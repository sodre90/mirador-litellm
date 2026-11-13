import type { Day } from "./calendar.ts";

/** Where a profile's gateway answers, and the key it reads with. The key never leaves the host. */
export interface GatewayAddress {
  url: string;
  key: string;
}

export interface ModelSpend {
  model: string;
  spend: number;
  requests: number;
  tokens: number;
}

export interface ProviderSpend {
  provider: string;
  spend: number;
}

/** A day's figures as the gateway counts them. Prompt tokens include those read from or written to the cache. */
export interface DaySpend {
  day: Day;
  spend: number;
  requests: number;
  failedRequests: number;
  tokens: number;
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** What reading prompts from the cache saved, against what the same tokens would have cost uncached. */
  cachingSavings: number;
  /** By model group: the name a client asks for, as the request logs name it too. */
  models: ModelSpend[];
  providers: ProviderSpend[];
}

/** One request the gateway logged, as the window lists it. */
export interface LoggedRequest {
  requestId: string;
  sessionId: string;
  startedAt: string;
  model: string;
  spend: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number | null;
  /** From the request's start to the model's first token; null when the gateway didn't note it. */
  firstTokenMs: number | null;
  failed: boolean;
  /** Why a failed request failed, as the gateway classed it. */
  failure: string | null;
}

export interface KeyInfo {
  alias: string | null;
  userId: string | null;
  /** The gateway's own id of the key, a hash, which its daily activity filters by. */
  keyId: string | null;
  spend: number | null;
  maxBudget: number | null;
  /** How often the budget starts again, such as "30d" or "1mo"; null for a budget that never does. */
  budgetDuration: string | null;
  budgetResetAt: string | null;
}

const ANSWER_MS = 15_000;
const PAGE_SIZE = 1000;
const MOST_PAGES = 20;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const textOf = (value: unknown) => (typeof value === "string" && value ? value : null);

/** What went wrong asking the gateway, in words that name neither the key nor what the gateway said back. */
export class GatewayProblem extends Error {}

function problemOfStatus(status: number, path: string, url: string) {
  if (status === 401 || status === 403) return new GatewayProblem(`The gateway refused the access key (HTTP ${status}).`);
  if (status === 404) return new GatewayProblem(`${url} has no ${path}: is it a LiteLLM proxy?`);
  return new GatewayProblem(`The gateway answered HTTP ${status} to ${path}.`);
}

function problemOfFailure(error: unknown, url: string) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new GatewayProblem(`${url} didn't answer within ${ANSWER_MS / 1000} seconds.`);
  }
  const code = isObject((error as { cause?: unknown })?.cause) ? textOf(((error as { cause: Json }).cause).code) : null;
  return new GatewayProblem(`Couldn't reach ${url}${code ? ` (${code})` : ""}.`);
}

/** Where the proxy's own routes are: an OpenAI-style address ending in /v1 has them at its root. */
export const baseOf = (url: string) => url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");

async function getJson({ url, key }: GatewayAddress, path: string, query: Record<string, string | number> = {}): Promise<Json> {
  const base = baseOf(url);
  const search = new URLSearchParams(Object.entries(query).map(([name, value]) => [name, String(value)]));
  const target = `${base}${path}${search.size > 0 ? `?${search}` : ""}`;
  let response: Response;
  try {
    response = await fetch(target, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(ANSWER_MS) });
  } catch (error) {
    throw problemOfFailure(error, base);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw problemOfStatus(response.status, path, base);
  }
  const answer: unknown = await response.json().catch(() => null);
  if (!isObject(answer)) throw new GatewayProblem(`The gateway's answer to ${path} wasn't what a LiteLLM proxy sends.`);
  return answer;
}

/** The proxy's version, from its readiness check; null when it doesn't say. */
export async function versionOf(address: GatewayAddress): Promise<string | null> {
  return textOf((await getJson(address, "/health/readiness")).litellm_version);
}

/** The key as the proxy knows it; its id is the proxy's hash of it, never the key itself, which a proxy may echo back. */
export async function keyInfoOf(address: GatewayAddress): Promise<KeyInfo> {
  const answer = await getJson(address, "/key/info");
  const info = isObject(answer.info) ? answer.info : {};
  return {
    alias: textOf(info.key_alias) ?? textOf(info.key_name),
    userId: textOf(info.user_id),
    keyId: [textOf(answer.key), textOf(info.token)].find((id) => id !== null && id !== address.key.trim()) ?? null,
    spend: typeof info.spend === "number" ? info.spend : null,
    maxBudget: typeof info.max_budget === "number" ? info.max_budget : null,
    budgetDuration: textOf(info.budget_duration),
    budgetResetAt: textOf(info.budget_reset_at),
  };
}

/** Every page of an endpoint that pages, as long as it says there is more. */
async function allPages(address: GatewayAddress, path: string, query: Record<string, string | number>, hasMore: (answer: Json, page: number) => boolean, page = 1): Promise<Json[]> {
  const answer = await getJson(address, path, { ...query, page, page_size: PAGE_SIZE });
  const morePages = hasMore(answer, page) && page < MOST_PAGES ? await allPages(address, path, query, hasMore, page + 1) : [];
  return [answer, ...morePages];
}

function modelSpendOf(model: string, value: unknown): ModelSpend {
  const metrics = isObject(value) && isObject(value.metrics) ? value.metrics : {};
  return { model, spend: numberOf(metrics.spend), requests: numberOf(metrics.api_requests), tokens: numberOf(metrics.total_tokens) };
}

const breakdownOf = (result: Json, part: string) => (isObject(result.breakdown) && isObject(result.breakdown[part]) ? result.breakdown[part] : {});

/** Model groups where the proxy reports them; a proxy from before them reports models alone. */
function modelsOf(result: Json): ModelSpend[] {
  const groups = breakdownOf(result, "model_groups");
  const models = Object.keys(groups).length > 0 ? groups : breakdownOf(result, "models");
  return Object.entries(models).map(([model, value]) => modelSpendOf(model, value));
}

function daySpendOf(result: unknown): DaySpend | null {
  if (!isObject(result) || typeof result.date !== "string") return null;
  const metrics = isObject(result.metrics) ? result.metrics : {};
  return {
    day: result.date.slice(0, 10),
    spend: numberOf(metrics.spend),
    requests: numberOf(metrics.api_requests),
    failedRequests: numberOf(metrics.failed_requests),
    tokens: numberOf(metrics.total_tokens),
    promptTokens: numberOf(metrics.prompt_tokens),
    cacheReadTokens: numberOf(metrics.cache_read_input_tokens),
    cacheWriteTokens: numberOf(metrics.cache_creation_input_tokens),
    cachingSavings: numberOf(metrics.prompt_caching_savings_spend),
    models: modelsOf(result),
    providers: Object.entries(breakdownOf(result, "providers")).map(([provider, value]) => ({ provider, spend: modelSpendOf(provider, value).spend })),
  };
}

function mergedBy<T extends object>(parts: T[], name: keyof T): T[] {
  return [...Map.groupBy(parts, (part) => part[name]).values()].map(summed);
}

/** The parts added up, field by field: numbers summed, anything else as the first part has it. */
function summed<T extends object>(parts: T[]): T {
  const fields = (part: T) => Object.entries(part) as [string, unknown][];
  const [first, ...rest] = parts;
  const total = new Map(fields(first!));
  rest.flatMap(fields).forEach(([field, value]) => {
    const known = total.get(field);
    if (typeof known === "number" && typeof value === "number") total.set(field, known + value);
  });
  return Object.fromEntries(total) as T;
}

/** A day the gateway split across pages counts once, with what each page had of it. */
export function mergedDays(days: DaySpend[]): DaySpend[] {
  const byDay = Map.groupBy(days, ({ day }) => day);
  return [...byDay.values()]
    .map((parts) => ({
      ...summed(parts),
      models: mergedBy(parts.flatMap(({ models }) => models), "model"),
      providers: mergedBy(parts.flatMap(({ providers }) => providers), "provider"),
    }))
    .sort((one, other) => one.day.localeCompare(other.day));
}

/**
 * The spend of the key's user, or of the key alone when it has no user, each day from `from` through `to`; a day
 * without spend is missing.
 */
export async function dailySpendOf(address: GatewayAddress, key: KeyInfo, from: Day, to: Day): Promise<DaySpend[]> {
  const scope: Record<string, string> = key.userId || !key.keyId ? {} : { api_key: key.keyId };
  const pages = await allPages(address, "/user/daily/activity", { start_date: from, end_date: to, ...scope }, (answer) => isObject(answer.metadata) && answer.metadata.has_more === true);
  const results = pages.flatMap((page) => (Array.isArray(page.results) ? page.results : []));
  return mergedDays(results.flatMap((result) => daySpendOf(result) ?? []));
}

/** A time the gateway wrote, which it may leave without a zone though it means UTC; null when it isn't one. */
export function timeOf(text: string | null): number | null {
  if (!text) return null;
  const time = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(time) ? null : time;
}

function firstTokenMsOf(row: Json): number | null {
  const started = timeOf(textOf(row.startTime));
  const firstToken = timeOf(textOf(row.completionStartTime));
  return started !== null && firstToken !== null && firstToken > started ? firstToken - started : null;
}

function failureOf(metadata: Json): string | null {
  const error = isObject(metadata.error_information) ? metadata.error_information : {};
  const parts = [textOf(error.error_class), textOf(String(error.error_code ?? "")) && `HTTP ${error.error_code}`].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function loggedRequestOf(row: unknown): LoggedRequest | null {
  if (!isObject(row) || typeof row.request_id !== "string" || typeof row.session_id !== "string") return null;
  const status = textOf(row.status);
  const failed = status !== null && status !== "success";
  const metadata = isObject(row.metadata) ? row.metadata : {};
  const usage = isObject(metadata.usage_object) ? metadata.usage_object : {};
  const promptDetails = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  return {
    requestId: row.request_id,
    sessionId: row.session_id,
    startedAt: textOf(row.startTime) ?? "",
    model: textOf(row.model_group) ?? textOf(row.model) ?? "",
    spend: numberOf(row.spend),
    promptTokens: numberOf(row.prompt_tokens),
    completionTokens: numberOf(row.completion_tokens),
    cacheReadTokens: numberOf(usage.cache_read_input_tokens ?? promptDetails.cached_tokens),
    cacheWriteTokens: numberOf(usage.cache_creation_input_tokens),
    durationMs: typeof row.request_duration_ms === "number" ? row.request_duration_ms : null,
    firstTokenMs: failed ? null : firstTokenMsOf(row),
    failed,
    failure: failed ? failureOf(metadata) : null,
  };
}

/**
 * The requests the gateway logged for a session, from `from` through `to`. The gateway matches session ids by part,
 * so only the session's own rows count, each once.
 */
export async function sessionRequestsOf(address: GatewayAddress, sessionId: string, from: Day, to: Day): Promise<LoggedRequest[]> {
  if (!sessionId) return [];
  const pages = await allPages(address, "/spend/logs/v2", { session_id: sessionId, start_date: from, end_date: to }, (answer, page) => numberOf(answer.total_pages) > page);
  const rows = pages.flatMap((page) => (Array.isArray(page.data) ? page.data : [])).flatMap((row) => loggedRequestOf(row) ?? []);
  const own = rows.filter((row) => row.sessionId === sessionId);
  return [...new Map(own.map((row) => [row.requestId, row])).values()];
}

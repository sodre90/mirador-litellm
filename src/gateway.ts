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

export interface DaySpend {
  day: Day;
  spend: number;
  requests: number;
  tokens: number;
  models: ModelSpend[];
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
  durationMs: number | null;
  failed: boolean;
}

export interface KeyInfo {
  alias: string | null;
  userId: string | null;
  /** The gateway's own id of the key, a hash, which its daily activity filters by. */
  keyId: string | null;
  spend: number | null;
  maxBudget: number | null;
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

function daySpendOf(result: unknown): DaySpend | null {
  if (!isObject(result) || typeof result.date !== "string") return null;
  const metrics = isObject(result.metrics) ? result.metrics : {};
  const models = isObject(result.breakdown) && isObject(result.breakdown.models) ? result.breakdown.models : {};
  return {
    day: result.date.slice(0, 10),
    spend: numberOf(metrics.spend),
    requests: numberOf(metrics.api_requests),
    tokens: numberOf(metrics.total_tokens),
    models: Object.entries(models).map(([model, value]) => modelSpendOf(model, value)),
  };
}

function mergedModels(models: ModelSpend[]): ModelSpend[] {
  const byModel = new Map<string, ModelSpend>();
  models.forEach(({ model, spend, requests, tokens }) => {
    const known = byModel.get(model) ?? { model, spend: 0, requests: 0, tokens: 0 };
    byModel.set(model, { model, spend: known.spend + spend, requests: known.requests + requests, tokens: known.tokens + tokens });
  });
  return [...byModel.values()];
}

/** A day the gateway split across pages counts once, with what each page had of it. */
export function mergedDays(days: DaySpend[]): DaySpend[] {
  const byDay = Map.groupBy(days, ({ day }) => day);
  return [...byDay.entries()]
    .map(([day, parts]) => ({
      day,
      spend: parts.reduce((sum, { spend }) => sum + spend, 0),
      requests: parts.reduce((sum, { requests }) => sum + requests, 0),
      tokens: parts.reduce((sum, { tokens }) => sum + tokens, 0),
      models: mergedModels(parts.flatMap(({ models }) => models)),
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

function loggedRequestOf(row: unknown): LoggedRequest | null {
  if (!isObject(row) || typeof row.request_id !== "string" || typeof row.session_id !== "string") return null;
  const status = textOf(row.status);
  return {
    requestId: row.request_id,
    sessionId: row.session_id,
    startedAt: textOf(row.startTime) ?? "",
    model: textOf(row.model_group) ?? textOf(row.model) ?? "",
    spend: numberOf(row.spend),
    promptTokens: numberOf(row.prompt_tokens),
    completionTokens: numberOf(row.completion_tokens),
    durationMs: typeof row.request_duration_ms === "number" ? row.request_duration_ms : null,
    failed: status !== null && status !== "success",
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

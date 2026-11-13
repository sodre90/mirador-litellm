import { addDays, daysBetween, periodsOf, type Day, type Periods } from "./calendar.ts";
import { clockTime, money, spentSince } from "./chips.ts";
import { baseOf, timeOf, type DaySpend, type KeyInfo, type LoggedRequest } from "./gateway.ts";
import type { ConversationRecord, ConversationRecords } from "./records.ts";
import { spendOf, type Gateway, type SpendCache } from "./spend.ts";

const LISTED_CONVERSATIONS = 25;
const LISTED_REQUESTS = 200;
const TREND_DAYS = 14;
/** The full days before today whose average spend the month's pace takes. */
const PACE_DAYS = 14;
/** The models the charts tell apart by colour, the most spent on first; the rest count together as "Other". */
const COLOURED_MODELS = 4;
export const OTHER_MODELS = "Other";
const DAY_MS = 86_400_000;

const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", pi: "pi", codex: "Codex", opencode: "opencode" };

/** A gateway as the window offers it: where it is and the profiles that use it. */
export interface WindowGateway {
  id: string;
  label: string;
  profiles: string[];
}

export interface WindowState {
  gateways: WindowGateway[];
  selected: string | null;
  overview: ReturnType<typeof overviewOf> | null;
  conversations: ReturnType<typeof conversationsOf>;
  focus: ReturnType<typeof focusOf>;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const gatewayLabel = (gateway: Gateway) => hostOf(baseOf(gateway.address.url));

const total = <T>(items: T[], pick: (item: T) => number) => items.reduce((sum, item) => sum + pick(item), 0);
const shareOf = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** Dollars with their cents, however many: the month's figure, which the window sets large. */
export const withCents = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Tokens as short as they read: 900, 38.1K, 1.24M. */
export function compact(count: number): string {
  if (count >= 10_000_000) return `${Math.round(count / 1_000_000)}M`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(Math.round(count));
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const utcDate = (day: Day) => new Date(`${day}T00:00:00Z`);
const monthNameOf = (day: Day) => utcDate(day).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
export const dayLabel = (day: Day) => utcDate(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (day: Day) => utcDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const lengthOfMonth = (day: Day) => new Date(Date.UTC(utcDate(day).getUTCFullYear(), utcDate(day).getUTCMonth() + 1, 0)).getUTCDate();

/** How long ago, in the words a list of conversations uses. */
export function relativeTime(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  const daysAgo = Math.round((Date.parse(new Date(now).toISOString().slice(0, 10)) - Date.parse(new Date(time).toISOString().slice(0, 10))) / DAY_MS);
  if (daysAgo <= 1) return "yesterday";
  if (daysAgo < 7) return new Date(time).toLocaleDateString("en-US", { weekday: "long" });
  return new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The models of the last 30 days the charts colour, the most spent on first. */
function colouredModelsOf(days: DaySpend[], periods: Periods): string[] {
  const recent = days.filter(({ day }) => day >= periods.chartFrom);
  const byModel = Map.groupBy(
    recent.flatMap(({ models }) => models),
    ({ model }) => model,
  );
  return [...byModel.entries()]
    .map(([model, parts]) => ({ model, spend: total(parts, ({ spend }) => spend) }))
    .filter(({ spend }) => spend > 0)
    .sort((one, other) => other.spend - one.spend)
    .slice(0, COLOURED_MODELS)
    .map(({ model }) => model);
}

/** A model's colour in the charts: 1 for the most spent on, up to 4; 0 for every other model, counted as "Other". */
const slotIn = (coloured: string[]) => (model: string) => coloured.indexOf(model) + 1;

function monthOf(days: DaySpend[], { today, month, lastMonth }: Periods, now: number) {
  const spentOn = new Map(days.map(({ day, spend }) => [day, spend]));
  const runningTotals = (from: Day, through: Day) => daysBetween(from, through).reduce<number[]>((sums, day) => [...sums, (sums.at(-1) ?? 0) + (spentOn.get(day) ?? 0)], []);
  const thisMonth = runningTotals(month, today);
  const before = runningTotals(lastMonth, addDays(month, -1));
  const spent = thisMonth.at(-1) ?? 0;
  const dayOfMonth = thisMonth.length;
  const sameDaysBefore = before[Math.min(dayOfMonth, before.length) - 1] ?? 0;
  const pace = total(daysBetween(addDays(today, -PACE_DAYS), addDays(today, -1)), (day) => spentOn.get(day) ?? 0) / PACE_DAYS;
  const length = lengthOfMonth(today);
  const projected = spent + pace * (length - dayOfMonth);
  return {
    name: monthNameOf(today),
    previousName: monthNameOf(lastMonth),
    shown: withCents(spent),
    sameDaysBefore: money(sameDaysBefore),
    change: sameDaysBefore > 0 ? (spent - sameDaysBefore) / sameDaysBefore : null,
    previousTotal: money(before.at(-1) ?? 0),
    projected: money(projected),
    projectedAmount: projected,
    endsOn: `${monthNameOf(today)} ${length}`,
    dayOfMonth,
    length,
    runningTotals: thisMonth,
    previousRunningTotals: before,
    asOf: clockTime(now),
  };
}

/** "30d", "1mo", "24h" in milliseconds; null for what the gateway may write that isn't one of those. */
function durationMsOf(duration: string | null): number | null {
  const [, amount, unit] = duration?.trim().match(/^(\d+)\s*(s|m|h|d|w|mo)$/) ?? [];
  if (!amount || !unit) return null;
  const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS, mo: 30 * DAY_MS };
  return Number(amount) * unitMs[unit]!;
}

function budgetOf(key: KeyInfo | null, now: number) {
  if (!key || key.maxBudget === null || key.maxBudget <= 0 || key.spend === null) return null;
  const resetsAt = timeOf(key.budgetResetAt);
  const periodMs = durationMsOf(key.budgetDuration);
  const elapsed = resetsAt !== null && periodMs !== null ? Math.min(1, Math.max(0, 1 - (resetsAt - now) / periodMs)) : null;
  return {
    used: key.spend / key.maxBudget,
    spent: money(key.spend),
    limit: money(key.maxBudget),
    keyAlias: key.alias,
    resetsOn: resetsAt === null ? null : new Date(resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" }),
    elapsed,
  };
}

/** The month's prompt tokens split by what the cache did with them; null before any prompt. */
function cacheOf(days: DaySpend[]) {
  const read = total(days, ({ cacheReadTokens }) => cacheReadTokens);
  const written = total(days, ({ cacheWriteTokens }) => cacheWriteTokens);
  const prompt = total(days, ({ promptTokens }) => promptTokens);
  const promptIncludesCache = prompt >= read + written;
  const input = promptIncludesCache ? prompt : prompt + read + written;
  if (input === 0) return null;
  const saved = total(days, ({ cachingSavings }) => cachingSavings);
  const spent = total(days, ({ spend }) => spend);
  return {
    readShare: read / input,
    writtenShare: written / input,
    uncachedShare: (input - read - written) / input,
    read: compact(read),
    written: compact(written),
    uncached: compact(input - read - written),
    saved: money(saved),
    savedShare: shareOf(saved, spent + saved),
  };
}

function tilesOf(days: DaySpend[], { today, week }: Periods, month: DaySpend[]) {
  const spentOn = new Map(days.map((day) => [day.day, day]));
  const spentBetween = (from: Day, through: Day) => total(daysBetween(from, through), (day) => spentOn.get(day)?.spend ?? 0);
  const thisWeek = spentSince(days, week);
  const lastWeek = spentBetween(addDays(week, -7), addDays(today, -7));
  const requests = total(month, ({ requests }) => requests);
  const failed = total(month, ({ failedRequests }) => failedRequests);
  const cache = cacheOf(month);
  return {
    today: { shown: money(spentOn.get(today)?.spend ?? 0), requests: spentOn.get(today)?.requests ?? 0, trend: daysBetween(addDays(today, 1 - TREND_DAYS), today).map((day) => spentOn.get(day)?.spend ?? 0) },
    week: { shown: money(thisWeek), change: lastWeek > 0 ? (thisWeek - lastWeek) / lastWeek : null },
    requests: { count: requests, failed, failedShare: shareOf(failed, requests) },
    caching: cache ? { saved: cache.saved, readShare: cache.readShare } : null,
  };
}

function dailyOf(days: DaySpend[], { chartFrom, today }: Periods, coloured: string[]) {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const slotOf = slotIn(coloured);
  const chartDays = daysBetween(chartFrom, today).map((day) => {
    const spent = byDay.get(day);
    const models = spent?.models ?? [];
    const other = total(models.filter(({ model }) => slotOf(model) === 0), ({ spend }) => spend);
    const parts = [
      ...coloured.map((model, index) => ({ model, slot: index + 1, spend: total(models.filter((part) => part.model === model), ({ spend }) => spend) })),
      { model: OTHER_MODELS, slot: 0, spend: other },
    ].filter(({ spend }) => spend > 0);
    return {
      day,
      label: dayLabel(day),
      tick: day === today ? "Today" : utcDate(day).getUTCDay() === 1 ? shortDay(day) : null,
      spend: spent?.spend ?? 0,
      shown: money(spent?.spend ?? 0),
      requests: spent?.requests ?? 0,
      parts: parts.map((part) => ({ ...part, shown: money(part.spend) })),
    };
  });
  const hasOther = chartDays.some(({ parts }) => parts.some(({ slot }) => slot === 0));
  return { models: [...coloured.map((model, index) => ({ model, slot: index + 1 })), ...(hasOther ? [{ model: OTHER_MODELS, slot: 0 }] : [])], days: chartDays };
}

function modelsOf(month: DaySpend[], coloured: string[]) {
  const slotOf = slotIn(coloured);
  const monthSpend = total(month, ({ spend }) => spend);
  const byModel = Map.groupBy(
    month.flatMap(({ models }) => models),
    ({ model }) => model,
  );
  return [...byModel.entries()]
    .map(([model, parts]) => ({ model, spend: total(parts, ({ spend }) => spend), requests: total(parts, ({ requests }) => requests) }))
    .filter(({ spend, requests }) => spend > 0 || requests > 0)
    .sort((one, other) => other.spend - one.spend)
    .map((model) => ({ ...model, slot: slotOf(model.model), shown: money(model.spend), each: model.requests > 0 ? money(model.spend / model.requests) : null, share: shareOf(model.spend, monthSpend) }));
}

function providersOf(month: DaySpend[]) {
  const monthSpend = total(month, ({ spend }) => spend);
  const byProvider = Map.groupBy(
    month.flatMap(({ providers }) => providers),
    ({ provider }) => provider,
  );
  return [...byProvider.entries()]
    .map(([provider, parts]) => ({ provider, spend: total(parts, ({ spend }) => spend) }))
    .filter(({ spend }) => spend > 0)
    .sort((one, other) => other.spend - one.spend)
    .map(({ provider, spend }) => ({ provider, shown: money(spend), share: shareOf(spend, monthSpend) }));
}

function overviewOf(gateway: Gateway, now: number) {
  const { spend } = gateway;
  const periods = periodsOf(now);
  const days = spend.value?.days ?? [];
  const month = days.filter(({ day }) => day >= periods.month);
  const coloured = colouredModelsOf(days, periods);
  const key = spend.value?.key ?? null;
  return {
    uiUrl: `${baseOf(gateway.address.url)}/ui`,
    who: key?.userId ?? null,
    keyAlias: key?.alias ?? null,
    asOf: spend.fetchedAt === null ? null : clockTime(spend.fetchedAt),
    problem: spend.problem,
    loading: spend.loading,
    stale: spend.stale,
    known: spend.value !== null,
    month: monthOf(days, periods, now),
    budget: budgetOf(key, now),
    tiles: tilesOf(days, periods, month),
    daily: dailyOf(days, periods, coloured),
    models: modelsOf(month, coloured),
    providers: providersOf(month),
    cache: cacheOf(month),
  };
}

/** Profile names with the agent each runs. */
export type ProfileAgents = Record<string, string>;

const agentOf = (profile: string | null, agents: ProfileAgents) => {
  const id = profile ? (agents[profile] ?? null) : null;
  return id === null ? null : { id, name: AGENT_NAMES[id] ?? id };
};

const lastRequestAt = (requests: LoggedRequest[]) => timeOf(requests.at(-1)?.startedAt ?? null);

function conversationsOf(gateway: Gateway | undefined, records: ConversationRecords, cache: SpendCache, agents: ProfileAgents, now: number) {
  if (!gateway) return [];
  return Object.entries(records)
    .filter(([, record]) => record.gateway === gateway.id)
    .sort(([, one], [, other]) => other.since - one.since)
    .slice(0, LISTED_CONVERSATIONS)
    .map(([id, record]) => {
      const fetched = cache.requestsOf(id, record);
      const requests = fetched?.value ?? null;
      const lastAt = requests ? lastRequestAt(requests) : null;
      const linked = requests === null ? (fetched === null ? "unlinked" : "asking") : requests.length > 0 ? "linked" : "unlinked";
      return {
        id,
        title: record.title,
        profile: record.profile,
        agent: agentOf(record.profile, agents),
        sessions: record.sessionIds.length,
        linked,
        spend: requests ? money(spendOf(requests)) : null,
        amount: requests ? spendOf(requests) : 0,
        requests: requests?.length ?? null,
        lastRequest: lastAt === null ? null : relativeTime(lastAt, now),
        lastAt,
        since: record.since,
      };
    })
    .sort((one, other) => (other.lastAt ?? other.since) - (one.lastAt ?? one.since));
}

const costShown = (spend: number) => (spend > 0 && spend < 0.01 ? `$${spend.toFixed(4)}` : `$${spend.toFixed(2)}`);

/** A request's prompt, counting what it read from or wrote to the cache whether or not the gateway's count did. */
function inputOf({ promptTokens, cacheReadTokens, cacheWriteTokens }: LoggedRequest) {
  const input = promptTokens >= cacheReadTokens + cacheWriteTokens ? promptTokens : promptTokens + cacheReadTokens + cacheWriteTokens;
  return { input, cached: cacheReadTokens };
}

function clockTimeOrDay(time: number | null, startedAt: string) {
  if (time === null) return startedAt;
  return `${new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clockTime(time)}`;
}

const requestRow = (slotOf: (model: string) => number) => (request: LoggedRequest) => {
  const at = timeOf(request.startedAt);
  const { input, cached } = inputOf(request);
  return {
    id: request.requestId,
    at: clockTimeOrDay(at, request.startedAt),
    time: at,
    model: request.model,
    slot: slotOf(request.model),
    input: compact(input),
    cachedShare: input > 0 ? cached / input : null,
    output: compact(request.completionTokens),
    firstToken: request.firstTokenMs === null ? null : seconds(request.firstTokenMs),
    took: request.durationMs === null ? null : seconds(request.durationMs),
    cost: request.spend,
    spend: costShown(request.spend),
    failed: request.failed,
    failure: request.failure,
  };
};

function median(sorted: number[]) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function focusOf(conversationId: string | null, records: ConversationRecords, cache: SpendCache, agents: ProfileAgents, now: number) {
  const record: ConversationRecord | undefined = conversationId ? records[conversationId] : undefined;
  if (!conversationId || !record) return null;
  const fetched = cache.requestsOf(conversationId, record);
  const rows = fetched?.value ?? [];
  const gatewayDays = cache.knownGateway(record.gateway)?.spend.value?.days ?? [];
  const slotOf = slotIn(colouredModelsOf(gatewayDays, periodsOf(now)));
  const answered = rows.filter(({ failed }) => !failed);
  const spent = spendOf(rows);
  const inputs = answered.map(inputOf);
  const input = total(inputs, ({ input }) => input);
  const firstTokens = answered.flatMap(({ firstTokenMs }) => (firstTokenMs === null ? [] : [firstTokenMs])).sort((one, other) => one - other);
  const startedAt = timeOf(rows[0]?.startedAt ?? null);
  const timeline = rows.reduce<{ time: number; total: number; spend: string; model: string; slot: number; failed: boolean; failure: string | null }[]>((points, request) => {
    const time = timeOf(request.startedAt);
    if (time === null) return points;
    return [...points, { time, total: (points.at(-1)?.total ?? 0) + request.spend, spend: costShown(request.spend), model: request.model, slot: slotOf(request.model), failed: request.failed, failure: request.failure }];
  }, []);
  const models = [...new Set(rows.map(({ model }) => model))].map((model) => ({ model, slot: slotOf(model) }));
  return {
    id: conversationId,
    title: record.title,
    profile: record.profile,
    agent: agentOf(record.profile, agents),
    sessions: record.sessionIds.length,
    started: startedAt === null ? null : clockTimeOrDay(startedAt, ""),
    spend: money(spent),
    perRequest: answered.length > 0 ? costShown(spent / answered.length) : null,
    count: rows.length,
    failed: rows.length - answered.length,
    input: compact(input),
    cachedShare: input > 0 ? total(inputs, ({ cached }) => cached) / input : null,
    output: compact(total(answered, ({ completionTokens }) => completionTokens)),
    firstToken: firstTokens.length > 0 ? seconds(median(firstTokens)) : null,
    slowestFirstToken: firstTokens.length > 0 ? seconds(firstTokens.at(-1)!) : null,
    loading: fetched?.loading ?? false,
    problem: fetched?.problem ?? null,
    models,
    timeline,
    requests: rows.slice(-LISTED_REQUESTS).reverse().map(requestRow(slotOf)),
  };
}

interface WindowInput {
  gateways: WindowGateway[];
  selected: string | null;
  focus: string | null;
  records: ConversationRecords;
  cache: SpendCache;
  agents: ProfileAgents;
  now: number;
}

/** What the plugin's window draws, from what is already fetched: the window asks for fresh figures itself. */
export function windowStateOf({ gateways, selected, focus, records, cache, agents, now }: WindowInput): WindowState {
  const shown = gateways.find(({ id }) => id === selected) ?? gateways[0];
  const gateway = shown ? cache.knownGateway(shown.id) : undefined;
  return {
    gateways,
    selected: shown?.id ?? null,
    overview: gateway ? overviewOf(gateway, now) : null,
    conversations: conversationsOf(gateway, records, cache, agents, now),
    focus: focusOf(focus, records, cache, agents, now),
  };
}

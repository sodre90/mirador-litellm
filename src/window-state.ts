import { daysBetween, periodsOf } from "./calendar.ts";
import { clockTime, money, spentSince } from "./chips.ts";
import { baseOf, type LoggedRequest } from "./gateway.ts";
import type { ConversationRecords } from "./records.ts";
import { spendOf, type Gateway, type SpendCache } from "./spend.ts";

const LISTED_CONVERSATIONS = 25;
const LISTED_REQUESTS = 200;

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

function overviewOf(gateway: Gateway, now: number) {
  const { spend } = gateway;
  const periods = periodsOf(now);
  const days = spend.value?.days ?? [];
  const month = days.filter(({ day }) => day >= periods.month);
  const monthSpend = spentSince(days, periods.month);
  const byModel = Map.groupBy(
    month.flatMap(({ models }) => models),
    ({ model }) => model,
  );
  const models = [...byModel.entries()]
    .map(([model, parts]) => ({ model, spend: parts.reduce((sum, part) => sum + part.spend, 0), requests: parts.reduce((sum, part) => sum + part.requests, 0) }))
    .sort((one, other) => other.spend - one.spend)
    .map((model) => ({ ...model, shown: money(model.spend), share: monthSpend > 0 ? model.spend / monthSpend : 0 }));
  const spentOn = new Map(days.map(({ day, spend }) => [day, spend]));
  const key = spend.value?.key ?? null;
  return {
    uiUrl: `${baseOf(gateway.address.url)}/ui`,
    who: key ? (key.userId ?? `the key ${key.alias ?? "in use"}`) : null,
    keyAlias: key?.alias ?? null,
    asOf: spend.fetchedAt === null ? null : clockTime(spend.fetchedAt),
    problem: spend.problem,
    loading: spend.loading,
    stale: spend.stale,
    known: spend.value !== null,
    totals: [
      { label: "Today", shown: money(spentSince(days, periods.today)) },
      { label: "This week", shown: money(spentSince(days, periods.week)) },
      { label: "Month to date", shown: money(monthSpend) },
    ],
    chart: daysBetween(periods.chartFrom, periods.today).map((day) => ({ day, spend: spentOn.get(day) ?? 0, shown: money(spentOn.get(day) ?? 0) })),
    models,
  };
}

function conversationsOf(gateway: Gateway | undefined, records: ConversationRecords, cache: SpendCache) {
  if (!gateway) return [];
  return Object.entries(records)
    .filter(([, record]) => record.gateway === gateway.id)
    .sort(([, one], [, other]) => other.since - one.since)
    .slice(0, LISTED_CONVERSATIONS)
    .map(([id, record]) => {
      const requests = cache.requestsOf(id, record)?.value ?? null;
      return { id, title: record.title, profile: record.profile, sessions: record.sessionIds.length, spend: requests ? money(spendOf(requests)) : null, requests: requests?.length ?? null };
    });
}

const requestRow = (request: LoggedRequest) => ({
  id: request.requestId,
  at: request.startedAt ? clockTimeOrDay(request.startedAt) : "",
  model: request.model,
  tokens: request.promptTokens + request.completionTokens,
  seconds: request.durationMs === null ? null : Math.round(request.durationMs / 100) / 10,
  spend: request.spend < 0.01 ? `$${request.spend.toFixed(4)}` : `$${request.spend.toFixed(2)}`,
  failed: request.failed,
});

function clockTimeOrDay(startedAt: string) {
  const time = Date.parse(startedAt.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(startedAt) ? startedAt : `${startedAt}Z`);
  if (Number.isNaN(time)) return startedAt;
  return `${new Date(time).toLocaleDateString([], { month: "short", day: "numeric" })} ${clockTime(time)}`;
}

function focusOf(conversationId: string | null, records: ConversationRecords, cache: SpendCache) {
  const record = conversationId ? records[conversationId] : undefined;
  if (!conversationId || !record) return null;
  const requests = cache.requestsOf(conversationId, record);
  const rows = requests?.value ?? [];
  return {
    id: conversationId,
    title: record.title,
    sessions: record.sessionIds.length,
    spend: money(spendOf(rows)),
    count: rows.length,
    loading: requests?.loading ?? false,
    problem: requests?.problem ?? null,
    requests: rows.slice(-LISTED_REQUESTS).reverse().map(requestRow),
  };
}

interface WindowInput {
  gateways: WindowGateway[];
  selected: string | null;
  focus: string | null;
  records: ConversationRecords;
  cache: SpendCache;
  now: number;
}

/** What the plugin's window draws, from what is already fetched: the window asks for fresh figures itself. */
export function windowStateOf({ gateways, selected, focus, records, cache, now }: WindowInput): WindowState {
  const shown = gateways.find(({ id }) => id === selected) ?? gateways[0];
  const gateway = shown ? cache.knownGateway(shown.id) : undefined;
  return {
    gateways,
    selected: shown?.id ?? null,
    overview: gateway ? overviewOf(gateway, now) : null,
    conversations: conversationsOf(gateway, records, cache),
    focus: focusOf(focus, records, cache),
  };
}

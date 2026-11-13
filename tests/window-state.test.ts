import { describe, expect, test } from "bun:test";
import { daysBetween } from "../src/calendar.ts";
import type { DaySpend, KeyInfo, LoggedRequest } from "../src/gateway.ts";
import type { ConversationRecords } from "../src/records.ts";
import { SpendCache, gatewayIdOf } from "../src/spend.ts";
import { compact, relativeTime, windowStateOf } from "../src/window-state.ts";

const FRIDAY = Date.parse("2026-11-13T10:00:00Z");
const ADDRESS = { url: "https://llm.example.com", key: "sk-window-secret" };
const GATEWAY = gatewayIdOf(ADDRESS);
const NO_BUDGET: KeyInfo = { alias: "laptop", userId: "sam@example.com", keyId: "hashed", spend: 25, maxBudget: null, budgetDuration: null, budgetResetAt: null };

type ModelDay = { spend: number; requests?: number; failed?: number; prompt?: number; read?: number; written?: number; saved?: number; provider?: string };

function daySpent(day: string, models: Record<string, ModelDay>): DaySpend {
  const parts = Object.entries(models);
  const sum = (pick: (model: ModelDay) => number | undefined) => parts.reduce((total, [, model]) => total + (pick(model) ?? 0), 0);
  const byProvider = Map.groupBy(parts, ([, { provider = "anthropic" }]) => provider);
  return {
    day,
    spend: sum(({ spend }) => spend),
    requests: sum(({ requests }) => requests),
    failedRequests: sum(({ failed }) => failed),
    tokens: 0,
    promptTokens: sum(({ prompt }) => prompt),
    cacheReadTokens: sum(({ read }) => read),
    cacheWriteTokens: sum(({ written }) => written),
    cachingSavings: sum(({ saved }) => saved),
    models: parts.map(([model, { spend, requests = 0 }]) => ({ model, spend, requests, tokens: 0 })),
    providers: [...byProvider.entries()].map(([provider, served]) => ({ provider, spend: served.reduce((total, [, { spend }]) => total + spend, 0) })),
  };
}

function windowOn(days: DaySpend[], { key = NO_BUDGET, records = {}, requests = {}, focus = null }: { key?: KeyInfo; records?: ConversationRecords; requests?: Record<string, LoggedRequest[] | null>; focus?: string | null } = {}) {
  const cache = new SpendCache(() => {}, () => FRIDAY);
  const gateway = cache.gateway(ADDRESS);
  gateway.spend.value = { key, days };
  gateway.spend.fetchedAt = FRIDAY;
  Object.entries(records).forEach(([id, record]) => {
    const fetched = cache.requestsOf(id, record);
    if (fetched && requests[id] !== undefined) fetched.value = requests[id];
  });
  return windowStateOf({ gateways: [{ id: GATEWAY, label: "llm.example.com", profiles: ["Work", "Pi"] }], selected: null, focus, records, cache, agents: { Work: "claude", Pi: "pi" }, now: FRIDAY });
}

describe("the month", () => {
  const october = daysBetween("2026-10-01", "2026-10-31").map((day) => daySpent(day, { "claude-opus": { spend: 10 } }));
  const november = daysBetween("2026-11-01", "2026-11-12").map((day) => daySpent(day, { "claude-opus": { spend: 20 } }));
  const { month } = windowOn([...october, ...november, daySpent("2026-11-13", { "claude-opus": { spend: 5 } })]).overview!;

  test("against the same days of the month before, and that month's whole", () => {
    expect(month).toMatchObject({ name: "November", previousName: "October", shown: "$245.00", sameDaysBefore: "$130", previousTotal: "$310", dayOfMonth: 13, length: 30 });
    expect(month.change).toBeCloseTo(115 / 130);
    expect(month.runningTotals).toHaveLength(13);
    expect(month.runningTotals.at(-1)).toBe(245);
    expect(month.previousRunningTotals).toHaveLength(31);
  });

  test("goes on to its end at the pace of the last two weeks before today", () => {
    const pace = (2 * 10 + 12 * 20) / 14;
    expect(month.projectedAmount).toBeCloseTo(245 + pace * 17);
    expect(month).toMatchObject({ projected: "$561", endsOn: "November 30" });
  });
});

describe("the gateway's figures this month", () => {
  const days = [
    daySpent("2026-10-05", { "claude-opus": { spend: 10, requests: 10 } }),
    daySpent("2026-11-03", {
      "claude-opus": { spend: 6, requests: 20, failed: 1, prompt: 1000, read: 600, written: 100, saved: 1.2 },
      "claude-sonnet": { spend: 2, requests: 40 },
      "claude-haiku": { spend: 0.5, requests: 30 },
      "gpt-5": { spend: 1, requests: 10, provider: "openai" },
      "gpt-5-mini": { spend: 0.25, requests: 5, provider: "openai" },
    }),
    daySpent("2026-11-06", { "claude-opus": { spend: 4, requests: 10 } }),
    daySpent("2026-11-10", { "claude-opus": { spend: 3, requests: 10 }, "claude-sonnet": { spend: 1, requests: 20 } }),
    daySpent("2026-11-13", { "claude-opus": { spend: 2, requests: 5, failed: 1, prompt: 500, read: 300, saved: 0.3 }, "gpt-5-mini": { spend: 0.1, requests: 2, provider: "openai" } }),
  ];
  const overview = windowOn(days).overview!;

  test("today with its last two weeks, the week against the same days of the last, the failed requests and what the cache saved", () => {
    expect(overview.tiles.today).toMatchObject({ shown: "$2.10", requests: 7 });
    expect(overview.tiles.today.trend).toHaveLength(14);
    expect(overview.tiles.today.trend.at(-1)).toBeCloseTo(2.1);
    expect(overview.tiles.week.shown).toBe("$6.10");
    expect(overview.tiles.week.change).toBeCloseTo((6.1 - 13.75) / 13.75);
    expect(overview.tiles.requests).toMatchObject({ count: 152, failed: 2 });
    expect(overview.tiles.caching).toMatchObject({ saved: "$1.50", readShare: 0.6 });
  });

  test("the prompt split by what the cache did with it, and the saving against what it would have cost", () => {
    expect(overview.cache).toMatchObject({ read: "900", written: "100", uncached: "500", saved: "$1.50" });
    expect(overview.cache!.uncachedShare).toBeCloseTo(1 / 3);
    expect(overview.cache!.savedShare).toBeCloseTo(1.5 / (19.85 + 1.5));
  });

  test("the four models spent on most in the last 30 days keep their colours everywhere, and the rest count as Other", () => {
    expect(overview.daily.models).toEqual([
      { model: "claude-opus", slot: 1 },
      { model: "claude-sonnet", slot: 2 },
      { model: "gpt-5", slot: 3 },
      { model: "claude-haiku", slot: 4 },
      { model: "Other", slot: 0 },
    ]);
    const today = overview.daily.days.at(-1)!;
    expect(today).toMatchObject({ day: "2026-11-13", label: "Fri, Nov 13", tick: "Today", shown: "$2.10", requests: 7 });
    expect(today.parts.map(({ model, slot, shown }) => [model, slot, shown])).toEqual([
      ["claude-opus", 1, "$2.00"],
      ["Other", 0, "$0.10"],
    ]);
    expect(overview.daily.days.find(({ day }) => day === "2026-11-09")!.tick).toBe("Nov 9");
    expect(overview.models.map(({ model, slot, requests, each }) => [model, slot, requests, each])).toEqual([
      ["claude-opus", 1, 45, "$0.33"],
      ["claude-sonnet", 2, 60, "$0.05"],
      ["gpt-5", 3, 10, "$0.10"],
      ["claude-haiku", 4, 30, "$0.02"],
      ["gpt-5-mini", 0, 7, "$0.05"],
    ]);
    expect(overview.providers.map(({ provider, shown }) => [provider, shown])).toEqual([
      ["anthropic", "$18.50"],
      ["openai", "$1.35"],
    ]);
  });

  test("a key without a budget shows none; one with a budget shows how much of it is spent and how far into its period", () => {
    expect(overview.budget).toBeNull();
    const budget = windowOn(days, { key: { ...NO_BUDGET, maxBudget: 100, budgetDuration: "30d", budgetResetAt: "2026-11-28T12:00:00Z" } }).overview!.budget!;
    expect(budget).toMatchObject({ used: 0.25, spent: "$25.00", limit: "$100", keyAlias: "laptop", resetsOn: "November 28" });
    expect(budget.elapsed).toBeCloseTo(1 - (Date.parse("2026-11-28T12:00:00Z") - FRIDAY) / (30 * 86_400_000));
  });
});

const loggedRequest = (id: string, minute: number, spend: number, more: Partial<LoggedRequest> = {}): LoggedRequest => ({
  requestId: id,
  sessionId: "session-1",
  startedAt: `2026-11-13T09:${String(minute).padStart(2, "0")}:00Z`,
  model: "claude-opus",
  spend,
  promptTokens: 1000,
  completionTokens: 100,
  cacheReadTokens: 800,
  cacheWriteTokens: 0,
  durationMs: 3000,
  firstTokenMs: 1000,
  failed: false,
  failure: null,
  ...more,
});

describe("conversations", () => {
  const records: ConversationRecords = {
    older: { title: "Speed up the nightly build", profile: "Work", gateway: GATEWAY, sessionIds: ["session-1"], since: FRIDAY - 3 * 86_400_000 },
    pi: { title: "Draft the migration guide", profile: "Pi", gateway: GATEWAY, sessionIds: ["pi-session"], since: FRIDAY - 60_000 },
    asking: { title: "Just started", profile: "Work", gateway: GATEWAY, sessionIds: ["session-3"], since: FRIDAY - 120_000 },
    elsewhere: { title: "On another gateway", profile: "Work", gateway: "other", sessionIds: ["session-4"], since: FRIDAY },
  };
  const requests = { older: [loggedRequest("r1", 30, 0.5), loggedRequest("r2", 50, 0.25)], pi: [] };
  const state = windowOn([], { records, requests });

  test("name their agent, the latest activity first, and say which the gateway logged no request of", () => {
    expect(state.conversations.map(({ id, agent, linked, requests, spend, lastRequest }) => ({ id, agent: agent?.name, linked, requests, spend, lastRequest }))).toEqual([
      { id: "pi", agent: "pi", linked: "unlinked", requests: 0, spend: "$0.00", lastRequest: null },
      { id: "asking", agent: "Claude Code", linked: "asking", requests: null, spend: null, lastRequest: null },
      { id: "older", agent: "Claude Code", linked: "linked", requests: 2, spend: "$0.75", lastRequest: "10 min ago" },
    ]);
  });

  test("say how long ago in words", () => {
    expect([30_000, 12 * 60_000, 2 * 3_600_000].map((ago) => relativeTime(FRIDAY - ago, FRIDAY))).toEqual(["just now", "12 min ago", "2 h ago"]);
    expect(relativeTime(Date.parse("2026-11-12T08:00:00Z"), FRIDAY)).toBe("yesterday");
    expect(relativeTime(Date.parse("2026-11-01T08:00:00Z"), FRIDAY)).toBe("Nov 1");
  });
});

describe("a conversation's page", () => {
  const records: ConversationRecords = { build: { title: "Speed up the nightly build", profile: "Work", gateway: GATEWAY, sessionIds: ["session-1"], since: FRIDAY - 86_400_000 } };
  const rows = [
    loggedRequest("first", 2, 0.31, { firstTokenMs: 1200 }),
    loggedRequest("refused", 5, 0, { failed: true, failure: "RateLimitError, HTTP 429", firstTokenMs: null, promptTokens: 0, cacheReadTokens: 0, completionTokens: 0 }),
    loggedRequest("second", 6, 0.38, { firstTokenMs: 2100, model: "claude-sonnet" }),
    loggedRequest("third", 9, 0.004, { firstTokenMs: 800, cacheReadTokens: 0 }),
  ];
  const days = [daySpent("2026-11-13", { "claude-opus": { spend: 5 }, "claude-sonnet": { spend: 1 } })];
  const { focus } = windowOn(days, { records, requests: { build: rows }, focus: "build" });

  test("sums up its spend, requests, prompt and cache, output and time to the first token", () => {
    expect(focus).toMatchObject({ title: "Speed up the nightly build", agent: { name: "Claude Code" }, sessions: 1, spend: "$0.69", perRequest: "$0.23", count: 4, failed: 1, input: "3.0K", output: "300", firstToken: "1.2s", slowestFirstToken: "2.1s" });
    expect(focus!.cachedShare).toBeCloseTo(1600 / 3000);
  });

  test("its spend adds up request by request, in the colours of the gateway's models", () => {
    expect(focus!.timeline.map(({ total, slot, failed }) => [Number(total.toFixed(3)), slot, failed])).toEqual([
      [0.31, 1, false],
      [0.31, 1, true],
      [0.69, 2, false],
      [0.694, 1, false],
    ]);
    expect(focus!.models).toEqual([
      { model: "claude-opus", slot: 1 },
      { model: "claude-sonnet", slot: 2 },
    ]);
  });

  test("lists its requests newest first, with a tiny cost in tenths of a cent and why one failed", () => {
    expect(focus!.requests.map(({ id, spend, cachedShare, firstToken, failure }) => [id, spend, cachedShare, firstToken, failure])).toEqual([
      ["third", "$0.0040", 0, "0.8s", null],
      ["second", "$0.38", 0.8, "2.1s", null],
      ["refused", "$0.00", null, null, "RateLimitError, HTTP 429"],
      ["first", "$0.31", 0.8, "1.2s", null],
    ]);
  });

  test("tokens read as short as they can", () => {
    expect([900, 38_100, 1_240_000, 12_400_000].map(compact)).toEqual(["900", "38.1K", "1.24M", "12M"]);
  });
});

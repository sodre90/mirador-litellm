import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { daysBetween, earliestOf, periodsOf, weekStartOf } from "../src/calendar.ts";
import { chipsOf, money } from "../src/chips.ts";
import { Fetched } from "../src/fetched.ts";
import { dailySpendOf, keyInfoOf, sessionRequestsOf, type DaySpend, type GatewayAddress, type LoggedRequest } from "../src/gateway.ts";
import type { GatewaySpend } from "../src/spend.ts";
import { startFakeGateway, type FakeGateway, type FakeRequest } from "./fake-gateway.ts";

const FRIDAY = Date.parse("2026-11-13T10:00:00Z");
const KEY = "sk-test-0000-secret";

describe("the days spend is counted over", () => {
  test("a week starts on Monday and every day is a UTC day", () => {
    expect(weekStartOf("2026-11-13")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09");
    expect(periodsOf(Date.parse("2026-11-13T23:30:00-05:00"))).toEqual({ today: "2026-11-14", week: "2026-11-09", month: "2026-11-01", lastMonth: "2026-10-01", chartFrom: "2026-10-16" });
  });

  test("one query reaches back to whichever period starts first: the month before, or the chart's first day early in March", () => {
    expect(earliestOf(periodsOf(Date.parse("2026-12-02T08:00:00Z")))).toBe("2026-11-01");
    expect(earliestOf(periodsOf(Date.parse("2027-03-01T08:00:00Z")))).toBe("2027-01-31");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("asking the gateway", () => {
  let gateway: FakeGateway;
  let address: GatewayAddress;
  const request = (id: string, sessionId: string, spend: number): FakeRequest => ({ request_id: id, session_id: sessionId, startTime: `2026-11-13T09:0${id.length}:00Z`, model_group: "claude-sonnet", spend });

  beforeAll(async () => {
    gateway = await startFakeGateway({ key: KEY });
    address = { url: `${gateway.url}/`, key: KEY };
  });
  afterAll(() => gateway.close());

  test("adds up a day the gateway split over pages, by model and provider, and asks for big pages", async () => {
    gateway.change({
      dailyPages: [
        [{ date: "2026-11-12", models: { "claude-sonnet": { spend: 2, requests: 4 } } }, { date: "2026-11-13", models: { "claude-sonnet": { spend: 1, requests: 2, cacheRead: 100 } } }],
        [{ date: "2026-11-13", models: { "claude-sonnet": { spend: 0.5, requests: 1, cacheRead: 50 }, "claude-haiku": { spend: 0.25, requests: 3, provider: "openai" } } }],
      ],
    });
    gateway.calls.length = 0;
    const days = await dailySpendOf(address, await keyInfoOf(address), "2026-11-01", "2026-11-14");
    expect(days.map(({ day, spend, requests }) => ({ day, spend, requests }))).toEqual([
      { day: "2026-11-12", spend: 2, requests: 4 },
      { day: "2026-11-13", spend: 1.75, requests: 6 },
    ]);
    expect(days[1]!.models).toEqual([
      { model: "claude-sonnet", spend: 1.5, requests: 3, tokens: 0 },
      { model: "claude-haiku", spend: 0.25, requests: 3, tokens: 0 },
    ]);
    expect(days[1]!.providers).toEqual([
      { provider: "anthropic", spend: 1.5 },
      { provider: "openai", spend: 0.25 },
    ]);
    expect(days[1]!.cacheReadTokens).toBe(150);
    const asked = gateway.calls.filter(({ pathname }) => pathname === "/user/daily/activity");
    expect(asked.map(({ searchParams }) => [searchParams.get("page"), searchParams.get("page_size"), searchParams.get("start_date"), searchParams.get("end_date")])).toEqual([
      ["1", "1000", "2026-11-01", "2026-11-14"],
      ["2", "1000", "2026-11-01", "2026-11-14"],
    ]);
    expect(asked[0]!.searchParams.has("api_key")).toBe(false);
  });

  test("reads failures, the cache and what it saved, and each provider's spend, by model group", async () => {
    gateway.change({
      dailyPages: [
        [
          {
            date: "2026-11-13",
            models: {
              "claude-sonnet": { spend: 3, requests: 10, failed: 1, promptTokens: 1000, cacheRead: 600, cacheWrite: 100, cachingSavings: 0.4, provider: "bedrock" },
              "gpt-5": { spend: 1, requests: 4, promptTokens: 200, provider: "azure" },
            },
          },
        ],
        [{ date: "2026-11-13", models: { "claude-sonnet": { spend: 1, requests: 2, failed: 1, promptTokens: 100, cacheRead: 50, cachingSavings: 0.1, provider: "bedrock" } } }],
      ],
    });
    const [day] = await dailySpendOf(address, await keyInfoOf(address), "2026-11-13", "2026-11-14");
    expect(day).toMatchObject({ spend: 5, requests: 16, failedRequests: 2, promptTokens: 1300, cacheReadTokens: 650, cacheWriteTokens: 100, cachingSavings: 0.5 });
    expect(day!.models.map(({ model, spend }) => [model, spend])).toEqual([
      ["claude-sonnet", 4],
      ["gpt-5", 1],
    ]);
    expect(day!.providers).toEqual([
      { provider: "bedrock", spend: 4 },
      { provider: "azure", spend: 1 },
    ]);
  });

  test("reads a request's cache, its time to the first token, and why it failed", async () => {
    gateway.change({
      requests: [
        { ...request("fast", "session-b", 0.2), startTime: "2026-11-13T09:00:00", completionStartTime: "2026-11-13T09:00:01.250000", prompt_tokens: 900, metadata: { usage_object: { cache_read_input_tokens: 700, cache_creation_input_tokens: 50 } } },
        { ...request("broken", "session-b", 0), status: "failure", completionStartTime: "2026-11-13T09:05:00Z", metadata: { error_information: { error_class: "RateLimitError", error_code: "429" } } },
      ],
    });
    const rows = await sessionRequestsOf(address, "session-b", "2026-11-13", "2026-11-14");
    expect(rows.map(({ requestId, cacheReadTokens, cacheWriteTokens, firstTokenMs, failed, failure }) => ({ requestId, cacheReadTokens, cacheWriteTokens, firstTokenMs, failed, failure }))).toEqual([
      { requestId: "fast", cacheReadTokens: 700, cacheWriteTokens: 50, firstTokenMs: 1250, failed: false, failure: null },
      { requestId: "broken", cacheReadTokens: 0, cacheWriteTokens: 0, firstTokenMs: null, failed: true, failure: "RateLimitError, HTTP 429" },
    ]);
  });

  test("reads the key's budget and when it starts again", async () => {
    gateway.change({ budget: { max: 200, spent: 50, duration: "30d", resetAt: "2026-11-28T12:00:00Z" } });
    expect(await keyInfoOf(address)).toMatchObject({ spend: 50, maxBudget: 200, budgetDuration: "30d", budgetResetAt: "2026-11-28T12:00:00Z" });
    gateway.change({ budget: undefined });
  });

  test("reads only the key's own spend when the key belongs to no user", async () => {
    gateway.change({ userId: null });
    gateway.calls.length = 0;
    await dailySpendOf(address, await keyInfoOf(address), "2026-11-01", "2026-11-14");
    expect(gateway.calls.find(({ pathname }) => pathname === "/user/daily/activity")!.searchParams.get("api_key")).toBe("hashed-key-id");
    gateway.change({ userId: undefined });
  });

  test("counts only the session's own requests, each once, over every page", async () => {
    const own = Array.from({ length: 1001 }, (_, index) => request(`own-${index}`, "session-a", 0.001));
    gateway.change({ requests: [...own, request("other", "session-a-and-more", 5)] });
    const rows = await sessionRequestsOf(address, "session-a", "2026-11-12", "2026-11-14");
    expect(rows).toHaveLength(1001);
    expect(new Set(rows.map(({ sessionId }) => sessionId))).toEqual(new Set(["session-a"]));
    gateway.calls.length = 0;
    expect(await sessionRequestsOf(address, "", "2026-11-12", "2026-11-14")).toEqual([]);
    expect(gateway.calls).toEqual([]);
  });

  test("says what went wrong in its own words, never with the key", async () => {
    const wrongKey = { url: gateway.url, key: "sk-wrong" };
    await expect(keyInfoOf(wrongKey)).rejects.toThrow("The gateway refused the access key (HTTP 401).");
    gateway.change({ failWith: 500 });
    const failed = await keyInfoOf(address).catch((error: Error) => error.message);
    expect(failed).toBe("The gateway answered HTTP 500 to /key/info.");
    expect(failed).not.toContain(KEY);
    gateway.change({ failWith: undefined });
    await expect(keyInfoOf({ url: "http://127.0.0.1:9", key: KEY })).rejects.toThrow(/^Couldn't reach http:\/\/127\.0\.0\.1:9/);
    await expect(keyInfoOf({ url: `${gateway.url}/nested`, key: KEY })).rejects.toThrow(`${gateway.url}/nested has no /key/info: is it a LiteLLM proxy?`);
  });

  test("finds the proxy's own routes at the root of an OpenAI-style address", async () => {
    expect((await keyInfoOf({ url: `${gateway.url}/v1/`, key: KEY })).alias).toBe("laptop");
  });

  test("never takes the key itself for its id, should the proxy echo it back", async () => {
    gateway.change({ echoesKey: true });
    expect((await keyInfoOf(address)).keyId).toBeNull();
    gateway.change({ echoesKey: false });
  });
});

describe("the statusline's chips", () => {
  const fetched = async <T>(value: T, now = FRIDAY) => {
    const figure = new Fetched(async () => value, 60_000, () => {}, () => now);
    await figure.refresh();
    return figure;
  };
  const daySpent = (day: string, spend: number): DaySpend => ({ day, spend, requests: 1, failedRequests: 0, tokens: 0, promptTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cachingSavings: 0, models: [], providers: [] });
  const spend: GatewaySpend = {
    key: { alias: "laptop", userId: "user-1", keyId: "hashed", spend: null, maxBudget: null, budgetDuration: null, budgetResetAt: null },
    days: [daySpent("2026-10-31", 100), daySpent("2026-11-03", 20), daySpent("2026-11-10", 7.5), daySpent("2026-11-13", 3.968)],
  };
  const requests: LoggedRequest[] = ["session-1", "session-1", "session-2"].map((sessionId, index) => ({
    requestId: `r${index}`,
    sessionId,
    startedAt: "2026-11-13T09:00:00Z",
    model: "claude-sonnet",
    spend: 0.5,
    promptTokens: 10,
    completionTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 1200,
    firstTokenMs: 400,
    failed: false,
    failure: null,
  }));
  const action = { gateway: "g1", conversation: "c1" };
  const allShown = { today: true, week: true, month: true, session: true };

  test("dollars take as little room as they can", () => {
    expect([0, 3.968, 99.994, 122.28, 4702.08, 12_345].map(money)).toEqual(["$0.00", "$3.97", "$99.99", "$122", "$4,702", "$12.3k"]);
  });

  test("today, the week from Monday and the month so far, then the conversation's own cost", async () => {
    const chips = chipsOf({ shown: allShown, spend: await fetched(spend), requests: await fetched(requests), action, now: FRIDAY });
    expect(chips.map(({ text }) => text)).toEqual(["Today $3.97", "Week $11.47", "Month $31.47", "Session $1.50"]);
    expect(chips[0]!.hint).toStartWith("What every key of user-1 spent through the gateway today, in UTC. As of ");
    expect(chips[3]).toMatchObject({ cost: { amount: 1.5, currency: "USD" }, opensWindow: { action }, hint: expect.stringContaining("3 requests over 2 sessions") });
    expect(chips.some(({ stale }) => stale)).toBe(false);
  });

  test("leave out what the profile turned off, and the session until the gateway logged a request of it", async () => {
    const chips = chipsOf({ shown: { ...allShown, week: false }, spend: await fetched(spend), requests: await fetched([]), action, now: FRIDAY });
    expect(chips.map(({ text }) => text)).toEqual(["Today $3.97", "Month $31.47"]);
    expect(chips.some(({ cost }) => cost)).toBe(false);
  });

  test("dim old figures, say why, and show a warning only when nothing is known yet", async () => {
    let fails = false;
    const figure = new Fetched(
      async () => {
        if (fails) throw new Error("The gateway answered HTTP 502 to /user/daily/activity.");
        return spend;
      },
      60_000,
      () => {},
      () => FRIDAY,
    );
    await figure.refresh();
    fails = true;
    figure.due();
    await figure.refresh();
    const [today] = chipsOf({ shown: allShown, spend: figure, requests: null, action, now: FRIDAY });
    expect(today).toMatchObject({ text: "Today $3.97", stale: true, hint: expect.stringContaining("HTTP 502") });

    const never = new Fetched<GatewaySpend>(() => Promise.reject(new Error("Couldn't reach https://llm.example.com.")), 60_000, () => {});
    expect(chipsOf({ shown: allShown, spend: never, requests: null, action, now: FRIDAY })).toEqual([]);
    const asking = never.refresh();
    expect(chipsOf({ shown: allShown, spend: never, requests: null, action, now: FRIDAY })).toEqual([{ text: "…", hint: "Asking the gateway what you spent." }]);
    await asking;
    expect(chipsOf({ shown: allShown, spend: never, requests: null, action, now: FRIDAY })).toEqual([
      { text: "⚠", level: "danger", hint: "The gateway's spend isn't known. Couldn't reach https://llm.example.com.", opensWindow: { action } },
    ]);
  });
});

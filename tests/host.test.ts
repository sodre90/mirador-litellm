import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import litellm from "../host.ts";
import type { CanvasPluginStorage, PluginActivityContext, PluginWindowContext, StatuslineChip, StatuslineContext } from "../mirador/api.ts";
import type { WindowState } from "../src/window-state.ts";
import { startFakeGateway, type FakeGateway, type FakeRequest } from "./fake-gateway.ts";

const KEY = "sk-test-1111-secret";
const today = new Date().toISOString().slice(0, 10);

function storageInMemory(): CanvasPluginStorage {
  const kept = new Map<string, unknown>();
  return { get: (key) => structuredClone(kept.get(key)), set: (key, value) => (value === undefined ? kept.delete(key) : kept.set(key, structuredClone(value))) };
}

async function until<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = read();
    if (done(value) || Date.now() > deadline) return value;
    await Bun.sleep(10);
  }
}

const request = (id: string, sessionId: string, spend: number): FakeRequest => ({ request_id: id, session_id: sessionId, startTime: `${today}T09:00:00Z`, model_group: "claude-sonnet", spend, prompt_tokens: 100, completion_tokens: 20, request_duration_ms: 1500 });

let gateway: FakeGateway;
const storage = storageInMemory();
const gatewaySettings = (url: string, more: Record<string, string> = {}) => (id: string) => ({ gateway: "on", url, key: KEY, ...more })[id] ?? null;

function statuslineOf(conversationId: string, sessionId: string | null, setting: (id: string) => string | null): StatuslineChip[] {
  const context: StatuslineContext = { conversationId, conversationTitle: `Conversation ${conversationId}`, sessionId, agent: "claude", profile: "Work", createdAt: Date.now() - 3_600_000, profileSetting: setting, storage };
  return litellm.statusline!(context);
}

beforeAll(async () => {
  gateway = await startFakeGateway({
    key: KEY,
    dailyPages: [[{ date: today, models: { "claude-sonnet": { spend: 3.25, requests: 10 }, "claude-haiku": { spend: 0.75, requests: 5 } } }]],
    requests: [request("r1", "session-1", 0.4), request("r2", "session-1", 0.35), request("r3", "session-2", 0.5), request("r4", "elsewhere", 9)],
  });
});
afterAll(() => gateway.close());

describe("the statusline", () => {
  test("shows nothing for a profile that doesn't use a gateway, and a warning for one without its URL or key", () => {
    expect(statuslineOf("c0", null, () => null)).toEqual([]);
    const [warning] = statuslineOf("c0", null, (id) => (id === "gateway" ? "on" : null));
    expect(warning).toMatchObject({ text: "⚠", level: "danger", hint: expect.stringContaining("Give the gateway's URL and access key") });
  });

  test("asks the gateway, then shows the periods and the conversation's own spend, which stands for its cost", async () => {
    const setting = gatewaySettings(gateway.url);
    expect(statuslineOf("c1", "session-1", setting)).toEqual([{ text: "…", hint: "Asking the gateway what you spent." }]);
    const chips = await until(
      () => statuslineOf("c1", "session-1", setting),
      (shown) => shown.length === 4,
    );
    expect(chips.map(({ text }) => text)).toEqual(["Today $4.00", "Week $4.00", "Month $4.00", "Session $0.75"]);
    expect(chips[3]!.cost).toEqual({ amount: 0.75, currency: "USD" });
    expect(JSON.stringify(chips)).not.toContain(KEY);
  });

  test("a turn in a new session counts that session too, from what the activity hook heard", async () => {
    const context = { profileSetting: gatewaySettings(gateway.url), storage } as unknown as PluginActivityContext;
    await litellm.activity!({ kind: "tool-started", toolCallId: "t", toolKind: null, conversationId: "c1", conversationTitle: "Conversation c1", sessionId: "session-2", at: Date.now() }, context);
    const seenBefore = statuslineOf("c1", "session-1", gatewaySettings(gateway.url));
    expect(seenBefore.at(-1)!.text).toBe("Session $0.75");
    await litellm.activity!({ kind: "turn-ended", ended: "finished", conversationId: "c1", conversationTitle: "Conversation c1", sessionId: "session-2", at: Date.now() }, context);
    const chips = await until(
      () => statuslineOf("c1", "session-2", gatewaySettings(gateway.url)),
      (shown) => shown.at(-1)?.text === "Session $1.25",
    );
    expect(chips.at(-1)).toMatchObject({ text: "Session $1.25", hint: expect.stringContaining("3 requests over 2 sessions") });
  });

  test("leaves out the figures the profile turned off", async () => {
    const chips = await until(
      () => statuslineOf("c1", "session-2", gatewaySettings(gateway.url, { week: "off", session: "off" })),
      (shown) => shown.length === 2,
    );
    expect(chips.map(({ text }) => text)).toEqual(["Today $4.00", "Month $4.00"]);
  });
});

describe("Test connection", () => {
  test("says which key it reached the gateway with, and what you spent today", async () => {
    expect(await litellm.checkProfile!(gatewaySettings(gateway.url))).toBe(`Reached LiteLLM 1.99.0 at ${gateway.url} with the key laptop of user-1: $4.00 spent today.`);
  });

  test("says what is missing or wrong, without the key", async () => {
    await expect(Promise.resolve().then(() => litellm.checkProfile!((id) => (id === "gateway" ? "on" : null)))).rejects.toThrow("Give the gateway's URL and access key");
    const wrongKey = (id: string) => ({ gateway: "on", url: gateway.url, key: "sk-wrong-9999" })[id] ?? null;
    await expect(Promise.resolve().then(() => litellm.checkProfile!(wrongKey))).rejects.toThrow("The gateway refused the access key (HTTP 401).");
  });
});

describe("the window", () => {
  const profiles = { Work: { gateway: "on", url: "", key: KEY }, Spare: { gateway: "on", url: "", key: KEY }, Elsewhere: { gateway: "on", url: "http://127.0.0.1:9", key: KEY }, Local: { gateway: "off" } } as Record<string, Record<string, string>>;
  let changes = 0;
  const context = (): PluginWindowContext => ({
    storage,
    windowChanged: () => void changes++,
    profiles: () => Object.keys(profiles).map((name) => ({ name, agent: name === "Spare" ? "pi" : "claude" })),
    settingOfProfile: (name, id) => profiles[name]?.[id] ?? null,
  });
  const state = () => litellm.window!.state(context()) as WindowState;

  beforeAll(() => {
    profiles.Work!.url = gateway.url;
    profiles.Spare!.url = gateway.url;
  });

  test("offers each gateway once, with the profiles that use it", () => {
    expect(state().gateways.map(({ label, profiles: users }) => ({ label, users }))).toEqual([
      { label: new URL(gateway.url).host, users: ["Work", "Spare"] },
      { label: "127.0.0.1:9", users: ["Elsewhere"] },
    ]);
  });

  test("shows the shown gateway's month, by model, and its conversations with their agents, and looks into one", async () => {
    litellm.window!.action!({ look: true }, context());
    const overview = await until(state, ({ overview, conversations }) => overview?.known === true && conversations[0]?.requests === 3);
    expect(overview.overview!.month.shown).toBe("$4.00");
    expect([overview.overview!.tiles.today.shown, overview.overview!.tiles.week.shown]).toEqual(["$4.00", "$4.00"]);
    expect(overview.overview!.models.map(({ model, shown, slot }) => [model, shown, slot])).toEqual([
      ["claude-sonnet", "$3.25", 1],
      ["claude-haiku", "$0.75", 2],
    ]);
    expect(overview.overview!.daily.days).toHaveLength(30);
    expect(overview.conversations).toMatchObject([{ id: "c1", title: "Conversation c1", profile: "Work", agent: { id: "claude", name: "Claude Code" }, sessions: 2, linked: "linked", spend: "$1.25", requests: 3 }]);
    expect(changes).toBeGreaterThan(0);
    expect(JSON.stringify(overview)).not.toContain(KEY);

    litellm.window!.action!({ conversation: "c1" }, context());
    const focused = await until(state, ({ focus }) => focus?.count === 3);
    expect(focused.focus).toMatchObject({ title: "Conversation c1", spend: "$1.25", sessions: 2, input: "300", output: "60" });
    expect(focused.focus!.requests.map(({ id, input, output, took }) => [id, input, output, took])).toEqual([
      ["r3", "100", "20", "1.5s"],
      ["r2", "100", "20", "1.5s"],
      ["r1", "100", "20", "1.5s"],
    ]);
    litellm.window!.action!({ back: true }, context());
    expect(state().focus).toBeNull();
  });

  test("a gateway that can't be reached says so, and the other stays as it was", async () => {
    litellm.window!.action!({ gateway: state().gateways[1]!.id }, context());
    const unreachable = await until(state, ({ overview }) => overview?.problem !== null && overview?.problem !== undefined);
    expect(unreachable.overview!.problem).toStartWith("Couldn't reach http://127.0.0.1:9");
    expect(unreachable.conversations).toEqual([]);
  });
});

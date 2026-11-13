import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { startFakeGateway, type FakeDay, type FakeGateway } from "../tests/fake-gateway.ts";
import { helpers, startHostWithThisPlugin, type TestHost } from "./mirador.ts";

/** Opt-in because it is not a test: MIRADOR_SCREENSHOTS=1 scripts/e2e.sh e2e/screenshots.spec.ts */
test.skip(process.env.MIRADOR_SCREENSHOTS !== "1", "set MIRADOR_SCREENSHOTS=1 to retake the plugin's screenshots");

const screenshotsDirectory = process.env.SCREENSHOTS_DIR ?? join(import.meta.dirname, "..", "screenshots");
const scheme = process.env.SCREENSHOT_SCHEME === "dark" ? "dark" : "light";
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });

let host: TestHost;
let gateway: FakeGateway;
const KEY = "sk-screenshots-secret";
const DAY_MS = 86_400_000;

const MODELS = [
  { name: "claude-opus", provider: "anthropic", daily: 31, each: 0.26 },
  { name: "claude-sonnet", provider: "anthropic", daily: 12, each: 0.035 },
  { name: "gpt-5", provider: "openai", daily: 4.2, each: 0.05 },
  { name: "gemini-2.5-pro", provider: "vertex_ai", daily: 2.1, each: 0.04 },
  { name: "claude-haiku", provider: "anthropic", daily: 1.4, each: 0.006 },
];

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Made-up spend from the first of last month to today: busier on weekdays, quiet at weekends, on five models. */
function madeUpDays(): FakeDay[] {
  const now = new Date();
  const firstOfLastMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const days = Math.round((Date.parse(dayOf(Date.now())) - firstOfLastMonth) / DAY_MS) + 1;
  return Array.from({ length: days }, (_, index) => {
    const time = firstOfLastMonth + index * DAY_MS;
    const weekday = new Date(time).getUTCDay();
    const busy = weekday === 0 || weekday === 6 ? 0.06 : 0.55 + ((index * 37) % 11) / 12;
    const models = Object.fromEntries(
      MODELS.map(({ name, provider, daily, each }, rank) => {
        const spend = daily * busy * (0.8 + ((index + rank * 3) % 5) / 10);
        const requests = Math.max(1, Math.round(spend / each));
        const promptTokens = requests * 30_000;
        return [name, { spend, requests, failed: Math.round(requests * 0.006), promptTokens, cacheRead: promptTokens * 0.61, cacheWrite: promptTokens * 0.07, cachingSavings: spend * 0.39, provider }];
      }),
    );
    return { date: dayOf(time), models };
  });
}

const monthSpend = (days: FakeDay[]) => {
  const month = dayOf(Date.now()).slice(0, 7);
  return days.filter(({ date }) => date.startsWith(month)).reduce((sum, { models }) => sum + Object.values(models).reduce((daySum, { spend }) => daySum + spend, 0), 0);
};

/** Fourteen requests of a conversation over the two hours before the screenshots, one of them refused for its rate. */
function madeUpRequests() {
  const start = Math.floor((Date.now() - 150 * 60_000) / 60_000) * 60_000;
  const plan = [0, 6, 9, 17, 24, 31, 32, 47, 58, 66, 79, 93, 118, 124];
  return plan.map((minute, index) => {
    const startTime = start + minute * 60_000;
    const model = index === 2 || index === 7 ? "claude-sonnet" : "claude-opus";
    const prompt = model === "claude-sonnet" ? 35_000 : 90_000 + index * 5_000;
    const firstTokenMs = 800 + ((index * 7) % 9) * 220;
    const output = 900 + ((index * 5) % 7) * 800;
    const durationMs = firstTokenMs + output * 1.6;
    const iso = (time: number) => new Date(time).toISOString();
    if (index === 5) {
      return { request_id: `request-${index}`, startTime: iso(startTime), model_group: model, spend: 0, status: "failure", request_duration_ms: 3_900, metadata: { error_information: { error_class: "RateLimitError", error_code: "429" } } };
    }
    return {
      request_id: `request-${index}`,
      startTime: iso(startTime),
      completionStartTime: iso(startTime + firstTokenMs),
      model_group: model,
      spend: model === "claude-sonnet" ? 0.035 : 0.14 + ((index * 3) % 5) * 0.09,
      status: "success",
      prompt_tokens: prompt,
      completion_tokens: output,
      request_duration_ms: durationMs,
      metadata: { usage_object: { cache_read_input_tokens: Math.round(prompt * (0.76 + (index % 4) * 0.05)), cache_creation_input_tokens: 0 } },
    };
  });
}

test.beforeAll(async () => {
  const days = madeUpDays();
  const now = new Date();
  gateway = await startFakeGateway({
    key: KEY,
    alias: "laptop",
    userId: "sam@example.com",
    version: "1.80.0",
    dailyPages: [days],
    budget: { max: 1200, spent: monthSpend(days), duration: "30d", resetAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() },
    everySessionRequests: madeUpRequests(),
  });
  ({ host } = await startHostWithThisPlugin());
});
test.afterAll(async () => {
  await host?.stop();
  await host?.cleanUp();
  await gateway?.close();
});

async function takeScreenshot(page: Page, name: string, clip?: Locator, margin = 12) {
  mkdirSync(screenshotsDirectory, { recursive: true });
  await page.mouse.move(0, 0);
  const path = join(screenshotsDirectory, `${name}-${scheme}.png`);
  const box = clip ? await clip.boundingBox() : null;
  await page.screenshot({ path, ...(box && { clip: { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin } }) });
}

test("screenshots", async ({ page }) => {
  await page.context().addInitScript((theme) => localStorage.setItem("mirador-theme", theme), scheme);
  await helpers().signIn(page, host);
  await helpers().addWorkspace(page, host.projectDir);
  const editor = await helpers().createProfile(page, "Work", `ANTHROPIC_BASE_URL=${gateway.url}\nANTHROPIC_AUTH_TOKEN=${KEY}`, "", "opencode");
  await helpers().openProfileTab(editor, "Plugins");
  const settings = editor.getByRole("group", { name: "LiteLLM" });
  await settings.getByLabel("Profile Uses a LiteLLM gateway").check();
  await settings.getByRole("button", { name: "Test connection" }).click();
  await expect(settings.getByRole("status")).toContainText("Reached LiteLLM");
  await takeScreenshot(page, "profile-settings", editor);
  await editor.getByRole("button", { name: "Save" }).click();
  await editor.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Work · opencode" });
  await helpers().startConversation(page, { withModels: false });
  await helpers().sendMessage(page, "TITLE Speed up the nightly build");
  await helpers().waitForTurnToEnd(page);
  await helpers().sendMessage(page, "USAGE 64000 200000 2.1");
  await helpers().waitForTurnToEnd(page);
  const statusline = page.getByRole("region", { name: "Statusline" });
  await expect(statusline.getByRole("group", { name: "LiteLLM" }).locator(".plugin-chip")).toHaveCount(4, { timeout: 45_000 });
  await takeScreenshot(page, "statusline", statusline, 6);

  const opened = page.context().waitForEvent("page");
  await statusline.getByRole("button", { name: /^Session / }).click();
  const gatewayWindow = await opened;
  await gatewayWindow.setViewportSize({ width: 1100, height: 1180 });
  const view = gatewayWindow.frameLocator(".item-window .canvas-frame.plugin iframe");
  await expect(view.getByRole("region", { name: "Requests" }).locator("tbody tr")).toHaveCount(14);
  await expect(view.getByRole("group", { name: /The conversation's spend over time/ }).locator("svg")).toBeVisible();
  await takeScreenshot(gatewayWindow, "conversation-requests");
  await view.getByRole("button", { name: /^All spend on / }).click();
  await gatewayWindow.setViewportSize({ width: 1100, height: 1500 });
  await expect(view.getByRole("region", { name: "Mirador conversations" })).toContainText("Speed up the nightly build");
  await expect(view.getByRole("region", { name: "Mirador conversations" })).toContainText("$");
  await expect(view.locator(".fresh")).toContainText("Updated");
  await takeScreenshot(gatewayWindow, "gateway-window");
});

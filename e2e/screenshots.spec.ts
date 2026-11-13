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

/** Thirty days of made-up spend: busier on weekdays, quiet at weekends, on three models. */
function madeUpMonth(): FakeDay[] {
  return Array.from({ length: 30 }, (_, back) => {
    const time = Date.now() - back * DAY_MS;
    const date = new Date(time).toISOString().slice(0, 10);
    const weekday = new Date(time).getUTCDay();
    const busy = weekday === 0 || weekday === 6 ? 0.08 : 0.6 + ((back * 37) % 11) / 10;
    return { date, models: { "claude-opus": { spend: 31 * busy, requests: Math.round(120 * busy) }, "claude-sonnet": { spend: 12 * busy, requests: Math.round(340 * busy) }, "claude-haiku": { spend: 1.4 * busy, requests: Math.round(210 * busy) } } };
  });
}

test.beforeAll(async () => {
  const today = new Date().toISOString().slice(0, 10);
  gateway = await startFakeGateway({
    key: KEY,
    alias: "laptop",
    userId: "sam@example.com",
    version: "1.80.0",
    dailyPages: [madeUpMonth()],
    everySessionRequests: Array.from({ length: 14 }, (_, index) => ({
      request_id: `request-${index}`,
      startTime: `${today}T09:${String(10 + index * 3).padStart(2, "0")}:00Z`,
      model_group: index % 4 === 3 ? "claude-haiku" : "claude-opus",
      spend: index % 4 === 3 ? 0.012 : 0.18 + (index % 5) * 0.07,
      prompt_tokens: 18_000 + index * 2_100,
      completion_tokens: 600 + index * 40,
      request_duration_ms: 4_000 + index * 350,
    })),
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
  await gatewayWindow.setViewportSize({ width: 1100, height: 860 });
  const view = gatewayWindow.frameLocator(".item-window .canvas-frame.plugin iframe");
  await expect(view.locator("tbody tr")).toHaveCount(14);
  await takeScreenshot(gatewayWindow, "conversation-requests");
  await view.getByRole("button", { name: "← All conversations" }).click();
  await expect(view.getByRole("region", { name: "Totals" })).toBeVisible();
  await expect(view.locator("table").last()).toContainText("Speed up the nightly build");
  await takeScreenshot(gatewayWindow, "gateway-window");
});

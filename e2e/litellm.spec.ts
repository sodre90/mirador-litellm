import { expect, test, type Page } from "@playwright/test";
import { startFakeGateway, type FakeGateway } from "../tests/fake-gateway.ts";
import { helpers, startHostWithThisPlugin, type TestHost } from "./mirador.ts";

let host: TestHost;
let gateway: FakeGateway;
const KEY = "sk-e2e-2222-secret";
const PROFILE = "Work";
const today = new Date().toISOString().slice(0, 10);

test.beforeAll(async () => {
  gateway = await startFakeGateway({
    key: KEY,
    dailyPages: [[{ date: today, models: { "claude-sonnet": { spend: 3.25, requests: 10 }, "claude-haiku": { spend: 0.75, requests: 5 } } }]],
    everySessionRequests: [
      { request_id: "first", startTime: `${today}T09:00:00Z`, model_group: "claude-sonnet", spend: 0.5, prompt_tokens: 1200, completion_tokens: 300, request_duration_ms: 2400 },
      { request_id: "second", startTime: `${today}T09:01:00Z`, model_group: "claude-haiku", spend: 0.25, prompt_tokens: 800, completion_tokens: 100, request_duration_ms: 900 },
    ],
  });
  ({ host } = await startHostWithThisPlugin());
});
test.afterAll(async () => {
  await host?.stop();
  await host?.cleanUp();
  await gateway?.close();
});

const windowView = (page: Page) => page.frameLocator(".item-window .canvas-frame.plugin iframe");

test("a profile on a LiteLLM gateway shows what you spent in the statusline, the conversation's spend in place of the agent's estimate, and the gateway's window", async ({ page }) => {
  await helpers().signIn(page, host);
  await helpers().addWorkspace(page, host.projectDir);
  const editor = await helpers().createProfile(page, PROFILE, `ANTHROPIC_BASE_URL=${gateway.url}\nANTHROPIC_AUTH_TOKEN=${KEY}`, "", "opencode");
  await helpers().openProfileTab(editor, "Plugins");
  const settings = editor.getByRole("group", { name: "LiteLLM" });

  await test.step("the profile turns the gateway on, and Test connection reads the URL and key from its environment", async () => {
    await settings.getByLabel("Profile Uses a LiteLLM gateway").check();
    await expect(settings.getByLabel("Profile Gateway URL")).toHaveAttribute("placeholder", "Empty: ANTHROPIC_BASE_URL from Launch");
    await expect(settings.getByLabel("Profile Access key")).toHaveAttribute("type", "password");
    await settings.getByRole("button", { name: "Test connection" }).click();
    await expect(settings.getByRole("status")).toHaveText(`Reached LiteLLM 1.99.0 at ${gateway.url} with the key laptop of user-1: $4.00 spent today.`);
    await settings.getByLabel("Profile Access key").fill("sk-wrong");
    await settings.getByRole("button", { name: "Test connection" }).click();
    await expect(settings.getByRole("alert")).toHaveText("The gateway refused the access key (HTTP 401).");
    await settings.getByLabel("Profile Access key").fill("");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor.locator(".saved")).toHaveText("Saved");
    await editor.getByRole("button", { name: "Close" }).click();
  });

  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await helpers().startConversation(page, { withModels: false });
  const statusline = page.getByRole("region", { name: "Statusline" });
  const chips = statusline.getByRole("group", { name: "LiteLLM" }).locator(".plugin-chip");

  await test.step("the statusline shows today, the week and the month, then the conversation's spend in place of the agent's", async () => {
    await helpers().sendMessage(page, "USAGE 100 1000 3.5");
    await helpers().waitForTurnToEnd(page);
    await expect(page.locator(".context-meter")).toHaveText(/10%/);
    await expect(chips).toHaveText(["Today $4.00", "Week $4.00", "Month $4.00", "Session $0.75"], { timeout: 45_000 });
    await expect(statusline.getByText("$3.50")).toHaveCount(0);
  });

  await test.step("the session's chip opens the window on the conversation's requests", async () => {
    const opened = page.context().waitForEvent("page");
    await statusline.getByRole("button", { name: "Session $0.75" }).click();
    const gatewayWindow = await opened;
    const view = windowView(gatewayWindow);
    await expect(view.locator("p.muted").first()).toHaveText("$0.75 over 2 requests.");
    await expect(view.locator("tbody tr")).toHaveCount(2);
    await expect(view.locator("tbody tr").first()).toContainText("claude-haiku");
    await view.getByRole("button", { name: "← All conversations" }).click();
    await expect(view.getByRole("region", { name: "Totals" })).toContainText("Month to date$4.00");
    await expect(view.getByRole("group", { name: "Spend each day, the last 30 days" })).toBeVisible();
    await expect(view.locator("table").first()).toContainText("claude-sonnet");
    await expect(view.locator("table").last()).toContainText(PROFILE);
    await gatewayWindow.close();
  });
});

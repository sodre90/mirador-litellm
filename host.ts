import type { CanvasHost, CanvasPluginStorage, PluginWindowContext, ProfilesSettings, StatuslineChip } from "./mirador/api.ts";
import { addDays, dayOf } from "./src/calendar.ts";
import { chipsOf, money, problemChip, type ShownFigures } from "./src/chips.ts";
import { baseOf, dailySpendOf, keyInfoOf, versionOf, type GatewayAddress } from "./src/gateway.ts";
import { recordsIn, remember } from "./src/records.ts";
import { SpendCache, gatewayIdOf } from "./src/spend.ts";
import { gatewayLabel, windowStateOf, type WindowGateway } from "./src/window-state.ts";

type Setting = (id: string) => string | null;

const usesGateway = (setting: Setting) => setting("gateway") === "on";

/** The gateway a profile's settings name; null while its URL or key is missing. */
const addressOf = (setting: Setting): GatewayAddress | null => {
  const url = setting("url")?.trim();
  const key = setting("key")?.trim();
  return url && key ? { url, key } : null;
};

const SETUP_HINT = "Give the gateway's URL and access key in Profiles → Plugins, or set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in the profile's Launch environment.";

const shownFigures = (setting: Setting): ShownFigures => ({
  today: setting("today") !== "off",
  week: setting("week") !== "off",
  month: setting("month") !== "off",
  session: setting("session") !== "off",
});

let windowContext: PluginWindowContext | null = null;
const cache = new SpendCache(() => windowContext?.windowChanged());

/** What the window shows: a gateway, and the conversation whose requests it lists, if any. */
const inWindow = { selected: null as string | null, focus: null as string | null };

/** The gateways the profiles use, each once, with the profiles that use it. */
function gatewaysOf(context: ProfilesSettings): WindowGateway[] {
  const byGateway = new Map<string, WindowGateway>();
  context
    .profiles()
    .map(({ name }) => ({ name, setting: (id: string) => context.settingOfProfile(name, id) }))
    .filter(({ setting }) => usesGateway(setting))
    .forEach(({ name, setting }) => {
      const address = addressOf(setting);
      if (!address) return;
      const gateway = cache.gateway(address);
      const known = byGateway.get(gateway.id) ?? { id: gateway.id, label: gatewayLabel(gateway), profiles: [] };
      byGateway.set(gateway.id, { ...known, profiles: [...known.profiles, name] });
    });
  return [...byGateway.values()];
}

/** The window asked for fresh figures: the shown gateway's, the listed conversations' never fetched, and the one it looks into. */
function refreshShown(context: PluginWindowContext, everything = false) {
  const state = windowStateOf({ gateways: gatewaysOf(context), selected: inWindow.selected, focus: inWindow.focus, records: recordsIn(context.storage), cache, now: Date.now() });
  const gateway = state.selected ? cache.knownGateway(state.selected) : undefined;
  if (everything) gateway?.spend.due();
  void gateway?.spend.refresh();
  const records = recordsIn(context.storage);
  state.conversations.forEach(({ id }) => {
    const requests = cache.requestsOf(id, records[id]!);
    if (everything) requests?.due();
    if (requests && (requests.fetchedAt === null || everything)) void requests.refresh();
  });
  const focused = inWindow.focus && records[inWindow.focus] ? cache.requestsOf(inWindow.focus, records[inWindow.focus]!) : null;
  void focused?.refresh();
}

function act(action: unknown, context: PluginWindowContext) {
  const asked = (typeof action === "object" && action !== null ? action : {}) as Record<string, unknown>;
  if (typeof asked.gateway === "string") inWindow.selected = asked.gateway;
  if (typeof asked.conversation === "string") inWindow.focus = asked.conversation;
  if (asked.back === true) inWindow.focus = null;
  refreshShown(context, asked.refresh === true);
  context.windowChanged();
  return null;
}

function rememberConversation(storage: CanvasPluginStorage, conversationId: string, gatewayId: string, seen: { title: string; profile?: string | null; sessionId: string | null; createdAt?: number }) {
  return remember(storage, conversationId, { ...seen, gateway: gatewayId, seenAt: Date.now() });
}

const litellm: CanvasHost = {
  items: {},
  tools: {},

  statusline(context): StatuslineChip[] {
    if (!usesGateway(context.profileSetting)) return [];
    const address = addressOf(context.profileSetting);
    if (!address) return [problemChip(SETUP_HINT)];
    const gateway = cache.gateway(address);
    const record = rememberConversation(context.storage, context.conversationId, gateway.id, {
      title: context.conversationTitle,
      profile: context.profile,
      sessionId: context.sessionId,
      createdAt: context.createdAt,
    });
    const shown = shownFigures(context.profileSetting);
    const requests = shown.session ? cache.requestsOf(context.conversationId, record) : null;
    void gateway.spend.refresh();
    void requests?.refresh();
    return chipsOf({ shown, spend: gateway.spend, requests, action: { gateway: gateway.id, conversation: context.conversationId }, now: Date.now() });
  },

  async checkProfile(setting) {
    const address = addressOf(setting);
    if (!address) throw new Error(SETUP_HINT);
    const [version, key] = await Promise.all([versionOf(address).catch(() => null), keyInfoOf(address)]);
    const today = dayOf(Date.now());
    const days = await dailySpendOf(address, key, today, addDays(today, 1));
    const spentToday = days.find(({ day }) => day === today)?.spend ?? 0;
    const whose = key.userId ? ` of ${key.userId}` : "";
    const keyName = key.alias ? `the key ${key.alias}${whose}` : `a key${whose}`;
    return `Reached LiteLLM${version ? ` ${version}` : ""} at ${baseOf(address.url)} with ${keyName}: ${money(spentToday)} spent today.`;
  },

  activity(event, context) {
    if (event.kind !== "turn-ended" || !usesGateway(context.profileSetting)) return;
    const address = addressOf(context.profileSetting);
    if (!address) return;
    cache.gateway(address);
    const record = rememberConversation(context.storage, event.conversationId, gatewayIdOf(address), { title: event.conversationTitle, sessionId: event.sessionId });
    cache.turnEnded(event.conversationId, record);
  },

  window: {
    state(context) {
      windowContext = context;
      return windowStateOf({ gateways: gatewaysOf(context), selected: inWindow.selected, focus: inWindow.focus, records: recordsIn(context.storage), cache, now: Date.now() });
    },
    action(action, context) {
      windowContext = context;
      return act(action, context);
    },
  },
};

export default litellm;

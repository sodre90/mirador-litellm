import type { StatuslineChip } from "../mirador/api.ts";
import { periodsOf, type Day } from "./calendar.ts";
import type { Fetched } from "./fetched.ts";
import type { DaySpend, LoggedRequest } from "./gateway.ts";
import { spendOf, type GatewaySpend } from "./spend.ts";

/** Dollars as short as the statusline needs: cents under $100, whole dollars under $10,000, then thousands. */
export function money(amount: number): string {
  if (amount < 100) return `$${amount.toFixed(2)}`;
  if (amount < 10_000) return `$${Math.round(amount).toLocaleString("en-US")}`;
  return `$${(amount / 1000).toFixed(1)}k`;
}

export const clockTime = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const spentSince = (days: DaySpend[], from: Day) => days.filter(({ day }) => day >= from).reduce((sum, { spend }) => sum + spend, 0);

export interface ShownFigures {
  today: boolean;
  week: boolean;
  month: boolean;
  session: boolean;
}

/** What a period's chip counts, in its tooltip. */
const PERIODS = [
  { id: "today", label: "Today", says: "today, in UTC" },
  { id: "week", label: "Week", says: "this week, from Monday in UTC" },
  { id: "month", label: "Month", says: "this month so far, in UTC" },
] as const;

function asOf(fetched: Fetched<unknown>) {
  const when = fetched.fetchedAt === null ? "" : `As of ${clockTime(fetched.fetchedAt)}.`;
  return [when, fetched.problem].filter(Boolean).join(" ");
}

const whose = ({ key }: GatewaySpend) => (key.userId ? `every key of ${key.userId}` : `the key ${key.alias ?? "in use"}`);

export const problemChip = (hint: string, opensWindow: StatuslineChip["opensWindow"] = true): StatuslineChip => ({ text: "⚠", level: "danger", hint, opensWindow });

interface ChipsInput {
  shown: ShownFigures;
  spend: Fetched<GatewaySpend>;
  requests: Fetched<LoggedRequest[]> | null;
  /** What a click on a chip hands the window. */
  action: { gateway: string; conversation: string };
  now: number;
}

/**
 * The gateway's figures for a conversation's statusline. The session's chip shows once the gateway logged a request of
 * the conversation's, and its cost then takes the place of the agent's own.
 */
export function chipsOf({ shown, spend, requests, action, now }: ChipsInput): StatuslineChip[] {
  const opensWindow = { action };
  if (spend.value === null) {
    if (spend.problem) return [problemChip(`The gateway's spend isn't known. ${spend.problem}`, opensWindow)];
    return spend.loading ? [{ text: "…", hint: "Asking the gateway what you spent." }] : [];
  }
  const periods = periodsOf(now);
  const stale = spend.stale;
  const periodChips = PERIODS.filter(({ id }) => shown[id]).map(({ id, label, says }) => ({
    text: `${label} ${money(spentSince(spend.value!.days, periods[id]))}`,
    hint: `What ${whose(spend.value!)} spent through the gateway ${says}. ${asOf(spend)}`.trim(),
    ...(stale && { stale: true }),
    opensWindow,
  }));
  return [...periodChips, ...sessionChips(shown.session ? requests : null, opensWindow)];
}

function sessionChips(requests: Fetched<LoggedRequest[]> | null, opensWindow: StatuslineChip["opensWindow"]): StatuslineChip[] {
  if (!requests?.value || requests.value.length === 0) return [];
  const amount = spendOf(requests.value);
  const sessions = new Set(requests.value.map(({ sessionId }) => sessionId)).size;
  const counted = `${requests.value.length} request${requests.value.length === 1 ? "" : "s"}${sessions > 1 ? ` over ${sessions} sessions` : ""}`;
  return [
    {
      text: `Session ${money(amount)}`,
      hint: `What this conversation spent through the gateway: ${counted}. ${asOf(requests)}`.trim(),
      ...(requests.stale && { stale: true }),
      cost: { amount, currency: "USD" },
      opensWindow,
    },
  ];
}

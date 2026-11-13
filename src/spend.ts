import { createHash } from "node:crypto";
import { addDays, dayOf, earliestOf, periodsOf } from "./calendar.ts";
import { Fetched } from "./fetched.ts";
import { dailySpendOf, keyInfoOf, sessionRequestsOf, type DaySpend, type GatewayAddress, type KeyInfo, type LoggedRequest } from "./gateway.ts";
import type { ConversationRecord } from "./records.ts";

const SPEND_EVERY_MS = 60_000;
const KEY_INFO_EVERY_MS = 10 * 60_000;
const SESSION_EVERY_MS = 30_000;
/** The gateway writes a request's spend a little after the turn that made it ends, so the session asks again then. */
const SPEND_WRITTEN_WITHIN_MS = 20_000;

/** Which gateway a profile uses, without the key in it: the same address and key are the same gateway. */
export const gatewayIdOf = ({ url, key }: GatewayAddress) => createHash("sha256").update(`${url.trim()}\n${key.trim()}`).digest("hex").slice(0, 16);

export interface GatewaySpend {
  key: KeyInfo;
  days: DaySpend[];
}

/** One gateway's figures: the key's user's spend by day, fetched at most once a minute. */
export class Gateway {
  readonly id: string;
  readonly spend: Fetched<GatewaySpend>;
  private key: { info: KeyInfo; at: number } | null = null;

  constructor(
    readonly address: GatewayAddress,
    changed: () => void,
    private readonly now: () => number,
  ) {
    this.id = gatewayIdOf(address);
    this.spend = new Fetched(() => this.loadSpend(), SPEND_EVERY_MS, changed, now);
  }

  private async keyInfo(): Promise<KeyInfo> {
    if (this.key && this.now() - this.key.at < KEY_INFO_EVERY_MS) return this.key.info;
    const info = await keyInfoOf(this.address);
    this.key = { info, at: this.now() };
    return info;
  }

  private async loadSpend(): Promise<GatewaySpend> {
    const key = await this.keyInfo();
    const periods = periodsOf(this.now());
    return { key, days: await dailySpendOf(this.address, key, earliestOf(periods), addDays(periods.today, 1)) };
  }
}

/** Every gateway's figures, and each conversation's requests on its gateway, kept in memory as long as Mirador runs. */
export class SpendCache {
  private readonly gateways = new Map<string, Gateway>();
  private readonly sessions = new Map<string, { sessionIds: string; requests: Fetched<LoggedRequest[]> }>();

  constructor(
    private readonly changed: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  gateway(address: GatewayAddress): Gateway {
    const id = gatewayIdOf(address);
    const known = this.gateways.get(id) ?? new Gateway(address, this.changed, this.now);
    this.gateways.set(id, known);
    return known;
  }

  knownGateway(id: string): Gateway | undefined {
    return this.gateways.get(id);
  }

  /** The requests of every session the conversation had; none for a conversation without a session yet. */
  requestsOf(conversationId: string, record: ConversationRecord): Fetched<LoggedRequest[]> | null {
    const gateway = this.gateways.get(record.gateway);
    if (!gateway || record.sessionIds.length === 0) return null;
    const cacheKey = `${record.gateway}/${conversationId}`;
    const sessionIds = record.sessionIds.join(" ");
    const known = this.sessions.get(cacheKey);
    if (known?.sessionIds === sessionIds) return known.requests;
    const requests = new Fetched(() => this.loadRequests(gateway, record), SESSION_EVERY_MS, this.changed, this.now);
    if (known) requests.value = known.requests.value;
    this.sessions.set(cacheKey, { sessionIds, requests });
    return requests;
  }

  private async loadRequests(gateway: Gateway, { sessionIds, since }: ConversationRecord): Promise<LoggedRequest[]> {
    const to = addDays(dayOf(this.now()), 1);
    const perSession = await Promise.all(sessionIds.map((sessionId) => sessionRequestsOf(gateway.address, sessionId, dayOf(since), to)));
    return perSession.flat().sort((one, other) => one.startedAt.localeCompare(other.startedAt));
  }

  /** A turn of the conversation ended: what it spent shows once the gateway wrote it. */
  turnEnded(conversationId: string, record: ConversationRecord) {
    const requests = this.requestsOf(conversationId, record);
    const gateway = this.gateways.get(record.gateway);
    const askAgain = () => {
      requests?.due();
      gateway?.spend.due();
    };
    askAgain();
    setTimeout(askAgain, SPEND_WRITTEN_WITHIN_MS).unref?.();
  }
}

export const spendOf = (requests: LoggedRequest[]) => requests.reduce((sum, { spend }) => sum + spend, 0);

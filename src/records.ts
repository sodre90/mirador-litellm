import type { CanvasPluginStorage } from "../mirador/api.ts";

/** What the plugin keeps of a conversation on a gateway profile, so its spend still counts after Mirador restarts. */
export interface ConversationRecord {
  title: string;
  profile: string | null;
  /** The gateway it last ran on, by the id `gatewayIdOf` gives it. */
  gateway: string;
  /** Every session id the agent gave it, oldest first: rewinding, clearing the context or moving profile starts another. */
  sessionIds: string[];
  /** No request of its can be older than this, in epoch milliseconds. */
  since: number;
}

export type ConversationRecords = Record<string, ConversationRecord>;

const KEY = "conversations";
const KEPT = 300;
const MOST_SESSIONS = 50;
const DAY_MS = 86_400_000;

export const recordsIn = (storage: CanvasPluginStorage): ConversationRecords => {
  const kept = storage.get(KEY);
  return typeof kept === "object" && kept !== null ? (kept as ConversationRecords) : {};
};

export interface Sighting {
  title: string;
  profile?: string | null;
  gateway: string;
  sessionId: string | null;
  /** When the conversation began, if known; else when it was seen, which a request of its may precede by a day at most. */
  createdAt?: number;
  seenAt: number;
}

function updated(record: ConversationRecord | undefined, { title, profile, gateway, sessionId, createdAt, seenAt }: Sighting): ConversationRecord {
  const sessionIds = record?.sessionIds ?? [];
  return {
    title,
    profile: profile === undefined ? (record?.profile ?? null) : profile,
    gateway,
    sessionIds: sessionId && !sessionIds.includes(sessionId) ? [...sessionIds, sessionId].slice(-MOST_SESSIONS) : sessionIds,
    since: Math.min(record?.since ?? Number.POSITIVE_INFINITY, createdAt ?? seenAt - DAY_MS),
  };
}

const sameRecord = (one: ConversationRecord | undefined, other: ConversationRecord) => one !== undefined && JSON.stringify(one) === JSON.stringify(other);

/** Keeps what was seen of the conversation; storage is written only when that changes something. */
export function remember(storage: CanvasPluginStorage, conversationId: string, sighting: Sighting): ConversationRecord {
  const records = recordsIn(storage);
  const record = updated(records[conversationId], sighting);
  if (sameRecord(records[conversationId], record)) return record;
  const newestFirst = Object.entries({ ...records, [conversationId]: record }).sort(([, one], [, other]) => other.since - one.since);
  storage.set(KEY, Object.fromEntries(newestFirst.slice(0, KEPT)));
  return record;
}

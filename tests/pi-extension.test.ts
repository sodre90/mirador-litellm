import { expect, test } from "bun:test";
import litellmSession, { SESSION_HEADER } from "../pi/litellm-session.ts";

test("the pi extension names pi's session in the header LiteLLM logs as the session, over whatever an earlier handler put there", () => {
  const handlers: ((event: { headers: Record<string, string | null> }, context: { sessionManager: { getSessionId(): string } }) => void)[] = [];
  litellmSession({ on: (_event, handler) => handlers.push(handler) });
  const headers: Record<string, string | null> = { "x-client-request-id": "01a1d6f4", [SESSION_HEADER]: "stale" };
  handlers.forEach((handler) => handler({ headers }, { sessionManager: { getSessionId: () => "01a1d6f4" } }));
  expect(headers).toEqual({ "x-client-request-id": "01a1d6f4", "x-litellm-session-id": "01a1d6f4" });
});

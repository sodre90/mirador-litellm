/**
 * A pi extension that sends pi's session id with each request in a header LiteLLM logs as the request's session, as
 * pi's own session headers are not. Copy it into the extensions folder of the profile's pi agent folder.
 */

interface ProviderHeadersEvent {
  headers: Record<string, string | null>;
}

interface SessionContext {
  sessionManager: { getSessionId(): string };
}

interface Pi {
  on(event: "before_provider_headers", handler: (event: ProviderHeadersEvent, context: SessionContext) => void): void;
}

export const SESSION_HEADER = "x-litellm-session-id";

export default function litellmSession(pi: Pi) {
  pi.on("before_provider_headers", (event, context) => {
    event.headers[SESSION_HEADER] = context.sessionManager.getSessionId();
  });
}

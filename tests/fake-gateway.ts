import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A day as /user/daily/activity reports it, by model. */
export interface FakeDay {
  date: string;
  models: Record<string, { spend: number; requests: number; tokens?: number }>;
}

/** A request as /spend/logs/v2 lists it. */
export interface FakeRequest {
  request_id: string;
  session_id: string;
  startTime: string;
  model_group: string;
  spend: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  request_duration_ms?: number;
  status?: string;
}

export interface FakeGatewaySetup {
  key: string;
  userId?: string | null;
  alias?: string | null;
  version?: string;
  /** Each page of /user/daily/activity; a day may be split over two of them, as the proxy pages by its own rows. */
  dailyPages?: FakeDay[][];
  requests?: FakeRequest[];
  /** Requests every session asked about has, such as one whose id only the agent knows. */
  everySessionRequests?: Omit<FakeRequest, "session_id">[];
  /** /key/info names the key itself where the proxy's hash of it goes. */
  echoesKey?: boolean;
  /** Answers every call with this status instead. */
  failWith?: number;
}

const dayResult = ({ date, models }: FakeDay) => {
  const entries = Object.entries(models);
  const sum = (pick: (model: { spend: number; requests: number; tokens?: number }) => number) => entries.reduce((total, [, model]) => total + pick(model), 0);
  return {
    date,
    metrics: { spend: sum(({ spend }) => spend), api_requests: sum(({ requests }) => requests), total_tokens: sum(({ tokens = 0 }) => tokens) },
    breakdown: { models: Object.fromEntries(entries.map(([name, model]) => [name, { metrics: { spend: model.spend, api_requests: model.requests, total_tokens: model.tokens ?? 0 } }])) },
  };
};

/**
 * A LiteLLM proxy as far as the plugin reads one: readiness, the key's info, the user's daily activity and the spend
 * logs, behind a bearer key. It notes every call, so a test can see what was asked.
 */
export async function startFakeGateway(initial: FakeGatewaySetup) {
  let setup = initial;
  const calls: URL[] = [];

  const answer = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const handle = (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://gateway");
    calls.push(url);
    if (setup.failWith) return answer(response, setup.failWith, { error: { message: `failing with key ${setup.key}` } });
    if (url.pathname === "/health/readiness") return answer(response, 200, { status: "healthy", litellm_version: setup.version ?? "1.99.0" });
    if (request.headers.authorization !== `Bearer ${setup.key}`) return answer(response, 401, { error: { message: "Authentication Error" } });
    if (url.pathname === "/key/info") {
      return answer(response, 200, { key: setup.echoesKey ? setup.key : "hashed-key-id", info: { key_alias: setup.alias ?? "laptop", user_id: setup.userId === undefined ? "user-1" : setup.userId, spend: 12.5, max_budget: null } });
    }
    if (url.pathname === "/user/daily/activity") {
      const pages = setup.dailyPages ?? [[]];
      const page = Number(url.searchParams.get("page") ?? 1);
      const from = url.searchParams.get("start_date") ?? "";
      const to = url.searchParams.get("end_date") ?? "";
      const results = (pages[page - 1] ?? []).filter(({ date }) => date >= from && date <= to).map(dayResult);
      return answer(response, 200, { results, metadata: { total_spend: 0, page, total_pages: pages.length, has_more: page < pages.length } });
    }
    if (url.pathname === "/spend/logs/v2") {
      const sessionId = url.searchParams.get("session_id") ?? "";
      const pageSize = Number(url.searchParams.get("page_size") ?? 50);
      const page = Number(url.searchParams.get("page") ?? 1);
      const everySession = sessionId ? (setup.everySessionRequests ?? []).map((row) => ({ ...row, request_id: `${row.request_id}-${sessionId}`, session_id: sessionId })) : [];
      const matching = [...(setup.requests ?? []).filter((row) => row.session_id.includes(sessionId)), ...everySession];
      const data = matching.slice((page - 1) * pageSize, page * pageSize);
      return answer(response, 200, { data, total: matching.length, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(matching.length / pageSize)) });
    }
    answer(response, 404, { detail: "Not Found" });
  };

  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    change(next: Partial<FakeGatewaySetup>) {
      setup = { ...setup, ...next };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeGateway = Awaited<ReturnType<typeof startFakeGateway>>;

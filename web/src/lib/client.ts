import type { IntakeEvent } from "@/server/intake/types";
import type { AgentEvent, CheckIn } from "@/server/negotiation/types";
import type { AgentMode } from "@/server/pace";
import type { PublicSession } from "@/server/store";

// `turnstile` is the site key when starting a session needs Cloudflare's bot check.
// `resting` is true when today's AI budget is spent and the simple script answers for everyone until 00:00 UTC.
export type SessionResponse = { mode: AgentMode; model: string | null; resting: boolean; busy: string | null; turnstile: string | null; account: { url: string; publishableKey: string } | null; session: PublicSession | null };

// A refusal from the server: its words for the person, and `needs` when the app can fix it itself ("recap").
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly needs?: string,
    // The rest of the refusal, such as how many picks the agent got right.
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function refusal(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; needs?: string } & Record<string, unknown>;
  return new ApiError(body.error ?? `Request failed (${response.status})`, response.status, body.needs, body);
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw await refusal(response);
  return (await response.json().catch(() => ({}))) as T;
}

async function* lines<E>(response: Response): AsyncGenerator<E> {
  if (!response.ok || !response.body) throw await refusal(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as E;
    }
  }
}

const post = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Follows a run that's still going, from just after the events already loaded, until it ends.
async function* follow(after: number): AsyncGenerator<AgentEvent> {
  const source = new EventSource(`/api/agent/events?after=${after}`);
  const queue: (AgentEvent | { type: "end" })[] = [];
  let wake: (() => void) | null = null;
  source.onmessage = (message) => {
    queue.push(JSON.parse(message.data));
    wake?.();
  };
  source.onerror = () => {
    // The browser reconnects on its own with Last-Event-ID; give up only once the stream is closed for good.
    if (source.readyState === EventSource.CLOSED) {
      queue.push({ type: "end" });
      wake?.();
    }
  };
  try {
    for (;;) {
      if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
      const event = queue.shift()!;
      if (event.type === "end") return;
      yield event;
    }
  } finally {
    source.close();
  }
}

export const api = {
  follow: (after: number) => Promise.resolve(follow(after)),
  session: () => fetch("/api/session", { cache: "no-store" }).then(json<SessionResponse>),
  // `adult`: the person said they're 18 or over.
  start: (name: string, turnstile: string | undefined, adult: boolean) => post("/api/session", { name, adult, ...(turnstile ? { turnstile } : {}) }).then(json<SessionResponse>),
  // Everything the agent holds, as a file (a saved agent asks for a fresh sign-in first).
  exportData: async (): Promise<Blob> => {
    const response = await fetch("/api/session/export");
    if (!response.ok) throw await refusal(response);
    return response.blob();
  },
  // Deletes the agent and everything it holds.
  reset: () => fetch("/api/session", { method: "DELETE" }).then(json<{ ok: true }>),
  // Forgetting removes every copy in storage; each returns the session as it now is.
  forgetIntent: (id: string) => fetch(`/api/intents/${id}`, { method: "DELETE" }).then(json<PublicSession>),
  forgetNote: (id: string) => fetch(`/api/about/${id}`, { method: "DELETE" }).then(json<PublicSession>),
  // The agent checks the network again every day for this many days (0 stops it).
  keepLooking: (days: 0 | 7 | 14 | 30) => post("/api/agent/keep-looking", { days }, "PUT").then(json<PublicSession>),
  // Who can reach the agent, answering a stranger's request, and unblocking.
  setReach: (policy: "ask" | "matched") => post("/api/reach", { policy }, "PUT").then(json<PublicSession>),
  answerRequest: (id: string, answer: "approve" | "deny" | "block") => post(`/api/reach/requests/${id}`, { answer }).then(json<PublicSession>),
  unblock: (agent: string) => fetch(`/api/reach/blocked/${encodeURIComponent(agent)}`, { method: "DELETE" }).then(json<PublicSession>),
  // Explicit consent to share something sensitive, and taking it back.
  consent: (id: string, share: boolean) => (share ? post(`/api/intents/${id}/consent`, {}, "PUT") : fetch(`/api/intents/${id}/consent`, { method: "DELETE" })).then(json<PublicSession>),
  intake: (input: unknown, signal?: AbortSignal) =>
    fetch("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }).then((r) => lines<IntakeEvent>(r)),
  renegotiate: (threadId: string, limit: number) => post(`/api/rooms/${threadId}/renegotiate`, { limit }).then((r) => lines<AgentEvent>(r)),
  say: (threadId: string, text: string) => post(`/api/rooms/${threadId}/messages`, { text }).then((r) => lines<AgentEvent>(r)),
  openPrivate: (name: string) => post("/api/rooms/private", { name }).then((r) => lines<AgentEvent>(r)),
  setIntent: (id: string, status: "confirmed" | "rejected") =>
    post(`/api/intents/${id}`, { status }, "PATCH").then(json<{ intents: PublicSession["intents"]; ready: boolean; recapNeeded: boolean }>),
  // `anyway`: go out even though the agent got many of the person's picks wrong, because they said so.
  // A standing yes for one intent, and taking it back.
  setMandate: (id: string, price: number, days: number) => post(`/api/intents/${id}/mandate`, { price, days }, "PUT").then(json<{ intents: PublicSession["intents"] }>),
  dropMandate: (id: string) => fetch(`/api/intents/${id}/mandate`, { method: "DELETE" }).then(json<{ intents: PublicSession["intents"] }>),
  run: (anyway = false) => post("/api/agent/run", anyway ? { anyway } : {}).then((r) => lines<AgentEvent>(r)),
  // `version` is the version on screen: if the proposal changed since, the server refuses rather than apply the answer to new terms.
  decide: (id: string, decision: "approved" | "declined", version?: number) => post(`/api/opportunities/${id}`, { decision, version }).then((r) => lines<AgentEvent>(r)),
  hold: (id: string) => post(`/api/opportunities/${id}/hold`, {}).then((r) => lines<AgentEvent>(r)),
  checkIn: (id: string, answer: CheckIn) => post(`/api/opportunities/${id}/checkin`, { answer }).then((r) => lines<AgentEvent>(r)),
};

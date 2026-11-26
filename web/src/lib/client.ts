import type { IntakeEvent } from "@/server/intake/types";
import type { AgentEvent, CheckIn } from "@/server/negotiation/types";
import type { AgentMode } from "@/server/pace";
import type { PublicSession } from "@/server/store";

export type SessionResponse = { mode: AgentMode; model: string | null; busy: string | null; session: PublicSession | null };

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`);
  return body as T;
}

async function* lines<E>(response: Response): AsyncGenerator<E> {
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`);
  }
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
  start: (name: string) => post("/api/session", { name }).then(json<SessionResponse>),
  reset: () => fetch("/api/session", { method: "DELETE" }).then(json<{ ok: true }>),
  intake: (input: unknown, signal?: AbortSignal) =>
    fetch("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }).then((r) => lines<IntakeEvent>(r)),
  renegotiate: (threadId: string, limit: number) => post(`/api/rooms/${threadId}/renegotiate`, { limit }).then((r) => lines<AgentEvent>(r)),
  say: (threadId: string, text: string) => post(`/api/rooms/${threadId}/messages`, { text }).then((r) => lines<AgentEvent>(r)),
  openPrivate: (name: string) => post("/api/rooms/private", { name }).then((r) => lines<AgentEvent>(r)),
  setIntent: (id: string, status: "confirmed" | "rejected") =>
    post(`/api/intents/${id}`, { status }, "PATCH").then(json<{ intents: PublicSession["intents"]; ready: boolean }>),
  run: () => fetch("/api/agent/run", { method: "POST" }).then((r) => lines<AgentEvent>(r)),
  decide: (id: string, decision: "approved" | "declined") => post(`/api/opportunities/${id}`, { decision }).then((r) => lines<AgentEvent>(r)),
  checkIn: (id: string, answer: CheckIn) => post(`/api/opportunities/${id}/checkin`, { answer }).then((r) => lines<AgentEvent>(r)),
};

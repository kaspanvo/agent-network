import type { IntakeEvent } from "@/server/intake/types";
import type { AgentEvent } from "@/server/negotiation/types";
import type { AgentMode } from "@/server/pace";
import type { PublicSession } from "@/server/store";

export type SessionResponse = { mode: AgentMode; session: PublicSession | null };

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

export const api = {
  session: () => fetch("/api/session", { cache: "no-store" }).then(json<SessionResponse>),
  start: (name: string) => post("/api/session", { name }).then(json<SessionResponse>),
  reset: () => fetch("/api/session", { method: "DELETE" }).then(json<{ ok: true }>),
  intake: (input: unknown) => post("/api/intake", input).then((r) => lines<IntakeEvent>(r)),
  setIntent: (id: string, status: "confirmed" | "rejected") =>
    post(`/api/intents/${id}`, { status }, "PATCH").then(json<{ intents: PublicSession["intents"]; ready: boolean }>),
  run: () => fetch("/api/agent/run", { method: "POST" }).then((r) => lines<AgentEvent>(r)),
  decide: (id: string, decision: "approved" | "declined") =>
    post(`/api/opportunities/${id}`, { decision }).then(json<{ decisions: PublicSession["decisions"] }>),
};

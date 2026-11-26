import Anthropic from "@anthropic-ai/sdk";
import type { Loggable } from "./activity";
import { allow, broadcast, finish, observe, persist, type Actor } from "./actor";
import { limitBehind } from "./limits";
import type { AgentEvent } from "./negotiation/types";
import { signUnsigned } from "./identity";

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// For routes that reach other agents or the model: null when the person may go ahead, otherwise the refusal.
export function rateLimited(actor: Actor): Response | null {
  return allow(actor) ? null : jsonError("That's a lot at once. Give it a few seconds and try again.", 429);
}

function friendly(err: unknown): string {
  const limit = limitBehind(err);
  if (limit) return limit.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY and restart the server.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is busy right now. Wait a moment and try again.";
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status}). Try again.`;
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Streams newline-delimited JSON events, logs each one, then saves the session whatever happened.
// When the browser stops reading (the person pressed stop or left), `signal` aborts the work.
// `busy` names work that holds the agent until it ends, like a run; a second request for it waits its turn by being refused.
export function ndjson<E extends Loggable>(
  actor: Actor,
  work: (emit: (event: E | { type: "error"; message: string }) => void, signal: AbortSignal) => Promise<void>,
  busy?: string,
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let open = true;
  const body = new ReadableStream({
    async start(controller) {
      const emit = (event: E | { type: "error"; message: string } | { type: "done" }) => {
        if (event.type !== "done" && event.type !== "error") observe(actor, event as Loggable);
        // Work that holds the agent (a run) can be followed live from another tab or after a reload.
        if (busy && "type" in event) broadcast(actor, event as AgentEvent);
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      if (busy) actor.busy = busy;
      try {
        await work(emit, abort.signal);
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error(err);
          emit({ type: "error", message: friendly(err) });
        }
      } finally {
        if (busy) finish(actor);
        await signUnsigned(actor.session).catch((err) => console.error("Couldn't sign the agent's messages:", err));
        persist(actor);
        emit({ type: "done" });
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

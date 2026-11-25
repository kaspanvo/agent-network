import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { loadSession, saveSession, SESSION_COOKIE, type Session } from "./store";

export function currentSession(request: NextRequest): Session | undefined {
  return loadSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function friendly(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY and restart the server.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is busy right now. Wait a moment and try again.";
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status}). Try again.`;
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Streams newline-delimited JSON events, then saves the session whatever happened.
export function ndjson<E>(session: Session, work: (emit: (event: E | { type: "error"; message: string }) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await work(emit);
      } catch (err) {
        console.error(err);
        emit({ type: "error", message: friendly(err) });
      } finally {
        saveSession(session);
        emit({ type: "done" });
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

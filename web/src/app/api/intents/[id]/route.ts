import type { NextRequest } from "next/server";
import { z } from "zod";
import { currentSession, jsonError } from "@/server/http";
import { isReady } from "@/server/intake/profile";
import { saveSession } from "@/server/store";

const Body = z.object({ status: z.enum(["confirmed", "rejected"]) });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/intents/[id]">) {
  const session = currentSession(request);
  if (!session) return jsonError("Your session has ended. Start again.", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose confirm or reject.", 400);
  const { id } = await ctx.params;
  const intent = session.intents.find((i) => i.id === id);
  if (!intent) return jsonError("That intent no longer exists.", 404);

  intent.status = parsed.data.status;
  session.pendingNotes.push(`[App note: ${session.name} ${parsed.data.status === "confirmed" ? "confirmed" : "rejected"} the inferred intent "${intent.summary}".]`);
  session.ready = session.ready && isReady(session);
  saveSession(session);
  return Response.json({ intents: session.intents, ready: session.ready });
}

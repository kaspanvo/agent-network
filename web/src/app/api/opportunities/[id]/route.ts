import type { NextRequest } from "next/server";
import { z } from "zod";
import { currentSession, jsonError } from "@/server/http";
import { saveSession } from "@/server/store";

const Body = z.object({ decision: z.enum(["approved", "declined"]) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/opportunities/[id]">) {
  const session = currentSession(request);
  if (!session) return jsonError("Your session has ended. Start again.", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Approve or decline.", 400);
  const { id } = await ctx.params;
  if (!session.run?.opportunities.some((o) => o.id === id)) return jsonError("That proposal no longer exists.", 404);
  session.decisions[id] = parsed.data.decision;
  saveSession(session);
  return Response.json({ decisions: session.decisions });
}

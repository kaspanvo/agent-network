import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { currentSession, jsonError } from "@/server/http";
import { agentMode } from "@/server/pace";
import { createSession, publicSession, SESSION_COOKIE } from "@/server/store";

export async function GET(request: NextRequest) {
  const session = currentSession(request);
  return Response.json({ mode: agentMode(), session: session ? publicSession(session) : null });
}

const StartBody = z.object({ name: z.string().trim().min(1).max(40) });

export async function POST(request: NextRequest) {
  const parsed = StartBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Tell your agent your first name.", 400);
  const session = createSession(parsed.data.name);
  const response = NextResponse.json({ mode: agentMode(), session: publicSession(session) });
  response.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

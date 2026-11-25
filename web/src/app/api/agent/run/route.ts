import type { NextRequest } from "next/server";
import { currentSession, jsonError, ndjson } from "@/server/http";
import { isReady } from "@/server/intake/profile";
import { claudeNarrator, scriptedNarrator } from "@/server/negotiation/narrator";
import { runAgent } from "@/server/negotiation/run";
import type { AgentEvent } from "@/server/negotiation/types";
import { agentMode } from "@/server/pace";

export async function POST(request: NextRequest) {
  const session = currentSession(request);
  if (!session) return jsonError("Set up your agent first.", 401);
  if (!isReady(session)) return jsonError("Give your agent at least one confirmed intent with a price first.", 409);
  const narrator = agentMode() === "claude" ? claudeNarrator() : scriptedNarrator;
  session.decisions = {};
  return ndjson<AgentEvent>(session, (emit) => runAgent(session, narrator, emit));
}

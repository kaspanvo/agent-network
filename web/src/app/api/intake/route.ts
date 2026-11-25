import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { currentSession, jsonError, ndjson } from "@/server/http";
import { claudeIntakeAgent } from "@/server/intake/claude";
import { demoIntakeAgent } from "@/server/intake/demo";
import { setIntentPrice } from "@/server/intake/profile";
import { openingMessage } from "@/server/intake/prompt";
import type { IntakeEvent } from "@/server/intake/types";
import { agentMode } from "@/server/pace";

const Input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal("choices"), itemId: z.string(), picked: z.array(z.string()).min(1).max(8) }),
  z.object({ kind: z.literal("number"), itemId: z.string(), value: z.number().finite() }),
]);

export async function POST(request: NextRequest) {
  const session = currentSession(request);
  if (!session) return jsonError("Start by telling your agent your name.", 401);
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("That message couldn't be read.", 400);
  const input = parsed.data;
  const early: IntakeEvent[] = [];

  let userText: string;
  if (input.kind === "start") {
    if (session.chat.length > 0) return jsonError("This conversation has already started.", 409);
    userText = openingMessage(session.name);
  } else if (input.kind === "text") {
    // Typing instead of using a quick-pick answers it.
    for (const item of session.chat) if (item.widget && !item.answered) item.answered = true;
    session.chat.push({ id: randomUUID(), role: "user", text: input.text });
    userText = input.text;
  } else {
    const item = session.chat.find((c) => c.id === input.itemId);
    if (!item?.widget || item.answered || item.widget.kind !== input.kind) return jsonError("That question has already been answered.", 409);
    item.answered = true;
    if (input.kind === "choices" && item.widget.kind === "choices") {
      const options = item.widget.options;
      const picked = input.picked.filter((p) => options.includes(p));
      if (picked.length === 0) return jsonError("Pick one of the options.", 400);
      session.chat.push({ id: randomUUID(), role: "user", text: picked.join(", ") });
      userText = `I picked: ${picked.join(", ")}`;
    } else if (input.kind === "number" && item.widget.kind === "number") {
      const { min, max, unit, intentId } = item.widget;
      const value = Math.min(max, Math.max(min, input.value));
      if (intentId) {
        const intent = setIntentPrice(session, intentId, value);
        if (intent) early.push({ type: "intent", intent });
      }
      session.chat.push({ id: randomUUID(), role: "user", text: `${value} ${unit}` });
      userText = `My answer: ${value} ${unit}`;
    } else {
      return jsonError("That answer doesn't match the question.", 400);
    }
  }

  if (session.pendingNotes.length > 0) {
    userText = `${session.pendingNotes.join("\n")}\n${userText}`;
    session.pendingNotes = [];
  }

  const agent = agentMode() === "claude" ? claudeIntakeAgent() : demoIntakeAgent();
  return ndjson<IntakeEvent>(session, async (emit) => {
    for (const event of early) emit(event);
    await agent.respond(session, userText, emit);
  });
}

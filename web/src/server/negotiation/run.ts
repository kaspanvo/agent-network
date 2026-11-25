import { formatPrice } from "../domain";
import { pause } from "../pace";
import { LISBON_PILOT } from "../population";
import type { Session } from "../store";
import type { Line, Narrator } from "./narrator";
import { listWords, planThreads } from "./plan";
import type { AgentEvent, Opportunity, ThreadPlan } from "./types";

function opportunityFor(thread: ThreadPlan, you: string): Opportunity {
  const price = thread.agreedPrice!;
  const fmt = (n: number) => formatPrice(n, thread.unit);
  const them = thread.counterpart.name;
  const group = thread.kind === "group";
  const roomNames = thread.room.map((r) => r.name);
  return {
    id: `${thread.id}-v1`,
    threadId: thread.id,
    intentId: thread.intentId,
    title: thread.direction === "seek" ? `${thread.intentSummary} with ${them}${group ? `, in a group of ${roomNames.length + 1}` : ""}` : `${thread.intentSummary}: ${them} would buy`,
    price,
    unit: thread.unit,
    people: [you, them, ...roomNames],
    terms: [`${fmt(price)}${group ? " each" : ""}`, ...(thread.schedule ? [thread.schedule] : []), ...(group ? [`With ${listWords(roomNames)}`] : [])],
    reasons: [
      thread.direction === "seek" ? `${fmt(price)} is within your ${fmt(thread.limit)} limit` : `${fmt(price)} is above your ${fmt(thread.limit)} floor`,
      ...(group ? [`${them} offered a group rate, and ${listWords(roomNames)} want the same`] : []),
      ...(thread.schedule ? [`${thread.schedule}, as you asked`] : []),
    ],
    version: 1,
  };
}

function bestPerIntent(threads: ThreadPlan[]): ThreadPlan[] {
  const best = new Map<string, ThreadPlan>();
  for (const t of threads) {
    if (t.agreedPrice === null) continue;
    const current = best.get(t.intentId);
    const better = !current || (t.direction === "seek" ? t.agreedPrice < current.agreedPrice! : t.agreedPrice > current.agreedPrice!);
    if (better) best.set(t.intentId, t);
  }
  return [...best.values()];
}

export async function runAgent(session: Session, narrator: Narrator, emit: (event: AgentEvent) => void): Promise<void> {
  const you = session.name;
  const events: AgentEvent[] = [];
  const send = (event: AgentEvent) => {
    events.push(event);
    emit(event);
  };
  session.run = { at: new Date().toISOString(), events, opportunities: [] };

  send({ type: "status", text: `Looking for agents in the ${LISBON_PILOT.name} whose intents fit yours` });
  await pause(800);
  const threads = planThreads(session.intents, LISBON_PILOT);
  if (threads.length === 0) {
    send({ type: "status", text: "Nobody in the pilot matches your intents yet. Your agent keeps listening as people join." });
    send({ type: "done", stats: { contacted: 0, rooms: 0, ready: 0 } });
    return;
  }

  // Start every narration now so the replies are ready by the time each conversation is shown.
  const narrations = new Map<string, Promise<Line[]>>();
  for (const t of threads) {
    if (t.moves.length === 0) continue;
    const pending = narrator.narrate(t, you);
    pending.catch(() => {});
    narrations.set(t.id, pending);
  }

  for (const thread of threads) {
    const them = thread.counterpart.name;
    send({
      type: "discover",
      threadId: thread.id,
      who: them,
      about: thread.intentSummary,
      why: `${them}'s agent ${thread.direction === "seek" ? "offers" : "is looking for"} ${thread.counterpart.blurb.toLowerCase()}, which fits "${thread.intentSummary.toLowerCase()}".`,
    });
    await pause(900);

    if (thread.moves.length === 0) {
      send({ type: "outcome", threadId: thread.id, result: "no_fit", why: thread.noFitReason ?? "No fit." });
      await pause(700);
      continue;
    }
    if (thread.kind === "group" || thread.room.length > 0) {
      send({
        type: "room",
        threadId: thread.id,
        members: [you, ...thread.room.map((r) => r.name)],
        why: `${them} offers a lower price per person for a group, and ${listWords(thread.room.map((r) => r.name))} want the same. Your agent opens a room for all of you.`,
      });
      await pause(900);
    }

    const lines = await narrations.get(thread.id)!;
    for (const [i, move] of thread.moves.entries()) {
      send({
        type: "message",
        threadId: thread.id,
        from: move.from,
        who: move.from === "you" ? `${you}'s agent` : `${them}'s agent`,
        action: move.action,
        amount: move.amount,
        unit: thread.unit,
        text: lines[i]!.text,
        why: lines[i]!.why,
      });
      await pause(1100);
    }
    send({
      type: "outcome",
      threadId: thread.id,
      result: thread.agreedPrice === null ? "no_fit" : "agreed",
      why: thread.agreedPrice === null ? (thread.noFitReason ?? "No price worked for both sides.") : `Agreed at ${formatPrice(thread.agreedPrice, thread.unit)}. It goes to you as a proposal; nothing is final until you approve.`,
    });
    await pause(700);
  }

  for (const thread of bestPerIntent(threads)) {
    const opportunity = opportunityFor(thread, you);
    session.run.opportunities.push(opportunity);
    send({ type: "opportunity", opportunity });
    await pause(500);
  }
  send({
    type: "done",
    stats: { contacted: threads.length, rooms: threads.filter((t) => t.kind === "group").length, ready: session.run.opportunities.length },
  });
}

import { formatPrice, isInterest } from "../domain";
import { intentBasis } from "../intake/profile";
import { pause } from "../pace";
import { localMarket, type Market } from "../market";
import type { Session } from "../store";
import type { Narrator } from "./narrator";
import { dealMessages, opportunityFor, runStats } from "./run";
import type { AgentEvent } from "./types";

// The person changes their limit inside a room. Their agent reopens that one conversation from scratch.
// A new agreement becomes the next version of the proposal and any earlier approval of it no longer counts.
export async function renegotiate(session: Session, threadId: string, limit: number, narrator: Narrator, emit: (event: AgentEvent) => void, market: Market = localMarket()): Promise<void> {
  const run = session.run;
  if (!run || !run.events.some((e) => e.type === "discover" && e.threadId === threadId)) throw new Error("That conversation no longer exists.");
  const intent = session.intents.find((i) => threadId.startsWith(`${i.id}-`));
  if (!intent) throw new Error("The intent behind this conversation was removed.");
  if (isInterest(intent) || intent.price === null) throw new Error("This room isn't about a price.");

  const send = (event: AgentEvent) => {
    run.events.push(event);
    emit(event);
  };
  const fmt = (n: number) => formatPrice(n, intent.unit);
  intent.price = limit;
  const thread = (await market.match([intent])).find((t) => t.id === threadId);
  if (!thread) throw new Error("That conversation can't be reopened.");

  send({ type: "note", threadId, text: `You set a new ${intent.direction === "seek" ? "limit" : "floor"} of ${fmt(limit)}. Your agent reopens the conversation.` });
  await pause(700);

  if (thread.moves.length > 0) {
    const lines = await narrator.narrate(thread, session.name);
    for (const event of dealMessages(thread, lines, session.name)) {
      send(event);
      await pause(1000);
    }
  }

  const previous = run.opportunities.find((o) => o.threadId === threadId);
  if (thread.agreedPrice === null) {
    send({
      type: "outcome",
      threadId,
      result: "no_fit",
      why: `${thread.noFitReason ?? "No price worked for both sides."}${previous ? ` Version ${previous.version} still stands.` : ""}`,
    });
  } else {
    const opportunity = {
      ...opportunityFor(thread, session.name, (previous?.version ?? 0) + 1),
      basis: intentBasis(intent),
      ...(previous ? { previous: { version: previous.version, price: previous.price, terms: previous.terms } } : {}),
    };
    if (previous) delete session.decisions[previous.id];
    run.opportunities = [...run.opportunities.filter((o) => o.threadId !== threadId), opportunity];
    send({ type: "outcome", threadId, result: "agreed", why: `Agreed at ${fmt(thread.agreedPrice)}. This is version ${opportunity.version}; nothing is final until you approve it.` });
    send({ type: "opportunity", opportunity });
  }
  send({ type: "done", stats: runStats(session) });
}

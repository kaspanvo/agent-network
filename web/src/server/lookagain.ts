import { cleared, formatPrice } from "./domain";
import { intentBasis } from "./intake/profile";
import type { Market } from "./market";
import { choose, dealMessages, MAX_CONTACTS, opportunityFor, releaseNext, shuffled, signed } from "./negotiation/run";
import type { Narrator } from "./negotiation/narrator";
import type { AgentEvent } from "./negotiation/types";
import type { Session } from "./store";

// "Keep looking": after the first run, the agent checks the network again on a schedule (a Durable Object alarm) and
// brings back only what's new, the way agents in team workspaces wake on a schedule or an event instead of waiting to
// be asked (Amp, Nebula, 2026). It never repeats a room it already had, and an intent that already has a live
// proposal isn't offered a second one: a new fit is noted, not pushed.

export const LOOK_EVERY_HOURS = 24;
const HOUR = 60 * 60 * 1000;

export type KeepLooking = { until: string; next: string; lastAt?: string; found: number };

export function startLooking(session: Session, days: number, now = new Date()): KeepLooking | null {
  if (days <= 0) {
    delete session.keepLooking;
    return null;
  }
  session.keepLooking = { until: new Date(now.getTime() + days * 24 * HOUR).toISOString(), next: new Date(now.getTime() + LOOK_EVERY_HOURS * HOUR).toISOString(), found: session.keepLooking?.found ?? 0 };
  return session.keepLooking;
}

export function lookDue(session: Session, now = new Date()): boolean {
  const k = session.keepLooking;
  return !!k && !!session.run && Date.parse(k.next) <= now.getTime() && Date.parse(k.until) > now.getTime();
}

// One look. Adds new rooms to the existing run (it doesn't replace it) and returns how many were new and proposed.
export async function lookAgain(session: Session, narrator: Narrator, market: Market, emit: (event: AgentEvent) => void, now = new Date()): Promise<{ fresh: number; proposed: number }> {
  const run = session.run;
  const k = session.keepLooking;
  if (!run || !k) return { fresh: 0, proposed: 0 };
  const send = (event: AgentEvent) => {
    run.events.push(event);
    emit(event);
  };
  const known = new Set(run.events.flatMap((e) => (e.type === "discover" ? [e.threadId] : [])));
  const threads = shuffled(await market.match(session.intents.filter(cleared)), `${session.id}:${now.toISOString().slice(0, 10)}`).slice(0, MAX_CONTACTS);
  const fresh = threads.filter((t) => !known.has(t.id) && t.agreedPrice !== null);
  k.lastAt = now.toISOString();
  k.next = new Date(now.getTime() + LOOK_EVERY_HOURS * HOUR).toISOString();
  if (!fresh.length) {
    send({ type: "status", text: "Your agent looked again. Nothing new that fits yet." });
    return { fresh: 0, proposed: 0 };
  }
  k.found += fresh.length;
  send({ type: "status", text: `Your agent looked again and found ${fresh.length} new fit${fresh.length === 1 ? "" : "s"}.` });
  for (const thread of fresh) {
    const them = thread.counterpart.name;
    send({ type: "discover", threadId: thread.id, who: them, about: thread.intentSummary, why: `New since your agent last looked: ${them}'s agent ${thread.direction === "seek" ? "offers" : "is looking for"} ${thread.counterpart.blurb.toLowerCase()}.` });
    if (thread.kind === "group" || thread.room.length) send({ type: "room", threadId: thread.id, members: [session.name, ...thread.room.map((r) => r.name)], why: `${them} offers a group rate, and others want the same.` });
    const lines = await narrator.narrate(thread, session.name);
    for (const event of dealMessages(thread, lines, session.name)) send(await signed(session, event));
    send({ type: "outcome", threadId: thread.id, result: "agreed", why: `Matched at ${formatPrice(thread.agreedPrice!, thread.unit)}. Nothing is final until you approve.` });
  }
  // One live proposal per intent: a new fit for something already proposed or agreed waits in its room.
  let proposed = 0;
  const live = (intentId: string) => run.opportunities.some((o) => o.intentId === intentId && session.decisions[o.id] !== "declined" && session.decisions[o.id] !== "lapsed");
  for (const intent of session.intents) {
    if (live(intent.id)) continue;
    const choice = choose(intent, fresh);
    if (!choice) continue;
    const opportunity = opportunityFor(choice.chosen, session.name, 1, choice.options.length);
    opportunity.basis = intentBasis(intent);
    (run.queued ??= []).push(opportunity);
    proposed++;
  }
  for (let next = releaseNext(session); next; next = releaseNext(session)) send({ type: "opportunity", opportunity: next });
  return { fresh: fresh.length, proposed };
}

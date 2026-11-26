import type { AgentEvent, Opportunity } from "./negotiation/types";
import { isStale } from "./intake/profile";
import type { Session } from "./store";

// A proposal holds everyone's place for a while, the way agent task boards (Vercel Board, coord, Marcus) give a
// claimed task a lease: if whoever holds it goes quiet, the lease runs out and the work is free again.
// Here the person holds the others' place. Unanswered when the hold runs out, the proposal lapses, the room
// is told, and nobody is left waiting. The person can ask for more time once.
export const HOLD_HOURS = 48;
export const EXTEND_HOURS = 24;

const HOUR = 60 * 60 * 1000;
// Alarms can fire a moment early; treat a hold this close to its end as over.
const EARLY = 1000;

// Something the person's agent must wake up for later, even if nobody has the page open.
export type Wake = { kind: "check_in" | "hold"; opportunityId: string };
export type Scheduler = (job: Wake, at: Date) => void;

export function holdUntil(from = new Date()): string {
  return new Date(from.getTime() + HOLD_HOURS * HOUR).toISOString();
}

export function whenWords(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

function waiting(session: Session, o: Opportunity): boolean {
  return !session.decisions[o.id] && !!o.holdUntil;
}

// Asks the host to wake the agent when each open proposal's hold runs out.
export function scheduleHolds(session: Session, schedule: Scheduler | undefined): void {
  if (!schedule) return;
  for (const o of session.run?.opportunities ?? []) if (waiting(session, o)) schedule({ kind: "hold", opportunityId: o.id }, new Date(o.holdUntil!));
}

// The hold on one proposal ran out. Safe to run twice, and does nothing if the person answered in time.
export function lapse(session: Session, id: string, now = new Date()): AgentEvent | null {
  const o = session.run?.opportunities.find((x) => x.id === id);
  if (!o || !waiting(session, o) || now.getTime() < Date.parse(o.holdUntil!) - EARLY) return null;
  session.decisions[id] = "lapsed";
  const plan = o.kind === "plan";
  const event: AgentEvent = {
    type: "hold",
    threadId: o.threadId,
    opportunityId: id,
    stage: "lapsed",
    until: o.holdUntil!,
    text: `${plan ? "This plan" : `Version ${o.version}`} lapsed: you didn't answer by ${whenWords(o.holdUntil!)}, so the others are free again. Your agent told them, without guessing at why. Send it out again for a fresh one.`,
  };
  session.run!.events.push(event);
  return event;
}

// Every proposal whose hold has run out. Run on each visit as well as by the alarm, so a missed alarm can't keep anyone waiting.
export function sweepHolds(session: Session, now = new Date()): AgentEvent[] {
  return (session.run?.opportunities ?? []).flatMap((o) => lapse(session, o.id, now) ?? []);
}

// The person asks for more time. The others' agents hold their place a day longer; only once per proposal.
export function extendHold(session: Session, id: string, schedule?: Scheduler, now = new Date()): AgentEvent {
  const o = session.run?.opportunities.find((x) => x.id === id);
  if (!o) throw new Error("That proposal no longer exists.");
  if (session.decisions[id] === "lapsed") throw new Error("This one already lapsed. Send your agent out again for a fresh one.");
  if (session.decisions[id]) throw new Error("You've already answered this one.");
  if (isStale(session, o)) throw new Error("You changed what you asked for, so this one no longer stands.");
  if (o.extended) throw new Error("You already asked for more time once. Answer by when it's held, or let it lapse.");
  const from = Math.max(now.getTime(), Date.parse(o.holdUntil ?? now.toISOString()));
  o.holdUntil = new Date(from + EXTEND_HOURS * HOUR).toISOString();
  o.extended = true;
  schedule?.({ kind: "hold", opportunityId: id }, new Date(o.holdUntil));
  const others = o.people.filter((p) => p !== session.name);
  const event: AgentEvent = {
    type: "hold",
    threadId: o.threadId,
    opportunityId: id,
    stage: "extended",
    until: o.holdUntil,
    text: `You asked for more time. ${others.length > 1 ? "The others' agents" : `${others[0] ?? "The other side"}'s agent`} will hold it until ${whenWords(o.holdUntil)}. You can ask once.`,
  };
  session.run!.events.push(event);
  return event;
}

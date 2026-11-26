import { formatPrice, isInterest } from "./domain";
import type { IntakeEvent } from "./intake/types";
import { listWords } from "./negotiation/plan";
import type { AgentEvent } from "./negotiation/types";
import type { LogActor, LogEntry, Session } from "./store";

export type Loggable = AgentEvent | IntakeEvent;
type Entry = Omit<LogEntry, "at">;

const VERB = { PROPOSE: "Proposed", COUNTER: "Countered with", ACCEPT: "Accepted" } as const;

function quote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `“${clean.length > 140 ? `${clean.slice(0, 139)}…` : clean}”`;
}

// The other people's agents in a room, in words: "Diego's agent", or "Lena, Rita and Bruno's agents".
export function audience(session: Session, threadId: string): string {
  const names = new Set<string>();
  for (const e of session.run?.events ?? []) {
    if (e.type === "discover" && e.threadId === threadId) names.add(e.who);
    if (e.type === "room" && e.threadId === threadId) for (const m of e.members) if (m !== session.name) names.add(m);
  }
  const list = [...names];
  return list.length ? `${listWords(list)}'s agent${list.length > 1 ? "s" : ""}` : "the room";
}

// Who acted, for an entry: the person, their agent, or Open's own code (the matcher, the privacy check, a hold running out).
function actorOf(event: Loggable, entry: Entry): LogActor {
  if (entry.kind === "you" || event.type === "ready") return "you";
  if (event.type === "decision") return event.decision === "lapsed" ? "open" : "you";
  if (event.type === "hold") return event.stage === "lapsed" ? "open" : "you";
  if (entry.kind === "withheld" || (event.type === "message" && event.from === "open")) return "open";
  return "agent";
}

// What goes in the person's activity log for an event, if anything: what their agent did, said or shared, and with whom.
// Other agents' messages aren't logged; the log is about what was done in your name.
export function entryFor(session: Session, event: Loggable): Entry | null {
  const entry = describe(session, event);
  return entry && { ...entry, by: actorOf(event, entry) };
}

function describe(session: Session, event: Loggable): Entry | null {
  switch (event.type) {
    case "intent": {
      const i = event.intent;
      if (i.status === "rejected") return { kind: "setup", text: `Left out “${i.summary}”` };
      const limit = !isInterest(i) && i.price !== null ? ` with a private ${i.direction === "seek" ? "limit" : "floor"} of ${formatPrice(i.price, i.unit)}` : "";
      const times = i.conditions.length ? `, ${i.conditions.join(", ")}` : "";
      return { kind: "setup", text: `Saved “${i.summary}”${limit}${times}` };
    }
    case "read":
      return { kind: "read", text: `Read a public page you shared: ${event.title} (${new URL(event.url).hostname}). Read-only, logged out` };
    case "ready":
      return { kind: "setup", text: "You confirmed the recap. Your agent is ready to go out" };
    case "discover":
      if (event.mode === "private") return { kind: "found", room: event.threadId, text: `Opened a private room with ${event.who}'s agent` };
      return {
        kind: "found",
        room: event.threadId,
        text: event.mode === "circle" ? `Found ${event.who}'s agent: into “${event.about}” too` : `Started talking with ${event.who}'s agent about “${event.about}”`,
      };
    case "room":
      return { kind: "found", room: event.threadId, text: `Opened a room with ${listWords(event.members.filter((m) => m !== session.name))}` };
    case "message": {
      const to = audience(session, event.threadId);
      if (event.from === "person") return { kind: "you", room: event.threadId, text: `You wrote to ${to}: ${quote(event.text)}` };
      if (event.withheld && event.from === "you") return { kind: "withheld", room: event.threadId, text: `Withheld a message to ${to}: it mentioned something private` };
      if (event.from === "open")
        return event.action === "MATCH" && event.amount !== null && event.unit
          ? { kind: "offer", room: event.threadId, text: `Open's matcher set the price at ${formatPrice(event.amount, event.unit)} with ${to}` }
          : event.action === "NO_MATCH"
            ? { kind: "offer", room: event.threadId, text: `No overlap with ${to}. Neither side learned the other's limit` }
            : null;
      if (event.action === "SEAL") return { kind: "offer", room: event.threadId, text: `Sent your sealed offer to Open's matcher, not to ${to}` };
      if (event.from !== "you") return null;
      if (event.action === "DECLINE") return { kind: "offer", room: event.threadId, text: `Walked away from ${to}: no price worked within your limit` };
      if (event.amount !== null && event.unit && event.action in VERB)
        return { kind: "offer", room: event.threadId, text: `${VERB[event.action as keyof typeof VERB]} ${formatPrice(event.amount, event.unit)} with ${to}` };
      return { kind: "shared", room: event.threadId, text: `Told ${to}: ${quote(event.text)}` };
    }
    case "outcome":
      return event.result === "no_fit" ? { kind: "found", room: event.threadId, text: `No fit: ${event.why}` } : null;
    case "shortlist": {
      const chosen = event.options.find((o) => o.threadId === event.chosen);
      return { kind: "found", room: event.chosen, text: `Compared ${event.options.length} offers for “${event.about}” and picked ${chosen?.who ?? "one"}. ${event.why}` };
    }
    case "opportunity": {
      const o = event.opportunity;
      const price = o.price !== null && o.unit ? `, ${formatPrice(o.price, o.unit)}` : "";
      return { kind: "found", room: o.threadId, text: o.kind === "plan" ? `Brought you a plan: ${o.title}` : `Brought you version ${o.version}: ${o.title}${price}` };
    }
    case "hold": {
      const o = session.run?.opportunities.find((x) => x.id === event.opportunityId);
      const title = o?.title ?? "a proposal";
      return event.stage === "lapsed"
        ? { kind: "hold", room: event.threadId, text: `“${title}” lapsed unanswered. Your agent told ${audience(session, event.threadId)} they're free again` }
        : { kind: "hold", room: event.threadId, text: `You asked ${audience(session, event.threadId)} to hold “${title}” a day longer` };
    }
    case "decision": {
      const o = session.run?.opportunities.find((x) => x.id === event.opportunityId);
      const title = o?.title ?? "a proposal";
      const plan = o?.kind === "plan";
      if (event.decision === "lapsed") return null;
      const text =
        event.decision === "approved"
          ? plan
            ? `You said you're in: ${title}`
            : `You approved version ${o?.version ?? 1}: ${title}`
          : plan
            ? `You passed on: ${title}`
            : `You declined: ${title}`;
      return { kind: "decision", room: event.threadId, text };
    }
    case "followup":
      return event.stage === "check_in" ? null : { kind: "followup", room: event.threadId, text: event.text };
    default:
      return null;
  }
}

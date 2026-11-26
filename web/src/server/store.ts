import { createHash, randomUUID as uuid } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { allChecks } from "./audit";
import { allDisclosures } from "./disclosure";
import { isStale } from "./intake/profile";
import type { ProfileIntent } from "./domain";
import type { Calibration } from "./intake/calibration";
import type { ChatItem } from "./intake/types";
import type { PageFacts } from "./tools/reader";
import type { AgentEvent, CheckIn, Opportunity, Outcome } from "./negotiation/types";

// One line in the person's activity log: what their agent did, said or shared on their behalf, and with whom.
// Each entry carries a hash of itself and the one before, so any later edit to the log shows.
// `by` is who acted: the person, their agent, or Open itself (the matcher, a hold running out). Every entry names
// its actor, the way audited agent boards record who performed each action.
export type LogActor = "you" | "agent" | "open";
export type LogEntry = {
  at: string;
  kind: "setup" | "found" | "shared" | "offer" | "you" | "decision" | "followup" | "withheld" | "read" | "hold";
  text: string;
  room?: string;
  by?: LogActor;
  hash?: string;
};

export function entryHash(previous: string, entry: Omit<LogEntry, "hash">): string {
  // Entries written before `by` existed hash without it, so old logs still check out.
  const fields = [previous, entry.at, entry.kind, entry.text, entry.room ?? null, ...(entry.by ? [entry.by] : [])];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 16);
}

// True when every entry's hash matches its content and the entry before it.
export function logIntact(log: LogEntry[]): boolean {
  let previous = "";
  for (const entry of log) {
    if (!entry.hash) continue;
    if (entry.hash !== entryHash(previous, entry)) return false;
    previous = entry.hash;
  }
  return true;
}

export type Session = {
  id: string;
  createdAt: string;
  name: string;
  // Exact model history, appended to and never edited.
  history: Anthropic.Beta.BetaMessageParam[];
  // What the person sees in the conversation.
  chat: ChatItem[];
  intents: ProfileIntent[];
  ready: boolean;
  // Notes for the agent about things the person did outside the chat, sent with their next message.
  pendingNotes: string[];
  run: { at: string; events: AgentEvent[]; opportunities: Opportunity[] } | null;
  decisions: Record<string, Outcome>;
  // The person checked the recap of what their agent will look for and said it's right.
  recapConfirmed: boolean;
  log: LogEntry[];
  // The agent's guesses at the person's either/or picks, and how many it got right.
  calibration?: Calibration;
  // Public pages the agent read for the person, with the facts it took from each.
  sources?: PageFacts[];
  followups: Record<string, { stage: "introduced" | "done"; answer?: CheckIn; dueAt?: string; asked?: boolean }>;
};

const SESSION_ID = /^[0-9a-f-]{36}$/;

export const SESSION_COOKIE = "open_sid";

export function isSessionId(id: string | undefined | null): id is string {
  return !!id && SESSION_ID.test(id);
}

// A new person's private state. Where it's kept is up to the host: a file locally, the person's Durable Object on Cloudflare.
export function createSession(name: string, id: string = uuid()): Session {
  return {
    id,
    createdAt: new Date().toISOString(),
    name,
    history: [],
    chat: [],
    intents: [],
    ready: false,
    pendingNotes: [],
    run: null,
    decisions: {},
    recapConfirmed: false,
    log: [],
    followups: {},
  };
}

// Sessions saved before newer fields existed.
export function upgradeSession(session: Session): Session {
  session.log ??= [];
  session.followups ??= {};
  session.recapConfirmed ??= session.ready;
  return session;
}

// What the browser is allowed to see: no model history, no other people's limits.
export function publicSession(session: Session) {
  return {
    name: session.name,
    chat: session.chat,
    intents: session.intents,
    ready: session.ready,
    run: session.run,
    decisions: session.decisions,
    recapConfirmed: session.recapConfirmed,
    log: session.log,
    logIntact: logIntact(session.log),
    checks: allChecks(session),
    // Per room: what it knows about the person, and the rule that decided each item.
    disclosures: allDisclosures(session),
    // Proposals agreed under an intent the person has since changed. They can be declined, not approved.
    stale: (session.run?.opportunities ?? []).filter((o) => isStale(session, o)).map((o) => o.id),
    // How well the agent read the person: only the score, never its guesses.
    understanding: session.calibration?.agreed !== undefined ? { agreed: session.calibration.agreed, total: session.calibration.pairs.length } : null,
    followups: session.followups,
    sources: session.sources ?? [],
  };
}
export type PublicSession = ReturnType<typeof publicSession>;

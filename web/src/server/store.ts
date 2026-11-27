import { createHash, randomUUID as uuid } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { allChecks } from "./audit";
import { allDisclosures } from "./disclosure";
import { isReady, isStale } from "./intake/profile";
import { marked } from "./http";
import { expiresAt } from "./privacy";
import { deleteAt } from "./rooms/settle";
import { profileOf, type AboutNote, type ProfileIntent } from "./domain";
import type { OpenMessage } from "./intake/openmodel";
import type { AgentKey, Delegation } from "./identity";
import type { Reach } from "./reach";
import type { KeepLooking } from "./lookagain";
import { understandingOf, type Calibration } from "./intake/calibration";
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
  // The same for an open model on Workers AI, which speaks the OpenAI chat format.
  openHistory?: OpenMessage[];
  // What the person sees in the conversation.
  chat: ChatItem[];
  intents: ProfileIntent[];
  // What the person picked at the start ("Pay less for something"), and what the agent learned that isn't an intent.
  goals?: string[];
  about?: AboutNote[];
  ready: boolean;
  // Notes for the agent about things the person did outside the chat, sent with their next message.
  pendingNotes: string[];
  // `queued`: proposals found but not yet shown, because a person gets a few at a time.
  run: { at: string; events: AgentEvent[]; opportunities: Opportunity[]; queued?: Opportunity[] } | null;
  decisions: Record<string, Outcome>;
  // The person checked the recap of what their agent will look for and said it's right.
  recapConfirmed: boolean;
  log: LogEntry[];
  // The agent's guesses at the person's either/or picks, and how many it got right.
  calibration?: Calibration;
  // Public pages the agent read for the person, with the facts it took from each.
  sources?: PageFacts[];
  followups: Record<string, { stage: "introduced" | "done"; answer?: CheckIn; dueAt?: string; asked?: boolean }>;
  // The agent's own signing key. The private half never leaves the session.
  agentKey?: AgentKey;
  // The permissions the person gave their agent (newest last), and the counter its messages carry.
  delegations?: Delegation[];
  agentSeq?: number;
  // Who can reach this agent, requests from strangers, and who's blocked.
  reach?: Reach;
  // The agent checks the network again on a schedule until this ends.
  keepLooking?: KeepLooking;
  // Today's use against the person's daily quotas.
  usage?: { day: string; counts: Partial<Record<string, number>> };
  // When the person last used their agent. It's deleted RETENTION_DAYS after this.
  lastSeenAt?: string;
  // When the person said they're 18 or over, before the agent was made.
  adultAt?: string;
  // A simulated member made by the simulation harness (src/sim). Set by the server-side harness only, never from a
  // request, so simulated people can be told apart from real ones and kept out of real numbers.
  synthetic?: boolean;
  // Rooms that settled, with when. Closed rooms take no more messages and are deleted ROOM_KEEP_DAYS later.
  closed?: Record<string, string>;
};

const SESSION_ID = /^[0-9a-f-]{36}$/;

export const SESSION_COOKIE = "open_sid";

export function isSessionId(id: string | undefined | null): id is string {
  return !!id && SESSION_ID.test(id);
}

// A new person's private state. Where it's kept is up to the host: a file locally, the person's Durable Object on Cloudflare.
export function createSession(name: string, id: string = uuid()): Session {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    lastSeenAt: now,
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
  // Ready means the recap is checked and there's something to go out with, whatever the model did or didn't call.
  session.ready = session.recapConfirmed && isReady(session);
  return session;
}

// What the browser is allowed to see: no model history, no other people's limits.
export function publicSession(session: Session) {
  return {
    name: session.name,
    // Agent turns carry `aiGenerated`, the same marker the live streams use.
    chat: session.chat.map(marked),
    intents: session.intents,
    goals: session.goals ?? [],
    about: session.about ?? [],
    // The structured profile, built from all of the above.
    profile: profileOf(session),
    ready: session.ready,
    run: session.run && { ...session.run, events: session.run.events.map(marked) },
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
    understanding: understandingOf(session.calibration),
    followups: session.followups,
    // The agent's public identity: what its signatures can be checked against. Never the private key.
    agent: session.agentKey ? { id: session.agentKey.id, publicJwk: session.agentKey.publicJwk, permission: session.delegations?.at(-1) ?? null } : null,
    sources: session.sources ?? [],
    // Who can reach the agent: the setting, strangers waiting for an answer, and who's blocked. Never the counters.
    reach: { policy: session.reach?.policy ?? "ask", requests: (session.reach?.requests ?? []).filter((r) => r.status === "pending"), blocked: session.reach?.blocked ?? [], allowed: session.reach?.allowed ?? [] },
    keepLooking: session.keepLooking ?? null,
    // A simulated member: the inbox says so, with a way back to the simulation.
    synthetic: !!session.synthetic,
    // Settled rooms: closed, read-only, and when each is deleted.
    closed: Object.fromEntries(Object.entries(session.closed ?? {}).map(([id, at]) => [id, { at, deleteAt: deleteAt(at) }])),
    // When the agent and everything it knows will be deleted if the person doesn't come back.
    keptUntil: new Date(expiresAt(session)).toISOString(),
  };
}
export type PublicSession = ReturnType<typeof publicSession>;

import { entryFor, type Loggable } from "./activity";
import type { AgentEvent } from "./negotiation/types";
import { entryHash, type LogEntry, type Session } from "./store";

// One live agent per person: a single object per id that holds the person's private state in memory and
// persists it after every request. On Cloudflare it lives inside the person's Durable Object (worker/person.ts);
// locally, a small registry plays that part (local/registry.ts). Every request for the same person works on the same object.
export type Actor = {
  session: Session;
  // Where the session is kept: the Durable Object's SQLite storage, or a file locally.
  save: (session: Session) => void;
  lastUsed: number;
  // What the agent is doing right now, so a second run can't start on top of the first.
  busy: string | null;
  // Browsers following a run live, such as a tab reopened while the agent was out.
  listeners?: Set<Listener>;
  // A small token bucket, so one person can't flood other agents or the model.
  tokens?: { left: number; at: number };
};

export type Listener = { event: (event: AgentEvent) => void; end: () => void };

const BUCKET = { size: 20, perSecond: 0.5 };

export function makeActor(session: Session, save: (session: Session) => void): Actor {
  return { session, save, lastUsed: Date.now(), busy: null };
}

export function record(actor: Actor, entry: Omit<LogEntry, "at">): void {
  const log = actor.session.log;
  const last = log.at(-1);
  if (last && last.text === entry.text && last.room === entry.room) return;
  const full = { at: new Date().toISOString(), ...entry };
  log.push({ ...full, hash: entryHash(last?.hash ?? "", full) });
}

// Takes one token for work that reaches other agents or the model. False means slow down.
export function allow(actor: Actor, now = Date.now()): boolean {
  const bucket = (actor.tokens ??= { left: BUCKET.size, at: now });
  bucket.left = Math.min(BUCKET.size, bucket.left + ((now - bucket.at) / 1000) * BUCKET.perSecond);
  bucket.at = now;
  if (bucket.left < 1) return false;
  bucket.left -= 1;
  return true;
}

// Follows the agent's live events until the work ends or the returned function is called.
export function listen(actor: Actor, listener: Listener): () => void {
  const listeners = (actor.listeners ??= new Set());
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcast(actor: Actor, event: AgentEvent): void {
  for (const listener of actor.listeners ?? []) listener.event(event);
}

// The work holding the agent finished: everyone following it can stop.
export function finish(actor: Actor): void {
  actor.busy = null;
  for (const listener of actor.listeners ?? []) listener.end();
  actor.listeners?.clear();
}

// Every event the agent emits passes through here, so the activity log can't miss anything done in the person's name.
export function observe(actor: Actor, event: Loggable): void {
  const entry = entryFor(actor.session, event);
  if (entry) record(actor, entry);
}

export function persist(actor: Actor): void {
  actor.save(actor.session);
}

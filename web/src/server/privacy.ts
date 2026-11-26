import { lowerFirst, profileOf } from "./domain";
import { isReady } from "./intake/profile";
import { RETENTION_DAYS } from "./retention";
import { entryHash, type Session } from "./store";

// The person's rights over what their agent holds, done in storage rather than by asking the model: a 2026 study of
// agent memory systems found that telling a model to forget something worked for at most 1.5% of requests. So
// "forget" removes every copy of the words, the model's own memory of the conversation included, and "start over"
// deletes the whole agent.

export { RETENTION_DAYS };
const DAY = 24 * 60 * 60 * 1000;

export function lastSeen(session: Session): number {
  return Date.parse(session.lastSeenAt ?? session.createdAt);
}

export function expiresAt(session: Session): number {
  return lastSeen(session) + RETENTION_DAYS * DAY;
}

export function expired(session: Session, now = Date.now()): boolean {
  return now >= expiresAt(session);
}

// Marks the person as here. Returns true when it changed enough to be worth saving (at most once an hour).
export function touch(session: Session, now = Date.now()): boolean {
  if (now - lastSeen(session) < 60 * 60 * 1000) return false;
  session.lastSeenAt = new Date(now).toISOString();
  return true;
}

// Everything the agent holds about the person, as a file they can keep or take elsewhere (GDPR Art. 15 and 20).
// Only the agent's private signing key is left out: it's a credential, not information about them.
export function exportOf(session: Session) {
  const rest: Partial<Session> = { ...session };
  const { agentKey } = session;
  delete rest.agentKey;
  delete rest.usage;
  return {
    exportedAt: new Date().toISOString(),
    about: "Everything your agent on Open holds about you. Your price limits are in `intents`. `history` and `openHistory` are the AI model's own copy of your conversation.",
    keptUntil: new Date(expiresAt(session)).toISOString(),
    ...rest,
    profile: profileOf(session),
    agentKey: agentKey ? { id: agentKey.id, publicJwk: agentKey.publicJwk } : null,
  };
}

const FORGOTTEN = "[forgotten]";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every string in `value` with each needle replaced, matching case. Needles under four characters are skipped: too
// likely to match something that isn't theirs.
function scrub<T>(value: T, needles: RegExp[]): T {
  if (typeof value === "string") return needles.reduce<string>((s, n) => s.replace(n, FORGOTTEN), value) as T;
  if (Array.isArray(value)) return value.map((v) => scrub(v, needles)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, needles)])) as T;
  return value;
}

function patterns(texts: string[]): RegExp[] {
  return [...new Set(texts.flatMap((t) => [t.trim(), lowerFirst(t.trim())]).filter((t) => t.length >= 4))].sort((a, b) => b.length - a.length).map((t) => new RegExp(escape(t), "gi"));
}

// Removes the words from everything the agent keeps: the conversation the person sees, rooms, the activity log (whose
// chain is re-hashed, with a line saying so), the either/or picks. The model's own history is dropped whole and
// replaced by a short note of what's left, so nothing forgotten can come back through it.
function forgetWords(session: Session, texts: string[], what: string): number {
  const needles = patterns(texts);
  const hit = (s: string) =>
    needles.some((n) => {
      n.lastIndex = 0;
      return n.test(s);
    });
  // The person's own messages that held it go whole: a half-redacted sentence still says too much.
  session.chat = session.chat.map((item) => (item.role === "user" && hit(item.text) ? { ...item, text: "[You asked your agent to forget this]" } : scrub(item, needles)));
  if (session.run) {
    session.run = scrub(session.run, needles);
    // A changed message no longer matches its signature: the agent signs it again as it is now.
    for (const event of session.run.events) if (event.type === "message" && event.text.includes(FORGOTTEN)) delete event.signature;
  }
  if (session.calibration) session.calibration = scrub(session.calibration, needles);
  // Other intents and notes may quote the same sentence.
  session.intents = session.intents.map((i) => ({ ...i, evidence: scrub(i.evidence, needles) }));
  if (session.about) session.about = session.about.map((n) => ({ ...n, evidence: scrub(n.evidence, needles) }));
  if (session.sources) session.sources = scrub(session.sources, needles);

  let redacted = 0;
  let previous = "";
  session.log = session.log.map((entry) => {
    const text = scrub(entry.text, needles);
    if (text !== entry.text) redacted++;
    const next = { ...entry, text };
    if (!entry.hash) return next;
    delete next.hash;
    const hash = entryHash(previous, next);
    previous = hash;
    return { ...next, hash };
  });
  const at = new Date().toISOString();
  const line = { at, kind: "you" as const, by: "you" as const, text: `You asked your agent to forget ${what}. Every copy of your words was removed${redacted ? `, including ${redacted} line${redacted === 1 ? "" : "s"} of this log` : ""}.` };
  session.log.push({ ...line, hash: entryHash(previous, line) });

  session.history = [];
  session.openHistory = [];
  const profile = profileOf(session);
  const left = [...profile.lookingFor, ...profile.offering, ...profile.into].map((e) => e.summary);
  session.pendingNotes = [
    `[App note: ${session.name} asked you to forget something, so your earlier conversation was cleared and nothing of it is kept. What you know now: ${left.length ? left.join("; ") : "nothing yet"}${profile.about.length ? `. Notes: ${profile.about.map((n) => n.fact).join("; ")}` : ""}. Don't bring up or guess at what was forgotten.]`,
  ];
  return redacted;
}

// "Forget this": the intent goes, with every room and proposal that came from it and every copy of the words.
export function forgetIntent(session: Session, id: string): boolean {
  const intent = session.intents.find((i) => i.id === id);
  if (!intent) return false;
  session.intents = session.intents.filter((i) => i.id !== id);
  if (session.run) {
    const gone = new Set(session.run.opportunities.filter((o) => o.intentId === id).map((o) => o.id));
    for (const o of session.run.queued ?? []) if (o.intentId === id) gone.add(o.id);
    session.run.events = session.run.events.filter((e) => !("threadId" in e) || typeof e.threadId !== "string" || !e.threadId.startsWith(`${id}-`));
    session.run.opportunities = session.run.opportunities.filter((o) => !gone.has(o.id));
    if (session.run.queued) session.run.queued = session.run.queued.filter((o) => !gone.has(o.id));
    for (const oid of gone) {
      delete session.decisions[oid];
      delete session.followups[oid];
    }
  }
  forgetWords(session, [intent.summary, intent.evidence], "one of the things it was looking for");
  // What goes out only got narrower, so a confirmed recap still holds; but with nothing left, there's nothing to send.
  session.ready = session.recapConfirmed && isReady(session);
  return true;
}

export function forgetNote(session: Session, id: string): boolean {
  const note = session.about?.find((n) => n.id === id);
  if (!note) return false;
  session.about = session.about!.filter((n) => n.id !== id);
  forgetWords(session, [note.fact, ...(note.evidence.startsWith("From the") || note.evidence.startsWith("Picked") ? [] : [note.evidence])], "a note it had made about you");
  return true;
}

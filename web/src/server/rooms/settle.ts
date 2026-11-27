import { record, type Actor } from "../actor";
import type { Session } from "../store";

// A room closes once nothing more can happen in it, and is deleted a while later, like short-lived task channels in
// agent workspaces (Buzz closes a worker's channel when the task is done). A closed room takes no more messages or
// limit changes; its record stays readable until it's deleted, so the person can look back at what was agreed.
export const ROOM_KEEP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// Settled: the proposal was declined or lapsed, or it happened (or didn't) and the person checked in.
export function settled(session: Session, threadId: string): string | null {
  const offers = (session.run?.opportunities ?? []).filter((o) => o.threadId === threadId);
  const latest = offers.at(-1);
  if (!latest) return null;
  const decision = session.decisions[latest.id];
  if (decision === "declined") return "you said no";
  if (decision === "lapsed") return "the proposal lapsed";
  if (decision === "approved" && session.followups[latest.id]?.stage === "done") return "you checked in";
  return null;
}

export function deleteAt(closedAt: string): string {
  return new Date(Date.parse(closedAt) + ROOM_KEEP_DAYS * DAY).toISOString();
}

// Closes every room that just settled. Returns the ones it closed, with why, for the activity log.
export function closeSettled(session: Session, now = new Date()): { threadId: string; why: string }[] {
  const closed = (session.closed ??= {});
  const threads = new Set((session.run?.opportunities ?? []).map((o) => o.threadId));
  const out: { threadId: string; why: string }[] = [];
  for (const threadId of threads) {
    if (closed[threadId]) continue;
    const why = settled(session, threadId);
    if (!why) continue;
    closed[threadId] = now.toISOString();
    out.push({ threadId, why });
  }
  return out;
}

// Deletes rooms closed more than ROOM_KEEP_DAYS ago: their messages, proposals, answers and check-ins.
export function deleteOldRooms(session: Session, now = new Date()): number {
  const closed = session.closed ?? {};
  const old = Object.keys(closed).filter((id) => Date.parse(deleteAt(closed[id]!)) <= now.getTime());
  if (!old.length || !session.run) return 0;
  const gone = new Set(old);
  const offers = new Set(session.run.opportunities.filter((o) => gone.has(o.threadId)).map((o) => o.id));
  session.run.events = session.run.events.filter((e) => !("threadId" in e) || !gone.has(e.threadId as string));
  session.run.opportunities = session.run.opportunities.filter((o) => !gone.has(o.threadId));
  for (const id of offers) {
    delete session.decisions[id];
    delete session.followups[id];
  }
  for (const id of old) delete closed[id];
  return old.length;
}

export function isClosed(session: Session, threadId: string): boolean {
  return !!session.closed?.[threadId];
}

// After any work, and on every visit: close what settled, delete what's past its date, and say so in the log.
export function tidyRooms(actor: Actor, now = new Date()): boolean {
  const { session } = actor;
  const titles = new Map((session.run?.opportunities ?? []).map((o) => [o.threadId, o.title]));
  const closed = closeSettled(session, now);
  for (const { threadId, why } of closed)
    record(actor, { kind: "decision", by: "open", room: threadId, text: `Closed the room for “${titles.get(threadId) ?? "a proposal"}” because ${why}. It's deleted on ${new Date(deleteAt(now.toISOString())).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` });
  const deleted = deleteOldRooms(session, now);
  if (deleted) record(actor, { kind: "decision", by: "open", text: `Deleted ${deleted} room${deleted === 1 ? "" : "s"} closed more than ${ROOM_KEEP_DAYS} days ago` });
  return closed.length > 0 || deleted > 0;
}

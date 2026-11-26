import { formatPrice } from "@/server/domain";
import type { AgentEvent, CheckIn, Opportunity, RoomMode } from "@/server/negotiation/types";

export type MessageEvent = Extract<AgentEvent, { type: "message" }>;
export type Shortlist = Extract<AgentEvent, { type: "shortlist" }>;

export type TimelineItem =
  | { kind: "message"; event: MessageEvent }
  | { kind: "note"; text: string }
  | { kind: "room"; members: string[]; why: string }
  | { kind: "outcome"; result: "agreed" | "no_fit" | "open"; why: string }
  | { kind: "followup"; stage: "introduced" | "check_in" | "done"; text: string; opportunityId: string; answer?: CheckIn };

export type ThreadStatus = "talking" | "agreed" | "no_fit" | "open";

export type Thread = {
  id: string;
  who: string;
  about: string;
  why: string;
  mode: RoomMode;
  // Everyone in the conversation other than you and your agent.
  others: string[];
  grouped: boolean;
  timeline: TimelineItem[];
  status: ThreadStatus;
};

export type RunState = {
  status: string | null;
  threads: Thread[];
  activeId: string | null;
  opportunities: Opportunity[];
  // What your agent compared before choosing, one per intent with more than one offer.
  shortlists: Shortlist[];
  stats: { contacted: number; rooms: number; ready: number } | null;
  error: string | null;
};

export const emptyRun: RunState = { status: null, threads: [], activeId: null, opportunities: [], shortlists: [], stats: null, error: null };

function onThread(state: RunState, id: string, change: (t: Thread) => Thread): RunState {
  return { ...state, activeId: id, threads: state.threads.map((t) => (t.id === id ? change(t) : t)) };
}

export function reduce(state: RunState, event: AgentEvent | { type: "done" }): RunState {
  switch (event.type) {
    case "status":
      return { ...state, status: event.text };
    case "discover":
      if (state.threads.some((t) => t.id === event.threadId)) return state;
      return {
        ...state,
        activeId: event.threadId,
        status: `Talking with ${event.who}'s agent`,
        threads: [
          ...state.threads,
          { id: event.threadId, who: event.who, about: event.about, why: event.why, mode: event.mode ?? "deal", others: [event.who], grouped: false, timeline: [], status: event.mode === "private" ? "open" : "talking" },
        ],
      };
    case "room":
      return onThread(state, event.threadId, (t) => ({
        ...t,
        grouped: true,
        others: [t.who, ...event.members.slice(1)],
        timeline: [...t.timeline, { kind: "room", members: event.members, why: event.why }],
      }));
    case "note":
      return onThread(state, event.threadId, (t) => ({ ...t, status: "talking", timeline: [...t.timeline, { kind: "note", text: event.text }] }));
    case "message":
      return onThread(state, event.threadId, (t) => ({ ...t, timeline: [...t.timeline, { kind: "message", event }] }));
    case "outcome":
      return onThread(state, event.threadId, (t) => ({ ...t, status: event.result, timeline: [...t.timeline, { kind: "outcome", result: event.result, why: event.why }] }));
    case "opportunity":
      return { ...state, opportunities: [...state.opportunities.filter((o) => o.threadId !== event.opportunity.threadId), event.opportunity] };
    case "shortlist":
      return { ...state, shortlists: [...state.shortlists.filter((s) => s.intentId !== event.intentId), event] };
    case "decision":
      return state;
    case "followup":
      return {
        ...state,
        threads: state.threads.map((t) =>
          t.id === event.threadId ? { ...t, timeline: [...t.timeline, { kind: "followup", stage: event.stage, text: event.text, opportunityId: event.opportunityId, answer: event.answer }] } : t,
        ),
      };
    case "error":
      return { ...state, error: event.message };
    case "done":
      return "stats" in event ? { ...state, stats: event.stats, status: null } : state;
  }
}

export function threadTitle(thread: Thread): string {
  if (thread.mode === "private") return `${thread.who} · private`;
  return `${thread.about} · ${thread.grouped ? thread.others.join(", ") : thread.who}`;
}

export function priceOf(opportunity: Opportunity): string | null {
  return opportunity.price !== null && opportunity.unit ? formatPrice(opportunity.price, opportunity.unit) : null;
}

export function lastLine(thread: Thread): string {
  for (let i = thread.timeline.length - 1; i >= 0; i--) {
    const item = thread.timeline[i]!;
    if (item.kind === "message") {
      const speaker = item.event.from === "person" ? "You" : item.event.from === "you" ? "Your agent" : item.event.who.replace("'s agent", "");
      return `${speaker}: ${item.event.text}`;
    }
    if (item.kind === "outcome") {
      if (item.result === "open") return "Open. No plan yet";
      if (item.result === "no_fit") return "No fit";
      return thread.mode === "deal" ? "Agreed. Waiting for your approval" : "Plan ready. Are you in?";
    }
    if (item.kind === "note") return item.text;
    if (item.kind === "room") return `Room opened with ${item.members.length} people`;
    if (item.kind === "followup") return item.stage === "check_in" ? "Did it happen? Your agent will ask" : item.text;
  }
  return thread.why;
}

// A deal room that reached a price, but your agent brought you a better offer for the same thing instead.
export function notPicked(thread: Thread, opportunities: Opportunity[]): boolean {
  return thread.mode === "deal" && thread.status === "agreed" && !opportunities.some((o) => o.threadId === thread.id);
}

// The stage a room is in, worded for its kind of room.
// With `opportunities` and `decisions`, it also says when a room waits on you, like a task in an agent inbox.
export function statusOf(thread: Thread, opportunities?: Opportunity[], decisions?: Record<string, string>): { text: string; cls: string } {
  const deal = thread.mode === "deal";
  if (opportunities && notPicked(thread, opportunities)) return { text: "NOT PICKED", cls: "bg-[#f1f2f4] text-slate" };
  const offer = opportunities?.find((o) => o.threadId === thread.id);
  if (offer && decisions && !decisions[offer.id]) return { text: "WAITING ON YOU", cls: "bg-signal text-white" };
  if (offer && decisions?.[offer.id] === "approved") return { text: followupOf(thread, offer.id).done ? "DONE" : "YOU SAID YES", cls: "bg-live-soft text-live-ink" };
  if (offer && decisions?.[offer.id] === "declined") return { text: "YOU SAID NO", cls: "bg-[#f1f2f4] text-slate" };
  switch (thread.status) {
    case "talking":
      return { text: deal ? "NEGOTIATING" : "TALKING", cls: "bg-signal-soft text-signal-ink" };
    case "agreed":
      return { text: deal ? "AGREED" : "PLAN READY", cls: "bg-live-soft text-live-ink" };
    case "open":
      return { text: thread.mode === "private" ? "PRIVATE" : "OPEN", cls: "bg-[#eef0f4] text-ink" };
    case "no_fit":
      return { text: "NO FIT", cls: "bg-[#f1f2f4] text-slate" };
  }
}

// Where a yes stands after you gave it: introduced and waiting for the check-in, or checked in.
export function followupOf(thread: Thread, opportunityId: string): { checkInDue: boolean; done: TimelineItem | undefined } {
  const items = thread.timeline.filter((t): t is Extract<TimelineItem, { kind: "followup" }> => t.kind === "followup" && t.opportunityId === opportunityId);
  const done = items.find((t) => t.stage === "done");
  return { checkInDue: !done && items.some((t) => t.stage === "check_in"), done };
}

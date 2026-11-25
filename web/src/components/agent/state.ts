import type { AgentEvent, Opportunity } from "@/server/negotiation/types";

export type MessageEvent = Extract<AgentEvent, { type: "message" }>;

export type Thread = {
  id: string;
  who: string;
  about: string;
  why: string;
  room: { members: string[]; why: string } | null;
  messages: MessageEvent[];
  outcome: { result: "agreed" | "no_fit"; why: string } | null;
};

export type RunState = {
  status: string | null;
  threads: Thread[];
  activeId: string | null;
  opportunities: Opportunity[];
  stats: { contacted: number; rooms: number; ready: number } | null;
  error: string | null;
};

export const emptyRun: RunState = { status: null, threads: [], activeId: null, opportunities: [], stats: null, error: null };

function updateThread(state: RunState, id: string, change: (t: Thread) => Thread): RunState {
  return { ...state, activeId: id, threads: state.threads.map((t) => (t.id === id ? change(t) : t)) };
}

export function reduce(state: RunState, event: AgentEvent | { type: "done" }): RunState {
  switch (event.type) {
    case "status":
      return { ...state, status: event.text };
    case "discover":
      return {
        ...state,
        activeId: event.threadId,
        status: `Talking with ${event.who}'s agent`,
        threads: [...state.threads, { id: event.threadId, who: event.who, about: event.about, why: event.why, room: null, messages: [], outcome: null }],
      };
    case "room":
      return updateThread(state, event.threadId, (t) => ({ ...t, room: { members: event.members, why: event.why } }));
    case "message":
      return updateThread(state, event.threadId, (t) => ({ ...t, messages: [...t.messages, event] }));
    case "outcome":
      return updateThread(state, event.threadId, (t) => ({ ...t, outcome: { result: event.result, why: event.why } }));
    case "opportunity":
      return { ...state, opportunities: [...state.opportunities, event.opportunity] };
    case "error":
      return { ...state, error: event.message };
    case "done":
      return "stats" in event ? { ...state, stats: event.stats, status: null } : state;
  }
}

export type ThreadState = "talking" | "agreed" | "no_fit";

export function threadState(thread: Thread): ThreadState {
  return thread.outcome?.result ?? "talking";
}

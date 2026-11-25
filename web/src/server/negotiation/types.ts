import type { Unit } from "../domain";

export type Move = { from: "you" | "them"; action: "PROPOSE" | "COUNTER" | "ACCEPT" | "DECLINE"; amount: number | null };

export type ThreadPlan = {
  id: string;
  intentId: string;
  intentSummary: string;
  direction: "seek" | "offer";
  // The limit of the person using the app. Never sent to the other side.
  limit: number;
  unit: Unit;
  counterpart: { memberId: string; name: string; blurb: string };
  // Other members who join when the thread is a group room.
  room: { name: string }[];
  kind: "direct" | "group" | "no_fit";
  noFitReason: string | null;
  schedule: string | null;
  moves: Move[];
  agreedPrice: number | null;
};

export type Opportunity = {
  id: string;
  threadId: string;
  intentId: string;
  title: string;
  price: number;
  unit: Unit;
  people: string[];
  terms: string[];
  reasons: string[];
  version: number;
};

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "discover"; threadId: string; who: string; about: string; why: string }
  | { type: "room"; threadId: string; members: string[]; why: string }
  | { type: "message"; threadId: string; from: "you" | "them"; who: string; action: Move["action"]; amount: number | null; unit: Unit; text: string; why: string }
  | { type: "outcome"; threadId: string; result: "agreed" | "no_fit"; why: string }
  | { type: "opportunity"; opportunity: Opportunity }
  | { type: "error"; message: string }
  | { type: "done"; stats: { contacted: number; rooms: number; ready: number } };

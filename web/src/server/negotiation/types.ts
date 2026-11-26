import type { Unit } from "../domain";

// Deals are settled by sealed offers: each agent sends its person's limit to Open's matcher, which is code.
// "open" is the matcher. PROPOSE/COUNTER/ACCEPT/DECLINE remain for runs saved before sealed offers.
export type Move = {
  from: "you" | "them" | "open";
  action: "PROPOSE" | "COUNTER" | "ACCEPT" | "DECLINE" | "SEAL" | "MATCH" | "NO_MATCH";
  amount: number | null;
};

export type ThreadPlan = {
  id: string;
  intentId: string;
  intentSummary: string;
  direction: "seek" | "offer";
  // The limit of the person using the app. Never sent to the other side, or to the model.
  limit: number;
  // The other member's limit. Only the matcher sees it: the market strips it before a plan reaches the person's agent.
  theirLimit?: number;
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

// A rich attachment on a room message: something happening, or a paid offer someone mentioned.
export type Card =
  | { kind: "happening"; title: string; when: string; where: string; cost: string; postedBy: string }
  | { kind: "offer"; title: string; who: string };

// What lands with the person for a decision. A deal has a price; a plan is something to do together.
export type Opportunity = {
  id: string;
  threadId: string;
  intentId: string;
  kind?: "deal" | "plan";
  title: string;
  price: number | null;
  unit: Unit | null;
  people: string[];
  terms: string[];
  reasons: string[];
  version: number;
  // A fingerprint of the intent this was agreed under (what, limit, times). If the person changes that intent,
  // the proposal no longer stands: like a payment mandate, approval only covers what was actually authorised.
  basis?: string;
  // What the version before said, so the person sees what changed.
  previous?: { version: number; price: number | null; terms: string[] };
  // A proposal holds everyone's place until this time, like a lease on a claimed task. Unanswered by then, it lapses
  // and the others are free again, so nobody is kept waiting on someone who went quiet.
  holdUntil?: string;
  // The person asked once for more time. A hold can be extended only once.
  extended?: boolean;
  // Who has said yes. Introductions wait until everyone has: one person's agent can't commit the others.
  approvals?: Record<string, "yes" | "waiting">;
  // A fingerprint of exactly what the person approved, so a later change to the terms can't ride on their yes.
  approvedTerms?: string;
  // When, and in what format, as agreed: what a standing yes is checked against.
  schedule?: string | null;
  group?: boolean;
  // The standing yes this was approved under, when the person's agent said yes for them.
  approvedUnder?: string;
};

// Deal rooms negotiate a price. Circles are rooms around a shared interest. Private rooms are one-to-one with one member's agent.
export type RoomMode = "deal" | "circle" | "private";

// Every message in a room is a typed move; the text only explains it. Deal moves carry amounts the engine decided.
// Circle moves share, ask, plan and join. "SAY" is the person's own message; agents answer it, share something, or pass it on.
export type Action = Move["action"] | "SHARE" | "ASK" | "PLAN" | "JOIN" | "SAY" | "ANSWER" | "PASS";

// One offer your agent weighed for an intent before choosing.
export type ShortlistOption = { threadId: string; who: string; price: number; unit: Unit; group: boolean; schedule: string | null };

// How a check-in after a yes went.
export type CheckIn = "again" | "once" | "missed";
export type Decision = "approved" | "declined";
// Where a proposal ended up: the person's answer, or "lapsed" when its hold ran out before they answered.
export type Outcome = Decision | "lapsed";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "discover"; threadId: string; who: string; about: string; why: string; mode?: RoomMode }
  | { type: "room"; threadId: string; members: string[]; why: string }
  | { type: "note"; threadId: string; text: string }
  // `from: "person"` is the person using the app, writing in the room themself.
  // `from: "open"` is Open's matcher, which sets prices in code. `withheld` marks a message the privacy check replaced.
  | { type: "message"; threadId: string; from: "you" | "them" | "person" | "open"; who: string; action: Action; amount: number | null; unit: Unit | null; text: string; why: string; card?: Card; withheld?: boolean; signature?: string }
  | { type: "outcome"; threadId: string; result: "agreed" | "no_fit" | "open"; why: string }
  | { type: "opportunity"; opportunity: Opportunity }
  // Your agent heard every offer for one intent before choosing, in random order, and shows what it compared.
  | { type: "shortlist"; intentId: string; about: string; heard: number; options: ShortlistOption[]; chosen: string; why: string }
  | { type: "decision"; threadId: string; opportunityId: string; decision: Outcome }
  // A proposal's hold was extended at the person's request, or ran out before they answered.
  | { type: "hold"; threadId: string; opportunityId: string; stage: "extended" | "lapsed"; until: string; text: string }
  // After a yes: everyone else says yes and you're introduced, then your agent checks whether it happened.
  | { type: "followup"; threadId: string; opportunityId: string; stage: "introduced" | "check_in" | "done"; text: string; answer?: CheckIn }
  | { type: "error"; message: string }
  | { type: "done"; stats: { contacted: number; rooms: number; ready: number } };

export function isPlan(opportunity: Opportunity): boolean {
  return opportunity.kind === "plan";
}

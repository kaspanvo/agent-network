import type { ProfileIntent } from "./domain";
import { planThreads } from "./negotiation/plan";
import type { CheckIn, ThreadPlan } from "./negotiation/types";
import { LISBON_PILOT } from "./population";

// The market is the one place that holds other members' sealed limits. A person's agent sends its own confirmed
// intents (with its person's limit) and gets back who fits and the matched price, never anyone else's number.
// Locally it runs in-process; on Cloudflare it's its own Durable Object (worker/market.ts), so other members'
// limits never enter a person's agent at all.
export interface Market {
  match(intents: ProfileIntent[]): Promise<ThreadPlan[]>;
  // A check-in said a match didn't happen. The market keeps a private count per member; it's never shown to anyone.
  report?(memberIds: string[], outcome: CheckIn): Promise<void>;
}

// Private reliability. Two "it didn't happen" check-ins and a member's agent stops being offered new matches for a
// while. No public stars or ratings: those get gamed (sybil reviews cost cents in 2026 studies) and shame people.
export { STRIKES_TO_PAUSE } from "./negotiation/plan";
export type Strikes = Record<string, number>;

export function addStrikes(strikes: Strikes, memberIds: string[], outcome: CheckIn): Strikes {
  if (outcome !== "missed") return strikes;
  const next = { ...strikes };
  for (const id of memberIds) next[id] = (next[id] ?? 0) + 1;
  return next;
}

// What leaves the market: the plan without the other side's limit.
export function sealed(thread: ThreadPlan): ThreadPlan {
  const out = { ...thread };
  delete out.theirLimit;
  return out;
}

export function matchInMarket(intents: ProfileIntent[], strikes: Strikes = {}): ThreadPlan[] {
  return planThreads(intents, LISBON_PILOT, strikes).map(sealed);
}

// Kept on globalThis so dev-server reloads keep it.
const g = globalThis as typeof globalThis & { __openStrikes?: Strikes };
export function localMarket(): Market {
  return {
    match: async (intents) => matchInMarket(intents, g.__openStrikes ?? {}),
    report: async (memberIds, outcome) => {
      g.__openStrikes = addStrikes(g.__openStrikes ?? {}, memberIds, outcome);
    },
  };
}

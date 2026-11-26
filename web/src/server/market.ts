import type { ProfileIntent } from "./domain";
import { planThreads } from "./negotiation/plan";
import type { ThreadPlan } from "./negotiation/types";
import { LISBON_PILOT } from "./population";

// The market is the one place that holds other members' sealed limits. A person's agent sends its own confirmed
// intents (with its person's limit) and gets back who fits and the matched price, never anyone else's number.
// Locally it runs in-process; on Cloudflare it's its own Durable Object (worker/market.ts), so other members'
// limits never enter a person's agent at all.
export interface Market {
  match(intents: ProfileIntent[]): Promise<ThreadPlan[]>;
}

// What leaves the market: the plan without the other side's limit.
export function sealed(thread: ThreadPlan): ThreadPlan {
  const out = { ...thread };
  delete out.theirLimit;
  return out;
}

export function matchInMarket(intents: ProfileIntent[]): ThreadPlan[] {
  return planThreads(intents, LISBON_PILOT).map(sealed);
}

export function localMarket(): Market {
  return { match: async (intents) => matchInMarket(intents) };
}

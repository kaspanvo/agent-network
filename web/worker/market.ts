import { DurableObject } from "cloudflare:workers";
import type { ProfileIntent } from "../src/server/domain";
import { matchInMarket } from "../src/server/market";
import type { ThreadPlan } from "../src/server/negotiation/types";

// Open's matcher, as its own Durable Object: one per community. It's the only object that compares sealed limits.
// A person's agent calls `match` with its own confirmed intents and gets back who fits and at what price, with
// every other member's limit already removed, so no person's agent ever holds someone else's number.
//
// One object per community keeps every match in a community in one ordered place. A community well past a
// thousand matches a second would be split by tag, never merged into one global object.
export class MarketAgent extends DurableObject<Env> {
  async match(intents: ProfileIntent[]): Promise<ThreadPlan[]> {
    return matchInMarket(intents);
  }
}

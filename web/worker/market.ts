import { DurableObject } from "cloudflare:workers";
import type { ProfileIntent } from "../src/server/domain";
import type { PrivacyRequest } from "../src/server/api";
import { addStrikes, matchInMarket, type Strikes } from "../src/server/market";
import type { CheckIn, ThreadPlan } from "../src/server/negotiation/types";

// Open's matcher, as its own Durable Object: one per community. It's the only object that compares sealed limits.
// A person's agent calls `match` with its own confirmed intents and gets back who fits and at what price, with
// every other member's limit already removed, so no person's agent ever holds someone else's number.
//
// One object per community keeps every match in a community in one ordered place. A community well past a
// thousand matches a second would be split by tag, never merged into one global object.
export class MarketAgent extends DurableObject<Env> {
  async match(intents: ProfileIntent[]): Promise<ThreadPlan[]> {
    return matchInMarket(intents, (await this.ctx.storage.get<Strikes>("strikes")) ?? {});
  }

  // Private reliability: a count per member of check-ins that said the match didn't happen. Never shown to anyone.
  async report(memberIds: string[], outcome: CheckIn): Promise<void> {
    const strikes = (await this.ctx.storage.get<Strikes>("strikes")) ?? {};
    await this.ctx.storage.put("strikes", addStrikes(strikes, memberIds, outcome));
  }

  // Requests from people who aren't members, about something an agent said about them. Kept in this community's
  // own storage for the people who run it.
  async keepPrivacyRequest(request: PrivacyRequest): Promise<void> {
    await this.ctx.storage.put(`privacy-request:${request.at}:${crypto.randomUUID()}`, request);
  }
}

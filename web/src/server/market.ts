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
  // `reporter` is a one-way key for the person reporting, so one person counts once, however often they report.
  report?(memberIds: string[], outcome: CheckIn, reporter: string): Promise<void>;
}

// Private reliability. A member's agent stops being offered new matches for a while once STRIKES_TO_PAUSE different
// people said a match with them didn't happen. One person's word is never enough: with a single report counting,
// one liar could pause an honest member. No public stars or ratings either: those get gamed (sybil reviews cost
// cents in 2026 studies) and shame people. A later "it happened" from the same person takes their report back.
export { STRIKES_TO_PAUSE } from "./negotiation/plan";
// Per member, the people (as one-way keys) who reported a missed match. Older stores kept a bare count, which
// couldn't tell one reporter from many; those counts are dropped.
export type Strikes = Record<string, string[] | number>;

export function addStrikes(strikes: Strikes, memberIds: string[], outcome: CheckIn, reporter: string): Strikes {
  const next: Strikes = {};
  for (const [id, value] of Object.entries(strikes)) if (Array.isArray(value)) next[id] = value;
  for (const id of memberIds) {
    const reporters = new Set((next[id] as string[] | undefined) ?? []);
    if (outcome === "missed") reporters.add(reporter);
    else reporters.delete(reporter);
    if (reporters.size) next[id] = [...reporters];
    else delete next[id];
  }
  return next;
}

// How many different people reported each member, which is what the matcher counts.
export function strikeCounts(strikes: Strikes): Record<string, number> {
  return Object.fromEntries(Object.entries(strikes).flatMap(([id, value]) => (Array.isArray(value) ? [[id, new Set(value).size]] : [])));
}

// A one-way key for a reporter: the market never holds anyone's session id.
export async function reporterKey(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reporter|${sessionId}`));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// What leaves the market: the plan without the other side's limit.
export function sealed(thread: ThreadPlan): ThreadPlan {
  const out = { ...thread };
  delete out.theirLimit;
  return out;
}

export function matchInMarket(intents: ProfileIntent[], strikes: Strikes = {}): ThreadPlan[] {
  return planThreads(intents, LISBON_PILOT, strikeCounts(strikes)).map(sealed);
}

// Kept on globalThis so dev-server reloads keep it.
const g = globalThis as typeof globalThis & { __openStrikes?: Strikes };
export function localMarket(): Market {
  return {
    match: async (intents) => matchInMarket(intents, g.__openStrikes ?? {}),
    report: async (memberIds, outcome, reporter) => {
      g.__openStrikes = addStrikes(g.__openStrikes ?? {}, memberIds, outcome, reporter);
    },
  };
}

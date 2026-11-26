import { isInterest, TIME_CONDITIONS, type Intent, type Population, type ProfileIntent, type Unit } from "../domain";
import type { Move, ThreadPlan } from "./types";

export function timesOf(conditions: string[]): string[] {
  return conditions.filter((c) => (TIME_CONDITIONS as readonly string[]).includes(c));
}

export function compatible(a: string[], b: string[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((t) => b.includes(t));
}

export function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const UNIT_WORD: Record<Unit, string> = { hour: "per hour", month: "per month", "one-off": "as a one-off" };

// What other members of the community say something is worth: the median of their limits for the same thing and
// unit. It never includes the person's own number.
export function goingRate(population: Population, tag: string, unit: Unit): number | null {
  const prices = population.intents.filter((i) => i.tag === tag && i.unit === unit).map((i) => i.price).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid]! : Math.round((prices[mid - 1]! + prices[mid]!) / 2);
}

// Sealed offers. Each agent sends its person's limit to Open's matcher (this function) and nothing else, and there
// are no rounds, so there's no trail of concessions to read.
//
// The price never depends on the person's own limit: it comes from the other side and the community's going rate,
// and the person's limit only decides yes or no. So nobody gains by understating what they'd pay or overstating
// what they'd take; saying the true limit is always best, and shading it only loses deals. (A rule that splits the
// overlap rewards shading, which kills deals that should happen.) The price also never lands exactly on the other
// side's limit, so it doesn't give it away.
export function settle(buyerMax: number, sellerFloor: number, ref: number | null, seed: string, youAre: "buyer" | "seller") {
  const them: Move["from"] = "them";
  const moves: Move[] = [
    { from: "you", action: "SEAL", amount: null },
    { from: them, action: "SEAL", amount: null },
  ];
  const margin = 0.03 + 0.07 * unitRandom(seed);
  let price: number;
  if (youAre === "buyer") {
    // Their floor and the going rate set the price.
    price = ref !== null && ref > sellerFloor ? ref : Math.max(sellerFloor + 1, Math.round(sellerFloor * (1 + margin)));
  } else {
    // Their limit and the going rate set the price.
    price = ref !== null && ref < buyerMax ? ref : Math.min(buyerMax - 1, Math.round(buyerMax * (1 - margin)));
  }
  const fits = price <= buyerMax && price >= sellerFloor;
  if (!fits) {
    moves.push({ from: "open", action: "NO_MATCH", amount: null });
    return { moves, price: null as number | null, youAre };
  }
  moves.push({ from: "open", action: "MATCH", amount: price });
  return { moves, price: price as number | null, youAre };
}

// A number in [0, 1) that is always the same for the same seed.
export function unitRandom(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Who gets a seat: the people whose times overlap most, and among equals a draw that's fixed for this room, never
// the order people joined in. First come is how agent markets go wrong: agents take the first offer 60-100% of the
// time, which rewards speed over fit (Magentic Marketplace, 2025).
export function bySeatFit<T>(candidates: T[], timesOfCandidate: (c: T) => string[], wanted: string[], seed: string): T[] {
  const overlap = (c: T) => (wanted.length ? timesOfCandidate(c).filter((t) => wanted.includes(t)).length : 0);
  return candidates
    .map((c, i) => ({ c, score: overlap(c), draw: unitRandom(`${seed}:${i}`) }))
    .sort((a, b) => b.score - a.score || a.draw - b.draw)
    .map((x) => x.c);
}

// Two "it didn't happen" check-ins and a member's agent isn't offered new matches for a while.
export const STRIKES_TO_PAUSE = 2;

// `strikes`: the market's private count of "it didn't happen" check-ins per member.
export function planThreads(intents: ProfileIntent[], population: Population, strikes: Record<string, number> = {}): ThreadPlan[] {
  const paused = (memberId: string) => (strikes[memberId] ?? 0) >= STRIKES_TO_PAUSE;
  const threads: ThreadPlan[] = [];
  const memberOf = (c: Intent) => population.members.find((m) => m.id === c.memberId)!;

  for (const intent of intents) {
    if (intent.status !== "confirmed" || intent.price === null || isInterest(intent)) continue;
    const yourTimes = timesOf(intent.conditions);
    // Members whose matches keep not happening aren't offered for a while. Nobody is told why: the count is private.
    const candidates = population.intents.filter((c) => c.tag === intent.tag && c.direction !== intent.direction && !paused(c.memberId));

    for (const c of candidates) {
      const member = memberOf(c);
      const theirTimes = timesOf(c.conditions);
      const shared = yourTimes.length && theirTimes.length ? yourTimes.filter((t) => theirTimes.includes(t)) : yourTimes.length ? yourTimes : theirTimes;
      const thread: ThreadPlan = {
        id: `${intent.id}-${c.id}`,
        intentId: intent.id,
        intentSummary: intent.summary,
        direction: intent.direction,
        limit: intent.price,
        theirLimit: c.price,
        unit: intent.unit,
        counterpart: { memberId: member.id, name: member.name, blurb: c.summary },
        room: [],
        kind: "direct",
        noFitReason: null,
        schedule: shared[0] ? shared[0][0].toUpperCase() + shared[0].slice(1) : null,
        moves: [],
        agreedPrice: null,
      };

      if (c.unit !== intent.unit) {
        threads.push({ ...thread, kind: "no_fit", noFitReason: `${member.name} prices ${UNIT_WORD[c.unit]}, and you set your price ${UNIT_WORD[intent.unit]}.` });
        continue;
      }
      if (!compatible(yourTimes, theirTimes)) {
        threads.push({ ...thread, kind: "no_fit", noFitReason: `${member.name} only does ${listWords(theirTimes)}; you asked for ${listWords(yourTimes)}.` });
        continue;
      }

      let result;
      if (intent.direction === "seek") {
        let floor = c.price;
        const group = c.groupPrice;
        if (group && intent.price < c.price && intent.price >= group.perPerson) {
          const others = population.intents.filter(
            (o) => o.tag === intent.tag && o.direction === "seek" && o.memberId !== c.memberId && !paused(o.memberId) && o.price >= group.perPerson && compatible(timesOf(o.conditions), theirTimes) && compatible(timesOf(o.conditions), yourTimes),
          );
          if (others.length >= group.size - 1) {
            thread.kind = "group";
            const seats = bySeatFit(others, (o) => timesOf(o.conditions), yourTimes.length ? yourTimes : theirTimes, thread.id);
            thread.room = seats.slice(0, group.size - 1).map((o) => ({ name: memberOf(o).name }));
            floor = group.perPerson;
          }
        }
        thread.theirLimit = floor;
        // A group sets its own per-person price, so the going rate for one-to-one doesn't apply.
        result = settle(intent.price, floor, thread.kind === "group" ? null : goingRate(population, intent.tag, intent.unit), thread.id, "buyer");
      } else {
        result = settle(c.price, intent.price, goingRate(population, intent.tag, intent.unit), thread.id, "seller");
      }

      thread.moves = result.moves;
      thread.agreedPrice = result.price;
      if (result.price === null) {
        thread.kind = "no_fit";
        thread.noFitReason = `No price worked for both of you within your ${intent.direction === "seek" ? "limit" : "floor"}.`;
      }
      threads.push(thread);
    }
  }
  return threads;
}

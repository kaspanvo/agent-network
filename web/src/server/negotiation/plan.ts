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

// Sealed offers. Each agent sends its person's limit to Open's matcher (this function) and nothing else.
// If the limits overlap, the price lands at a random point in the middle of the overlap, so the price
// alone never tells either side the other's limit. There are no rounds, so there's no trail of concessions to read.
// Research on agent negotiation found models disclose their person's limit in 2-80% of episodes, and that limits
// can be inferred from how offers move; keeping the number out of the model and out of the trajectory avoids both.
export function settle(buyerMax: number, sellerFloor: number, seed: string, youAre: "buyer" | "seller") {
  const them: Move["from"] = "them";
  const moves: Move[] = [
    { from: "you", action: "SEAL", amount: null },
    { from: them, action: "SEAL", amount: null },
  ];
  if (buyerMax < sellerFloor) {
    moves.push({ from: "open", action: "NO_MATCH", amount: null });
    return { moves, price: null as number | null, youAre };
  }
  const u = 0.35 + 0.3 * unitRandom(seed);
  const price = Math.min(buyerMax, Math.max(sellerFloor, Math.round(sellerFloor + u * (buyerMax - sellerFloor))));
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

export function planThreads(intents: ProfileIntent[], population: Population): ThreadPlan[] {
  const threads: ThreadPlan[] = [];
  const memberOf = (c: Intent) => population.members.find((m) => m.id === c.memberId)!;

  for (const intent of intents) {
    if (intent.status !== "confirmed" || intent.price === null || isInterest(intent)) continue;
    const yourTimes = timesOf(intent.conditions);
    const candidates = population.intents.filter((c) => c.tag === intent.tag && c.direction !== intent.direction);

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
            (o) => o.tag === intent.tag && o.direction === "seek" && o.memberId !== c.memberId && o.price >= group.perPerson && compatible(timesOf(o.conditions), theirTimes) && compatible(timesOf(o.conditions), yourTimes),
          );
          if (others.length >= group.size - 1) {
            thread.kind = "group";
            thread.room = others.slice(0, group.size - 1).map((o) => ({ name: memberOf(o).name }));
            floor = group.perPerson;
          }
        }
        thread.theirLimit = floor;
        result = settle(intent.price, floor, thread.id + intent.price, "buyer");
      } else {
        result = settle(c.price, intent.price, thread.id + intent.price, "seller");
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

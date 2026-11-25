import { TIME_CONDITIONS, type Intent, type Population, type ProfileIntent, type Unit } from "../domain";
import type { Move, ThreadPlan } from "./types";

const ROUNDS = 3;

function timesOf(conditions: string[]): string[] {
  return conditions.filter((c) => (TIME_CONDITIONS as readonly string[]).includes(c));
}

function compatible(a: string[], b: string[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((t) => b.includes(t));
}

export function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const UNIT_WORD: Record<Unit, string> = { hour: "per hour", month: "per month", "one-off": "as a one-off" };

// Concession bargaining. Each agent knows only its own limit, opens away from it and concedes evenly.
// An agent accepts the other side's last offer as soon as its own next offer would meet it, so no one crosses their limit.
export function bargain(buyerMax: number, sellerFloor: number, firstMover: "buyer" | "seller", youAre: "buyer" | "seller") {
  const bid = (t: number) => Math.min(buyerMax, Math.floor(buyerMax * 0.7 + buyerMax * 0.3 * (t / ROUNDS)));
  const ask = (t: number) => Math.max(sellerFloor, Math.ceil(sellerFloor * 1.3 - sellerFloor * 0.3 * (t / ROUNDS)));
  const who = (side: "buyer" | "seller"): Move["from"] => (side === youAre ? "you" : "them");
  const order: ("buyer" | "seller")[] = firstMover === "buyer" ? ["buyer", "seller"] : ["seller", "buyer"];
  const moves: Move[] = [];
  const last: { buyer?: number; seller?: number } = {};

  for (let t = 0; t <= ROUNDS; t++) {
    for (const side of order) {
      const amount = side === "buyer" ? bid(t) : ask(t);
      const theirs = side === "buyer" ? last.seller : last.buyer;
      if (theirs !== undefined && (side === "buyer" ? amount >= theirs : amount <= theirs)) {
        moves.push({ from: who(side), action: "ACCEPT", amount: theirs });
        return { moves, price: theirs };
      }
      moves.push({ from: who(side), action: moves.length === 0 ? "PROPOSE" : "COUNTER", amount });
      last[side] = amount;
    }
  }
  moves.push({ from: who(youAre), action: "DECLINE", amount: null });
  return { moves, price: null };
}

export function planThreads(intents: ProfileIntent[], population: Population): ThreadPlan[] {
  const threads: ThreadPlan[] = [];
  const memberOf = (c: Intent) => population.members.find((m) => m.id === c.memberId)!;

  for (const intent of intents) {
    if (intent.status !== "confirmed" || intent.price === null) continue;
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
        result = bargain(intent.price, floor, "buyer", "buyer");
      } else {
        result = bargain(c.price, intent.price, "seller", "seller");
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

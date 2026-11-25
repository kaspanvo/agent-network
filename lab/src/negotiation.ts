import type { Message } from "./domain";
import { round2 } from "./money";

// An agent sees only its own principal's limit; the runtime sees only the offers they make.
export interface NegotiatingAgent {
  label: string;
  offerAt(round: number, rounds: number): number;
}

const OPENING_MARGIN = 0.25;
const ROUNDS = 6;

// Opens below its maximum and concedes linearly, reaching the maximum on the last round.
export function concedingBuyer(label: string, max: number): NegotiatingAgent {
  const open = max * (1 - OPENING_MARGIN);
  return { label, offerAt: (t, rounds) => round2(open + (max - open) * (t / rounds)) };
}

// Opens above its floor and concedes linearly, reaching the floor on the last round.
export function concedingSeller(label: string, floor: number): NegotiatingAgent {
  const open = floor * (1 + OPENING_MARGIN);
  return { label, offerAt: (t, rounds) => round2(open - (open - floor) * (t / rounds)) };
}

export type NegotiationResult = { price: number | null; transcript: Message[] };

export function negotiate(buyer: NegotiatingAgent, seller: NegotiatingAgent, rounds = ROUNDS): NegotiationResult {
  const transcript: Message[] = [];
  for (let t = 0; t <= rounds; t++) {
    const ask = seller.offerAt(t, rounds);
    transcript.push({ from: seller.label, action: t === 0 ? "PROPOSE" : "COUNTER", amount: ask });
    const bid = buyer.offerAt(t, rounds);
    if (bid >= ask) {
      const price = round2((bid + ask) / 2);
      transcript.push({ from: buyer.label, action: "ACCEPT", amount: price });
      return { price, transcript };
    }
    transcript.push({ from: buyer.label, action: "COUNTER", amount: bid });
  }
  transcript.push({ from: buyer.label, action: "DECLINE" });
  return { price: null, transcript };
}

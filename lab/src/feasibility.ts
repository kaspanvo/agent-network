import type { Deal, Intent, PopulationIndex, Proposal } from "./domain";
import { EPSILON, formatMoney, sum } from "./money";

export type Verdict = {
  proposal: Proposal;
  status: "feasible" | "infeasible" | "conflict";
  reasons: string[];
};

type Pot = {
  intent: Intent;
  kind: "price" | "blocker" | "incentive";
  blockerIndex?: number;
  spent: number;
};

type Usage = {
  participants: Set<string>;
  intentsUsed: Set<string>;
  mainDeals: Map<string, Deal>;
  offerUse: Map<string, number>;
  hours: Map<string, number>;
  pots: Map<string, Pot>;
  unauthorized: string[];
};

function referenceErrors(p: Proposal, idx: PopulationIndex): string[] {
  const errors: string[] = [];
  if (p.deals.length === 0) errors.push("proposal has no deals");
  for (const d of p.deals) {
    const offer = idx.intents.get(d.offerIntentId);
    const seek = idx.intents.get(d.forIntentId);
    if (offer?.direction !== "offer") errors.push(`${d.offerIntentId} is not a known offer`);
    if (seek?.direction !== "seek") errors.push(`${d.forIntentId} is not a known seek`);
    if (seek && d.blockerIndex !== undefined && !seek.blockers[d.blockerIndex])
      errors.push(`${idx.nameOf(seek.id)} has no blocker #${d.blockerIndex}`);
    for (const pay of d.paidBy) {
      if (!idx.intents.has(pay.fromIntentId)) errors.push(`payment from unknown intent ${pay.fromIntentId}`);
      if (pay.amount < 0) errors.push(`negative payment from ${pay.fromIntentId}`);
    }
  }
  return errors;
}

// Assumes referenceErrors() returned nothing.
function usage(p: Proposal, idx: PopulationIndex): Usage {
  const u: Usage = {
    participants: new Set(),
    intentsUsed: new Set(),
    mainDeals: new Map(),
    offerUse: new Map(),
    hours: new Map(),
    pots: new Map(),
    unauthorized: [],
  };

  for (const d of p.deals) {
    const offer = idx.intents.get(d.offerIntentId)!;
    const seek = idx.intents.get(d.forIntentId)!;
    u.intentsUsed.add(offer.id).add(seek.id);
    u.participants.add(offer.principalId).add(seek.principalId);
    if (d.blockerIndex === undefined && !u.mainDeals.has(seek.id)) u.mainDeals.set(seek.id, d);
    u.offerUse.set(offer.id, (u.offerUse.get(offer.id) ?? 0) + 1);
    u.hours.set(offer.principalId, (u.hours.get(offer.principalId) ?? 0) + offer.hours);
  }

  for (const d of p.deals) {
    for (const pay of d.paidBy) {
      const payer = idx.intents.get(pay.fromIntentId)!;
      u.intentsUsed.add(payer.id);
      u.participants.add(payer.principalId);

      let kind: Pot["kind"];
      if (payer.id === d.forIntentId) {
        kind = d.blockerIndex === undefined ? "price" : "blocker";
      } else if (d.blockerIndex !== undefined && u.mainDeals.get(d.forIntentId)?.offerIntentId === payer.id) {
        kind = "incentive";
      } else {
        u.unauthorized.push(`${idx.nameOf(payer.id)} is not entitled to pay toward ${idx.nameOf(d.forIntentId)}'s deal`);
        continue;
      }

      const blockerIndex = kind === "blocker" ? d.blockerIndex : undefined;
      const key = `${payer.id}:${kind}:${blockerIndex ?? ""}`;
      const pot = u.pots.get(key) ?? { intent: payer, kind, blockerIndex, spent: 0 };
      pot.spent = sum([pot.spent, pay.amount]);
      u.pots.set(key, pot);
    }
  }
  return u;
}

function potCap(pot: Pot): number {
  if (pot.kind === "price") return pot.intent.reservationPrice;
  if (pot.kind === "incentive") return pot.intent.incentiveBudget;
  return pot.intent.blockers[pot.blockerIndex!]!.maxContribution;
}

function potLabel(pot: Pot): string {
  if (pot.kind === "price") return "for the deal";
  if (pot.kind === "incentive") return "from their incentive budget";
  return `toward "${pot.intent.blockers[pot.blockerIndex!]!.description}"`;
}

export function violations(p: Proposal, idx: PopulationIndex): string[] {
  const refErrors = referenceErrors(p, idx);
  if (refErrors.length > 0) return refErrors;

  const u = usage(p, idx);
  const name = (intentId: string) => idx.nameOf(intentId);
  const reasons = [...u.unauthorized];

  const mainCount = new Map<string, number>();
  for (const d of p.deals) {
    const offer = idx.intents.get(d.offerIntentId)!;
    const seek = idx.intents.get(d.forIntentId)!;
    const blocker = d.blockerIndex === undefined ? undefined : seek.blockers[d.blockerIndex];
    const needed = blocker ? blocker.resolvedBy : seek.tag;

    if (offer.tag !== needed) reasons.push(`${name(offer.id)} offers "${offer.tag}" but ${name(seek.id)} needs "${needed}"`);
    // Seats are funded from one-off pots (incentive budgets, blocker contributions).
    const neededBasis = blocker ? "one-off" : seek.priceBasis;
    if (offer.priceBasis !== neededBasis)
      reasons.push(`${name(offer.id)} prices ${offer.priceBasis} but this deal is priced ${neededBasis}`);
    if (offer.principalId === seek.principalId) reasons.push(`${name(offer.id)} cannot deal with themselves`);
    if (d.price < offer.reservationPrice - EPSILON)
      reasons.push(`${formatMoney(d.price)} is below ${name(offer.id)}'s floor of ${formatMoney(offer.reservationPrice)}`);
    const paid = sum(d.paidBy.map((x) => x.amount));
    if (Math.abs(paid - d.price) > EPSILON)
      reasons.push(`payments of ${formatMoney(paid)} don't match the ${formatMoney(d.price)} price for ${name(offer.id)}`);
    if (blocker && !u.mainDeals.has(seek.id)) reasons.push(`resolves ${name(seek.id)}'s blocker without the deal it unblocks`);
    if (!blocker) mainCount.set(seek.id, (mainCount.get(seek.id) ?? 0) + 1);
  }

  for (const [seekId, n] of mainCount) if (n > 1) reasons.push(`${name(seekId)} is served ${n} times in one proposal`);

  for (const seekId of u.mainDeals.keys()) {
    idx.intents.get(seekId)!.blockers.forEach((b, bi) => {
      if (!p.deals.some((d) => d.forIntentId === seekId && d.blockerIndex === bi))
        reasons.push(`blocker unresolved for ${name(seekId)}: "${b.description}"`);
    });
  }

  for (const pot of u.pots.values()) {
    const cap = potCap(pot);
    if (pot.spent > cap + EPSILON)
      reasons.push(`${name(pot.intent.id)} would pay ${formatMoney(pot.spent)} ${potLabel(pot)}, above their limit of ${formatMoney(cap)}`);
  }

  for (const [offerId, n] of u.offerUse) {
    const cap = idx.intents.get(offerId)!.capacity;
    if (n > cap) reasons.push(`${name(offerId)} can serve ${cap} but is asked to serve ${n}`);
  }

  for (const [principalId, h] of u.hours) {
    const principal = idx.principals.get(principalId)!;
    if (h > principal.hoursPerWeek + EPSILON)
      reasons.push(`${principal.name} would work ${h}h, above their ${principal.hoursPerWeek}h/week`);
  }

  for (const intentId of u.intentsUsed) {
    const { mandate } = idx.intents.get(intentId)!;
    if (!mandate.mayNegotiate) reasons.push(`${name(intentId)}'s mandate does not allow negotiation`);
    else if (u.participants.size > 2 && !mandate.mayJoinMultiParty)
      reasons.push(`${name(intentId)}'s mandate does not allow multi-party arrangements`);
  }

  return reasons;
}

// Tracks commitments across proposals so the same seek, capacity, hours or budget isn't promised twice.
export class Ledger {
  private readonly idx: PopulationIndex;
  private readonly met = new Set<string>();
  private readonly offerUse = new Map<string, number>();
  private readonly hours = new Map<string, number>();
  private readonly incentive = new Map<string, number>();

  constructor(idx: PopulationIndex) {
    this.idx = idx;
  }

  // Assumes violations(p) is empty. Returns conflicts; commits only when there are none.
  commit(p: Proposal): string[] {
    const u = usage(p, this.idx);
    const name = (intentId: string) => this.idx.nameOf(intentId);
    const conflicts: string[] = [];

    for (const seekId of u.mainDeals.keys())
      if (this.met.has(seekId)) conflicts.push(`${name(seekId)}'s intent is already met by an earlier proposal`);
    for (const [offerId, n] of u.offerUse)
      if ((this.offerUse.get(offerId) ?? 0) + n > this.idx.intents.get(offerId)!.capacity)
        conflicts.push(`${name(offerId)} has no capacity left`);
    for (const [principalId, h] of u.hours) {
      const principal = this.idx.principals.get(principalId)!;
      if ((this.hours.get(principalId) ?? 0) + h > principal.hoursPerWeek + EPSILON)
        conflicts.push(`${principal.name} has no hours left this week`);
    }
    const incentiveSpend = [...u.pots.values()].filter((pot) => pot.kind === "incentive");
    for (const pot of incentiveSpend)
      if ((this.incentive.get(pot.intent.id) ?? 0) + pot.spent > pot.intent.incentiveBudget + EPSILON)
        conflicts.push(`${name(pot.intent.id)}'s incentive budget is already committed`);

    if (conflicts.length > 0) return conflicts;

    for (const seekId of u.mainDeals.keys()) this.met.add(seekId);
    for (const [offerId, n] of u.offerUse) this.offerUse.set(offerId, (this.offerUse.get(offerId) ?? 0) + n);
    for (const [principalId, h] of u.hours) this.hours.set(principalId, (this.hours.get(principalId) ?? 0) + h);
    for (const pot of incentiveSpend) this.incentive.set(pot.intent.id, sum([this.incentive.get(pot.intent.id) ?? 0, pot.spent]));
    return [];
  }
}

export function evaluate(proposals: Proposal[], idx: PopulationIndex): Verdict[] {
  const ledger = new Ledger(idx);
  return proposals.map((proposal) => {
    const reasons = violations(proposal, idx);
    if (reasons.length > 0) return { proposal, status: "infeasible", reasons };
    const conflicts = ledger.commit(proposal);
    if (conflicts.length > 0) return { proposal, status: "conflict", reasons: conflicts };
    return { proposal, status: "feasible", reasons: [] };
  });
}

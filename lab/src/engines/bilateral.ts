import type { Engine, EngineResult } from "../domain";
import { candidateOffers, negotiateDirect } from "./common";

// Baseline B: bilateral agent negotiation, as in Index or Yume. Two agents, one deal.
// A seeker's agent declines anything its principal has an unresolved blocker for.
export const bilateralEngine: Engine = {
  name: "B · bilateral",
  run(idx) {
    const result: EngineResult = { proposals: [], notes: [] };

    for (const seek of idx.seeks) {
      if (!seek.mandate.mayNegotiate) continue;
      const blocker = seek.blockers[0];
      if (blocker) {
        result.notes.push({ intentId: seek.id, kind: "declined", detail: `blocker unresolved: "${blocker.description}"` });
        continue;
      }
      const candidates = candidateOffers(idx, seek);
      if (candidates.length === 0) {
        result.notes.push({ intentId: seek.id, kind: "no-candidates", detail: `no "${seek.tag}" offers` });
        continue;
      }

      let agreed = false;
      for (const offer of candidates) {
        const { price, transcript } = negotiateDirect(idx, seek, offer);
        if (price === null) continue;
        result.proposals.push({
          id: `b-${result.proposals.length + 1}`,
          engine: this.name,
          pattern: "reciprocal",
          deals: [{ offerIntentId: offer.id, forIntentId: seek.id, price, paidBy: [{ fromIntentId: seek.id, amount: price }] }],
          transcript,
        });
        agreed = true;
        break;
      }
      if (!agreed)
        result.notes.push({ intentId: seek.id, kind: "no-agreement", detail: `no zone of agreement with ${candidates.length} candidate(s)` });
    }
    return result;
  },
};

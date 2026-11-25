import type { Engine, EngineResult } from "../domain";
import { cosineSimilarities } from "../similarity";

const THRESHOLD = 0.1;

// Baseline A: conventional matching. Pairs each seek with the most similar offer description
// and proposes the provider's floor as if it were a listed price. No negotiation, no blockers.
export const similarityEngine: Engine = {
  name: "A · similarity",
  run(idx) {
    const result: EngineResult = { proposals: [], notes: [] };
    const { seeks, offers } = idx;
    const scores = cosineSimilarities(
      seeks.map((s) => s.summary),
      offers.map((o) => o.summary),
    );

    seeks.forEach((seek, i) => {
      let best = -1;
      let bestScore = THRESHOLD;
      offers.forEach((offer, j) => {
        const score = scores[i]![j]!;
        if (offer.principalId !== seek.principalId && score > bestScore) {
          best = j;
          bestScore = score;
        }
      });
      const offer = offers[best];
      if (!offer) {
        result.notes.push({ intentId: seek.id, kind: "no-candidates", detail: "no sufficiently similar offer" });
        return;
      }
      result.proposals.push({
        id: `a-${result.proposals.length + 1}`,
        engine: this.name,
        pattern: "reciprocal",
        deals: [
          {
            offerIntentId: offer.id,
            forIntentId: seek.id,
            price: offer.reservationPrice,
            paidBy: [{ fromIntentId: seek.id, amount: offer.reservationPrice }],
          },
        ],
        transcript: [],
      });
    });
    return result;
  },
};

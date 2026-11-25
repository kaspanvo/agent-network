import type { Deal, Engine, EngineNote, EngineResult, Message, Payment } from "../domain";
import { round2 } from "../money";
import { concedingBuyer, concedingSeller, negotiate } from "../negotiation";
import { candidateOffers, negotiateDirect } from "./common";

// Village: dynamic rooms. Opens a room around a seek and a matching offer; when the seek has blockers,
// opens a seat per blocker, pools what the room's members will fund, and negotiates with whoever can fill it.
// Patterns implemented: reciprocal, blocker-resolution.
export const roomEngine: Engine = {
  name: "Village · rooms",
  run(idx) {
    const result: EngineResult = { proposals: [], notes: [] };

    for (const seek of idx.seeks) {
      if (!seek.mandate.mayNegotiate) continue;
      const multiParty = seek.blockers.length > 0;
      if (multiParty && !seek.mandate.mayJoinMultiParty) {
        result.notes.push({ intentId: seek.id, kind: "declined", detail: "has blockers but mandate excludes multi-party rooms" });
        continue;
      }
      const candidates = candidateOffers(idx, seek).filter((o) => !multiParty || o.mandate.mayJoinMultiParty);
      if (candidates.length === 0) {
        result.notes.push({ intentId: seek.id, kind: "no-candidates", detail: `no "${seek.tag}" offers` });
        continue;
      }

      let missingSeat: EngineNote | undefined;
      let formed = false;

      for (const offer of candidates) {
        const main = negotiateDirect(idx, seek, offer);
        if (main.price === null) continue;

        const deals: Deal[] = [
          { offerIntentId: offer.id, forIntentId: seek.id, price: main.price, paidBy: [{ fromIntentId: seek.id, amount: main.price }] },
        ];
        const transcript: Message[] = [...main.transcript];
        const members = new Set([seek.principalId, offer.principalId]);
        let incentiveLeft = offer.incentiveBudget;
        let seatsFilled = true;

        for (const [blockerIndex, blocker] of seek.blockers.entries()) {
          const pledged = round2(incentiveLeft + blocker.maxContribution);
          const fillers = candidateOffers(idx, seek, blocker.resolvedBy).filter(
            (o) => o.mandate.mayJoinMultiParty && !members.has(o.principalId),
          );

          let filled = false;
          for (const filler of fillers) {
            const seat = negotiate(
              concedingBuyer(`room for ${idx.nameOf(seek.id)}`, pledged),
              concedingSeller(idx.nameOf(filler.id), filler.reservationPrice),
            );
            if (seat.price === null) continue;

            // The provider's incentive budget is drawn first, so the seeker pays only what's left.
            const fromIncentive = Math.min(incentiveLeft, seat.price);
            const fromSeeker = round2(seat.price - fromIncentive);
            incentiveLeft = round2(incentiveLeft - fromIncentive);
            const paidBy: Payment[] = [];
            if (fromIncentive > 0) paidBy.push({ fromIntentId: offer.id, amount: fromIncentive });
            if (fromSeeker > 0) paidBy.push({ fromIntentId: seek.id, amount: fromSeeker });

            deals.push({ offerIntentId: filler.id, forIntentId: seek.id, blockerIndex, price: seat.price, paidBy });
            transcript.push(...seat.transcript);
            members.add(filler.principalId);
            filled = true;
            break;
          }

          if (!filled) {
            missingSeat = {
              intentId: seek.id,
              kind: "missing-seat",
              detail:
                `needs a "${blocker.resolvedBy}" provider to resolve "${blocker.description}"` +
                (fillers.length > 0 ? `; ${fillers.length} candidate(s) had no zone of agreement` : ""),
            };
            seatsFilled = false;
            break;
          }
        }
        if (!seatsFilled) continue;

        result.proposals.push({
          id: `v-${result.proposals.length + 1}`,
          engine: this.name,
          pattern: multiParty ? "blocker-resolution" : "reciprocal",
          deals,
          transcript,
        });
        formed = true;
        break;
      }

      if (!formed)
        result.notes.push(
          missingSeat ?? { intentId: seek.id, kind: "no-agreement", detail: `no zone of agreement with ${candidates.length} candidate(s)` },
        );
    }
    return result;
  },
};

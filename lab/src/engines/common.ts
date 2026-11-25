import type { Intent, PopulationIndex } from "../domain";
import { concedingBuyer, concedingSeller, negotiate, type NegotiationResult } from "../negotiation";

export function candidateOffers(idx: PopulationIndex, seek: Intent, tag = seek.tag, basis = seek.priceBasis): Intent[] {
  return idx.offers.filter(
    (o) => o.tag === tag && o.priceBasis === basis && o.principalId !== seek.principalId && o.mandate.mayNegotiate,
  );
}

export function negotiateDirect(idx: PopulationIndex, seek: Intent, offer: Intent): NegotiationResult {
  return negotiate(
    concedingBuyer(idx.nameOf(seek.id), seek.reservationPrice),
    concedingSeller(idx.nameOf(offer.id), offer.reservationPrice),
  );
}

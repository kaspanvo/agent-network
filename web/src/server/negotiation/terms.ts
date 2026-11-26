import type { Opportunity } from "./types";

// What a yes covers: the version, the price and every term, and who's in it.
export function termsOf(o: Opportunity): string {
  return JSON.stringify([o.version, o.price, o.unit, o.terms, [...new Set(o.people)].sort()]);
}

// True once every person in the proposal has said yes to this version. Introductions depend on it.
export function everyoneSaidYes(o: Opportunity): boolean {
  const answers = Object.values(o.approvals ?? {});
  return answers.length === new Set(o.people).size && answers.every((a) => a === "yes");
}

// The person's yes still covers the proposal as it stands now. (Approvals saved before fingerprints existed have none to compare.)
export function yesStillStands(o: Opportunity): boolean {
  return o.approvedTerms === undefined || o.approvedTerms === termsOf(o);
}

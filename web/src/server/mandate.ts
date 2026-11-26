import { createHash } from "node:crypto";
import { formatPrice, isInterest, type Mandate, type ProfileIntent } from "./domain";
import { intentBasis } from "./intake/profile";
import type { Opportunity } from "./negotiation/types";

export const MAX_MANDATE_DAYS = 60;

// A standing yes for one intent. Refused (with the reason) when it would reach past the person's own limit.
export function makeMandate(intent: ProfileIntent, price: number, days: number, now = new Date()): Mandate | string {
  if (isInterest(intent) || intent.price === null) return "A standing yes is for deals with a price.";
  if (intent.status !== "confirmed") return "Confirm this intent first.";
  if (intent.direction === "seek" ? price > intent.price : price < intent.price)
    return `A standing yes can't go past your own ${intent.direction === "seek" ? "limit" : "floor"} of ${formatPrice(intent.price, intent.unit)}.`;
  if (!Number.isInteger(days) || days < 1 || days > MAX_MANDATE_DAYS) return `Choose between 1 and ${MAX_MANDATE_DAYS} days.`;
  const until = new Date(now.getTime() + days * 86_400_000).toISOString();
  const at = now.toISOString();
  const basis = intentBasis(intent);
  const hash = createHash("sha256").update(JSON.stringify([intent.id, price, intent.unit, until, at, basis])).digest("hex").slice(0, 16);
  return { price, until, at, basis, hash };
}

// Whether a standing yes covers this proposal: still in date, the intent unchanged since, and every term inside
// the bounds the person set (price, and the times and format they asked for).
export function covers(intent: ProfileIntent, opportunity: Opportunity, now = new Date()): boolean {
  const m = intent.mandate;
  if (!m || opportunity.kind === "plan" || opportunity.price === null) return false;
  if (Date.parse(m.until) <= now.getTime()) return false;
  if (m.basis !== intentBasis(intent)) return false;
  if (intent.direction === "seek" ? opportunity.price > m.price : opportunity.price < m.price) return false;
  const times = intent.conditions;
  if (times.length && opportunity.schedule && !times.includes(opportunity.schedule.toLowerCase())) return false;
  if (intent.prefers && opportunity.group !== undefined && (intent.prefers === "group") !== opportunity.group) return false;
  return true;
}

export function mandateWords(intent: ProfileIntent): string | null {
  const m = intent.mandate;
  if (!m) return null;
  const date = new Date(m.until).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${intent.direction === "seek" ? "up to" : "from"} ${formatPrice(m.price, intent.unit)}, until ${date}`;
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { formatPrice, isInterest, sharedLine, TIME_CONDITIONS, Unit, type ProfileIntent } from "../domain";
import type { Session } from "../store";
import type { RecapItem, Widget } from "./types";

export const SaveIntentInput = z.object({
  id: z.string().nullable().optional(),
  kind: z.enum(["deal", "interest"]).optional(),
  direction: z.enum(["seek", "offer"]),
  summary: z.string().min(1),
  tag: z.string().min(1),
  provenance: z.enum(["stated", "inferred"]),
  evidence: z.string(),
  price: z.number().nonnegative().nullable().optional(),
  unit: Unit.optional(),
  conditions: z.array(z.string()).optional(),
  priority: z.number().int().min(1).nullable().optional(),
  prefers: z.enum(["group", "solo"]).nullable().optional(),
});
export type SaveIntentInput = z.infer<typeof SaveIntentInput>;

// Amounts with a currency or a rate ("up to 15€/hour", "€300", "20 euros per lesson", "max 15/h"), with the word that leads into them.
const AMOUNT =
  /(?:\b(?:up to|max(?:imum)?|at most|under|below|around|about|roughly|from|at least|min(?:imum)?|for|budget(?: of)?)\s+)?(?:[€$£]\s?\d+(?:[.,]\d+)?(?:\s?k)?|\d+(?:[.,]\d+)?(?:\s?k)?\s?(?:€|\$|£|eur(?:os?)?\b|usd\b|dollars?\b|pounds?\b)|\b\d+(?:[.,]\d+)?(?=\s?(?:\/|per\s)\s?(?:h|hr|hour|month|mo|session|lesson|night)\b))(?:\s?(?:\/|per\s)\s?(?:h|hr|hour|month|mo|session|lesson|night)\b)?/gi;

// A summary is what other agents hear about an intent, so it never carries an amount: the limit has its own private
// field. Models sometimes write "Learn Spanish, up to 15€/hour" anyway; the amount is taken out here, in code.
export function withoutAmounts(summary: string): string {
  const cleaned = summary
    .replace(AMOUNT, "")
    .replace(/\s*[,;:]\s*(?=[,;:]|$)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;.])/g, "$1")
    .replace(/[,;:\s]+$/g, "")
    .trim();
  return cleaned || summary.trim();
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanConditions(conditions: string[]): string[] {
  const known = new Set<string>(TIME_CONDITIONS);
  return [...new Set(conditions.map((c) => c.trim().toLowerCase()).filter((c) => known.has(c)))];
}

// An optional field: the new value if one was passed, null to clear it, otherwise what was there.
function pick<K extends string, V>(key: K, next: V | null | undefined, previous: V | undefined): { [P in K]?: V } {
  const value = next === undefined ? previous : (next ?? undefined);
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

// Inferred intents wait for the person to confirm; stated ones count straight away.
export function saveIntent(session: Session, input: SaveIntentInput): ProfileIntent {
  const existing = input.id ? session.intents.find((i) => i.id === input.id) : undefined;
  const intent: ProfileIntent = {
    id: existing?.id ?? randomUUID().slice(0, 8),
    kind: input.kind ?? existing?.kind ?? "deal",
    direction: input.direction,
    tag: normalizeTag(input.tag) || "other",
    summary: withoutAmounts(input.summary),
    price: input.price !== undefined ? input.price : (existing?.price ?? null),
    unit: input.unit ?? existing?.unit ?? "one-off",
    conditions: input.conditions ? cleanConditions(input.conditions) : (existing?.conditions ?? []),
    provenance: existing?.provenance ?? input.provenance,
    evidence: input.evidence || existing?.evidence || "",
    status: existing?.status ?? (input.provenance === "inferred" ? "pending" : "confirmed"),
    ...pick("priority", input.priority, existing?.priority),
    ...pick("prefers", input.prefers, existing?.prefers),
    // A standing yes stays with its intent; if the intent changed, its fingerprint no longer matches and it covers nothing.
    ...(existing?.mandate ? { mandate: existing.mandate } : {}),
  };
  // Something new to look for means the person should see the recap again before the agent goes out with it.
  if (!existing) session.recapConfirmed = false;
  session.intents = existing ? session.intents.map((i) => (i.id === intent.id ? intent : i)) : [...session.intents, intent];
  return intent;
}

export function setIntentPrice(session: Session, intentId: string, price: number): ProfileIntent | undefined {
  const intent = session.intents.find((i) => i.id === intentId);
  if (!intent) return undefined;
  intent.price = price;
  return intent;
}

// Times of day matter for services (lessons, sitting) and things to do together, not for one-off sales like a bike.
export function setConditionsForAll(session: Session, conditions: string[]): ProfileIntent[] {
  const clean = cleanConditions(conditions);
  for (const intent of session.intents) if (isInterest(intent) || intent.unit !== "one-off") intent.conditions = clean;
  return session.intents;
}

// Ready once there's something to go out with: a confirmed deal with a price, or a confirmed interest.
export function isReady(session: Session): boolean {
  return session.intents.some((i) => i.status === "confirmed" && (isInterest(i) || i.price !== null));
}

// Intents the agent will go out with, most important first.
export function activeIntents(session: Session): ProfileIntent[] {
  return session.intents
    .map((intent, index) => ({ intent, index }))
    .filter(({ intent }) => intent.status === "confirmed" && (isInterest(intent) || intent.price !== null))
    .sort((a, b) => (a.intent.priority ?? 99) - (b.intent.priority ?? 99) || a.index - b.index)
    .map(({ intent }) => intent);
}

// The person names what matters most; everything else follows in the order they mentioned it.
export function setTopPriority(session: Session, intentId: string): void {
  let next = 2;
  for (const intent of session.intents) intent.priority = intent.id === intentId ? 1 : next++;
}

export function recapWidget(session: Session): Widget {
  const active = activeIntents(session);
  const ranked = active.some((i) => i.priority !== undefined) && active.length > 1;
  const items: RecapItem[] = active.map((intent, n) => ({
    id: intent.id,
    summary: intent.summary,
    kind: isInterest(intent) ? "interest" : "deal",
    rank: ranked ? n + 1 : null,
    limit: !isInterest(intent) && intent.price !== null ? `${intent.direction === "seek" ? "Up to" : "At least"} ${formatPrice(intent.price, intent.unit)}` : null,
    times: intent.conditions,
    prefers: intent.prefers === "group" ? "Small group if cheaper" : intent.prefers === "solo" ? "One-to-one" : null,
    shared: sharedLine(intent),
  }));
  return { kind: "recap", items };
}

// What a proposal was agreed under. Changing any of it means the agent was working from an old picture of you.
export function intentBasis(intent: ProfileIntent): string {
  return JSON.stringify([intent.summary, intent.price, intent.unit, intent.conditions, intent.prefers ?? null, intent.status]);
}

// True when the intent behind a proposal changed or was dropped after the proposal was agreed.
export function isStale(session: Session, opportunity: { intentId: string; basis?: string }): boolean {
  if (opportunity.basis === undefined) return false;
  const intent = session.intents.find((i) => i.id === opportunity.intentId);
  return !intent || intentBasis(intent) !== opportunity.basis;
}

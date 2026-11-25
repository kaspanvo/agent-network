import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TIME_CONDITIONS, Unit, type ProfileIntent } from "../domain";
import type { Session } from "../store";

export const SaveIntentInput = z.object({
  id: z.string().nullable().optional(),
  direction: z.enum(["seek", "offer"]),
  summary: z.string().min(1),
  tag: z.string().min(1),
  provenance: z.enum(["stated", "inferred"]),
  evidence: z.string(),
  price: z.number().nonnegative().nullable().optional(),
  unit: Unit.optional(),
  conditions: z.array(z.string()).optional(),
});
export type SaveIntentInput = z.infer<typeof SaveIntentInput>;

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanConditions(conditions: string[]): string[] {
  const known = new Set<string>(TIME_CONDITIONS);
  return [...new Set(conditions.map((c) => c.trim().toLowerCase()).filter((c) => known.has(c)))];
}

// Inferred intents wait for the person to confirm; stated ones count straight away.
export function saveIntent(session: Session, input: SaveIntentInput): ProfileIntent {
  const existing = input.id ? session.intents.find((i) => i.id === input.id) : undefined;
  const intent: ProfileIntent = {
    id: existing?.id ?? randomUUID().slice(0, 8),
    direction: input.direction,
    tag: normalizeTag(input.tag) || "other",
    summary: input.summary,
    price: input.price !== undefined ? input.price : (existing?.price ?? null),
    unit: input.unit ?? existing?.unit ?? "one-off",
    conditions: input.conditions ? cleanConditions(input.conditions) : (existing?.conditions ?? []),
    provenance: existing?.provenance ?? input.provenance,
    evidence: input.evidence || existing?.evidence || "",
    status: existing?.status ?? (input.provenance === "inferred" ? "pending" : "confirmed"),
  };
  session.intents = existing ? session.intents.map((i) => (i.id === intent.id ? intent : i)) : [...session.intents, intent];
  return intent;
}

export function setIntentPrice(session: Session, intentId: string, price: number): ProfileIntent | undefined {
  const intent = session.intents.find((i) => i.id === intentId);
  if (!intent) return undefined;
  intent.price = price;
  return intent;
}

// Times of day matter for services (lessons, sitting), not for one-off sales like a bike.
export function setConditionsForAll(session: Session, conditions: string[]): ProfileIntent[] {
  const clean = cleanConditions(conditions);
  for (const intent of session.intents) if (intent.unit !== "one-off") intent.conditions = clean;
  return session.intents;
}

export function isReady(session: Session): boolean {
  return session.intents.some((i) => i.status === "confirmed" && i.price !== null);
}

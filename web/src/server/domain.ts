import { z } from "zod";

export const Unit = z.enum(["hour", "month", "one-off"]);
export type Unit = z.infer<typeof Unit>;

export const Intent = z.object({
  id: z.string(),
  memberId: z.string(),
  direction: z.enum(["seek", "offer"]),
  tag: z.string(),
  summary: z.string(),
  // Seek: the most they'd pay. Offer: the least they'd accept. Private to their agent.
  price: z.number().nonnegative(),
  unit: Unit,
  conditions: z.array(z.string()).default([]),
  // Offer only: price per person when enough people join together.
  groupPrice: z.object({ size: z.number().int().min(2), perPerson: z.number().nonnegative() }).optional(),
});
export type Intent = z.infer<typeof Intent>;

export const Member = z.object({ id: z.string(), name: z.string(), blurb: z.string() });
export type Member = z.infer<typeof Member>;

export const Population = z.object({
  name: z.string(),
  synthetic: z.boolean(),
  members: z.array(Member),
  intents: z.array(Intent),
});
export type Population = z.infer<typeof Population>;

// An intent held by the person using the app, with where it came from.
export const ProfileIntent = z.object({
  id: z.string(),
  direction: z.enum(["seek", "offer"]),
  tag: z.string(),
  summary: z.string(),
  price: z.number().nonnegative().nullable(),
  unit: Unit,
  conditions: z.array(z.string()),
  provenance: z.enum(["stated", "inferred"]),
  evidence: z.string(),
  status: z.enum(["confirmed", "pending", "rejected"]),
});
export type ProfileIntent = z.infer<typeof ProfileIntent>;

export const TIME_CONDITIONS = ["mornings", "evenings", "weekends"] as const;

export function formatPrice(amount: number, unit: Unit): string {
  const euros = Number.isInteger(amount) ? `€${amount}` : `€${amount.toFixed(2)}`;
  return unit === "one-off" ? euros : `${euros}/${unit === "hour" ? "h" : "mo"}`;
}

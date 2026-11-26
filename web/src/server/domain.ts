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

// Something a member enjoys doing with others. No money involved. `shares` is what they allowed their agent to tell other agents.
export const Interest = z.object({
  memberId: z.string(),
  tag: z.string(),
  shares: z.array(z.string()).min(1),
  conditions: z.array(z.string()).default([]),
});
export type Interest = z.infer<typeof Interest>;

// Something happening that a member's agent can bring into a room.
export const Happening = z.object({
  id: z.string(),
  tag: z.string(),
  postedBy: z.string(),
  title: z.string(),
  when: z.string(),
  where: z.string(),
  cost: z.string(),
  conditions: z.array(z.string()).default([]),
});
export type Happening = z.infer<typeof Happening>;

export const Population = z.object({
  name: z.string(),
  synthetic: z.boolean(),
  members: z.array(Member),
  intents: z.array(Intent),
  interests: z.array(Interest).default([]),
  happenings: z.array(Happening).default([]),
});
export type Population = z.infer<typeof Population>;

// An intent held by the person using the app, with where it came from.
export const ProfileIntent = z.object({
  id: z.string(),
  // A deal has a price and gets negotiated. An interest is something to do with others and gets a room, not a price.
  // Sessions saved before interests existed have no kind; treat them as deals.
  kind: z.enum(["deal", "interest"]).optional(),
  direction: z.enum(["seek", "offer"]),
  tag: z.string(),
  summary: z.string(),
  price: z.number().nonnegative().nullable(),
  unit: Unit,
  conditions: z.array(z.string()),
  provenance: z.enum(["stated", "inferred"]),
  evidence: z.string(),
  status: z.enum(["confirmed", "pending", "rejected"]),
  // 1 is what matters most, from the either/or question in setup. Unranked intents come after ranked ones.
  priority: z.number().int().min(1).optional(),
  // For lessons and services: a small group if it's cheaper, or one-to-one even if it costs more.
  prefers: z.enum(["group", "solo"]).optional(),
});
export type ProfileIntent = z.infer<typeof ProfileIntent>;

export const TIME_CONDITIONS = ["mornings", "evenings", "weekends"] as const;

export function isInterest(intent: Pick<ProfileIntent, "kind">): boolean {
  return intent.kind === "interest";
}

// Interest tags the pilot knows, with the words people use for them.
export const INTEREST_TAGS: Record<string, RegExp> = {
  "live-music": /\b(music|musician|jazz|fado|concerts?|gigs?|bands?|jam(s|ming)?|singing|drums?|drummer|indie)\b/i,
  running: /\b(run|runs|running|runner|marathon|jogging)\b/i,
  "board-games": /\b(board ?games?|catan|tabletop|game nights?)\b/i,
};

// "Learn Spanish" in the middle of a sentence: lower-case the first letter only, so names keep their capitals.
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function formatPrice(amount: number, unit: Unit): string {
  const euros = Number.isInteger(amount) ? `€${amount}` : `€${amount.toFixed(2)}`;
  return unit === "one-off" ? euros : `${euros}/${unit === "hour" ? "h" : "mo"}`;
}

// What other agents are told about an intent. Never the price limit.
export function sharedLine(intent: ProfileIntent): string {
  const times = intent.conditions.length ? `, ${intent.conditions.join(" or ")}` : "";
  if (isInterest(intent)) return `Into ${lowerFirst(intent.summary)}${times}.`;
  return `${intent.direction === "seek" ? "Looking for" : "Offers"}: ${lowerFirst(intent.summary)}${times}.`;
}

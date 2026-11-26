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
// A standing yes: the person lets their agent accept offers for one intent within bounds they set, until a date.
// Like a payment mandate (AP2's open mandate, Mastercard's spend controls), it's scoped, it expires, and it's tied
// to a fingerprint of the intent as it was: change the intent and the standing yes no longer covers anything.
export const Mandate = z.object({
  // Seek: the most the agent may say yes to. Offer: the least. Never past the person's own limit.
  price: z.number().nonnegative(),
  until: z.string(),
  at: z.string(),
  // The intent as it was when the person said this (what, limit, times, format).
  basis: z.string(),
  // A fingerprint of everything above, kept with each yes it gives.
  hash: z.string(),
});
export type Mandate = z.infer<typeof Mandate>;

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
  mandate: Mandate.optional(),
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

// Something the agent learned about the person that isn't a deal or an interest: a level, a deadline, a reason.
// Kept with the words it came from, private to the person's agent.
export const AboutNote = z.object({ id: z.string(), fact: z.string().min(1).max(160), evidence: z.string().max(400), at: z.string() });
export type AboutNote = z.infer<typeof AboutNote>;

export type ProfileEntry = {
  id: string;
  summary: string;
  // Worded for the person, e.g. "up to €15/h". Never shown to other agents. Null when not set or an interest.
  limit: string | null;
  missing: "price" | null;
  times: string[];
  format: "group" | "solo" | null;
  top: boolean;
  status: ProfileIntent["status"];
  source: ProfileIntent["provenance"];
  quote: string;
  shared: string;
  // For the standing-yes control: the limit, its unit and side, and the standing yes in words when there is one.
  direction: ProfileIntent["direction"];
  limitValue: number | null;
  unit: Unit;
  standingYes: string | null;
};

// The person's profile, built from what they've said so far. One structure, used by the panel, the API and the agent.
export type Profile = {
  name: string;
  cameFor: string[];
  lookingFor: ProfileEntry[];
  offering: ProfileEntry[];
  into: ProfileEntry[];
  free: string[];
  format: "group" | "solo" | null;
  top: string | null;
  about: AboutNote[];
  // Inferred items waiting for a yes, and deals without a price yet.
  toConfirm: number;
  missing: number;
};

export function profileOf(input: { name: string; intents: ProfileIntent[]; goals?: string[]; about?: AboutNote[] }): Profile {
  const live = input.intents.filter((i) => i.status !== "rejected");
  const ranked = [...live].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const entry = (i: ProfileIntent): ProfileEntry => ({
    id: i.id,
    summary: i.summary,
    limit: isInterest(i) || i.price === null ? null : `${i.direction === "seek" ? "up to" : "from"} ${formatPrice(i.price, i.unit)}`,
    missing: !isInterest(i) && i.price === null ? "price" : null,
    times: i.conditions,
    format: i.prefers ?? null,
    top: i.priority === 1,
    status: i.status,
    source: i.provenance,
    quote: i.evidence,
    shared: sharedLine(i),
    direction: i.direction,
    limitValue: isInterest(i) ? null : i.price,
    unit: i.unit,
    standingYes:
      i.mandate && Date.parse(i.mandate.until) > Date.now()
        ? `${i.direction === "seek" ? "up to" : "from"} ${formatPrice(i.mandate.price, i.unit)}, until ${new Date(i.mandate.until).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
        : null,
  });
  const deals = ranked.filter((i) => !isInterest(i));
  const formats = [...new Set(live.flatMap((i) => (i.prefers ? [i.prefers] : [])))];
  const all = [...deals, ...ranked.filter(isInterest)].map(entry);
  return {
    name: input.name,
    cameFor: input.goals ?? [],
    lookingFor: deals.filter((i) => i.direction === "seek").map(entry),
    offering: deals.filter((i) => i.direction === "offer").map(entry),
    into: ranked.filter(isInterest).map(entry),
    free: TIME_CONDITIONS.filter((t) => live.some((i) => i.conditions.includes(t))),
    format: formats.length === 1 ? formats[0]! : null,
    top: ranked.find((i) => i.priority === 1)?.summary ?? null,
    about: input.about ?? [],
    toConfirm: all.filter((e) => e.status === "pending").length,
    missing: all.filter((e) => e.missing && e.status === "confirmed").length,
  };
}

// What other agents are told about an intent. Never the price limit.
export function sharedLine(intent: ProfileIntent): string {
  const times = intent.conditions.length ? `, ${intent.conditions.join(" or ")}` : "";
  if (isInterest(intent)) return `Into ${lowerFirst(intent.summary)}${times}.`;
  return `${intent.direction === "seek" ? "Looking for" : "Offers"}: ${lowerFirst(intent.summary)}${times}.`;
}

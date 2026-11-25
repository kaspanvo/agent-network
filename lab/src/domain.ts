import { z } from "zod";

const money = z.number().nonnegative();

export const Principal = z.object({
  id: z.string(),
  kind: z.enum(["person", "business"]),
  name: z.string(),
  hoursPerWeek: z.number().nonnegative().default(0),
});

export const Blocker = z.object({
  description: z.string(),
  resolvedBy: z.string(),
  maxContribution: money.default(0),
});

export const Mandate = z.object({
  mayNegotiate: z.boolean().default(true),
  mayJoinMultiParty: z.boolean().default(true),
});

export const Intent = z.object({
  id: z.string(),
  principalId: z.string(),
  direction: z.enum(["seek", "offer"]),
  status: z.enum(["active", "standing", "conditional", "dormant"]),
  summary: z.string(),
  tag: z.string(),
  // Seek: the most the principal will pay. Offer: the least they will accept. Private to their agent.
  reservationPrice: money,
  priceBasis: z.enum(["one-off", "per-hour", "per-month"]).default("one-off"),
  hours: z.number().nonnegative().default(0),
  capacity: z.number().int().positive().default(1),
  // Offer only: what the provider will spend to win a deal, e.g. funding a seeker's blocker.
  incentiveBudget: money.default(0),
  blockers: z.array(Blocker).default([]),
  mandate: Mandate.default({ mayNegotiate: true, mayJoinMultiParty: true }),
});

export const Population = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    synthetic: z.boolean(),
    principals: z.array(Principal),
    intents: z.array(Intent),
  })
  .superRefine((pop, ctx) => {
    const principalIds = new Set<string>();
    for (const p of pop.principals) {
      if (principalIds.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate principal id ${p.id}` });
      principalIds.add(p.id);
    }
    const intentIds = new Set<string>();
    for (const i of pop.intents) {
      if (intentIds.has(i.id)) ctx.addIssue({ code: "custom", message: `duplicate intent id ${i.id}` });
      intentIds.add(i.id);
      if (!principalIds.has(i.principalId))
        ctx.addIssue({ code: "custom", message: `intent ${i.id} references unknown principal ${i.principalId}` });
      if (i.direction === "offer" && i.blockers.length > 0)
        ctx.addIssue({ code: "custom", message: `offer ${i.id} cannot have blockers` });
      if (i.direction === "seek" && i.incentiveBudget > 0)
        ctx.addIssue({ code: "custom", message: `seek ${i.id} cannot have an incentive budget` });
    }
  });

export type Principal = z.infer<typeof Principal>;
export type Blocker = z.infer<typeof Blocker>;
export type Intent = z.infer<typeof Intent>;
export type Population = z.infer<typeof Population>;

export type Payment = { fromIntentId: string; amount: number };

export type Deal = {
  offerIntentId: string;
  forIntentId: string;
  // Set when this deal resolves one of the seek's blockers rather than the seek itself.
  blockerIndex?: number;
  price: number;
  paidBy: Payment[];
};

export type Message = {
  from: string;
  action: "PROPOSE" | "COUNTER" | "ACCEPT" | "DECLINE";
  amount?: number;
};

export type Proposal = {
  id: string;
  engine: string;
  pattern: "reciprocal" | "blocker-resolution";
  deals: Deal[];
  transcript: Message[];
};

export type EngineNote = {
  intentId: string;
  kind: "declined" | "no-candidates" | "no-agreement" | "missing-seat";
  detail: string;
};

export type EngineResult = { proposals: Proposal[]; notes: EngineNote[] };

export interface Engine {
  name: string;
  run(index: PopulationIndex): EngineResult;
}

export type PopulationIndex = {
  population: Population;
  principals: Map<string, Principal>;
  intents: Map<string, Intent>;
  seeks: Intent[];
  offers: Intent[];
  nameOf(intentId: string): string;
};

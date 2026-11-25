import { describe, expect, it } from "vitest";
import { Population, type Deal, type Proposal } from "../src/domain";
import { evaluate, violations } from "../src/feasibility";
import { indexPopulation } from "../src/population";

function makeIndex({ migratorHours = 4, migratorMultiParty = true, vendorBasis = "one-off" } = {}) {
  return indexPopulation(
    Population.parse({
      name: "test",
      synthetic: true,
      principals: [
        { id: "c", kind: "business", name: "Customer" },
        { id: "v", kind: "business", name: "Vendor" },
        { id: "m", kind: "person", name: "Migrator", hoursPerWeek: migratorHours },
      ],
      intents: [
        {
          id: "need",
          principalId: "c",
          direction: "seek",
          status: "conditional",
          summary: "cheaper CRM",
          tag: "crm",
          reservationPrice: 50,
          blockers: [{ description: "won't migrate", resolvedBy: "migration" }],
        },
        {
          id: "crm",
          principalId: "v",
          direction: "offer",
          status: "active",
          summary: "CRM",
          tag: "crm",
          reservationPrice: 45,
          priceBasis: vendorBasis,
          incentiveBudget: 100,
        },
        {
          id: "mig",
          principalId: "m",
          direction: "offer",
          status: "conditional",
          summary: "migrations",
          tag: "migration",
          reservationPrice: 90,
          hours: 3,
          mandate: { mayNegotiate: true, mayJoinMultiParty: migratorMultiParty },
        },
      ],
    }),
  );
}

const mainDeal: Deal = { offerIntentId: "crm", forIntentId: "need", price: 47, paidBy: [{ fromIntentId: "need", amount: 47 }] };
const migrationDeal = (price = 95, payer = "crm"): Deal => ({
  offerIntentId: "mig",
  forIntentId: "need",
  blockerIndex: 0,
  price,
  paidBy: [{ fromIntentId: payer, amount: price }],
});
const proposal = (deals: Deal[], id = "p1"): Proposal => ({ id, engine: "test", pattern: "blocker-resolution", deals, transcript: [] });

describe("violations", () => {
  it("accepts a funded three-party blocker-resolution room", () => {
    expect(violations(proposal([mainDeal, migrationDeal()]), makeIndex())).toEqual([]);
  });

  it("rejects a deal whose blocker is left unresolved", () => {
    expect(violations(proposal([mainDeal]), makeIndex())).toEqual([`blocker unresolved for Customer: "won't migrate"`]);
  });

  it("rejects a price below the provider's floor", () => {
    expect(violations(proposal([mainDeal, migrationDeal(80)]), makeIndex())).toContain("$80 is below Migrator's floor of $90");
  });

  it("rejects spending beyond the incentive budget", () => {
    expect(violations(proposal([mainDeal, migrationDeal(120)]), makeIndex())).toContain(
      "Vendor would pay $120 from their incentive budget, above their limit of $100",
    );
  });

  it("rejects the seeker paying toward a blocker beyond what they'd contribute", () => {
    expect(violations(proposal([mainDeal, migrationDeal(95, "need")]), makeIndex())).toContain(
      `Customer would pay $95 toward "won't migrate", above their limit of $0`,
    );
  });

  it("rejects payments from parties with no stake in the deal", () => {
    const vendorPaysMain: Deal = { ...mainDeal, paidBy: [{ fromIntentId: "crm", amount: 47 }] };
    expect(violations(proposal([vendorPaysMain, migrationDeal()]), makeIndex())).toContain(
      "Vendor is not entitled to pay toward Customer's deal",
    );
  });

  it("rejects work beyond the provider's weekly hours", () => {
    expect(violations(proposal([mainDeal, migrationDeal()]), makeIndex({ migratorHours: 2 }))).toContain(
      "Migrator would work 3h, above their 2h/week",
    );
  });

  it("rejects multi-party rooms for principals whose mandate excludes them", () => {
    expect(violations(proposal([mainDeal, migrationDeal()]), makeIndex({ migratorMultiParty: false }))).toContain(
      "Migrator's mandate does not allow multi-party arrangements",
    );
  });

  it("rejects deals that compare different price bases", () => {
    expect(violations(proposal([mainDeal, migrationDeal()]), makeIndex({ vendorBasis: "per-month" }))).toContain(
      "Vendor prices per-month but this deal is priced one-off",
    );
  });

  it("rejects resolving a blocker without the deal it unblocks", () => {
    expect(violations(proposal([migrationDeal()]), makeIndex())).toContain("resolves Customer's blocker without the deal it unblocks");
  });
});

describe("evaluate", () => {
  it("marks a second proposal for an already-met seek as a conflict", () => {
    const room = [mainDeal, migrationDeal()];
    const verdicts = evaluate([proposal(room, "p1"), proposal(room, "p2")], makeIndex({ migratorHours: 10 }));
    expect(verdicts.map((v) => v.status)).toEqual(["feasible", "conflict"]);
    expect(verdicts[1]!.reasons).toContain("Customer's intent is already met by an earlier proposal");
  });
});

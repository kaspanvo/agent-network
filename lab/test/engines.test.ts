import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { participants, runExperiment, summarize } from "../src/experiment";
import { indexPopulation, loadPopulation } from "../src/population";

const idx = indexPopulation(loadPopulation(fileURLToPath(new URL("../fixtures/founding-cohort.json", import.meta.url))));
const runs = Object.fromEntries(runExperiment(idx).map((r) => [r.engine, r]));
const bilateral = runs["B · bilateral"]!;
const rooms = runs["C · rooms"]!;

describe("engines on the founding-cohort fixture", () => {
  it("negotiating engines only produce proposals the checker accepts", () => {
    for (const run of [bilateral, rooms]) expect(run.verdicts.every((v) => v.status === "feasible")).toBe(true);
  });

  it("bilateral agents decline seeks with unresolved blockers", () => {
    const declined = bilateral.notes.filter((n) => n.kind === "declined").map((n) => n.intentId);
    expect(declined).toEqual(["brightdesk-crm", "harbor-pos"]);
  });

  it("rooms resolve Brightdesk's blocker with a vendor-funded migration seat", () => {
    const room = rooms.verdicts.find((v) => v.proposal.pattern === "blocker-resolution")!;
    expect(room.status).toBe("feasible");
    expect([...participants(room.proposal, idx)].sort()).toEqual(["brightdesk", "ledgerly", "sam"]);
    const seat = room.proposal.deals.find((d) => d.blockerIndex === 0)!;
    expect(seat.paidBy.map((p) => p.fromIntentId)).toEqual(["ledgerly-crm"]);
  });

  it("rooms report the seat they could not fill", () => {
    expect(rooms.notes).toContainEqual(expect.objectContaining({ intentId: "harbor-pos", kind: "missing-seat" }));
  });

  it("rooms meet every seek bilateral meets, plus the blocked one", () => {
    const b = summarize(bilateral, idx).seeksMet;
    const v = summarize(rooms, idx).seeksMet;
    expect(v).toEqual(expect.arrayContaining(b));
    expect(v.filter((id) => !b.includes(id))).toEqual(["brightdesk-crm"]);
  });

  it("similarity matching produces false matches the checker rejects", () => {
    const sim = summarize(runs["A · similarity"]!, idx);
    expect(sim.infeasible).toBeGreaterThan(0);
  });
});

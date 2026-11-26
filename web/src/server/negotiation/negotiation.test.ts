import { describe, expect, it } from "vitest";
import type { ProfileIntent } from "../domain";
import { LISBON_PILOT } from "../population";
import { createSession } from "../store";
import { scriptedNarrator } from "./narrator";
import { planThreads, settle } from "./plan";
import { runAgent } from "./run";
import type { AgentEvent } from "./types";

const spanish: ProfileIntent = { id: "s1", direction: "seek", tag: "spanish-lessons", summary: "Learn Spanish", price: 15, unit: "hour", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed" };
const bike: ProfileIntent = { id: "b1", direction: "offer", tag: "road-bike", summary: "Sell my road bike", price: 220, unit: "one-off", conditions: [], provenance: "inferred", evidence: "", status: "confirmed" };

describe("sealed offers", () => {
  it.each([
    [15, 12],
    [250, 220],
  ])("settles inside both limits (buyer max %d, seller floor %d), priced by the matcher", (max, floor) => {
    for (const seed of ["a", "b", "c", "d"]) {
      const { price, moves } = settle(max, floor, null, seed, "buyer");
      expect(price).not.toBeNull();
      expect(price!).toBeGreaterThanOrEqual(floor);
      expect(price!).toBeLessThanOrEqual(max);
      expect(moves.map((m) => [m.from, m.action])).toEqual([
        ["you", "SEAL"],
        ["them", "SEAL"],
        ["open", "MATCH"],
      ]);
    }
  });

  it("finds no deal when the limits don't overlap, without revealing either", () => {
    const { price, moves } = settle(10, 20, null, "x", "buyer");
    expect(price).toBeNull();
    expect(moves.at(-1)).toEqual({ from: "open", action: "NO_MATCH", amount: null });
  });

  it("never puts an amount in an agent's move, only in the matcher's", () => {
    const { moves } = settle(250, 220, null, "x", "seller");
    for (const m of moves.filter((m) => m.from !== "open")) expect(m.amount).toBeNull();
  });

  it("never lets the person's own limit move the price, so understating it can only lose the deal", () => {
    for (const seed of ["a", "b", "c"]) {
      // Buying: whatever maximum you state, the price is the same whenever there's a deal.
      const asBuyer = [300, 260, 240, 230].map((max) => settle(max, 200, null, seed, "buyer").price).filter((p) => p !== null);
      expect(new Set(asBuyer).size).toBe(1);
      // Selling: whatever floor you state, the same.
      const asSeller = [100, 150, 180, 200].map((floor) => settle(250, floor, null, seed, "seller").price).filter((p) => p !== null);
      expect(new Set(asSeller).size).toBe(1);
    }
    // Understating your maximum below the price just loses the deal.
    const price = settle(300, 200, null, "a", "buyer").price!;
    expect(settle(price - 1, 200, null, "a", "buyer").price).toBeNull();
  });

  it("uses the community's going rate when it fits, and never lands exactly on the other side's limit", () => {
    expect(settle(20, 12, 15, "a", "buyer").price).toBe(15);
    expect(settle(20, 12, 25, "a", "buyer").price).toBeNull();
    for (const seed of ["a", "b", "c", "d", "e"]) {
      expect(settle(300, 200, null, seed, "buyer").price).not.toBe(200);
      expect(settle(300, 200, null, seed, "seller").price).not.toBe(300);
    }
  });
});

describe("who gets a seat", () => {
  it("fills seats by fit, with a fixed draw among equals, not by the order people joined", async () => {
    const { bySeatFit } = await import("./plan");
    const people = [
      { name: "first to join", times: ["mornings"] },
      { name: "evenings", times: ["evenings"] },
      { name: "evenings and weekends", times: ["evenings", "weekends"] },
    ];
    const ranked = bySeatFit(people, (p) => p.times, ["evenings", "weekends"], "room-1").map((p) => p.name);
    expect(ranked).toEqual(["evenings and weekends", "evenings", "first to join"]);
    // Equals are ordered by a draw that differs between rooms and stays the same for one room.
    const equals = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, times: [] as string[] }));
    const orders = new Set(["a", "b", "c", "d"].map((seed) => bySeatFit(equals, (p) => p.times, [], seed).map((p) => p.name).join()));
    expect(orders.size).toBeGreaterThan(1);
    expect(bySeatFit(equals, (p) => p.times, [], "a")).toEqual(bySeatFit(equals, (p) => p.times, [], "a"));
  });
});

describe("planThreads", () => {
  it("forms a group room with Diego when one-to-one is above the limit", () => {
    const diego = planThreads([spanish], LISBON_PILOT).find((t) => t.counterpart.memberId === "diego")!;
    expect(diego.kind).toBe("group");
    expect(diego.room.map((r) => r.name).sort()).toEqual(["Joana", "Lena"]);
    expect(diego.agreedPrice).toBeGreaterThanOrEqual(12);
    expect(diego.agreedPrice).toBeLessThanOrEqual(15);
    expect(diego.schedule).toBe("Evenings");
  });

  it("rules out a school that only teaches mornings", () => {
    const lingo = planThreads([spanish], LISBON_PILOT).find((t) => t.counterpart.memberId === "lingo")!;
    expect(lingo.kind).toBe("no_fit");
    expect(lingo.noFitReason).toContain("mornings");
    expect(lingo.moves).toEqual([]);
  });

  it("ignores intents that are pending or have no price", () => {
    expect(planThreads([{ ...spanish, status: "pending" }, { ...bike, price: null }], LISBON_PILOT)).toEqual([]);
  });
});

describe("runAgent", () => {
  it("streams discovery, a room, explained messages and proposals", async () => {
    const session = createSession("Sam");
    session.intents = [spanish, bike];
    const events: AgentEvent[] = [];
    await runAgent(session, scriptedNarrator, (e) => events.push(e));

    expect(events.some((e) => e.type === "room")).toBe(true);
    const messages = events.filter((e): e is Extract<AgentEvent, { type: "message" }> => e.type === "message");
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect(m.why.length).toBeGreaterThan(0);
    // Your agent never tells the other side your limit.
    for (const m of messages.filter((m) => m.from === "you")) expect(m.text).not.toContain("€15/h limit");

    const titles = session.run!.opportunities.map((o) => o.title);
    expect(titles[0]).toMatch(/^Learn Spanish with (Diego, in a group of 3|Lucía)$/);
    expect(titles[1]).toBe("Sell my road bike: Marco would buy");
    expect(events.at(-1)).toMatchObject({ type: "done", stats: { ready: 2, rooms: 1 } });
  });
});

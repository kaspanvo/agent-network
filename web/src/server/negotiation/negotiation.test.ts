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
    [100, 100],
  ])("settles inside both limits (buyer max %d, seller floor %d), priced by the matcher", (max, floor) => {
    for (const seed of ["a", "b", "c", "d"]) {
      const { price, moves } = settle(max, floor, seed, "buyer");
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
    const { price, moves } = settle(10, 20, "x", "buyer");
    expect(price).toBeNull();
    expect(moves.at(-1)).toEqual({ from: "open", action: "NO_MATCH", amount: null });
  });

  it("never puts an amount in an agent's move, only in the matcher's", () => {
    const { moves } = settle(250, 220, "x", "seller");
    for (const m of moves.filter((m) => m.from !== "open")) expect(m.amount).toBeNull();
  });

  it("lands in the middle of the overlap, at a point that varies by room", () => {
    const prices = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => settle(300, 200, seed, "buyer").price));
    expect(prices.size).toBeGreaterThan(1);
    for (const p of prices) {
      expect(p!).toBeGreaterThanOrEqual(235);
      expect(p!).toBeLessThanOrEqual(265);
    }
  });
});

describe("planThreads", () => {
  it("forms a group room with Diego when one-to-one is above the limit", () => {
    const diego = planThreads([spanish], LISBON_PILOT).find((t) => t.counterpart.memberId === "diego")!;
    expect(diego.kind).toBe("group");
    expect(diego.room.map((r) => r.name)).toEqual(["Lena", "Joana"]);
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

import { describe, expect, it } from "vitest";
import type { ProfileIntent } from "../domain";
import { LISBON_PILOT } from "../population";
import { createSession } from "../store";
import { scriptedNarrator } from "./narrator";
import { bargain, planThreads } from "./plan";
import { runAgent } from "./run";
import type { AgentEvent } from "./types";

const spanish: ProfileIntent = { id: "s1", direction: "seek", tag: "spanish-lessons", summary: "Learn Spanish", price: 15, unit: "hour", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed" };
const bike: ProfileIntent = { id: "b1", direction: "offer", tag: "road-bike", summary: "Sell my road bike", price: 220, unit: "one-off", conditions: [], provenance: "inferred", evidence: "", status: "confirmed" };

describe("bargain", () => {
  it.each([
    [15, 12],
    [250, 220],
    [100, 100],
  ])("settles within both limits (buyer max %d, seller floor %d)", (max, floor) => {
    for (const first of ["buyer", "seller"] as const) {
      const { price, moves } = bargain(max, floor, first, "buyer");
      expect(price).not.toBeNull();
      expect(price!).toBeGreaterThanOrEqual(floor);
      expect(price!).toBeLessThanOrEqual(max);
      expect(moves.at(-1)!.action).toBe("ACCEPT");
    }
  });

  it("walks away when the limits don't overlap", () => {
    const { price, moves } = bargain(10, 20, "buyer", "buyer");
    expect(price).toBeNull();
    expect(moves.at(-1)).toMatchObject({ from: "you", action: "DECLINE" });
  });

  it("never offers past an agent's own limit", () => {
    const { moves } = bargain(15, 12, "buyer", "buyer");
    for (const m of moves.filter((m) => m.action !== "ACCEPT" && m.action !== "DECLINE")) {
      if (m.from === "you") expect(m.amount!).toBeLessThanOrEqual(15);
      else expect(m.amount!).toBeGreaterThanOrEqual(12);
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
    expect(titles).toEqual(["Learn Spanish with Diego, in a group of 3", "Sell my road bike: Marco would buy"]);
    expect(events.at(-1)).toMatchObject({ type: "done", stats: { ready: 2, rooms: 1 } });
  });
});

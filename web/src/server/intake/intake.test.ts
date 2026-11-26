import { describe, expect, it } from "vitest";
import { createSession } from "../store";
import { demoIntakeAgent } from "./demo";
import { isReady, saveIntent, setConditionsForAll, setIntentPrice } from "./profile";
import type { IntakeEvent } from "./types";

async function turn(text: string, session = createSession("Sam")) {
  const events: IntakeEvent[] = [];
  await demoIntakeAgent().respond(session, text, (e) => events.push(e), new AbortController().signal);
  return { session, events };
}

describe("profile", () => {
  it("keeps inferred intents pending until the person confirms them", () => {
    const session = createSession("Sam");
    const bike = saveIntent(session, { direction: "offer", summary: "Sell my bike", tag: "Road Bike!", provenance: "inferred", evidence: "it sits in the hallway", unit: "one-off", price: 220 });
    expect(bike.tag).toBe("road-bike");
    expect(bike.status).toBe("pending");
    expect(isReady(session)).toBe(false);
    bike.status = "confirmed";
    expect(isReady(session)).toBe(true);
  });

  it("updates an intent in place when given its id", () => {
    const session = createSession("Sam");
    const first = saveIntent(session, { direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", unit: "hour" });
    saveIntent(session, { id: first.id, direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", conditions: ["Evenings", "noon"] });
    expect(session.intents).toHaveLength(1);
    expect(session.intents[0]!.conditions).toEqual(["evenings"]);
    setIntentPrice(session, first.id, 15);
    expect(session.intents[0]!.price).toBe(15);
  });

  it("applies times of day to services only", () => {
    const session = createSession("Sam");
    saveIntent(session, { direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", unit: "hour" });
    saveIntent(session, { direction: "offer", summary: "Sell my bike", tag: "road-bike", provenance: "stated", evidence: "", unit: "one-off" });
    setConditionsForAll(session, ["evenings"]);
    expect(session.intents.map((i) => i.conditions)).toEqual([["evenings"], []]);
  });
});

describe("demo intake agent", () => {
  it("opens with quick picks and records stated and inferred intents from free text", async () => {
    const { session, events } = await turn("[App note: start]");
    expect(events.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "choices", multiple: true } });

    await turn("I picked: Learn something new", session);
    const { events: third } = await turn("I'd love to learn Spanish. My old road bike just sits in the hallway.", session);
    const intents = third.flatMap((e) => (e.type === "intent" ? [e.intent] : []));
    expect(intents.map((i) => [i.tag, i.provenance, i.status])).toEqual([
      ["spanish-lessons", "stated", "confirmed"],
      ["road-bike", "inferred", "pending"],
    ]);
    expect(intents[1]!.evidence).toBe("My old road bike just sits in the hallway.");
    expect(third.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "number", intentId: intents[0]!.id } });
  });
});

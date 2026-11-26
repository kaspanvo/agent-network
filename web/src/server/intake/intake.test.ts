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

  const said = (events: IntakeEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  const replies = (events: IntakeEvent[]) => events.find((e): e is Extract<IntakeEvent, { type: "suggestions" }> => e.type === "suggestions")?.options ?? [];

  it("follows up on what was picked, not with one line for everyone", async () => {
    const { session } = await turn("[App note: start]");
    const { events } = await turn("I picked: Pay less for something", session);
    expect(said(events)).toContain("pay less for");
    expect(said(events)).not.toContain("Good picks");
    expect(replies(events)).toContain("A used camera, not new");

    const { session: two } = await turn("[App note: start]");
    const { events: both } = await turn("I picked: Learn something new, Earn on the side", two);
    expect(said(both)).toBe("Tell me in your own words what you'd like to learn and what you could teach or do for others.");
    expect(replies(both)).toEqual(["I'd love to learn Spanish", "I could teach Spanish"]);
  });

  it("understands each suggested reply the way it was meant", async () => {
    const cases: [string, string, string][] = [
      ["Pay less for something", "A used camera, not new", "used-camera seek"],
      ["Sell or rent something", "My camera sits in a drawer", "used-camera offer"],
      ["Earn on the side", "I could teach Spanish", "spanish-lessons offer"],
      ["Earn on the side", "I can walk dogs on weekends", "dog-sitting offer"],
      ["Find help for a project", "Someone to mind my dog on weekends", "dog-sitting seek"],
      ["Pay less for something", "Cheaper Spanish lessons in a group", "spanish-lessons seek"],
    ];
    for (const [pick, reply, expected] of cases) {
      const { session } = await turn("[App note: start]");
      await turn(`I picked: ${pick}`, session);
      await turn(reply, session);
      expect(session.intents.map((i) => `${i.tag} ${i.direction}`)).toEqual([expected]);
    }
  });

  it("takes 'in a group' as already answering group or one-to-one", async () => {
    const { session } = await turn("[App note: start]");
    await turn("I picked: Pay less for something", session);
    await turn("Cheaper Spanish lessons in a group", session);
    expect(session.intents[0]!.prefers).toBe("group");
  });

  it("answers a question instead of saving it, then goes back to what it asked with the same chips", async () => {
    const { session } = await turn("[App note: start]");
    const { events: asked } = await turn("I picked: Pay less for something", session);
    const { events } = await turn("What can you actually do for me?", session);
    expect(session.intents).toEqual([]);
    expect(said(events)).toContain("Nothing is agreed without your yes");
    expect(said(events)).toContain("back to you: What would you like to pay less for?");
    expect(replies(events)).toEqual(replies(asked));
  });

  it("still takes a request that names something as an intent, and notes what helps", async () => {
    const { session } = await turn("[App note: start]");
    await turn("I picked: Learn something new", session);
    await turn("Can you find me Spanish lessons? I'm a total beginner, with a trip in March.", session);
    expect(session.intents.map((i) => i.tag)).toEqual(["spanish-lessons"]);
    expect(session.about?.map((a) => a.fact)).toEqual(["Starting from scratch", "Trip coming up in March"]);
  });

  it("treats typing instead of picking at the start as the person's own words", async () => {
    const { session } = await turn("[App note: start]");
    await turn("I'd love to learn Spanish", session);
    expect(session.intents.map((i) => i.tag)).toEqual(["spanish-lessons"]);
  });
});

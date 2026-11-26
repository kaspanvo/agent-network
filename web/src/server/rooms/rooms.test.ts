import { describe, expect, it } from "vitest";
import type { ProfileIntent } from "../domain";
import { scoreCalibration } from "../intake/calibration";
import { demoIntakeAgent } from "../intake/demo";
import type { IntakeEvent } from "../intake/types";
import { scriptedNarrator } from "../negotiation/narrator";
import { renegotiate } from "../negotiation/renegotiate";
import { runAgent } from "../negotiation/run";
import type { AgentEvent } from "../negotiation/types";
import { LISBON_PILOT } from "../population";
import { createSession } from "../store";
import { circleScript, planCircles, planOpportunity } from "./circle";
import { keywordResponder, openPrivateRoom, roomContext, sayInRoom } from "./reply";

const interest = (tag: string, summary: string, conditions: string[]): ProfileIntent => ({
  id: tag.slice(0, 4),
  kind: "interest",
  direction: "seek",
  tag,
  summary,
  price: null,
  unit: "one-off",
  conditions,
  provenance: "stated",
  evidence: "",
  status: "confirmed",
});

const music = interest("live-music", "Live music, mostly jazz", ["evenings"]);

async function runWith(intents: ProfileIntent[]) {
  const session = createSession("Ana");
  session.intents = intents;
  const events: AgentEvent[] = [];
  await runAgent(session, scriptedNarrator, (e) => events.push(e));
  return { session, events };
}

describe("circles", () => {
  it("opens a group room when several members share an interest, and plans something that fits your times", () => {
    const [circle] = planCircles([music], LISBON_PILOT);
    expect(circle!.members.map((m) => m.name)).toEqual(["Lena", "Rita", "Bruno", "Carla"]);
    expect(circle!.chosen?.id).toBe("jazz-jam");
    const plan = planOpportunity(circle!, "Ana")!;
    expect(plan).toMatchObject({ kind: "plan", price: null, title: "Jazz jam session", version: 1 });
    expect(plan.terms).toContain("Thursday, 22:00");
  });

  it("opens a one-to-one room when only one member shares it", () => {
    const [circle] = planCircles([interest("board-games", "Board games", ["evenings"])], LISBON_PILOT);
    expect(circle!.members.map((m) => m.name)).toEqual(["Pedro"]);
    expect(circleScript(circle!, "Ana", LISBON_PILOT)[0]!.text).toContain("What is Pedro up to?");
  });

  it("keeps the room open without a plan when nobody shares it at your times", () => {
    const [circle] = planCircles([interest("running", "Running", ["evenings"])], LISBON_PILOT);
    expect(circle!.members).toEqual([]);
    expect(circle!.elsewhere.map((m) => m.name)).toEqual(["Tom", "Sofia"]);
    expect(planOpportunity(circle!, "Ana")).toBeNull();
  });

  it("runs circles next to deals and attaches what's happening as cards", async () => {
    const { session, events } = await runWith([music]);
    expect(events.find((e) => e.type === "discover")).toMatchObject({ mode: "circle", threadId: "circle-live" });
    expect(events.some((e) => e.type === "message" && e.card?.kind === "happening")).toBe(true);
    expect(events.some((e) => e.type === "message" && e.card?.kind === "offer")).toBe(true);
    expect(session.run!.opportunities).toHaveLength(1);
    await expect(renegotiate(session, "circle-live", 10, scriptedNarrator, () => {})).rejects.toThrow();
  });
});

describe("talking in rooms", () => {
  it("lets the person write in a room and the agents answer from what their people shared", async () => {
    const { session } = await runWith([music]);
    const events: AgentEvent[] = [];
    await sayInRoom(session, "circle-live", "When is the jazz jam?", keywordResponder, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: "message", from: "person", text: "When is the jazz jam?" });
    const replies = events.filter((e) => e.type === "message" && e.from === "them");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ who: "Lena's agent", card: { kind: "happening", title: "Jazz jam session" } });
  });

  it("passes the message on when no agent knows the answer", async () => {
    const { session } = await runWith([music]);
    const replies = await keywordResponder.reply(roomContext(session, "circle-live"), "Anyone into knitting?");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("pass your message on");
  });

  it("opens a private room with an agent you've met, and only those", async () => {
    const { session } = await runWith([music]);
    const id = await openPrivateRoom(session, "Bruno", () => {});
    expect(id).toBe("dm-bruno");
    expect(roomContext(session, id)).toMatchObject({ mode: "private", members: [{ name: "Bruno" }] });
    expect(await openPrivateRoom(session, "Bruno", () => {})).toBe("dm-bruno");
    await expect(openPrivateRoom(session, "Pedro", () => {})).rejects.toThrow("met in a room");
    // Agents never pass on price limits.
    expect(roomContext(session, "circle-live").members.flatMap((m) => m.facts).join(" ")).not.toMatch(/€20/);
  });
});

describe("demo intake with interests", () => {
  it("records an interest without asking for a price, then asks when you're free", async () => {
    const session = createSession("Ana");
    const say = async (text: string) => {
      const events: IntakeEvent[] = [];
      await demoIntakeAgent().respond(session, text, (e) => events.push(e), new AbortController().signal);
      return events;
    };
    await say("[App note: start]");
    await say("I picked: Find things to do");
    const third = await say("I'm into jazz and live music");
    expect(third.find((e) => e.type === "intent")).toMatchObject({ intent: { kind: "interest", tag: "live-music", summary: "Live music, mostly jazz", price: null } });
    expect(third.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "choices", options: ["Mornings", "Evenings", "Weekends"] } });
    const fourth = await say("Evenings");
    expect(session.intents[0]!.conditions).toEqual(["evenings"]);
    // Before going out, the agent shows what it understood and waits for the person to confirm it.
    expect(fourth.some((e) => e.type === "ready")).toBe(false);
    expect(fourth.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "recap", items: [{ summary: "Live music, mostly jazz", limit: null, times: ["evenings"] }] } });
    session.recapConfirmed = true;
    // Then it checks its guesses on an either/or pick between real things happening: jazz, as she said.
    const fifth = await say("[App note: Ana confirmed the recap.] That's right.");
    expect(fifth.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "pairs", pairs: [{ a: { title: "Jazz jam session" }, b: { title: "Fado night with Rita's group" } }] } });
    expect(session.calibration!.pairs[0]!.predicted).toBe("a");
    scoreCalibration(session, { [session.calibration!.pairs[0]!.id]: "a" });
    session.chat.at(-1)!.answered = true;
    const sixth = await say("[App note: Ana answered the either/or picks. Their agent guessed 1 of 1 right.]");
    expect(sixth.some((e) => e.type === "ready")).toBe(true);
    expect(session.calibration!.agreed).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { observe } from "./actor";
import { actorFor, startActor } from "./local/registry";
import type { ProfileIntent } from "./domain";
import { checkIn, decide } from "./followup";
import { demoIntakeAgent } from "./intake/demo";
import type { IntakeEvent } from "./intake/types";
import { scriptedNarrator } from "./negotiation/narrator";
import { planThreads } from "./negotiation/plan";
import { choose, runAgent, shuffled } from "./negotiation/run";
import type { AgentEvent } from "./negotiation/types";
import { LISBON_PILOT } from "./population";
import { createSession } from "./store";

// Changes that follow what field studies of agent-to-agent marketplaces found.

const spanish: ProfileIntent = { id: "s1", kind: "deal", direction: "seek", tag: "spanish-lessons", summary: "Learn Spanish", price: 15, unit: "hour", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed" };
const jazz: ProfileIntent = { id: "j1", kind: "interest", direction: "seek", tag: "live-music", summary: "Live music, mostly jazz", price: null, unit: "one-off", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed" };

async function run(intents: ProfileIntent[]) {
  const actor = startActor("Ana");
  actor.session.intents = intents.map((i) => ({ ...i }));
  const events: AgentEvent[] = [];
  await runAgent(actor.session, scriptedNarrator, (e) => {
    observe(actor, e);
    events.push(e);
  });
  return { actor, session: actor.session, events };
}

describe("setup: either/or questions and a recap before going out", () => {
  it("asks group or one-to-one, ranks what matters most, then shows a recap that never shares the limit", async () => {
    const session = createSession("Ana");
    const say = async (text: string) => {
      const events: IntakeEvent[] = [];
      await demoIntakeAgent().respond(session, text, (e) => events.push(e), new AbortController().signal);
      return events;
    };
    const widget = (events: IntakeEvent[]) => events.find((e) => e.type === "widget")?.widget;
    await say("[App note: start]");
    await say("I picked: Learn something new");
    await say("I'd love to learn Spanish, and I'm into jazz");
    session.intents.find((i) => i.tag === "spanish-lessons")!.price = 15;
    expect(widget(await say("My answer: 15 €/hour"))).toMatchObject({ kind: "choices", prompt: "Group or one-to-one", multiple: false });
    expect(widget(await say("I picked: One-to-one, even if it costs more"))).toMatchObject({ kind: "choices", options: ["Mornings", "Evenings", "Weekends"] });
    expect(widget(await say("I picked: Evenings"))).toMatchObject({ kind: "choices", prompt: "What matters most", options: ["Live music, mostly jazz", "Learn Spanish"] });
    const recap = widget(await say("I picked: Learn Spanish"));

    expect(session.intents.find((i) => i.tag === "spanish-lessons")).toMatchObject({ prefers: "solo", priority: 1 });
    expect(recap).toMatchObject({ kind: "recap", items: [{ summary: "Learn Spanish", rank: 1, limit: "Up to €15/h", prefers: "One-to-one" }, { summary: "Live music, mostly jazz", rank: 2 }] });
    // What other agents hear never includes the price limit.
    for (const item of recap!.kind === "recap" ? recap!.items : []) expect(item.shared).not.toMatch(/€|15/);
    expect(session.ready).toBe(false);
  });
});

describe("collecting offers before choosing", () => {
  it("hears every Spanish teacher, compares them and picks the cheapest that fits", async () => {
    const { session, events } = await run([spanish]);
    const shortlist = events.find((e): e is Extract<AgentEvent, { type: "shortlist" }> => e.type === "shortlist")!;
    expect(shortlist.heard).toBe(3);
    expect(shortlist.options.map((o) => o.who).sort()).toEqual(["Diego", "Lucía"]);
    // With no preference for group or one-to-one, the lower price wins.
    const chosen = shortlist.options.find((o) => o.threadId === shortlist.chosen)!;
    expect(chosen.price).toBe(Math.min(...shortlist.options.map((o) => o.price)));
    expect(session.run!.opportunities[0]!.reasons).toContain("The best fit of 2 offers your agent compared");
  });

  it("picks one-to-one over a cheaper group when the person said so", () => {
    const solo = { ...spanish, prefers: "solo" as const };
    const choice = choose(solo, planThreads([solo], LISBON_PILOT))!;
    expect(choice.chosen.counterpart.name).toBe("Lucía");
    // Either Lucía was also cheapest, or the agent explains it chose one-to-one over a lower group price.
    expect(choice.why).toMatch(/one-to-one|lowest price/);
  });

  it("hears agents in an order that doesn't depend on who joined first, and is the same for the same person", () => {
    const ids = Array.from({ length: 8 }, (_, i) => i);
    expect(shuffled(ids, "a")).toEqual(shuffled(ids, "a"));
    expect(shuffled(ids, "a")).not.toEqual(ids);
    expect([...shuffled(ids, "a")].sort()).toEqual(ids);
  });

  it("brings proposals in the order the person ranked them", async () => {
    const { session } = await run([spanish, { ...jazz, priority: 1 }]);
    expect(session.run!.opportunities.map((o) => o.kind)).toEqual(["plan", "deal"]);
  });
});

describe("follow-through after a yes", () => {
  it("gets the others' yes, introduces you, then asks whether it happened and tells the agent", async () => {
    const { session } = await run([jazz]);
    const plan = session.run!.opportunities[0]!;
    const events: AgentEvent[] = [];
    await decide(session, plan.id, "approved", (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: "decision", decision: "approved" });
    expect(events.filter((e) => e.type === "message" && e.action === "JOIN").length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "followup").map((e) => e.type === "followup" && e.stage)).toEqual(["introduced", "check_in"]);
    expect(session.followups[plan.id]).toMatchObject({ stage: "introduced" });
    await expect(decide(session, plan.id, "declined", () => {})).rejects.toThrow("already answered");

    const after: AgentEvent[] = [];
    await checkIn(session, plan.id, "again", (e) => after.push(e));
    expect(after[0]).toMatchObject({ type: "followup", stage: "done", answer: "again" });
    expect(session.pendingNotes.at(-1)).toContain("they'd do it again");
    await expect(checkIn(session, plan.id, "missed", () => {})).rejects.toThrow("already told");
  });

  it("only checks in on things you said yes to", async () => {
    const { session } = await run([jazz]);
    const plan = session.run!.opportunities[0]!;
    await decide(session, plan.id, "declined", () => {});
    await expect(checkIn(session, plan.id, "again", () => {})).rejects.toThrow("said yes to");
  });
});

describe("one live agent per person, with an activity log", () => {
  it("gives every request for the same person the same state", () => {
    const actor = startActor("Ana");
    actor.session.decisions["x"] = "approved";
    expect(actorFor(actor.session.id)!.session.decisions["x"]).toBe("approved");
    expect(actorFor(actor.session.id)).toBe(actor);
  });

  it("logs what the agent said in your name and to whom, but not what other agents said", async () => {
    const { actor } = await run([spanish]);
    const log = actor.session.log.map((l) => l.text);
    expect(log.some((t) => /^Sent your sealed offer to Open's matcher, not to Diego, (Lena and Joana|Joana and Lena)'s agents$/.test(t))).toBe(true);
    expect(log.some((t) => /^Open's matcher set the price at €\d+\/h with Lucía's agent$/.test(t))).toBe(true);
    expect(log.some((t) => t.startsWith("Compared 2 offers for “Learn Spanish” and picked"))).toBe(true);
    expect(log.some((t) => t.startsWith("Brought you version 1"))).toBe(true);
    // Messages from other people's agents aren't things your agent did.
    expect(log.some((t) => t.includes("Lucía's agent:"))).toBe(false);
  });
});

describe("learning from the picks", () => {
  it("plans what the person picked over what the agent guessed", async () => {
    const { session } = await run([{ ...jazz, evidence: `Picked "Fado night with Rita's group" over "Jazz jam session".` }]);
    const plan = session.run!.opportunities[0]!;
    expect(plan.title).toBe("Fado night with Rita's group");
    expect(plan.reasons[0]).toBe("You picked this one when your agent checked its guesses");
  });
});

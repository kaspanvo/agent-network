import { describe, expect, it } from "vitest";
import { makeActor } from "./actor";
import { handleApi, type Host } from "./api";
import { agentModels } from "./models";
import { saveIntent, withoutAmounts } from "./intake/profile";
import { createSession, upgradeSession, type Session } from "./store";

// Set up and checked, with something the agent inferred still waiting for a yes.
function readyWithInferred(): { session: Session; host: Host; inferredId: string } {
  const session = createSession("Ana");
  saveIntent(session, { kind: "deal", direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", unit: "hour", price: 15 });
  const bike = saveIntent(session, { kind: "deal", direction: "offer", summary: "Sell my bike", tag: "road-bike", provenance: "inferred", evidence: "", unit: "one-off", price: 200 });
  session.recapConfirmed = true;
  session.ready = true;
  session.chat.push({ id: "plan", role: "agent", text: "Here's my plan. Send me out whenever you're ready." });
  return { session, host: { actor: makeActor(session, () => {}), start: () => makeActor(session, () => {}) }, inferredId: bike.id };
}

const call = (host: Host, method: string, path: string, body: unknown = {}) => handleApi(new Request(`http://localhost:3000${path}`, { method, body: JSON.stringify(body) }), host);

describe("sending the agent out after the person changed something", () => {
  it("takes the agent off ready when an answer to an inference undoes the checked recap, and says so", async () => {
    const { session, host, inferredId } = readyWithInferred();
    const body = await (await call(host, "PATCH", `/api/intents/${inferredId}`, { status: "confirmed" })).json();
    expect(body).toMatchObject({ ready: false, recapNeeded: true });
    expect(session.ready).toBe(false);
  });

  it("refuses to go out with the recap unchecked, naming what it needs, so the app can show the recap", async () => {
    const { session, host } = readyWithInferred();
    session.recapConfirmed = false;
    const response = await call(host, "POST", "/api/agent/run");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ needs: "recap" });
  });

  it("shows the recap again when the app asks, without a message from the person or a new intent", async () => {
    const { session, host, inferredId } = readyWithInferred();
    await call(host, "PATCH", `/api/intents/${inferredId}`, { status: "confirmed" });
    const intents = session.intents.length;
    const chat = session.chat.length;
    const text = await (await call(host, "POST", "/api/intake", { kind: "refresh" })).text();
    expect(text).toContain('"kind":"recap"');
    expect(session.intents).toHaveLength(intents);
    expect(session.chat.slice(chat).map((c) => c.role)).toEqual(["agent"]);
  });

  it("fixes sessions saved ready with the recap unchecked", () => {
    const session = createSession("Ana");
    session.ready = true;
    session.recapConfirmed = false;
    expect(upgradeSession(session).ready).toBe(false);
  });
});

describe("ready is the app's call, not the model's", () => {
  // A model that answers but never calls mark_ready, like a small open model that skips a step.
  const forgetful = (session: Session): Host => ({
    actor: makeActor(session, () => {}),
    start: () => makeActor(session, () => {}),
    agents: { ...agentModels(), intake: () => ({ respond: async () => {} }) },
  });

  it("is ready once the person confirms the recap, even if the model never says so", async () => {
    const { session } = readyWithInferred();
    session.ready = false;
    session.recapConfirmed = false;
    session.chat.push({ id: "recap", role: "agent", text: "Did I get it right?", widget: { kind: "recap", items: [] } });
    const text = await (await call(forgetful(session), "POST", "/api/intake", { kind: "recap", itemId: "recap", answer: "confirm" })).text();
    expect(session.ready).toBe(true);
    expect(text).toContain('"type":"ready"');
  });

  it("shows the recap itself when asked, without the model", async () => {
    const { session } = readyWithInferred();
    session.recapConfirmed = false;
    const host: Host = { ...forgetful(session), agents: { ...agentModels(), intake: () => ({ respond: async () => { throw new Error("the model was asked"); } }) } };
    const text = await (await call(host, "POST", "/api/intake", { kind: "refresh" })).text();
    expect(text).toContain('"kind":"recap"');
    expect(text).not.toContain("the model was asked");
    expect(session.chat.at(-1)?.widget?.kind).toBe("recap");
  });

  it("unsticks sessions saved with the recap confirmed but never marked ready", () => {
    const session = createSession("Ana");
    saveIntent(session, { kind: "deal", direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", unit: "hour", price: 15 });
    session.recapConfirmed = true;
    session.ready = false;
    expect(upgradeSession(session).ready).toBe(true);
  });
});

describe("what other agents hear about an intent", () => {
  it("never carries an amount, however the model wrote the summary", () => {
    expect(withoutAmounts("Learn Spanish, one-to-one, evenings, up to 15€/hour; open to any-level teachers too")).toBe("Learn Spanish, one-to-one, evenings; open to any-level teachers too");
    expect(withoutAmounts("Buy a used camera for €300")).toBe("Buy a used camera");
    expect(withoutAmounts("Sell my bike, at least 200 euros")).toBe("Sell my bike");
    expect(withoutAmounts("Guitar lessons max 20/h")).toBe("Guitar lessons");
    expect(withoutAmounts("Dog-sitting (around $40 per night)")).toBe("Dog-sitting");
    expect(withoutAmounts("Learn Spanish before a trip in March")).toBe("Learn Spanish before a trip in March");
    expect(saveIntent(createSession("Ana"), { direction: "seek", summary: "Spanish lessons up to 15€/hour", tag: "spanish-lessons", provenance: "stated", evidence: "", unit: "hour", price: 15 }).summary).toBe("Spanish lessons");
  });
});

describe("before going out, the agent checks it has read the person right", () => {
  async function confirmed(): Promise<{ session: Session; host: Host }> {
    const session = createSession("Ana");
    saveIntent(session, { kind: "deal", direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", unit: "hour", price: 15, conditions: ["evenings"] });
    session.recapConfirmed = true;
    session.ready = true;
    session.chat.push({ id: "plan", role: "agent", text: "Here's my plan." });
    return { session, host: { actor: makeActor(session, () => {}), start: () => makeActor(session, () => {}) } };
  }

  it("asks for the either/or picks first if they were never shown, and the app can show them itself", async () => {
    const { session, host } = await confirmed();
    const refused = await call(host, "POST", "/api/agent/run");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ needs: "calibration" });
    const shown = await (await call(host, "POST", "/api/intake", { kind: "refresh", what: "calibration" })).text();
    expect(shown).toContain('"kind":"pairs"');
    expect(session.calibration?.pairs.length).toBeGreaterThan(0);
  });

  it("says so when it got too many picks wrong, and goes anyway only if the person says so", async () => {
    const { session, host } = await confirmed();
    const { calibrationPairs, scoreCalibration } = await import("./intake/calibration");
    const pairs = calibrationPairs(session);
    session.calibration = { pairs };
    scoreCalibration(session, Object.fromEntries(pairs.map((p) => [p.id, p.predicted === "a" ? "b" : "a"])));
    const refused = await call(host, "POST", "/api/agent/run");
    expect(await refused.json()).toMatchObject({ needs: "understanding", agreed: 0, total: pairs.length });
    const went = await call(host, "POST", "/api/agent/run", { anyway: true });
    expect(went.status).toBe(200);
    expect(await went.text()).toContain('"type":"discover"');
  });
});

describe("changing a limit in a room", () => {
  it("allows two changes, then keeps the limit as it is", async () => {
    const { session, host } = readyWithInferred();
    session.intents = session.intents.filter((i) => i.tag === "spanish-lessons");
    session.calibration = { pairs: [], picks: {}, agreed: 0 };
    await (await call(host, "POST", "/api/agent/run", { anyway: true })).text();
    const room = session.run!.events.find((e) => e.type === "discover")!;
    const threadId = (room as { threadId: string }).threadId;
    // Each change streams to the end before the next.
    for (const limit of [16, 17]) {
      const response = await call(host, "POST", `/api/rooms/${threadId}/renegotiate`, { limit });
      expect(response.status).toBe(200);
      await response.text();
    }
    const third = await call(host, "POST", `/api/rooms/${threadId}/renegotiate`, { limit: 18 });
    expect(third.status).toBe(409);
  });
});

describe("people who aren't members", () => {
  it("keeps a deletion request without needing a session", async () => {
    const { receivedPrivacyRequests } = await import("./api");
    const host: Host = { actor: undefined, start: () => { throw new Error("no session"); } };
    const ok = await call(host, "POST", "/api/privacy/requests", { kind: "delete", about: "Someone's agent mentioned me in a running room last week." });
    expect(ok.status).toBe(202);
    expect(receivedPrivacyRequests().at(-1)).toMatchObject({ kind: "delete" });
    expect((await call(host, "POST", "/api/privacy/requests", { kind: "delete", about: "short" })).status).toBe(400);
  });

  it("won't note anything about someone else", async () => {
    const { runTool } = await import("./intake/tools");
    const session = createSession("Ana");
    const item = { id: "a", role: "agent" as const, text: "" };
    const refused = await runTool({ session, item, emit: () => {} }, "note_about_person", { fact: "My boss wants me to learn Spanish", evidence: "my boss wants me to" });
    expect(refused.isError).toBe(true);
    const kept = await runTool({ session, item, emit: () => {} }, "note_about_person", { fact: "Beginner in Spanish", evidence: "I'm a beginner" });
    expect(kept.isError).toBeFalsy();
  });
});

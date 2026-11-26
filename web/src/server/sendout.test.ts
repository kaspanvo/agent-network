import { describe, expect, it } from "vitest";
import { makeActor } from "./actor";
import { handleApi, type Host } from "./api";
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

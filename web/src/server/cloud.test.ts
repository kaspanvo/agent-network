import { describe, expect, it } from "vitest";
import { makeActor } from "./actor";
import { handleApi, type Host } from "./api";
import type { ProfileIntent } from "./domain";
import { checkInDue, decide } from "./followup";
import { demoIntakeAgent } from "./intake/demo";
import { localMarket, matchInMarket } from "./market";
import { modelFor, ROLES } from "./roles";
import { runAgent } from "./negotiation/run";
import { scriptedNarrator } from "./negotiation/narrator";
import type { AgentEvent } from "./negotiation/types";
import { createSession, type Session } from "./store";
import { makeReader, plainExtractor, readShared, refuseUrl, type PageSource } from "./tools/reader";

const spanish: ProfileIntent = {
  id: "s1",
  direction: "seek",
  tag: "spanish-lessons",
  summary: "Learn Spanish",
  price: 15,
  unit: "hour",
  conditions: ["evenings"],
  provenance: "stated",
  evidence: "",
  status: "confirmed",
  prefers: "solo",
};

function memoryHost(): Host & { saved: number } {
  const host = {
    saved: 0,
    actor: undefined as Host["actor"],
    start(name: string) {
      host.actor = makeActor(createSession(name), () => host.saved++);
      return host.actor;
    },
  };
  return host;
}

const at = (path: string, init?: RequestInit) => new Request(`http://localhost:3000${path}`, init);

describe("one API for Next.js and the Durable Object", () => {
  it("starts a session, sets the cookie and saves through the host", async () => {
    const host = memoryHost();
    const response = await handleApi(at("/api/session", { method: "POST", body: JSON.stringify({ name: "Ana" }) }), host);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`open_sid=${host.actor!.session.id}`);
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
    expect(host.saved).toBe(1);
    const body = await (await handleApi(at("/api/session"), host)).json();
    expect(body.session.name).toBe("Ana");
  });

  it("refuses changes sent from another site, and unknown routes", async () => {
    const host = memoryHost();
    const forged = await handleApi(at("/api/agent/run", { method: "POST", headers: { origin: "https://evil.example" } }), host);
    expect(forged.status).toBe(403);
    expect((await handleApi(at("/api/nope"), host)).status).toBe(404);
    expect((await handleApi(at("/api/session", { method: "PUT" }), host)).status).toBe(405);
  });
});

describe("the market", () => {
  it("never hands another member's limit to a person's agent", () => {
    const threads = matchInMarket([spanish]);
    expect(threads.length).toBeGreaterThan(0);
    for (const t of threads) expect(t).not.toHaveProperty("theirLimit");
  });

  it("is what a run matches through", async () => {
    const session = createSession("Ana");
    session.intents = [spanish];
    let asked = 0;
    const market = { match: async (intents: ProfileIntent[]) => (asked++, localMarket().match(intents)) };
    const events: AgentEvent[] = [];
    await runAgent(session, scriptedNarrator, (e) => events.push(e), market);
    expect(asked).toBe(1);
    expect(session.run!.opportunities.length).toBe(1);
  });
});

describe("check-ins on a schedule", () => {
  async function approved() {
    const session = createSession("Ana");
    session.intents = [spanish];
    await runAgent(session, scriptedNarrator, () => {});
    const id = session.run!.opportunities[0]!.id;
    const scheduled: { id: string; at: Date }[] = [];
    await decide(session, id, "approved", () => {}, (opportunityId, when) => scheduled.push({ id: opportunityId, at: when }));
    return { session, id, scheduled };
  }

  it("asks the host to wake the agent a week after a deal", async () => {
    const { id, scheduled, session } = await approved();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.id).toBe(id);
    const days = (scheduled[0]!.at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(session.followups[id]!.dueAt).toBe(scheduled[0]!.at.toISOString());
  });

  it("asks once when the alarm fires, even if it fires twice, and not after an answer", async () => {
    const { session, id } = await approved();
    expect(checkInDue(session, id)).toMatchObject({ type: "followup", stage: "check_in" });
    expect(checkInDue(session, id)).toBeNull();
    const other = await approved();
    other.session.followups[other.id] = { stage: "done", answer: "again" };
    expect(checkInDue(other.session, other.id)).toBeNull();
  });
});

describe("model assignment", () => {
  it("runs every role that speaks for people on the same model and effort", () => {
    const people = Object.values(ROLES).filter((r) => r.speaksForPeople);
    expect(new Set(people.map((r) => `${r.model}/${r.effort}`)).size).toBe(1);
  });

  it("asks for a refusal fallback only where the model has one", () => {
    expect(modelFor("narrator")).not.toHaveProperty("fallbacks");
    expect(modelFor("intake")).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });
});

describe("the page reader", () => {
  const page = (url: string, text = "Sony a6400, barely used. €550. Pick up in Lisbon."): PageSource => ({ fetch: async () => ({ url, title: "Sony a6400", text }) });

  it("reads only public https pages", () => {
    expect(refuseUrl("https://www.olx.pt/item/123")).toBeNull();
    for (const bad of ["http://example.com", "https://localhost/x", "https://10.0.0.1/", "https://[::1]/", "https://user:pw@example.com", "https://intranet/", "https://printer.local/", "https://example.com:8443/", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(refuseUrl(bad), bad).not.toBeNull();
    }
  });

  it("refuses a page that redirected somewhere private, and stops at the daily budget", async () => {
    await expect(makeReader(page("https://192.168.1.1/admin"), plainExtractor).read("https://short.example/abc", 0)).rejects.toThrow("redirected");
    await expect(makeReader(page("https://shop.example/a"), plainExtractor).read("https://shop.example/a", 8)).rejects.toThrow("daily limit");
  });

  it("reads only links the person shared, and keeps what it read as evidence", async () => {
    const session: Session = createSession("Ana");
    const reader = makeReader(page("https://shop.example/a"), plainExtractor);
    await expect(readShared(session, reader, "https://shop.example/a")).rejects.toThrow("Only read links");
    session.chat.push({ id: "u1", role: "user", text: "Is this a fair price? https://shop.example/a" });
    const facts = await readShared(session, reader, "https://shop.example/a");
    expect(facts).toMatchObject({ title: "Sony a6400", price: "€550" });
    expect(session.sources).toHaveLength(1);
  });

  it("lets the demo agent read a link the person pasted", async () => {
    const session = createSession("Ana");
    session.chat.push({ id: "a0", role: "agent", text: "Hi" });
    const text = "Would this camera be worth it? https://shop.example/a";
    session.chat.push({ id: "u1", role: "user", text });
    const events: { type: string }[] = [];
    await demoIntakeAgent(makeReader(page("https://shop.example/a"), plainExtractor)).respond(session, text, (e) => events.push(e), new AbortController().signal);
    expect(events.some((e) => e.type === "read")).toBe(true);
    expect(session.chat.at(-1)!.text).toContain("I only read it, logged out");
  });
});

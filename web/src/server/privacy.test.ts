import { describe, expect, it } from "vitest";
import { makeActor, record } from "./actor";
import { handleApi, type Host } from "./api";
import { isReady, saveIntent } from "./intake/profile";
import { runTool } from "./intake/tools";
import type { ChatItem } from "./intake/types";
import { expired, exportOf, forgetIntent, forgetNote, RETENTION_DAYS } from "./privacy";
import { sensitiveIn } from "./sensitive";
import { createSession, logIntact, type Session } from "./store";

const at = (path: string, init?: RequestInit) => new Request(`http://localhost:3000${path}`, init);

function hostWith(session: Session): Host & { erased: boolean } {
  const host = {
    erased: false,
    actor: makeActor(session, () => {}) as Host["actor"],
    start: () => {
      throw new Error("no");
    },
    erase: async () => {
      host.erased = true;
      host.actor = undefined;
    },
  };
  return host;
}

// A person who told their agent about Spanish lessons and a bike, in their own words.
function talked(): Session {
  const session = createSession("Ana");
  session.chat.push({ id: "u1", role: "user", text: "I want to learn Spanish with a tutor in the evenings" } as ChatItem);
  session.chat.push({ id: "a1", role: "agent", text: "Got it: learn Spanish with a tutor." } as ChatItem);
  session.history.push({ role: "user", content: "I want to learn Spanish with a tutor in the evenings" });
  session.openHistory = [{ role: "user", content: "I want to learn Spanish with a tutor in the evenings" }];
  saveIntent(session, { direction: "seek", summary: "Learn Spanish with a tutor", tag: "spanish", provenance: "stated", evidence: "I want to learn Spanish with a tutor", price: 15, unit: "hour" });
  saveIntent(session, { direction: "offer", summary: "Sell my road bike", tag: "bike", provenance: "stated", evidence: "selling my road bike", price: 200, unit: "one-off" });
  const actor = makeActor(session, () => {});
  record(actor, { kind: "shared", by: "agent", text: "Shared: Looking for: learn Spanish with a tutor, evenings." });
  record(actor, { kind: "shared", by: "agent", text: "Shared: Offers: sell my road bike." });
  return session;
}

describe("start over deletes, it doesn't just forget the cookie", () => {
  it("erases the agent through the host and clears the cookie", async () => {
    const host = hostWith(talked());
    const response = await handleApi(at("/api/session", { method: "DELETE" }), host);
    expect(response.status).toBe(200);
    expect(host.erased).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("deletes an agent left unused past the keep-until date", () => {
    const session = createSession("Ana");
    expect(expired(session)).toBe(false);
    session.lastSeenAt = new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(expired(session)).toBe(true);
  });

  it("refreshes the cookie on each visit, for as long as the agent is kept", async () => {
    const response = await handleApi(at("/api/session"), hostWith(talked()));
    expect(response.headers.get("set-cookie")).toContain(`Max-Age=${RETENTION_DAYS * 24 * 60 * 60}`);
  });
});

describe("a copy of everything", () => {
  it("exports all the agent holds, except its private signing key", async () => {
    const session = talked();
    session.agentKey = { id: "k1", publicJwk: { kty: "OKP", x: "pub" }, privateJwk: { kty: "OKP", x: "pub", d: "secret" } };
    const response = await handleApi(at("/api/session/export"), hostWith(session));
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const text = await response.text();
    expect(text).toContain("Learn Spanish with a tutor");
    expect(text).toContain('"price": 15');
    expect(text).not.toContain("secret");
    expect(exportOf(session).keptUntil).toBeTruthy();
  });
});

describe("forget means every copy", () => {
  it("removes the intent, the person's words, the model's memory and log lines, and keeps the log checkable", () => {
    const session = talked();
    const id = session.intents.find((i) => i.tag === "spanish")!.id;
    expect(forgetIntent(session, id)).toBe(true);
    const everything = JSON.stringify(session);
    expect(everything).not.toMatch(/spanish with a tutor/i);
    expect(session.history).toEqual([]);
    expect(session.openHistory).toEqual([]);
    expect(session.chat[0]!.text).toBe("[You asked your agent to forget this]");
    expect(logIntact(session.log)).toBe(true);
    expect(session.log.at(-1)!.text).toMatch(/forget/);
    // What's left is untouched, and the agent is told only that.
    expect(everything).toContain("Sell my road bike");
    expect(session.pendingNotes[0]).toContain("Sell my road bike");
  });

  it("deletes a note the same way", () => {
    const session = talked();
    session.about = [{ id: "n1", fact: "Beginner in Spanish", evidence: "I'm a total beginner", at: new Date().toISOString() }];
    session.chat.push({ id: "u2", role: "user", text: "I'm a total beginner" } as ChatItem);
    expect(forgetNote(session, "n1")).toBe(true);
    expect(JSON.stringify(session)).not.toMatch(/total beginner|Beginner in Spanish/);
  });

  it("works through the API", async () => {
    const session = talked();
    const id = session.intents[0]!.id;
    const response = await handleApi(at(`/api/intents/${id}`, { method: "DELETE" }), hostWith(session));
    expect(response.status).toBe(200);
    expect((await response.json()).intents).toHaveLength(1);
  });
});

describe("sensitive things wait for an explicit yes", () => {
  it("spots special categories in everyday words, without flagging ordinary ones", () => {
    expect(sensitiveIn("Sober socials on Fridays")).toBe("health");
    expect(sensitiveIn("Join the Pride run")).toBe("sexuality");
    expect(sensitiveIn("Friday prayers group")).toBe("religion");
    expect(sensitiveIn("Learn Spanish in the evenings")).toBeNull();
    expect(sensitiveIn("Half marathon race training")).toBeNull();
    expect(sensitiveIn("Cooking demonstration")).toBeNull();
  });

  it("keeps a sensitive intent out of everything that goes out until the person agrees, and lets them take it back", async () => {
    const session = createSession("Ana");
    const intent = saveIntent(session, { kind: "interest", direction: "seek", summary: "Sober socials", tag: "socials", provenance: "stated", evidence: "I don't drink, sober socials please" });
    expect(intent.sensitive).toBe("health");
    expect(isReady(session)).toBe(false);
    const host = hostWith(session);
    const yes = await handleApi(at(`/api/intents/${intent.id}/consent`, { method: "PUT" }), host);
    expect(yes.status).toBe(200);
    expect(isReady(session)).toBe(true);
    expect(session.log.at(-1)!.text).toContain("your health");
    await handleApi(at(`/api/intents/${intent.id}/consent`, { method: "DELETE" }), host);
    expect(isReady(session)).toBe(false);
  });

  it("never keeps a sensitive note, whatever the model asks", async () => {
    const session = createSession("Ana");
    const item = { id: "a", role: "agent", text: "" } as ChatItem;
    const result = await runTool({ session, item, emit: () => {} } as never, "note_about_person", { fact: "In recovery, avoids bars", evidence: "I'm in recovery" });
    expect(JSON.stringify(result)).toContain("sensitive");
    expect(session.about ?? []).toHaveLength(0);
  });
});

describe("Open is for adults", () => {
  it("won't make an agent without the 18+ declaration", async () => {
    const host = { actor: undefined, start: () => makeActor(createSession("Ana"), () => {}) } as Host;
    const response = await handleApi(at("/api/session", { method: "POST", body: JSON.stringify({ name: "Ana" }) }), host);
    expect(response.status).toBe(400);
  });
});

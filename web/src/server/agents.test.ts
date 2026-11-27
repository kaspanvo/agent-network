import { describe, expect, it } from "vitest";
import { makeActor } from "./actor";
import { handleApi, type Host } from "./api";
import type { ProfileIntent } from "./domain";
import { decide } from "./followup";
import { agentKey, checkMessage, scopeFor } from "./identity";
import { lookAgain, lookDue, startLooking } from "./lookagain";
import { localMarket } from "./market";
import { scriptedNarrator } from "./negotiation/narrator";
import { runAgent } from "./negotiation/run";
import type { AgentEvent } from "./negotiation/types";
import { answer, contactMessage, receive, reachOf } from "./reach";
import { oneAgentEach, type Responder, type RoomContext } from "./rooms/reply";
import { closeSettled, deleteOldRooms, ROOM_KEEP_DAYS } from "./rooms/settle";
import { createSession, type Session } from "./store";

const spanish: ProfileIntent = { id: "s1", direction: "seek", tag: "spanish-lessons", summary: "Learn Spanish", price: 15, unit: "hour", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed", prefers: "solo" };
const DAY = 24 * 60 * 60 * 1000;
type Message = Extract<AgentEvent, { type: "message" }>;

async function outWith(name = "Ana", intents: ProfileIntent[] = [{ ...spanish }]): Promise<Session> {
  const session = createSession(name);
  session.intents = intents;
  session.recapConfirmed = true;
  await runAgent(session, scriptedNarrator, () => {});
  return session;
}
const hostFor = (session: Session): Host => ({ actor: makeActor(session, () => {}), start: () => makeActor(session, () => {}) });
const at = (path: string, init?: RequestInit) => new Request(`http://localhost:3000${path}`, init);

describe("rooms close when settled", () => {
  it("closes a declined room, refuses messages there, and deletes it after the keep period", async () => {
    const session = await outWith();
    const offer = session.run!.opportunities[0]!;
    await decide(session, offer.id, "declined", () => {});
    expect(closeSettled(session).map((c) => c.threadId)).toEqual([offer.threadId]);
    const reply = await handleApi(at(`/api/rooms/${offer.threadId}/messages`, { method: "POST", body: JSON.stringify({ text: "Still there?" }) }), hostFor(session));
    expect(reply.status).toBe(409);
    expect(deleteOldRooms(session, new Date(Date.now() + (ROOM_KEEP_DAYS - 1) * DAY))).toBe(0);
    expect(deleteOldRooms(session, new Date(Date.now() + (ROOM_KEEP_DAYS + 1) * DAY))).toBe(1);
    expect(session.run!.events.some((e) => "threadId" in e && e.threadId === offer.threadId)).toBe(false);
  });

  it("leaves a room open while it's still waiting on someone", async () => {
    const session = await outWith();
    expect(closeSettled(session)).toEqual([]);
  });
});

describe("signatures that can't be replayed", () => {
  it("names the permission, recipients and a rising counter, and a receiver refuses replays, other rooms and other topics", async () => {
    const session = await outWith();
    const mine = session.run!.events.filter((e): e is Message => e.type === "message" && e.from === "you");
    expect(mine.length).toBeGreaterThan(0);
    const key = session.agentKey!;
    const delegations = session.delegations!;
    expect(delegations.at(-1)!.tags).toEqual(["spanish-lessons"]);
    let last = 0;
    for (const m of mine) {
      expect(m.envelope!.to.length).toBeGreaterThan(0);
      expect(await checkMessage(key, m, { delegations, tag: "spanish-lessons", lastSeq: last })).toBeNull();
      last = m.envelope!.seq;
    }
    const first = mine[0]!;
    expect(await checkMessage(key, first, { delegations, lastSeq: last })).toMatch(/replayed/);
    expect(await checkMessage(key, { ...first, threadId: "elsewhere" }, { delegations })).toMatch(/signature/);
    expect(await checkMessage(key, first, { delegations, tag: "used-camera" })).toMatch(/didn't allow/);
    expect(await checkMessage(key, first, { delegations, me: "Someone Else" })).toMatch(/someone else/);
    expect(await checkMessage(key, first, { delegations, now: new Date(Date.now() + DAY) })).toMatch(/too old/);
  });

  it("issues a new permission when what the person confirmed changes", async () => {
    const session = await outWith();
    const before = await scopeFor(session);
    session.intents.push({ ...spanish, id: "g1", tag: "guitar-lessons", summary: "Learn the guitar" });
    expect(await scopeFor(session)).not.toBe(before);
    expect(session.delegations!.at(-1)!.tags).toEqual(["guitar-lessons", "spanish-lessons"]);
  });
});

describe("who can reach your agent", () => {
  it("asks about strangers, delivers once approved, refuses replays, and blocks", async () => {
    const ana = await outWith("Ana");
    const ivo = await outWith("Ivo");
    const target = (await agentKey(ana)).id;
    const first = await contactMessage(ivo, target, "Hi, want to practise Spanish together? Call me on 912 345 678");
    expect(await receive(ana, first)).toEqual({ status: "asked" });
    // Contact details are taken out before the person sees it.
    expect(reachOf(ana).requests[0]!.text).not.toContain("912");
    // The same message again is a replay.
    expect((await receive(ana, first)).why).toMatch(/replayed/);
    // Approve, and the next message is delivered.
    answer(ana, reachOf(ana).requests[0]!.id, "approve");
    expect((await receive(ana, await contactMessage(ivo, target, "Great, thanks"))).status).toBe("delivered");
    // A message meant for another agent is refused.
    expect((await receive(ana, await contactMessage(ivo, "someone-else", "Hello"))).why).toMatch(/someone else/);
  });

  it("turns strangers away without asking when set to matched only, and stays silent to the blocked", async () => {
    const ana = await outWith("Ana");
    const kai = await outWith("Kai");
    const target = (await agentKey(ana)).id;
    reachOf(ana).policy = "matched";
    expect((await receive(ana, await contactMessage(kai, target, "Hello"))).status).toBe("refused");
    reachOf(ana).policy = "ask";
    await receive(ana, await contactMessage(kai, target, "Hello again"));
    answer(ana, reachOf(ana).requests.find((r) => r.status === "pending")!.id, "block");
    expect(await receive(ana, await contactMessage(kai, target, "Please?"))).toEqual({ status: "refused", why: "blocked" });
  });
});

describe("keep looking", () => {
  it("brings back only new fits, and a proposal only for an intent without a live one", async () => {
    const session = await outWith();
    startLooking(session, 7);
    expect(lookDue(session)).toBe(false);
    session.keepLooking!.next = new Date(Date.now() - 1000).toISOString();
    expect(lookDue(session)).toBe(true);
    // Nothing changed: nothing new.
    expect(await lookAgain(session, scriptedNarrator, localMarket(), () => {})).toEqual({ fresh: 0, proposed: 0 });
    // Something new to look for: new rooms, and a proposal for it.
    session.intents.push({ ...spanish, id: "g1", tag: "guitar-lessons", summary: "Learn the guitar", price: 25 });
    session.keepLooking!.next = new Date(Date.now() - 1000).toISOString();
    const result = await lookAgain(session, scriptedNarrator, localMarket(), () => {});
    expect(result.fresh).toBeGreaterThan(0);
    expect(result.proposed).toBe(1);
    expect(session.run!.opportunities.some((o) => o.intentId === "g1")).toBe(true);
    // Looked again, nothing repeats.
    session.keepLooking!.next = new Date(Date.now() - 1000).toISOString();
    expect((await lookAgain(session, scriptedNarrator, localMarket(), () => {})).fresh).toBe(0);
  });

  it("is set and stopped through the API, only after a first run", async () => {
    const fresh = createSession("Ana");
    expect((await handleApi(at("/api/agent/keep-looking", { method: "PUT", body: JSON.stringify({ days: 7 }) }), hostFor(fresh))).status).toBe(409);
    const session = await outWith();
    const jobs: unknown[] = [];
    const host = { ...hostFor(session), wake: (job: unknown) => jobs.push(job) };
    expect((await handleApi(at("/api/agent/keep-looking", { method: "PUT", body: JSON.stringify({ days: 7 }) }), host)).status).toBe(200);
    expect(jobs).toEqual([{ kind: "look" }]);
    await handleApi(at("/api/agent/keep-looking", { method: "PUT", body: JSON.stringify({ days: 0 }) }), host);
    expect(session.keepLooking).toBeUndefined();
  });
});

describe("each member's agent is briefed on its own", () => {
  it("gives every model call only one member's facts", async () => {
    const seen: string[][] = [];
    const inner: Responder = {
      async reply(room: RoomContext) {
        seen.push(room.members.flatMap((m) => m.facts));
        return room.members.map((m) => ({ name: m.name, move: "ANSWER" as const, text: `${m.name} says hi`, why: "" }));
      },
    };
    const room: RoomContext = {
      you: "Ana",
      topic: "Live music",
      mode: "circle",
      recent: [],
      members: [
        { name: "Lena", facts: ["Lena goes to a jazz jam"], happenings: [] },
        { name: "Rita", facts: ["Rita plays fado"], happenings: [] },
      ],
    };
    const replies = await oneAgentEach(inner).reply(room, "Anyone around Thursday?");
    expect(seen).toEqual([["Lena goes to a jazz jam"], ["Rita plays fado"]]);
    expect(replies.map((r) => r.name)).toEqual(["Lena", "Rita"]);
  });
});

describe("proposals say what's still to settle", () => {
  it("lists what's left for the people to agree, and repeats it when they're introduced", async () => {
    const session = await outWith();
    const offer = session.run!.opportunities[0]!;
    expect(offer.open).toEqual(expect.arrayContaining(["How to pay, between you", "Where the sessions happen"]));
    await decide(session, offer.id, "approved", () => {});
    const intro = session.run!.events.find((e) => e.type === "followup" && e.stage === "introduced");
    expect(intro && "text" in intro ? intro.text : "").toContain("Still to settle between you");
  });
});

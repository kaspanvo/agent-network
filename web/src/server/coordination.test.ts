import { describe, expect, it } from "vitest";
import { makeActor, observe } from "./actor";
import { handleApi, type Host } from "./api";
import { checksFor } from "./audit";
import { disclosuresFor } from "./disclosure";
import type { ProfileIntent } from "./domain";
import { checkInDue, decide } from "./followup";
import { extendHold, HOLD_HOURS, lapse, scheduleHolds, sweepHolds, type Wake } from "./holds";
import { intentBasis } from "./intake/profile";
import { scriptedNarrator } from "./negotiation/narrator";
import { runAgent } from "./negotiation/run";
import { everyoneSaidYes, yesStillStands } from "./negotiation/terms";
import { createSession, entryHash, logIntact, type LogEntry, type Session } from "./store";

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

const HOUR = 3_600_000;

async function proposed(): Promise<{ session: Session; id: string }> {
  const session = createSession("Ana");
  session.intents = [{ ...spanish }];
  await runAgent(session, scriptedNarrator, () => {});
  return { session, id: session.run!.opportunities[0]!.id };
}

function hostFor(session: Session): Host {
  return { actor: makeActor(session, () => {}), start: () => makeActor(session, () => {}) };
}

const post = (path: string, body: unknown) => new Request(`http://localhost:3000${path}`, { method: "POST", body: JSON.stringify(body) });

describe("holds: a proposal keeps everyone's place for a while, then lapses", () => {
  it("holds a new proposal for two days", async () => {
    const { session } = await proposed();
    const hours = (Date.parse(session.run!.opportunities[0]!.holdUntil!) - Date.now()) / HOUR;
    expect(hours).toBeGreaterThan(HOLD_HOURS - 0.1);
    expect(hours).toBeLessThanOrEqual(HOLD_HOURS);
  });

  it("asks the host to wake the agent when each open hold runs out", async () => {
    const { session, id } = await proposed();
    const jobs: { job: Wake; at: Date }[] = [];
    scheduleHolds(session, (job, at) => jobs.push({ job, at }));
    expect(jobs).toEqual([{ job: { kind: "hold", opportunityId: id }, at: new Date(session.run!.opportunities[0]!.holdUntil!) }]);
  });

  it("lapses only once the hold is over, only once, and then refuses a yes", async () => {
    const { session, id } = await proposed();
    expect(lapse(session, id)).toBeNull();
    const later = new Date(Date.now() + (HOLD_HOURS + 1) * HOUR);
    expect(lapse(session, id, later)).toMatchObject({ type: "hold", stage: "lapsed" });
    expect(lapse(session, id, later)).toBeNull();
    expect(session.decisions[id]).toBe("lapsed");
    await expect(decide(session, id, "approved", () => {})).rejects.toThrow("lapsed");
  });

  it("never lapses something the person already answered", async () => {
    const { session, id } = await proposed();
    await decide(session, id, "declined", () => {});
    expect(sweepHolds(session, new Date(Date.now() + 100 * HOUR))).toEqual([]);
    expect(session.decisions[id]).toBe("declined");
  });

  it("can be extended a day, once", async () => {
    const { session, id } = await proposed();
    const before = Date.parse(session.run!.opportunities[0]!.holdUntil!);
    const woken: Wake[] = [];
    expect(extendHold(session, id, (job) => woken.push(job))).toMatchObject({ type: "hold", stage: "extended" });
    expect(Date.parse(session.run!.opportunities[0]!.holdUntil!) - before).toBe(24 * HOUR);
    expect(woken).toEqual([{ kind: "hold", opportunityId: id }]);
    expect(() => extendHold(session, id)).toThrow("once");
  });

  it("is swept on the next visit even if no alarm fired, and the log says Open did it", async () => {
    const { session, id } = await proposed();
    session.run!.opportunities[0]!.holdUntil = new Date(Date.now() - HOUR).toISOString();
    const host = hostFor(session);
    const body = await (await handleApi(new Request("http://localhost:3000/api/session"), host)).json();
    expect(body.session.decisions[id]).toBe("lapsed");
    expect(session.log.at(-1)).toMatchObject({ kind: "hold", by: "open" });
    expect(checksFor(session, session.run!.opportunities[0]!.threadId).find((c) => c.label === "Nobody kept waiting")?.ok).toBe(true);
  });
});

describe("approvals: fenced to a version, and introductions wait for everyone", () => {
  it("refuses an answer to a version the person wasn't shown", async () => {
    const { session, id } = await proposed();
    const response = await handleApi(post(`/api/opportunities/${id}`, { decision: "approved", version: 2 }), hostFor(session));
    expect(response.status).toBe(409);
    expect(session.decisions[id]).toBeUndefined();
  });

  it("records who said yes, introduces only after everyone has, and fingerprints the yes", async () => {
    const { session, id } = await proposed();
    const response = await handleApi(post(`/api/opportunities/${id}`, { decision: "approved", version: 1 }), hostFor(session));
    await response.text();
    const o = session.run!.opportunities[0]!;
    expect(everyoneSaidYes(o)).toBe(true);
    expect(Object.keys(o.approvals!)).toEqual(expect.arrayContaining(o.people));
    expect(session.followups[id]?.stage).toBe("introduced");
    const checks = checksFor(session, o.threadId);
    expect(checks.find((c) => c.label === "Everyone said yes for themself")?.ok).toBe(true);
    expect(checks.find((c) => c.label === "Your yes covers these exact terms")?.ok).toBe(true);
  });

  it("doesn't let changed terms ride on an earlier yes, and the check-in re-checks that", async () => {
    const { session, id } = await proposed();
    await decide(session, id, "approved", () => {});
    const o = session.run!.opportunities[0]!;
    o.price = 99;
    expect(yesStillStands(o)).toBe(false);
    expect(checksFor(session, o.threadId).find((c) => c.label === "Your yes covers these exact terms")?.ok).toBe(false);
    expect(checkInDue(session, id)).toBeNull();
  });

  it("asks for more time through the API, and the log names the person as the one who asked", async () => {
    const { session, id } = await proposed();
    const host = hostFor(session);
    const text = await (await handleApi(post(`/api/opportunities/${id}/hold`, {}), host)).text();
    expect(text).toContain('"stage":"extended"');
    expect(session.log.at(-1)).toMatchObject({ kind: "hold", by: "you" });
  });
});

describe("the privacy check after a yes", () => {
  it("doesn't call it a leak when the matcher set the price exactly at the limit and the agent repeats it", async () => {
    const { session, id } = await proposed();
    const o = session.run!.opportunities[0]!;
    // Make the limit exactly the matched price, as when sealed offers meet right at it.
    const intent = session.intents[0]!;
    intent.price = o.price;
    o.basis = intentBasis(intent);
    await decide(session, id, "approved", () => {});
    expect(session.run!.events.some((e) => e.type === "message" && e.from === "you" && e.text.includes(String(o.price)))).toBe(true);
    expect(checksFor(session, o.threadId).find((c) => c.label === "Your limit stayed private")?.ok).toBe(true);
  });
});

describe("the activity log names who acted", () => {
  it("marks the agent, the person and Open's matcher, and stays tamper-evident", async () => {
    const { session, id } = await proposed();
    const host = hostFor(session);
    // The API logs a run as it streams; here the run happened directly, so log it the same way.
    for (const event of session.run!.events) observe(host.actor!, event);
    await (await handleApi(post(`/api/opportunities/${id}`, { decision: "approved" }), host)).text();
    expect([...new Set(session.log.map((e) => e.by))].sort()).toEqual(["agent", "open", "you"]);
    expect(session.log.some((e) => e.kind === "decision" && e.by === "you")).toBe(true);
    expect(logIntact(session.log)).toBe(true);
  });

  it("still checks out entries written before actors were recorded", () => {
    const old: LogEntry = { at: "2026-11-20T10:00:00.000Z", kind: "setup", text: "Saved “Learn Spanish”" };
    const next: LogEntry = { at: "2026-11-20T10:01:00.000Z", kind: "found", text: "Found someone", by: "agent" };
    old.hash = entryHash("", old);
    next.hash = entryHash(old.hash, next);
    expect(logIntact([old, next])).toBe(true);
    expect(logIntact([old, { ...next, by: "you" }])).toBe(false);
  });
});

describe("who sees what in a room", () => {
  it("keeps the limit with the matcher, shares the first name, and holds the introduction until everyone says yes", async () => {
    const { session, id } = await proposed();
    const threadId = session.run!.opportunities[0]!.threadId;
    const before = disclosuresFor(session, threadId);
    expect(before.find((d) => d.what === "Your first name")?.status).toBe("shared");
    expect(before.find((d) => d.what.startsWith("Your limit"))).toMatchObject({ status: "private", to: "Open's matcher only" });
    expect(before.find((d) => d.what === "You, as someone to meet")?.status).toBe("on_yes");
    expect(before.find((d) => d.what === "Your contact details")?.status).toBe("private");
    // Nothing marked as shared ever carries the person's limit.
    for (const d of before.filter((x) => x.status === "shared")) expect(d.what).not.toContain("15");

    await decide(session, id, "approved", () => {});
    const after = disclosuresFor(session, threadId);
    expect(after.find((d) => d.what === "You, as someone to meet")?.status).toBe("shared");
    expect(after.find((d) => d.what === "That you said yes")?.status).toBe("shared");
  });
});

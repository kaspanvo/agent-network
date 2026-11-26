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

describe("private reliability", () => {
  it("stops offering a member only once two different people said a match didn't happen", async () => {
    const { localMarket, addStrikes, strikeCounts } = await import("./market");
    const { planThreads } = await import("./negotiation/plan");
    const { LISBON_PILOT } = await import("./population");
    const intent = { ...spanish, price: 30 };
    const offered = (strikes: Parameters<typeof strikeCounts>[0]) => planThreads([intent], LISBON_PILOT, strikeCounts(strikes)).map((t) => t.counterpart.memberId);
    expect(offered({})).toContain("lucia");
    // One person, however often they report, can't pause anyone.
    const liar = addStrikes(addStrikes(addStrikes({}, ["lucia"], "missed", "a"), ["lucia"], "missed", "a"), ["lucia"], "missed", "a");
    expect(offered(liar)).toContain("lucia");
    // A second, different person makes it two.
    const two = addStrikes(liar, ["lucia"], "missed", "b");
    expect(offered(two)).not.toContain("lucia");
    // A later "it happened" from the same person takes their report back.
    expect(offered(addStrikes(two, ["lucia"], "again", "b"))).toContain("lucia");
    // Counts kept the old way couldn't tell one reporter from many: they're dropped.
    expect(offered({ lucia: 5 })).toContain("lucia");
    const market = localMarket();
    await market.report!(["lucia"], "missed", "a");
    expect(typeof market.match).toBe("function");
  });
});

describe("a standing yes", () => {
  it("covers a proposal only inside its bounds, in date, and for the intent as it was", async () => {
    const { makeMandate, covers } = await import("./mandate");
    const { session, id } = await proposed();
    const intent = session.intents[0]!;
    const o = session.run!.opportunities.find((x) => x.id === id)!;
    expect(makeMandate(intent, intent.price! + 5, 7)).toMatch(/can't go past your own limit/);
    const mandate = makeMandate(intent, o.price!, 7);
    if (typeof mandate === "string") throw new Error(mandate);
    intent.mandate = mandate;
    expect(covers(intent, o)).toBe(true);
    // A higher price, an expired yes, or a changed intent: not covered.
    expect(covers(intent, { ...o, price: o.price! + 1 })).toBe(false);
    expect(covers(intent, o, new Date(Date.now() + 8 * 86_400_000))).toBe(false);
    intent.conditions = ["mornings"];
    expect(covers(intent, o)).toBe(false);
  });

  it("lets the agent say yes for the person after a run, logs it as the agent's act, and leaves the rest waiting", async () => {
    const session = createSession("Ana");
    session.intents = [{ ...spanish, price: 20 }];
    session.recapConfirmed = true;
    session.ready = true;
    session.calibration = { pairs: [], picks: {}, agreed: 0 };
    const host = hostFor(session);
    await (await handleApi(new Request("http://localhost:3000/api/intents/s1/mandate", { method: "PUT", body: JSON.stringify({ price: 20, days: 7 }) }), host)).json();
    expect(session.intents[0]!.mandate?.price).toBe(20);
    await (await handleApi(post("/api/agent/run", { anyway: true }), host)).text();
    const auto = session.run!.opportunities.filter((o) => o.approvedUnder);
    expect(auto.length).toBeGreaterThan(0);
    for (const o of auto) expect(session.decisions[o.id]).toBe("approved");
    expect(session.log.some((e) => e.by === "agent" && e.text.startsWith("Said yes for you"))).toBe(true);
    expect(checksFor(session, auto[0]!.threadId).find((c) => c.label === "Within your standing yes")?.ok).toBe(true);
  });
});

describe("a few decisions at a time", () => {
  it("shows at most three proposals, and the next one when the person answers", async () => {
    const { MAX_PROPOSALS } = await import("./negotiation/run");
    const session = createSession("Ana");
    const base = { provenance: "stated" as const, evidence: "", status: "confirmed" as const, conditions: [] as string[] };
    session.intents = [
      { ...spanish, price: 40, conditions: [] },
      { ...base, id: "b1", kind: "deal", direction: "offer", tag: "road-bike", summary: "Sell my road bike", price: 10, unit: "one-off" },
      { ...base, id: "c1", kind: "deal", direction: "offer", tag: "used-camera", summary: "Sell my camera", price: 10, unit: "one-off" },
      { ...base, id: "d1", kind: "deal", direction: "seek", tag: "dog-sitting", summary: "Find a dog-sitter", price: 900, unit: "one-off" },
      { ...base, id: "j1", kind: "interest", direction: "seek", tag: "live-music", summary: "Live music, mostly jazz", price: null, unit: "one-off" },
    ];
    session.recapConfirmed = true;
    session.ready = true;
    session.calibration = { pairs: [], picks: {}, agreed: 0 };
    const host = hostFor(session);
    await (await handleApi(post("/api/agent/run", { anyway: true }), host)).text();
    const run = session.run!;
    expect(run.opportunities.length).toBeLessThanOrEqual(MAX_PROPOSALS);
    expect(run.queued?.length ?? 0).toBeGreaterThan(0);
    const before = run.opportunities.length;
    const first = run.opportunities[0]!;
    await (await handleApi(post(`/api/opportunities/${first.id}`, { decision: "declined" }), host)).text();
    expect(run.opportunities.length).toBe(before + 1);
    expect(run.opportunities.filter((o) => !session.decisions[o.id]).length).toBeLessThanOrEqual(MAX_PROPOSALS);
  });
});

describe("signed messages", () => {
  it("signs what the person's agent says, so it can be checked as unchanged, and never shares the private key", async () => {
    const { verify } = await import("./identity");
    const { publicSession } = await import("./store");
    const { session } = await proposed();
    const key = session.agentKey!;
    const ours = session.run!.events.filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message" && e.from === "you");
    expect(ours.length).toBeGreaterThan(0);
    for (const m of ours) expect(await verify(key, m.threadId, m.text, m.signature!)).toBe(true);
    // Changed words, or another room, no longer verify.
    const m = ours[0]!;
    expect(await verify(key, m.threadId, `${m.text}!`, m.signature!)).toBe(false);
    expect(await verify(key, "another-room", m.text, m.signature!)).toBe(false);
    const shown = JSON.stringify(publicSession(session));
    expect(shown).toContain(key.id);
    expect(shown).not.toContain(String(key.privateJwk.d));
  });
});

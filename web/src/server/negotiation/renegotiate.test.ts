import { describe, expect, it } from "vitest";
import type { ProfileIntent } from "../domain";
import { createSession } from "../store";
import { scriptedNarrator } from "./narrator";
import { renegotiate } from "./renegotiate";
import { runAgent } from "./run";
import type { AgentEvent } from "./types";

const spanish: ProfileIntent = { id: "s1", direction: "seek", tag: "spanish-lessons", summary: "Learn Spanish", price: 15, unit: "hour", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed" };

async function withRun() {
  const session = createSession("Sam");
  // Asking for a group makes the agent pick Diego's group room every time.
  session.intents = [{ ...spanish, prefers: "group" }];
  await runAgent(session, scriptedNarrator, () => {});
  return session;
}

describe("renegotiate", () => {
  it("reopens the room at the new limit and issues the next version, clearing the old approval", async () => {
    const session = await withRun();
    const v1 = session.run!.opportunities.find((o) => o.threadId === "s1-diego-spanish")!;
    session.decisions[v1.id] = "approved";

    const events: AgentEvent[] = [];
    await renegotiate(session, "s1-diego-spanish", 13, scriptedNarrator, (e) => events.push(e));

    expect(events[0]).toMatchObject({ type: "note", threadId: "s1-diego-spanish" });
    const v2 = session.run!.opportunities.find((o) => o.threadId === "s1-diego-spanish")!;
    expect(v2.version).toBe(2);
    expect(v2.price).toBeLessThanOrEqual(13);
    expect(session.decisions[v1.id]).toBeUndefined();
    expect(session.intents[0]!.price).toBe(13);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("keeps the previous version when the new limit leaves no deal", async () => {
    const session = await withRun();
    const events: AgentEvent[] = [];
    await renegotiate(session, "s1-diego-spanish", 8, scriptedNarrator, (e) => events.push(e));
    const outcome = events.find((e) => e.type === "outcome");
    expect(outcome).toMatchObject({ result: "no_fit" });
    expect(outcome && "why" in outcome ? outcome.why : "").toContain("Version 1 still stands");
    expect(session.run!.opportunities.find((o) => o.threadId === "s1-diego-spanish")!.version).toBe(1);
  });

  it("refuses rooms that don't exist", async () => {
    const session = await withRun();
    await expect(renegotiate(session, "nope", 13, scriptedNarrator, () => {})).rejects.toThrow("no longer exists");
  });
});

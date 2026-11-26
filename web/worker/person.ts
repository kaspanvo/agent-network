import { Agent } from "agents";
import { makeActor, observe, persist, broadcast, type Actor } from "../src/server/actor";
import { handleApi } from "../src/server/api";
import { checkInDue } from "../src/server/followup";
import type { Market } from "../src/server/market";
import { agentModels } from "../src/server/models";
import { createSession, upgradeSession, type Session } from "../src/server/store";
import { browserRunSource } from "./browser";

// The community whose market this agent matches in.
const COMMUNITY = "lisbon-pilot";

// What's kept, split so no single row gets near SQLite's 2 MB limit: the model history and the run grow; the rest stays small.
type Part = "core" | "history" | "run";

// One person's agent, as a Durable Object built on Cloudflare's Agents SDK. Everything private to the person
// (their limits, their conversation, their run, their log) lives in this object's own SQLite storage and
// nowhere else. Requests for the same person always reach this one object, one at a time, so a decision made
// while a run streams can't be lost. When idle it hibernates; the next request wakes it from storage.
export class PersonAgent extends Agent<Env> {
  private actor: Actor | undefined;

  async onStart() {
    void this.sql`CREATE TABLE IF NOT EXISTS session_parts (part TEXT PRIMARY KEY, value TEXT NOT NULL)`;
    const rows = this.sql<{ part: Part; value: string }>`SELECT part, value FROM session_parts`;
    if (rows.length === 0) return;
    const parts = Object.fromEntries(rows.map((r) => [r.part, JSON.parse(r.value)])) as Record<Part, unknown>;
    const session = { ...(parts.core as Session), history: (parts.history ?? []) as Session["history"], run: (parts.run ?? null) as Session["run"] };
    this.actor = makeActor(upgradeSession(session), (s) => this.save(s));
  }

  private save(session: Session) {
    const { history, run, ...core } = session;
    const parts: [Part, unknown][] = [["core", core], ["history", history], ["run", run]];
    for (const [part, value] of parts) void this.sql`INSERT OR REPLACE INTO session_parts (part, value) VALUES (${part}, ${JSON.stringify(value)})`;
  }

  private market(): Market {
    const stub = this.env.MARKET.getByName(COMMUNITY);
    return { match: (intents) => stub.match(intents) };
  }

  async onRequest(request: Request): Promise<Response> {
    if (this.actor) this.actor.lastUsed = Date.now();
    return handleApi(request, {
      actor: this.actor,
      start: (name) => {
        // A fresh object for a fresh person: the Worker routes every new session to a new id.
        if (this.actor) throw new Error("This agent already belongs to someone.");
        this.actor = makeActor(createSession(name, this.name), (s) => this.save(s));
        return this.actor;
      },
      market: this.market(),
      agents: agentModels(browserRunSource(this.env.BROWSER)),
      // A Durable Object alarm wakes this agent when it's time to ask how it went, even if nobody has the page open.
      scheduleCheckIn: (opportunityId, at) => {
        void this.schedule(at, "checkInDue", { opportunityId });
      },
    });
  }

  async checkInDue({ opportunityId }: { opportunityId: string }) {
    const actor = this.actor;
    if (!actor) return;
    const event = checkInDue(actor.session, opportunityId);
    if (!event) return;
    observe(actor, event);
    broadcast(actor, event);
    persist(actor);
  }
}

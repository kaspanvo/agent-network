import { Agent } from "agents";
import { makeActor, observe, persist, broadcast, type Actor } from "../src/server/actor";
import { handleApi } from "../src/server/api";
import { checkInDue } from "../src/server/followup";
import { lapse, type Wake } from "../src/server/holds";
import type { Market } from "../src/server/market";
import { agentModels } from "../src/server/models";
import { expired, expiresAt } from "../src/server/privacy";
import { createSession, upgradeSession, type Session } from "../src/server/store";
import { browserRunSource } from "./browser";
import { budgetCounter } from "./budget";

// The community whose market this agent matches in.
const COMMUNITY = "lisbon-pilot";

// What's kept, split so no single row gets near SQLite's 2 MB limit: the model history and the run grow; the rest stays small.
type Part = "core" | "history" | "open_history" | "run";

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
    const session = {
      ...(parts.core as Session),
      history: (parts.history ?? []) as Session["history"],
      openHistory: (parts.open_history ?? []) as NonNullable<Session["openHistory"]>,
      run: (parts.run ?? null) as Session["run"],
    };
    this.actor = makeActor(upgradeSession(session), (s) => this.save(s));
    // Kept RETENTION_DAYS after last use, then deleted. Agents made before expiry existed get their check now.
    if (expired(this.actor.session)) return this.erase();
    // Idempotent: an agent that already has its check keeps it, instead of gaining one per restart.
    await this.schedule(new Date(expiresAt(this.actor.session)), "expire", undefined, { idempotent: true });
  }

  // Deletes the person's data at once, then the rest of the object (its scheduled wakes, the SDK's own tables) in a
  // fresh alarm invocation of its own, so the teardown can't be cut short by the request that asked for it ending.
  private async erase() {
    void this.sql`DELETE FROM session_parts`;
    this.actor = undefined;
    await this.schedule(1, "selfDestruct");
  }

  async selfDestruct() {
    await this.destroy();
  }

  // Fires when the agent would be past its keep-until date. If the person came back meanwhile, it checks again later.
  async expire() {
    const actor = this.actor;
    if (!actor) return;
    if (expired(actor.session)) return this.erase();
    await this.schedule(new Date(expiresAt(actor.session)), "expire");
  }

  private save(session: Session) {
    const { history, openHistory, run, ...core } = session;
    const parts: [Part, unknown][] = [["core", core], ["history", history], ["open_history", openHistory ?? []], ["run", run]];
    for (const [part, value] of parts) void this.sql`INSERT OR REPLACE INTO session_parts (part, value) VALUES (${part}, ${JSON.stringify(value)})`;
  }

  // The service's daily budget, shared by every person's agent.
  private get counter() {
    return budgetCounter(this.env.BUDGET);
  }

  private market(): Market {
    const stub = this.env.MARKET.getByName(COMMUNITY);
    return { match: (intents) => stub.match(intents), report: (memberIds, outcome, reporter) => stub.report(memberIds, outcome, reporter) };
  }

  async onRequest(request: Request): Promise<Response> {
    if (this.actor) this.actor.lastUsed = Date.now();
    return handleApi(request, {
      actor: this.actor,
      start: (name) => {
        // A fresh object for a fresh person: the Worker routes every new session to a new id.
        if (this.actor) throw new Error("This agent already belongs to someone.");
        this.actor = makeActor(createSession(name, this.name), (s) => this.save(s));
        void this.schedule(new Date(expiresAt(this.actor.session)), "expire");
        return this.actor;
      },
      market: this.market(),
      privacyRequests: (r) => this.env.MARKET.getByName(COMMUNITY).keepPrivacyRequest(r),
      erase: () => this.erase(),
      counter: this.counter,
      agents: agentModels(browserRunSource(this.env.BROWSER), this.env.AI, this.counter),
      // A Durable Object alarm wakes this agent when a proposal's hold runs out or it's time to ask how it went,
      // even if nobody has the page open.
      wake: (job, at) => {
        void this.schedule(at, "wake", job);
      },
    });
  }

  // Alarms fire at least once, so each job is safe to run twice: it re-checks the session and does nothing if it's settled.
  async wake(job: Wake) {
    const actor = this.actor;
    if (!actor) return;
    const event = job.kind === "hold" ? lapse(actor.session, job.opportunityId) : checkInDue(actor.session, job.opportunityId);
    if (!event) return;
    observe(actor, event);
    broadcast(actor, event);
    persist(actor);
  }

  // Check-ins scheduled before `wake` existed still call this.
  async checkInDue({ opportunityId }: { opportunityId: string }) {
    return this.wake({ kind: "check_in", opportunityId });
  }
}

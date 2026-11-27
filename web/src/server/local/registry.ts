import { makeActor, persist, record, type Actor } from "../actor";
import type { Directory, Who } from "../account";
import type { AgentInfo } from "../accountRoutes";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSession } from "../store";
import { deleteSession, loadSession, saveSession } from "./files";

// Local stand-in for Cloudflare's Durable Object namespace: one actor per person id, kept in memory,
// saved to a file, and dropped when idle (like a Durable Object hibernating). The next request wakes it from disk.
const IDLE_MS = 30 * 60 * 1000;

// Kept on globalThis so dev-server reloads don't fork a person's agent into two copies.
const g = globalThis as typeof globalThis & { __openActors?: Map<string, Actor> };
const actors: Map<string, Actor> = (g.__openActors ??= new Map());

function sweep(now: number) {
  for (const [id, actor] of actors) {
    if (actor.busy || now - actor.lastUsed < IDLE_MS) continue;
    saveSession(actor.session);
    actors.delete(id);
  }
}

export function actorFor(id: string | undefined): Actor | undefined {
  const now = Date.now();
  sweep(now);
  if (!id) return undefined;
  let actor = actors.get(id);
  if (!actor) {
    const session = loadSession(id);
    if (!session) return undefined;
    actor = makeActor(session, saveSession);
    actors.set(id, actor);
  }
  actor.lastUsed = now;
  return actor;
}

export function startActor(name: string): Actor {
  const actor = makeActor(createSession(name), saveSession);
  saveSession(actor.session);
  actors.set(actor.session.id, actor);
  return actor;
}

// Deletes the person's agent: from memory and from disk.
export async function eraseActor(id: string): Promise<void> {
  actors.delete(id);
  deleteSession(id);
}

// Which agent each account owns, in a file, standing in for the account Durable Objects.
const ACCOUNTS = () => join(process.cwd(), ".data", "accounts.json");
function readAccounts(): Record<string, string> {
  try {
    return existsSync(ACCOUNTS()) ? (JSON.parse(readFileSync(ACCOUNTS(), "utf8")) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
export const localDirectory: Directory = {
  get: async (sub) => readAccounts()[sub] ?? null,
  set: async (sub, agentId) => {
    mkdirSync(join(process.cwd(), ".data"), { recursive: true, mode: 0o700 });
    writeFileSync(ACCOUNTS(), JSON.stringify({ ...readAccounts(), [sub]: agentId }), { mode: 0o600 });
  },
};

export async function localAgentInfo(id: string): Promise<AgentInfo> {
  const actor = actorFor(id);
  return { exists: !!actor, owner: actor?.session.owner?.sub ?? null, started: !!actor && actor.session.chat.length > 0 };
}

export async function localClaim(id: string, who: Who): Promise<void> {
  const actor = actorFor(id);
  if (!actor) throw new Error("No such agent.");
  if (actor.session.owner && actor.session.owner.sub !== who.sub) throw new Error("This agent belongs to another account.");
  if (actor.session.owner) return;
  actor.session.owner = { sub: who.sub, ...(who.email ? { email: who.email } : {}), linkedAt: new Date().toISOString() };
  record(actor, { kind: "you", by: "you", text: `You saved your agent to your account${who.email ? ` (${who.email})` : ""}` });
  persist(actor);
}

export async function localErase(id: string): Promise<void> {
  const owner = actorFor(id)?.session.owner;
  await eraseActor(id);
  if (owner && readAccounts()[owner.sub] === id) {
    const all = readAccounts();
    delete all[owner.sub];
    writeFileSync(ACCOUNTS(), JSON.stringify(all), { mode: 0o600 });
  }
}

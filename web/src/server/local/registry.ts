import { makeActor, type Actor } from "../actor";
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

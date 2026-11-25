import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ProfileIntent } from "./domain";
import type { ChatItem } from "./intake/types";
import type { AgentEvent, Opportunity } from "./negotiation/types";

export type Session = {
  id: string;
  createdAt: string;
  name: string;
  // Exact model history, appended to and never edited.
  history: Anthropic.Beta.BetaMessageParam[];
  // What the person sees in the conversation.
  chat: ChatItem[];
  intents: ProfileIntent[];
  ready: boolean;
  // Notes for the agent about things the person did outside the chat, sent with their next message.
  pendingNotes: string[];
  run: { at: string; events: AgentEvent[]; opportunities: Opportunity[] } | null;
  decisions: Record<string, "approved" | "declined">;
};

const DATA_DIR = join(process.cwd(), ".data", "sessions");
const SESSION_ID = /^[0-9a-f-]{36}$/;

export const SESSION_COOKIE = "open_sid";

export function createSession(name: string): Session {
  const session: Session = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name,
    history: [],
    chat: [],
    intents: [],
    ready: false,
    pendingNotes: [],
    run: null,
    decisions: {},
  };
  saveSession(session);
  return session;
}

export function loadSession(id: string | undefined): Session | undefined {
  if (!id || !SESSION_ID.test(id)) return undefined;
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, `${id}.json`), "utf8")) as Session;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export function saveSession(session: Session): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(join(DATA_DIR, `${session.id}.json`), JSON.stringify(session), { mode: 0o600 });
}

// What the browser is allowed to see: no model history, no other people's limits.
export function publicSession(session: Session) {
  return {
    name: session.name,
    chat: session.chat,
    intents: session.intents,
    ready: session.ready,
    run: session.run,
    decisions: session.decisions,
  };
}
export type PublicSession = ReturnType<typeof publicSession>;

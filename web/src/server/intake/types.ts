import type { AboutNote, ProfileIntent } from "../domain";
import type { Session } from "../store";

// One line of the recap: what the agent will look for, what stays private, and what other agents will hear.
export type RecapItem = {
  id: string;
  summary: string;
  kind: "deal" | "interest";
  rank: number | null;
  // The private limit, worded for the person. Never shown to other agents.
  limit: string | null;
  times: string[];
  prefers: string | null;
  // Exactly what other agents are told about this intent.
  shared: string;
};

// What the person's answer to the recap reads as in the chat.
export const RECAP_CONFIRMED = "That's right.";
export const RECAP_CHANGE = "I want to change something.";

export type Widget =
  | { kind: "choices"; prompt: string; options: string[]; multiple: boolean }
  | { kind: "recap"; items: RecapItem[] }
  // Either/or picks between real things on the network. The agent's guesses stay on the server.
  | { kind: "pairs"; pairs: { id: string; question: string; a: { title: string; detail: string }; b: { title: string; detail: string } }[] }
  | { kind: "number"; label: string; min: number; max: number; step: number; value: number; unit: string; intentId: string | null };

export type ChatItem = {
  id: string;
  role: "agent" | "user";
  text: string;
  widget?: Widget;
  answered?: boolean;
  // Short replies the person might send next, shown above the composer.
  suggestions?: string[];
  // What the agent did during this turn, shown as quiet steps under its message.
  activity?: string[];
  stopped?: boolean;
};

export type IntakeEvent =
  | { type: "agent_start"; itemId: string }
  | { type: "text"; itemId: string; delta: string }
  | { type: "widget"; itemId: string; widget: Widget }
  | { type: "activity"; itemId: string; text: string }
  | { type: "suggestions"; itemId: string; options: string[] }
  | { type: "intent"; intent: ProfileIntent }
  // The rest of the profile: what they picked at the start and what the agent noted about them.
  | { type: "about"; goals: string[]; about: AboutNote[] }
  | { type: "ready" }
  | { type: "read"; url: string; title: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface IntakeAgent {
  // Takes the person's turn (already in plain words), appends the agent's reply to the session and emits it as it streams.
  respond(session: Session, userText: string, emit: (event: IntakeEvent) => void, signal: AbortSignal): Promise<void>;
}

export function activityFor(intent: ProfileIntent, isNew: boolean): string {
  const verb = isNew ? "Noted" : "Updated";
  const pending = isNew && intent.status === "pending" ? " · needs your OK" : "";
  return `${verb} · ${intent.summary}${pending}`;
}

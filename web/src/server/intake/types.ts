import type { ProfileIntent } from "../domain";
import type { Session } from "../store";

export type Widget =
  | { kind: "choices"; prompt: string; options: string[]; multiple: boolean }
  | { kind: "number"; label: string; min: number; max: number; step: number; value: number; unit: string; intentId: string | null };

export type ChatItem = {
  id: string;
  role: "agent" | "user";
  text: string;
  widget?: Widget;
  answered?: boolean;
};

export type IntakeEvent =
  | { type: "agent_start"; itemId: string }
  | { type: "text"; itemId: string; delta: string }
  | { type: "widget"; itemId: string; widget: Widget }
  | { type: "intent"; intent: ProfileIntent }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "done" };

export interface IntakeAgent {
  // Takes the person's turn (already in plain words), appends the agent's reply to the session and emits it as it streams.
  respond(session: Session, userText: string, emit: (event: IntakeEvent) => void): Promise<void>;
}

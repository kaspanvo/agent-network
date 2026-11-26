import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "../roles";
import type { Reader } from "../tools/reader";
import type { Session } from "../store";
import { intakeSystemPrompt } from "./prompt";
import { runTool, TOOL_SPECS } from "./tools";
import type { ChatItem, IntakeAgent, IntakeEvent } from "./types";

const MAX_STEPS = 6;

// Tools whose input can be long enough to be worth streaming as it's written.
const EAGER = new Set(["show_choices", "ask_number", "save_intent"]);

const tools: Anthropic.Beta.BetaTool[] = TOOL_SPECS.map((t) => ({
  name: t.name,
  description: t.description,
  ...(EAGER.has(t.name) ? { eager_input_streaming: true } : {}),
  input_schema: t.parameters as Anthropic.Beta.BetaTool["input_schema"],
}));

export function claudeIntakeAgent(client: Anthropic = new Anthropic(), reader?: Reader): IntakeAgent {
  return {
    async respond(session: Session, userText: string, emit: (event: IntakeEvent) => void, signal: AbortSignal) {
      const itemId = randomUUID();
      const item: ChatItem = { id: itemId, role: "agent", text: "" };
      session.chat.push(item);
      emit({ type: "agent_start", itemId });
      session.history.push({ role: "user", content: userText });

      for (let step = 0; step < MAX_STEPS; step++) {
        const { model, effort, ...fallback } = modelFor("intake");
        const stream = client.beta.messages.stream(
          {
            ...fallback,
            model,
            max_tokens: 16000,
            output_config: { effort },
            cache_control: { type: "ephemeral" },
            system: intakeSystemPrompt(session.name),
            tools: reader ? tools : tools.filter((t) => t.name !== "read_page"),
            messages: session.history,
          },
          { signal },
        );
        stream.on("text", (delta) => {
          item.text += delta;
          emit({ type: "text", itemId, delta });
        });

        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          // The person pressed stop: keep what was written so far and end the turn quietly.
          if (signal.aborted) {
            item.stopped = true;
            return;
          }
          throw err;
        }
        session.history.push({ role: "assistant", content: message.content });

        if (message.stop_reason === "refusal") {
          emit({ type: "error", message: "Your agent couldn't continue this conversation." });
          return;
        }
        const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (toolUses.length === 0) return;
        if (message.stop_reason === "max_tokens") throw new Error("The agent's reply was cut off. Try again.");

        let waitForPerson = false;
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
          toolUses.map(async (tool): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
            const result = await runTool({ session, item, emit, reader }, tool.name, tool.input);
            if (result.wait) waitForPerson = true;
            return { type: "tool_result", tool_use_id: tool.id, content: result.content, ...(result.isError ? { is_error: true } : {}) };
          }),
        );
        session.history.push({ role: "user", content: results });
        if (waitForPerson) return;
        if (item.text && !item.text.endsWith(" ")) {
          item.text += " ";
          emit({ type: "text", itemId, delta: " " });
        }
      }
    },
  };
}

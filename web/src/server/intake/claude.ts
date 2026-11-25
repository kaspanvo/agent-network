import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Session } from "../store";
import { isReady, saveIntent, SaveIntentInput } from "./profile";
import { intakeSystemPrompt } from "./prompt";
import type { ChatItem, IntakeAgent, IntakeEvent, Widget } from "./types";

const MODEL = "claude-opus-5-5";
const MAX_STEPS = 6;

const ShowChoicesInput = z.object({
  prompt: z.string(),
  options: z.array(z.string().min(1)).min(2).max(8),
  multiple: z.boolean(),
});
const AskNumberInput = z.object({
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  value: z.number(),
  unit: z.string(),
  intent_id: z.string().nullable(),
});

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "show_choices",
    description: "Show tappable options under your message. The person's pick comes back as their next message. Use it as the last action of your turn.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Short label above the options" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
        multiple: { type: "boolean", description: "Whether several options can be picked" },
      },
      required: ["prompt", "options", "multiple"],
    },
  },
  {
    name: "ask_number",
    description: "Show a slider for a price or number. If intent_id is set, the answer is saved as that intent's price. Use it as the last action of your turn.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "e.g. Most you'd pay per hour" },
        min: { type: "number" },
        max: { type: "number" },
        step: { type: "number" },
        value: { type: "number", description: "Starting value" },
        unit: { type: "string", description: "Shown after the number, e.g. €/hour or € one-off" },
        intent_id: { type: ["string", "null"], description: "The intent this price belongs to" },
      },
      required: ["label", "min", "max", "step", "value", "unit", "intent_id"],
    },
  },
  {
    name: "save_intent",
    description: "Create or update one of the person's intents. Returns the saved intent with its id.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        id: { type: ["string", "null"], description: "Pass to update an existing intent" },
        direction: { type: "string", enum: ["seek", "offer"] },
        summary: { type: "string", description: "Short, in their words, e.g. Learn Spanish before a trip in March" },
        tag: { type: "string", description: "kebab-case category" },
        provenance: { type: "string", enum: ["stated", "inferred"] },
        evidence: { type: "string", description: "Their exact words this comes from" },
        price: { type: ["number", "null"] },
        unit: { type: "string", enum: ["hour", "month", "one-off"] },
        conditions: { type: "array", items: { type: "string", enum: ["mornings", "evenings", "weekends"] } },
      },
      required: ["direction", "summary", "tag", "provenance", "evidence"],
    },
  },
  {
    name: "mark_ready",
    description: "Mark the agent as ready to go out and negotiate.",
    input_schema: { type: "object", properties: {} },
  },
];

export function claudeIntakeAgent(client: Anthropic = new Anthropic()): IntakeAgent {
  return {
    async respond(session: Session, userText: string, emit: (event: IntakeEvent) => void) {
      const itemId = randomUUID();
      const item: ChatItem = { id: itemId, role: "agent", text: "" };
      session.chat.push(item);
      emit({ type: "agent_start", itemId });
      session.history.push({ role: "user", content: userText });

      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = client.beta.messages.stream({
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: "low" },
          cache_control: { type: "ephemeral" },
          system: intakeSystemPrompt(session.name),
          tools,
          messages: session.history,
        });
        stream.on("text", (delta) => {
          item.text += delta;
          emit({ type: "text", itemId, delta });
        });
        const message = await stream.finalMessage();
        session.history.push({ role: "assistant", content: message.content });

        if (message.stop_reason === "refusal") {
          emit({ type: "error", message: "Your agent couldn't continue this conversation." });
          return;
        }
        const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (toolUses.length === 0) return;
        if (message.stop_reason === "max_tokens") throw new Error("The agent's reply was cut off. Try again.");

        let waitForPerson = false;
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tool) => {
          const ok = (content: unknown): Anthropic.Beta.BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: tool.id, content: JSON.stringify(content) });
          const fail = (error: string): Anthropic.Beta.BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: tool.id, is_error: true, content: error });

          if (tool.name === "save_intent") {
            const parsed = SaveIntentInput.safeParse(tool.input);
            if (!parsed.success) return fail(z.prettifyError(parsed.error));
            const intent = saveIntent(session, parsed.data);
            emit({ type: "intent", intent });
            return ok(intent);
          }
          if (tool.name === "show_choices" || tool.name === "ask_number") {
            let widget: Widget;
            if (tool.name === "show_choices") {
              const parsed = ShowChoicesInput.safeParse(tool.input);
              if (!parsed.success) return fail(z.prettifyError(parsed.error));
              widget = { kind: "choices", ...parsed.data };
            } else {
              const parsed = AskNumberInput.safeParse(tool.input);
              if (!parsed.success) return fail(z.prettifyError(parsed.error));
              const { intent_id, ...rest } = parsed.data;
              widget = { kind: "number", ...rest, intentId: intent_id };
            }
            item.widget = widget;
            emit({ type: "widget", itemId, widget });
            waitForPerson = true;
            return ok({ shown: true, note: "Wait for their answer in the next message." });
          }
          if (tool.name === "mark_ready") {
            if (!isReady(session)) return fail("No confirmed intent has a price yet.");
            session.ready = true;
            emit({ type: "ready" });
            return ok({ ready: true });
          }
          return fail(`Unknown tool ${tool.name}`);
        });
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

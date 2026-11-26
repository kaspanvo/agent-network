import { randomUUID } from "node:crypto";
import { pause } from "../pace";
import type { Reader } from "../tools/reader";
import type { Session } from "../store";
import { intakeSystemPrompt } from "./prompt";
import { REPLIES_RULE, runTool, showSuggestions, TOOL_SPECS, type ToolResult } from "./tools";
import type { ChatItem, IntakeAgent, IntakeEvent } from "./types";

// The intake agent on an open model served by Cloudflare Workers AI, for running without a Claude key.
// Workers AI speaks the OpenAI chat format: tools as {type: "function", function}, calls back as tool_calls whose
// arguments are a JSON string, results sent back as role "tool" messages.

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string | Record<string, unknown> } };
export type OpenMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type OpenTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type ChatRequest = { messages: OpenMessage[]; tools: OpenTool[]; tool_choice: "auto" | "required"; max_tokens: number };
export type ChatResponse = { choices: { message: { content: string | null; tool_calls?: ToolCall[] | null } }[]; usage?: { neurons?: number } };
// One chat completion. On Cloudflare it's the Workers AI binding; tests pass a script.
export type ChatModel = (request: ChatRequest) => Promise<ChatResponse>;

const MAX_STEPS = 6;
// Enough recent messages for the conversation so far, without paying to resend all of it on every turn.
const KEEP = 40;

// Calls that end the turn. Each carries the words the person sees in `text`.
const TURN_END = new Set(["reply", "show_choices", "ask_number", "show_recap", "show_calibration"]);
const TEXT = { text: { type: "string", description: "Your words to the person: one or two short sentences." } };

function openTools(reader: boolean): OpenTool[] {
  const specs = TOOL_SPECS.filter((t) => t.name !== "suggest_replies" && (reader || t.name !== "read_page")).map((t) => {
    if (!TURN_END.has(t.name)) return t;
    const parameters = t.parameters as { properties: Record<string, unknown>; required?: string[] };
    return { ...t, parameters: { ...parameters, properties: { ...TEXT, ...parameters.properties }, required: ["text", ...(parameters.required ?? [])] } };
  });
  specs.push({
    name: "reply",
    description: "Say something to the person and end your turn, when no widget fits. Your question goes in text, and the tappable answers to it in answers.",
    parameters: {
      type: "object",
      properties: { ...TEXT, answers: { type: "array", items: { type: "string" }, maxItems: 3, description: REPLIES_RULE } },
      required: ["text", "answers"],
    },
  });
  return specs.map((s) => ({ type: "function", function: s }));
}

function args(call: ToolCall): Record<string, unknown> {
  const raw = call.function.arguments;
  if (typeof raw !== "string") return raw ?? {};
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

// Some models still answer in plain text now and then, sometimes with the answers as a list or as JSON.
// Keep the words and pick the answers out, rather than showing the person a block of JSON.
export function salvage(content: string): { text: string; answers: string[] } {
  const clean = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const json = clean.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { text?: unknown; answers?: unknown; options?: unknown };
      const answers = Array.isArray(parsed.answers) ? parsed.answers : Array.isArray(parsed.options) ? parsed.options : [];
      const before = clean.slice(0, json.index).trim();
      const text = typeof parsed.text === "string" ? parsed.text : before;
      if (text) return { text, answers: answers.filter((a): a is string => typeof a === "string") };
    } catch {
      // Not JSON after all: treat it as words.
    }
  }
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const answers = lines.filter((l) => LIST_ITEM.test(l)).map((l) => l.replace(LIST_ITEM, ""));
  const text = lines.filter((l) => !LIST_ITEM.test(l)).join(" ");
  return { text, answers };
}

// The most recent messages, starting at something the person said, so a tool call is never sent without its result.
function recent(history: OpenMessage[]): OpenMessage[] {
  if (history.length <= KEEP) return history;
  let start = history.length - KEEP;
  while (start < history.length && history[start]!.role !== "user") start++;
  return history.slice(start);
}

// When the script answers instead of the model, the person is told, on that very message. A weaker agent quietly
// standing in is how people end up worse off without noticing (Project Deal, 2026).
export function scriptStoodIn(session: Session, emit: (event: IntakeEvent) => void, overBudget: boolean): void {
  const item = session.chat.at(-1);
  if (item?.role !== "agent") return;
  const text = overBudget ? "Answered by the simple script · Open's AI is back at 00:00 UTC" : "Answered by the simple script · Open's AI didn't respond";
  item.activity = [...(item.activity ?? []), text];
  emit({ type: "activity", itemId: item.id, text });
}

export function openModelIntakeAgent(model: ChatModel, fallback: IntakeAgent, reader?: Reader): IntakeAgent {
  const tools = openTools(!!reader);
  return {
    async respond(session: Session, userText: string, emit: (event: IntakeEvent) => void, signal: AbortSignal) {
      // Asking something while a slider or choice is waiting doesn't answer it: the reply brings it back.
      const previous = session.chat.filter((c) => c.role === "agent").at(-1)?.widget;
      const waiting = previous && (previous.kind === "choices" || previous.kind === "number") && /\?\s*$/.test(userText.trim()) ? previous : undefined;
      const history = (session.openHistory ??= []);
      history.push({ role: "user", content: userText });
      const ask = () =>
        model({ messages: [{ role: "system", content: intakeSystemPrompt(session.name, "single_call") }, ...recent(history)], tools, tool_choice: "required", max_tokens: 1200 });

      // The first call happens before anything is shown, so if the model is unavailable (or today's free allowance
      // is used up) the scripted agent takes this turn instead, and the conversation carries on.
      let response: ChatResponse;
      try {
        response = await ask();
      } catch (err) {
        console.warn("Open model unavailable, the script takes this turn:", err instanceof Error ? err.message : err);
        history.pop();
        await fallback.respond(session, userText, emit, signal);
        scriptStoodIn(session, emit, err instanceof Error && err.name === "BudgetExceeded");
        const said = session.chat.at(-1);
        history.push({ role: "user", content: userText }, { role: "assistant", content: said?.role === "agent" ? said.text : "" });
        return;
      }

      const item: ChatItem = { id: randomUUID(), role: "agent", text: "" };
      session.chat.push(item);
      emit({ type: "agent_start", itemId: item.id });
      const ctx = { session, item, emit, reader };
      const say = async (text: string) => {
        if (!text.trim()) return;
        if (item.text && !item.text.endsWith(" ")) item.text += " ";
        for (const word of text.trim().split(/(?<= )/)) {
          if (signal.aborted) {
            item.stopped = true;
            return;
          }
          item.text += word;
          emit({ type: "text", itemId: item.id, delta: word });
          await pause(20);
        }
      };

      for (let step = 0; step < MAX_STEPS; step++) {
        if (step > 0) response = await ask();
        if (signal.aborted) {
          item.stopped = true;
          return;
        }
        const message = response.choices[0]?.message ?? { content: "" };
        const calls = message.tool_calls ?? [];
        history.push({ role: "assistant", content: message.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });
        if (calls.length === 0) {
          const { text, answers } = salvage(message.content ?? "");
          await say(text);
          showSuggestions(ctx, answers);
          if (item.text) return;
          continue;
        }

        let ended = false;
        let saved: string | undefined;
        for (const call of calls) {
          const input = args(call);
          // A price slider asked for in the same step as the intent it belongs to can't know that intent's id yet.
          if (call.function.name === "ask_number" && saved && !session.intents.some((i) => i.id === input.intent_id)) input.intent_id = saved;
          let result: ToolResult;
          if (call.function.name === "reply") {
            await say(typeof input.text === "string" ? input.text : "");
            if (waiting && !item.widget) {
              item.widget = waiting;
              emit({ type: "widget", itemId: item.id, widget: waiting });
            } else showSuggestions(ctx, Array.isArray(input.answers) ? input.answers.filter((a): a is string => typeof a === "string") : []);
            result = { content: JSON.stringify({ shown: true, note: waiting ? "The app showed your earlier widget again. Wait for their answer." : "Wait for their answer in the next message." }), wait: true };
          } else {
            result = await runTool(ctx, call.function.name, input);
            if (call.function.name === "save_intent" && !result.isError) saved = (JSON.parse(result.content) as { id: string }).id;
            if (TURN_END.has(call.function.name) && !result.isError) await say(typeof input.text === "string" ? input.text : "");
          }
          if (result.wait) ended = true;
          history.push({ role: "tool", tool_call_id: call.id, content: result.isError ? `Error: ${result.content}` : result.content });
        }
        if (ended && item.text) return;
        if (ended) {
          // A widget with no words above it: say something short so the person knows what it's for.
          await say("Here you go.");
          return;
        }
      }
      if (!item.text) await say("Sorry, I lost my thread there. Could you say that again?");
    },
  };
}

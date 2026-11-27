import { claudeIntakeAgent } from "./intake/claude";
import { demoIntakeAgent } from "./intake/demo";
import { openModelIntakeAgent, scriptStoodIn } from "./intake/openmodel";
import type { IntakeAgent } from "./intake/types";
import { budgetedChat, budgetedPages, DAILY, limitBehind, localCounter, type Counter } from "./limits";
import { claudeNarrator, scriptedNarrator, type Narrator } from "./negotiation/narrator";
import { agentMode, type AgentMode } from "./pace";
import { AGENT_MODEL, claudeFor, OPEN_MODEL, workersAiChat, type AiBinding } from "./roles";
import { claudeResponder, keywordResponder, oneAgentEach, openModelResponder, type Responder } from "./rooms/reply";
import { claudeExtractor, fetchSource, makeReader, plainExtractor, type Extractor, type PageSource, type Reader } from "./tools/reader";

export { AGENT_MODEL, OPEN_MODEL, ROLES, modelFor, claudeFor, type Role } from "./roles";

export type Agents = {
  mode: AgentMode;
  // The model that speaks for people, shown in the app. Null in demo mode.
  label: string | null;
  intake: () => IntakeAgent;
  narrator: () => Narrator;
  responder: () => Responder;
  reader: Reader;
  // True when today's AI budget is spent, so the simple script answers for everyone until 00:00 UTC.
  resting: () => Promise<boolean>;
};

// Over budget or too slow: the job falls back to what the script does, instead of failing.
const spent = (err: unknown) => limitBehind(err) !== null;

function narratorOr(primary: Narrator, fallback: Narrator): Narrator {
  return {
    async narrate(thread, you) {
      try {
        return await primary.narrate(thread, you);
      } catch (err) {
        if (spent(err)) return fallback.narrate(thread, you);
        throw err;
      }
    },
  };
}

function responderOr(primary: Responder, fallback: Responder): Responder {
  return {
    async reply(room, text) {
      try {
        return await primary.reply(room, text);
      } catch (err) {
        if (spent(err)) return fallback.reply(room, text);
        throw err;
      }
    },
  };
}

function extractorOr(primary: Extractor, fallback: Extractor): Extractor {
  return async (page) => {
    try {
      return await primary(page);
    } catch (err) {
      if (spent(err)) return fallback(page);
      throw err;
    }
  };
}

// Claude takes the turn while today's budget lasts; after that the script does.
function intakeWithin(primary: IntakeAgent, fallback: IntakeAgent, counter: Counter): IntakeAgent {
  return {
    async respond(session, userText, emit, signal) {
      if ((await counter.used("claude_calls")) >= DAILY.claudeCalls) {
        await fallback.respond(session, userText, emit, signal);
        return scriptStoodIn(session, emit, true);
      }
      return primary.respond(session, userText, emit, signal);
    },
  };
}

// `pages` is where the reader fetches from: Cloudflare Browser Run in the Worker, a plain fetch locally.
// `ai` is the Workers AI binding, when the host has one. `counter` holds the service's daily budget.
export function agentModels(pages: PageSource = fetchSource, ai?: AiBinding, counter: Counter = localCounter): Agents {
  const mode = agentMode(!!ai);
  const source = budgetedPages(pages, counter);
  if (mode === "claude") {
    const reader = makeReader(source, extractorOr(claudeExtractor(claudeFor("reader", counter)), plainExtractor));
    const demo = demoIntakeAgent(reader);
    return {
      mode,
      label: AGENT_MODEL.label,
      reader,
      intake: () => intakeWithin(claudeIntakeAgent(claudeFor("intake", counter), reader), demo, counter),
      narrator: () => narratorOr(claudeNarrator(claudeFor("narrator", counter)), scriptedNarrator),
      responder: () => oneAgentEach(responderOr(claudeResponder(claudeFor("room_reply", counter)), keywordResponder)),
      resting: async () => (await counter.used("claude_calls")) >= DAILY.claudeCalls,
    };
  }
  const reader = makeReader(source, plainExtractor);
  if (mode === "open" && ai) {
    const chat = budgetedChat(workersAiChat(ai), counter);
    return {
      mode,
      label: OPEN_MODEL.label,
      reader,
      // The script stands in for any turn the model can't take (down, slow, or over today's budget).
      intake: () => openModelIntakeAgent(chat, demoIntakeAgent(reader), reader),
      // The narrator only words what code already decided; the script does that well enough.
      narrator: () => scriptedNarrator,
      responder: () => oneAgentEach(openModelResponder(chat)),
      resting: async () => (await counter.used("neurons")) >= DAILY.neurons,
    };
  }
  return { mode: "demo", label: null, reader, intake: () => demoIntakeAgent(reader), narrator: () => scriptedNarrator, responder: () => keywordResponder, resting: async () => false };
}

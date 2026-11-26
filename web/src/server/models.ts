import { claudeIntakeAgent } from "./intake/claude";
import { demoIntakeAgent } from "./intake/demo";
import { openModelIntakeAgent } from "./intake/openmodel";
import type { IntakeAgent } from "./intake/types";
import { claudeNarrator, scriptedNarrator, type Narrator } from "./negotiation/narrator";
import { agentMode, type AgentMode } from "./pace";
import { AGENT_MODEL, claudeFor, OPEN_MODEL, workersAiChat, type AiBinding } from "./roles";
import { claudeResponder, keywordResponder, openModelResponder, type Responder } from "./rooms/reply";
import { claudeExtractor, fetchSource, makeReader, plainExtractor, type PageSource, type Reader } from "./tools/reader";

export { AGENT_MODEL, OPEN_MODEL, ROLES, modelFor, claudeFor, type Role } from "./roles";

export type Agents = {
  mode: AgentMode;
  // The model that speaks for people, shown in the app. Null in demo mode.
  label: string | null;
  intake: () => IntakeAgent;
  narrator: () => Narrator;
  responder: () => Responder;
  reader: Reader;
};

// `pages` is where the reader fetches from: Cloudflare Browser Run in the Worker, a plain fetch locally.
// `ai` is the Workers AI binding, when the host has one.
export function agentModels(pages: PageSource = fetchSource, ai?: AiBinding): Agents {
  const mode = agentMode(!!ai);
  if (mode === "claude") {
    const reader = makeReader(pages, claudeExtractor(claudeFor("reader")));
    return {
      mode,
      label: AGENT_MODEL.label,
      reader,
      intake: () => claudeIntakeAgent(claudeFor("intake"), reader),
      narrator: () => claudeNarrator(claudeFor("narrator")),
      responder: () => claudeResponder(claudeFor("room_reply")),
    };
  }
  const reader = makeReader(pages, plainExtractor);
  if (mode === "open" && ai) {
    const chat = workersAiChat(ai);
    return {
      mode,
      label: OPEN_MODEL.label,
      reader,
      // The script stands in for any turn the model can't take, so the conversation never stops.
      intake: () => openModelIntakeAgent(chat, demoIntakeAgent(reader), reader),
      // The narrator only words what code already decided; the script does that well enough.
      narrator: () => scriptedNarrator,
      responder: () => openModelResponder(chat),
    };
  }
  return { mode: "demo", label: null, reader, intake: () => demoIntakeAgent(reader), narrator: () => scriptedNarrator, responder: () => keywordResponder };
}

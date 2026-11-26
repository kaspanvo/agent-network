import { claudeIntakeAgent } from "./intake/claude";
import { demoIntakeAgent } from "./intake/demo";
import type { IntakeAgent } from "./intake/types";
import { claudeNarrator, scriptedNarrator, type Narrator } from "./negotiation/narrator";
import { agentMode, type AgentMode } from "./pace";
import { AGENT_MODEL, claudeFor } from "./roles";
import { claudeResponder, keywordResponder, type Responder } from "./rooms/reply";
import { claudeExtractor, fetchSource, makeReader, plainExtractor, type PageSource, type Reader } from "./tools/reader";

export { AGENT_MODEL, ROLES, modelFor, claudeFor, type Role } from "./roles";

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
export function agentModels(pages: PageSource = fetchSource): Agents {
  const mode = agentMode();
  const claude = mode === "claude";
  const reader = makeReader(pages, claude ? claudeExtractor(claudeFor("reader")) : plainExtractor);
  return {
    mode,
    label: claude ? AGENT_MODEL.label : null,
    reader,
    intake: () => (claude ? claudeIntakeAgent(claudeFor("intake"), reader) : demoIntakeAgent(reader)),
    narrator: () => (claude ? claudeNarrator(claudeFor("narrator")) : scriptedNarrator),
    responder: () => (claude ? claudeResponder(claudeFor("room_reply")) : keywordResponder),
  };
}

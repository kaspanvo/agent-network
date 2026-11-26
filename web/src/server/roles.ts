import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// Which model does which job. Kept in code, not in a router, so a change is reviewed like any other.
//
// - Anthropic's Project Deal found people represented by a weaker model got worse deals and didn't notice.
//   So every role that speaks or decides for a person runs on the same model and effort, for every member.
//   Nothing on that path is routed by plan, budget or load.
// - Project Swap found most lost value came from the agent misreading its person, so understanding the
//   person (intake) gets the strongest tier too.
// - Roles that only word something already decided in code (the narrator) or read a public page into facts
//   (the reader) use cheaper, faster models. A weaker model there can't change what anyone gets.
export type Role = "intake" | "room_reply" | "narrator" | "reader";

type Assignment = { model: string; label: string; effort: "low" | "medium" | "high"; fallbacks: boolean; speaksForPeople: boolean };

const OPUS = { model: "claude-opus-5-5", label: "Claude Opus 5.5" };
const SONNET = { model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" };
const HAIKU = { model: "claude-haiku-5-5", label: "Claude Haiku 5.5" };

export const ROLES: Record<Role, Assignment> = {
  intake: { ...OPUS, effort: "medium", fallbacks: true, speaksForPeople: true },
  room_reply: { ...OPUS, effort: "medium", fallbacks: true, speaksForPeople: true },
  // Haiku 5.5 has no server-side fallback, so none is requested.
  narrator: { ...HAIKU, effort: "low", fallbacks: false, speaksForPeople: false },
  reader: { ...SONNET, effort: "medium", fallbacks: true, speaksForPeople: false },
};

// The model shown to the person: the one that speaks for them, the same for everyone.
export const AGENT_MODEL = { id: ROLES.room_reply.model, label: ROLES.room_reply.label } as const;

// Request fields for a role: the model, its effort, and the refusal fallback where the model has one.
export function modelFor(role: Role) {
  const a = ROLES[role];
  return {
    model: a.model,
    effort: a.effort,
    ...(a.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

// A Claude client for one role. With OPEN_AI_GATEWAY_URL set, calls go through Cloudflare AI Gateway, which logs
// them, retries, and tags each with its role so spend and errors can be read per job. With a key stored in the
// gateway (OPEN_AI_GATEWAY_BYOK=true) the app holds no Anthropic key at all.
export function claudeFor(role: Role): Anthropic {
  const gateway = env.OPEN_AI_GATEWAY_URL;
  if (!gateway) return new Anthropic();
  const byok = env.OPEN_AI_GATEWAY_BYOK === "true";
  return new Anthropic({
    baseURL: gateway,
    apiKey: byok ? "stored-in-gateway" : env.ANTHROPIC_API_KEY,
    defaultHeaders: {
      ...(byok ? { "x-api-key": null, Authorization: null } : {}),
      ...(env.CF_AIG_TOKEN ? { "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}` } : {}),
      // Only the job and tier, never anything about the person.
      "cf-aig-metadata": JSON.stringify({ app: "open", role, tier: ROLES[role].speaksForPeople ? "people-v1" : "support-v1" }),
      // Each agent turn is unique; the gateway's exact-match cache would only ever serve stale words.
      "cf-aig-skip-cache": "true",
      "cf-aig-max-attempts": "2",
    },
  });
}

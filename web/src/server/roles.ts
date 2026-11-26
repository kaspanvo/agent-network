import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import type { ChatModel, ChatResponse } from "./intake/openmodel";
import { budgetedFetch, type Counter } from "./limits";

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
// Every client counts its requests against the day's Claude budget, gives up on a request after 90 seconds and
// retries at most twice, so a slow or failing API can't stack up calls.
export function claudeFor(role: Role, counter?: Counter): Anthropic {
  const limits = { timeout: 90_000, maxRetries: 2, ...(counter ? { fetch: budgetedFetch(counter) } : {}) };
  const gateway = env.OPEN_AI_GATEWAY_URL;
  if (!gateway) return new Anthropic(limits);
  const byok = env.OPEN_AI_GATEWAY_BYOK === "true";
  return new Anthropic({
    ...limits,
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

// Without a Claude key, one open model on Cloudflare Workers AI does every job that needs a model, for everyone alike.
// Qwen3.8 27B was the steadiest of the free-tier models at calling one tool per step and at suggesting replies that
// answer its own question. Thinking is off: it halved the cost per turn without changing the replies.
const DEFAULT_OPEN_MODEL = "@cf/qwen/qwen3.8-27b";
export const OPEN_MODEL = {
  model: env.OPEN_WORKERS_AI_MODEL ?? DEFAULT_OPEN_MODEL,
  label: (env.OPEN_WORKERS_AI_MODEL ?? DEFAULT_OPEN_MODEL) === DEFAULT_OPEN_MODEL ? "Qwen3.8 27B" : (env.OPEN_WORKERS_AI_MODEL ?? "").split("/").at(-1)!,
} as const;

// The part of the Workers AI binding Open uses.
export type AiBinding = { run(model: string, input: Record<string, unknown>, options?: { gateway?: { id: string } }): Promise<unknown> };

// Each call logs its model, time, cost and which tools it called: never anything the person said.
export function workersAiChat(ai: AiBinding): ChatModel {
  return async (request) => {
    const started = Date.now();
    // Through AI Gateway when one is set: its logs, and a rate limit set in the dashboard on top of Open's own.
    const options = env.OPEN_WORKERS_AI_GATEWAY ? { gateway: { id: env.OPEN_WORKERS_AI_GATEWAY } } : undefined;
    const response = (await ai.run(OPEN_MODEL.model, { ...request, chat_template_kwargs: { enable_thinking: false } }, options)) as ChatResponse;
    const calls = response.choices[0]?.message.tool_calls?.map((c) => c.function.name) ?? [];
    console.log(JSON.stringify({ at: "workers-ai", model: OPEN_MODEL.model, ms: Date.now() - started, neurons: Math.round(response.usage?.neurons ?? 0), calls }));
    return response;
  };
}

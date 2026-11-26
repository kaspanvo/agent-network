import { env } from "./env";

// Delays that make streamed agent activity readable. OPEN_PACE=0 turns them off (tests).
export function pause(ms: number): Promise<void> {
  const wait = ms * env.OPEN_PACE;
  return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
}

export type AgentMode = "claude" | "demo";

export function agentMode(): AgentMode {
  if (env.OPEN_AGENT_MODE) return env.OPEN_AGENT_MODE;
  // A key in the app, or one stored in Cloudflare AI Gateway.
  return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || (env.OPEN_AI_GATEWAY_URL && env.OPEN_AI_GATEWAY_BYOK === "true") ? "claude" : "demo";
}

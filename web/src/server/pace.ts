// Delays that make streamed agent activity readable. OPEN_PACE=0 turns them off (tests).
const factor = Number(process.env.OPEN_PACE ?? 1);

export function pause(ms: number): Promise<void> {
  const wait = ms * (Number.isFinite(factor) ? factor : 1);
  return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
}

export type AgentMode = "claude" | "demo";

export function agentMode(): AgentMode {
  const mode = process.env.OPEN_AGENT_MODE;
  if (mode === "claude" || mode === "demo") return mode;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "claude" : "demo";
}

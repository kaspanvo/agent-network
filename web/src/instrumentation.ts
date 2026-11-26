// Runs once when the server starts, before it takes requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Importing validates the settings, so a bad value stops the server here rather than mid-conversation.
  const { env } = await import("./server/env");
  const mode = env.OPEN_AGENT_MODE ?? (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? "claude" : "demo");
  console.log(`Open: agents run in ${mode} mode${env.OPEN_PACE !== 1 ? `, pace ${env.OPEN_PACE}` : ""}.`);
}

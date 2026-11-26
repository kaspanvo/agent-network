import { z } from "zod";

// Every setting the server reads, checked once at startup so a typo fails loudly instead of silently changing behaviour.
const Env = z.object({
  // claude: Claude through the API. open: an open model on Cloudflare Workers AI (needs the AI binding). demo: a fixed script.
  OPEN_AGENT_MODE: z.enum(["claude", "open", "demo"]).optional(),
  // Which Workers AI model the open mode uses.
  OPEN_WORKERS_AI_MODEL: z.string().regex(/^@(cf|hf)\//).optional(),
  OPEN_PACE: z.coerce.number().min(0).max(10).default(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().min(1).optional(),
  // Cloudflare AI Gateway's Anthropic endpoint: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/anthropic
  OPEN_AI_GATEWAY_URL: z.url().optional(),
  // "true" when the Anthropic key is stored in the gateway, so the app holds none.
  OPEN_AI_GATEWAY_BYOK: z.enum(["true", "false"]).optional(),
  // The gateway's own token, when the gateway is set to require one.
  CF_AIG_TOKEN: z.string().min(1).optional(),
});
export type Env = z.infer<typeof Env>;

function load(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) throw new Error(`Open's settings are invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const env = load();

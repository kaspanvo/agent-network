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
  // Route Workers AI calls through this AI Gateway (its id), for logs and a rate limit set in the dashboard.
  OPEN_WORKERS_AI_GATEWAY: z.string().min(1).optional(),

  // Daily budgets for the whole service, reset at 00:00 UTC. Past one, the paid models stop and the script answers.
  // 9,000 neurons stays inside Workers AI's free 10,000 a day: raise it to allow paid usage.
  OPEN_DAILY_NEURONS: z.coerce.number().int().min(0).default(9_000),
  OPEN_DAILY_CLAUDE_CALLS: z.coerce.number().int().min(0).default(1_000),
  OPEN_DAILY_PAGE_READS: z.coerce.number().int().min(0).default(200),
  OPEN_DAILY_SESSIONS: z.coerce.number().int().min(0).default(300),
  OPEN_SESSIONS_PER_IP: z.coerce.number().int().min(1).default(5),

  // Cloudflare Turnstile on starting a session. Off until both keys are set.
  OPEN_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET: z.string().min(1).optional(),
  // The hostnames a Turnstile token may come from, comma-separated. Never localhost in production.
  TURNSTILE_HOSTNAMES: z.string().optional(),
});
export type Env = z.infer<typeof Env>;

function load(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) throw new Error(`Open's settings are invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const env = load();

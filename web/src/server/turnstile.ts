import { env } from "./env";

// Cloudflare Turnstile on starting a session: a new session is what gets a fresh daily quota, so it's where a bot
// would get in. Off until a site key and secret are set. Then every new session needs a fresh token that siteverify
// accepts for this action and one of our hostnames, and anything else (including siteverify being unreachable)
// is refused: it fails closed.
export const TURNSTILE_ACTION = "start";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileConfig = { siteKey?: string; secret?: string; hostnames?: string };
const fromEnv = (): TurnstileConfig => ({ siteKey: env.OPEN_TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET, hostnames: env.TURNSTILE_HOSTNAMES });

export function turnstileSiteKey(config: TurnstileConfig = fromEnv()): string | null {
  return config.siteKey && config.secret ? config.siteKey : null;
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

type Siteverify = { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };

// True when the token checks out, or when Turnstile isn't set up.
export async function passesTurnstile(token: unknown, request: Request, verify: typeof fetch = fetch, config: TurnstileConfig = fromEnv()): Promise<boolean> {
  const secret = config.secret;
  if (!turnstileSiteKey(config) || !secret) return true;
  const hostnames = new Set((config.hostnames ?? "").split(",").map((h) => h.trim()).filter(Boolean));
  if (typeof token !== "string" || token.length === 0 || token.length > 2048 || hostnames.size === 0) return false;
  let result: Siteverify;
  try {
    const response = await verify(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: clientIp(request) }),
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = (await response.json()) as Siteverify;
  } catch (err) {
    console.warn("Turnstile check failed, refusing:", err instanceof Error ? err.message : err);
    return false;
  }
  return result.success === true && result.action === TURNSTILE_ACTION && !!result.hostname && hostnames.has(result.hostname);
}

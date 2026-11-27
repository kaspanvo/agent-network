import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env";

// Accounts. People try Open anonymously; an account (Supabase Auth: an emailed code, then a passkey) saves their agent
// so it survives a lost cookie, works on their other devices, and can be trusted with more (a standing yes, later
// introductions and payments). Open never sees passwords or passkeys: the browser signs in with Supabase, and Open
// checks the signed token Supabase issued, locally, against Supabase's published public keys.

export type AccountConfig = { url: string; publishableKey: string };

export function accountConfig(): AccountConfig | null {
  return env.OPEN_SUPABASE_URL && env.OPEN_SUPABASE_PUBLISHABLE_KEY ? { url: env.OPEN_SUPABASE_URL.replace(/\/$/, ""), publishableKey: env.OPEN_SUPABASE_PUBLISHABLE_KEY } : null;
}

// Who's asking, as the verified token says. `freshAt` is when they last proved it's them (seconds since 1970).
export type Who = { sub: string; email?: string; freshAt: number; sessionId?: string };

// The token travels in a cookie the page keeps in step with its Supabase session, so every request carries it, a
// live event stream included. An Authorization header works too.
export const TOKEN_COOKIE = "open_at";

export function tokenOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === TOKEN_COOKIE) return decodeURIComponent(value.join("=")) || null;
  }
  return null;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type SupabaseClaims = JWTPayload & { email?: string; session_id?: string; is_anonymous?: boolean; amr?: ({ method: string; timestamp: number } | string)[] };

export function whoFrom(claims: SupabaseClaims): Who | null {
  if (!claims.sub || claims.is_anonymous) return null;
  // The latest moment they signed in or confirmed it's them; the token's issue time only when that's missing.
  const times = (claims.amr ?? []).flatMap((a) => (typeof a === "object" && typeof a.timestamp === "number" ? [a.timestamp] : []));
  return { sub: claims.sub, email: claims.email, freshAt: times.length ? Math.max(...times) : (claims.iat ?? 0), sessionId: claims.session_id };
}

// Checks the signature against Supabase's public keys (fetched once and cached), the issuer, the audience and expiry.
export async function verifyToken(token: string, config: AccountConfig): Promise<Who | null> {
  try {
    let keys = keySets.get(config.url);
    if (!keys) keySets.set(config.url, (keys = createRemoteJWKSet(new URL(`${config.url}/auth/v1/.well-known/jwks.json`))));
    const { payload } = await jwtVerify(token, keys, { issuer: `${config.url}/auth/v1`, audience: "authenticated" });
    return whoFrom(payload as SupabaseClaims);
  } catch {
    return null;
  }
}

export async function identify(request: Request, config: AccountConfig | null = accountConfig()): Promise<Who | null> {
  const token = config ? tokenOf(request) : null;
  return token && config ? verifyToken(token, config) : null;
}

// Sensitive actions on a saved agent need a sign-in from the last few minutes, the way GitHub's sudo mode works.
export const FRESH_SECONDS = 10 * 60;

export function isFresh(who: Who | null | undefined, now = Date.now()): boolean {
  return !!who && now / 1000 - who.freshAt <= FRESH_SECONDS;
}

// Which agent belongs to which account. One small Durable Object per account on Cloudflare; a file locally.
export interface Directory {
  get(sub: string): Promise<string | null>;
  set(sub: string, agentId: string): Promise<void>;
}

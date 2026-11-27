"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";

// The browser side of accounts. Supabase signs people in (Google, an emailed link or code, or a passkey) and keeps
// their session; this keeps a cookie in step with it so every request to Open, a live event stream included, carries
// the signed token Open checks. Supabase's library loads only when accounts are switched on.

export type LinkStatus = "linked" | "switched" | "conflict" | "none";
export type SignInMethod = "google" | "email" | "passkey";

const TOKEN_COOKIE = "open_at";
const LAST_METHOD = "open_last_signin";
// Set just before leaving for Google or an emailed link, so the page they come back to finishes signing in.
const RETURNING = "open_signin_return";
let ready: Promise<SupabaseClient | null> | null = null;
let digits = 6;

// How many digits the emailed code has (the Supabase project decides). Known once accounts() has run.
export function codeLength(): number {
  return digits;
}

function mirror(session: Session | null) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  if (!session) {
    document.cookie = `${TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  const left = Math.max(0, (session.expires_at ?? 0) - Math.floor(Date.now() / 1000));
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(session.access_token)}; Path=/; Max-Age=${left}; SameSite=Lax${secure}`;
}

// Starts Supabase once, if accounts are on, and waits for any saved session to be restored (and refreshed) before the
// first request to Open, so a returning person isn't asked to sign in for nothing. The PKCE flow keeps the secret half
// of every link and Google round trip in this browser, so a link that leaks can't be used elsewhere.
export function accounts(): Promise<SupabaseClient | null> {
  ready ??= (async () => {
    const config = (await fetch("/api/account/config").then((r) => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false }))) as { enabled: boolean; url?: string; publishableKey?: string; codeLength?: number };
    if (!config.enabled || !config.url || !config.publishableKey) return null;
    digits = config.codeLength ?? 6;
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" } });
    const { data } = await client.auth.getSession();
    mirror(data.session);
    client.auth.onAuthStateChange((_event, session) => mirror(session));
    return client;
  })();
  return ready;
}

async function signedInClient(): Promise<SupabaseClient> {
  const client = await accounts();
  if (!client) fail(null, "Accounts aren't switched on.");
  return client;
}

export async function signedInEmail(): Promise<string | null> {
  const client = await accounts();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.user.email ?? null;
}

function fail(error: { message?: string } | null | undefined, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// How they signed in last time on this device, to point them back to it (as Vercel, Linear and Slack do).
export function lastMethod(): SignInMethod | null {
  try {
    const value = localStorage.getItem(LAST_METHOD);
    return value === "google" || value === "email" || value === "passkey" ? value : null;
  } catch {
    return null;
  }
}

function remember(method: SignInMethod) {
  try {
    localStorage.setItem(LAST_METHOD, method);
  } catch {
    // Private windows can refuse storage; the hint is only a convenience.
  }
}

function leaving(method: SignInMethod) {
  try {
    // Per browser, not per tab: an emailed link opens in a new tab.
    localStorage.setItem(RETURNING, JSON.stringify({ method, back: location.pathname + location.search }));
  } catch {
    // Without it they land on the inbox, which is where most sign-ins start anyway.
  }
}

// One email does both: a link to tap on this device, and a six-digit code to type on any device. New people get an
// account from it, so signing up and signing in are the same step. Supabase answers the same whether or not an
// account exists.
export async function sendEmail(email: string): Promise<void> {
  const client = await signedInClient();
  leaving("email");
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/auth/callback` } });
  if (error) fail(error, "We couldn't send the email. Try again in a minute.");
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const client = await signedInClient();
  const { data, error } = await client.auth.verifyOtp({ email, token: code.trim(), type: "email" });
  if (error || !data.session) fail(error, "That code didn't work. Check it, or send a new email.");
  mirror(data.session);
  remember("email");
}

// Leaves for Google and comes back to /auth/callback.
export async function signInWithGoogle(): Promise<void> {
  const client = await signedInClient();
  leaving("google");
  const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: "select_account" } } });
  if (error) fail(error, "Google sign-in didn't start. Try again, or use your email.");
}

// Passkey sign-in. "conditional" offers saved passkeys in the email field's autofill instead of a dialog; it waits
// quietly until they pick one, and the caller aborts it when the form goes away.
export async function signInWithPasskey(options: { conditional?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  const client = await signedInClient();
  const { data, error } = await client.auth.signInWithPasskey({ options: { ...(options.conditional ? { mediation: "conditional" as const } : {}), ...(options.signal ? { signal: options.signal } : {}) } });
  if (error || !data?.session) fail(error, "That passkey didn't work. Try Google or your email instead.");
  mirror(data.session);
  remember("passkey");
}

export async function passkeyAutofillAvailable(): Promise<boolean> {
  const check = (window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> } | undefined)?.isConditionalMediationAvailable;
  return check ? check().catch(() => false) : false;
}

export async function hasPasskey(): Promise<boolean> {
  const client = await accounts();
  if (!client) return false;
  const { data, error } = await client.auth.passkey.list();
  return !error && Array.isArray(data) && data.length > 0;
}

export async function addPasskey(): Promise<void> {
  const client = await signedInClient();
  const { error } = await client.auth.registerPasskey();
  if (error) fail(error, "Your passkey wasn't added. Try again.");
}

// Back from Google or an emailed link: swaps the one-time code in the address for a session. Returns where to go next.
export async function finishRedirect(url: URL): Promise<string> {
  const client = await signedInClient();
  const hash = new URLSearchParams(url.hash.slice(1));
  const problem = url.searchParams.get("error_code") ?? hash.get("error_code") ?? url.searchParams.get("error") ?? hash.get("error");
  let saved: { method?: SignInMethod; back?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(RETURNING) ?? "{}");
  } catch {
    // Nothing saved: go to the inbox.
  }
  if (problem) throw new RedirectProblem(problem === "otp_expired" ? "expired" : "failed");
  const code = url.searchParams.get("code");
  if (!code) throw new RedirectProblem("failed");
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  // The browser that asked for the link holds the other half of it; any other browser can't finish.
  if (error || !data.session) throw new RedirectProblem(saved.method ? "failed" : "other-browser");
  mirror(data.session);
  remember(saved.method ?? (data.session.user.app_metadata?.provider === "google" ? "google" : "email"));
  try {
    localStorage.removeItem(RETURNING);
    sessionStorage.setItem(JUST_SIGNED_IN, "1");
  } catch {
    // The inbox still sees the session; it just won't offer to link straight away.
  }
  const back = saved.back && saved.back.startsWith("/") && !saved.back.startsWith("//") ? saved.back : "/inbox";
  return back.startsWith("/auth/") ? "/inbox" : back;
}

export class RedirectProblem extends Error {
  constructor(readonly kind: "expired" | "failed" | "other-browser") {
    super(kind);
  }
}

// Set by the return page, read once by the inbox so it can link this device's agent to the account.
const JUST_SIGNED_IN = "open_just_signed_in";
export function justSignedIn(): boolean {
  try {
    const yes = sessionStorage.getItem(JUST_SIGNED_IN) === "1";
    sessionStorage.removeItem(JUST_SIGNED_IN);
    return yes;
  } catch {
    return false;
  }
}

// "others" signs out every other device; "local" just this one (the saved agent stays where it is).
export async function signOut(scope: "local" | "others"): Promise<void> {
  const client = await accounts();
  if (!client) return;
  const { error } = await client.auth.signOut({ scope });
  if (error) fail(error, "Signing out didn't work. Try again.");
  if (scope === "local") {
    mirror(null);
    await fetch("/api/account/signout", { method: "POST" });
  }
}

// After signing in: save this device's agent to the account, open the account's agent here, or ask which to keep.
export async function link(choose?: "this" | "saved"): Promise<LinkStatus> {
  const response = await fetch("/api/account/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choose ? { choose } : {}) });
  const body = (await response.json().catch(() => ({}))) as { status?: LinkStatus; error?: string };
  if (!response.ok || !body.status) throw new Error(body.error ?? "Your agent couldn't be saved. Try again.");
  return body.status;
}

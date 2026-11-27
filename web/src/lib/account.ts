"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";

// The browser side of accounts. Supabase signs people in (an emailed code, or a passkey) and keeps their session;
// this keeps a cookie in step with it so every request to Open, a live event stream included, carries the signed
// token Open checks. Supabase's library loads only when accounts are switched on.

export type LinkStatus = "linked" | "switched" | "conflict" | "none";

const TOKEN_COOKIE = "open_at";
let ready: Promise<SupabaseClient | null> | null = null;

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
// first request to Open, so a returning person isn't asked to sign in for nothing.
export function accounts(): Promise<SupabaseClient | null> {
  ready ??= (async () => {
    const config = (await fetch("/api/account/config").then((r) => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false }))) as { enabled: boolean; url?: string; publishableKey?: string };
    if (!config.enabled || !config.url || !config.publishableKey) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    const { data } = await client.auth.getSession();
    mirror(data.session);
    client.auth.onAuthStateChange((_event, session) => mirror(session));
    return client;
  })();
  return ready;
}

export async function signedInEmail(): Promise<string | null> {
  const client = await accounts();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.user.email ?? null;
}

function fail(error: { message?: string } | null | undefined, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// An emailed six-digit code. Supabase says the same thing whether or not an account exists.
export async function sendCode(email: string): Promise<void> {
  const client = await accounts();
  if (!client) fail(null, "Accounts aren't switched on.");
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) fail(error, "We couldn't send a code. Try again in a minute.");
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const client = await accounts();
  if (!client) fail(null, "Accounts aren't switched on.");
  const { data, error } = await client.auth.verifyOtp({ email, token: code.trim(), type: "email" });
  if (error || !data.session) fail(error, "That code didn't work. Check it, or send a new one.");
  mirror(data.session);
}

export async function signInWithPasskey(): Promise<void> {
  const client = await accounts();
  if (!client) fail(null, "Accounts aren't switched on.");
  const { data, error } = await client.auth.signInWithPasskey();
  if (error || !data?.session) fail(error, "That passkey didn't work. Try your email instead.");
  mirror(data.session);
}

export async function addPasskey(): Promise<void> {
  const client = await accounts();
  if (!client) fail(null, "Accounts aren't switched on.");
  const { error } = await client.auth.registerPasskey();
  if (error) fail(error, "Your passkey wasn't added. Try again.");
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

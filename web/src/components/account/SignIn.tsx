"use client";

import { useEffect, useRef, useState } from "react";
import { codeLength, lastMethod, passkeyAutofillAvailable, sendEmail, signInWithGoogle, signInWithPasskey, verifyCode, type SignInMethod } from "@/lib/account";

// One way in, whether they're new or back (as Notion, Linear, Vercel and Claude do): Google, or their email, which
// gets a link to tap and a code to type, and makes an account if they don't have one. Saved passkeys appear in the
// email field's autofill, and the method they used last time on this device is marked. Used to reach a saved agent,
// to save an agent for the first time, and to confirm it's them before something sensitive.

const RESEND_SECONDS = 60;

// Where to read the email, for the common providers. Opening the inbox saves a step on phones especially.
function inboxFor(email: string): { name: string; url: string } | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return { name: "Gmail", url: "https://mail.google.com/mail/u/0/#search/%22sign-in+code%22" };
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return { name: "Outlook", url: "https://outlook.live.com/mail/0/" };
  if (/^(icloud|me|mac)\.com$/.test(domain)) return { name: "iCloud Mail", url: "https://www.icloud.com/mail" };
  if (/^yahoo\./.test(domain)) return { name: "Yahoo Mail", url: "https://mail.yahoo.com" };
  if (/^(proton\.me|protonmail\.com|pm\.me)$/.test(domain)) return { name: "Proton Mail", url: "https://mail.proton.me" };
  return null;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function LastUsed() {
  return <span className="rounded-full bg-paper px-2 py-0.5 font-mono text-[10px] tracking-wider text-slate">LAST USED</span>;
}

export function SignIn({
  mode,
  onDone,
  onCancel,
}: {
  // "save": first time, from the profile. "signin": reaching a saved agent. "confirm": a fresh sign-in for a sensitive step.
  mode: "save" | "signin" | "confirm";
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState<SignInMethod | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last] = useState(lastMethod);
  const autofill = useRef<AbortController | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const digits = codeLength();
  // Confirming happens in the middle of something: Google and the link would leave the page and lose it, so it's
  // a passkey or the code only.
  const confirming = mode === "confirm";

  // Passkeys saved for Open show up in the email field's autofill, without a dialog.
  useEffect(() => {
    let live = true;
    void passkeyAutofillAvailable().then((ok) => {
      if (!ok || !live) return;
      const controller = new AbortController();
      autofill.current = controller;
      signInWithPasskey({ conditional: true, signal: controller.signal })
        .then(() => live && done.current())
        .catch(() => {});
    });
    return () => {
      live = false;
      autofill.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const run = async (kind: SignInMethod | "code", work: () => Promise<void>, after?: () => void) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
      after?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = (to: string) =>
    run("email", () => sendEmail(to), () => {
      setSentTo(to);
      setCode("");
      setWait(RESEND_SECONDS);
    });

  const check = (value: string) => run("code", () => verifyCode(sentTo!, value), onDone);

  const usePasskey = () => {
    autofill.current?.abort();
    void run("passkey", () => signInWithPasskey(), onDone);
  };

  const title = mode === "save" ? "Save your agent" : confirming ? "Confirm it's you" : "Sign in to your agent";
  const lead =
    mode === "save"
      ? "Keep it if this browser forgets you, and reach it from your other devices. New here? This creates your account. No password."
      : confirming
        ? "This changes something important, so we check it's you."
        : "Your agent is saved to an account. Sign in the way you did before.";

  // After the email went out: tap the link, or type the code.
  if (sentTo) {
    const inbox = inboxFor(sentTo);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-semibold">Check your email</h3>
          <p className="text-[13px] text-slate">
            We sent {confirming ? "a code" : "a sign-in link and a code"} to <strong className="text-ink">{sentTo}</strong>.{" "}
            {confirming ? "Type it here." : "Tap the link in this browser, or type the code here."}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void check(code);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`code-${mode}`} className="text-[13px] font-medium">
            {digits}-digit code
          </label>
          <div className="flex gap-2">
            <input
              id={`code-${mode}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`[0-9]{${digits}}`}
              maxLength={digits}
              required
              autoFocus
              value={code}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, digits);
                setCode(value);
                // A pasted or autofilled code goes straight in.
                if (value.length === digits && busy !== "code") void check(value);
              }}
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-center font-mono text-base tracking-[0.3em] outline-none focus:border-ink"
            />
            <button type="submit" disabled={!!busy || code.length !== digits} className="min-h-11 shrink-0 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
              {busy === "code" ? "Checking…" : "Continue"}
            </button>
          </div>
        </form>
        {inbox && (
          <a href={inbox.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center rounded-full border border-line bg-white px-4 text-sm font-medium hover:border-ink">
            Open {inbox.name}
          </a>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate">
          <button type="button" disabled={wait > 0 || !!busy} onClick={() => void send(sentTo)} className="min-h-9 underline underline-offset-2 disabled:no-underline disabled:opacity-60">
            {wait > 0 ? `Send again in ${wait}s` : "Send again"}
          </button>
          <button type="button" onClick={() => setSentTo(null)} className="min-h-9 underline underline-offset-2">
            Use a different email
          </button>
        </div>
        <p className="text-xs text-slate">Not there? Check spam, or wait a minute: emails can take a moment.</p>
        {error && (
          <p role="alert" className="text-[13px] text-signal-ink">
            {error}
          </p>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-9 self-start text-[13px] text-slate underline underline-offset-2">
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="text-[13px] text-slate">{lead}</p>
      </div>

      {confirming ? (
        <button type="button" disabled={!!busy} onClick={usePasskey} className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
          {busy === "passkey" ? "Waiting for your passkey…" : "Use my passkey"}
          {last === "passkey" && <LastUsed />}
        </button>
      ) : (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run("google", signInWithGoogle)}
          className="flex min-h-11 items-center justify-center gap-2.5 rounded-full border border-line bg-white px-5 text-sm font-semibold text-ink transition-colors hover:border-ink disabled:opacity-40"
        >
          <GoogleMark />
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
          {last === "google" && <LastUsed />}
        </button>
      )}

      <div className="flex items-center gap-3 text-xs text-slate" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(email.trim());
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={`email-${mode}`} className="flex items-center gap-2 text-[13px] font-medium">
          Email {last === "email" && <LastUsed />}
        </label>
        <input
          id={`email-${mode}`}
          type="email"
          required
          autoComplete="username webauthn"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-11 rounded-full border border-line bg-white px-4 text-base outline-none focus:border-ink sm:text-sm"
        />
        <button type="submit" disabled={!!busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
          {busy === "email" ? "Sending…" : confirming ? "Email me a code" : "Continue with email"}
        </button>
      </form>

      {!confirming && mode === "signin" && (
        <button type="button" disabled={!!busy} onClick={usePasskey} className="flex min-h-9 items-center gap-2 self-start text-[13px] text-slate underline underline-offset-2 hover:text-ink">
          {busy === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
          {last === "passkey" && <LastUsed />}
        </button>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-signal-ink">
          {error}
        </p>
      )}

      {!confirming && (
        <p className="text-xs text-slate">
          By continuing you agree to{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-ink">
            how Open uses your data
          </a>
          .
        </p>
      )}

      {onCancel && (
        <button type="button" onClick={onCancel} className="min-h-9 self-start text-[13px] text-slate underline underline-offset-2">
          Cancel
        </button>
      )}
    </div>
  );
}

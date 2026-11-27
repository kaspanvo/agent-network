"use client";

import { useState } from "react";
import { sendCode, signInWithPasskey, verifyCode } from "@/lib/account";

// Signing in: a passkey if they have one, otherwise a six-digit code by email. Used to reach a saved agent, to save
// an agent for the first time, and to confirm it's them before something sensitive.
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
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      after?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "save" ? "Save your agent" : mode === "confirm" ? "Confirm it's you" : "Sign in to your agent";
  const lead =
    mode === "save"
      ? "So you don't lose it if this browser forgets you, and so you can reach it from your other devices. We send a code; no password."
      : mode === "confirm"
        ? "This changes something important, so we check it's you."
        : "This agent is saved to an account. Use your passkey, or get a code by email.";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="text-[13px] text-slate">{lead}</p>
      </div>
      {mode !== "save" && (
        <button type="button" disabled={busy} onClick={() => void run(signInWithPasskey, onDone)} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
          Use my passkey
        </button>
      )}
      {!sent ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => sendCode(email.trim()), () => setSent(true));
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`email-${mode}`} className="text-[13px] font-medium">
            {mode === "save" ? "Your email" : "Or get a code by email"}
          </label>
          <div className="flex gap-2">
            <input
              id={`email-${mode}`}
              type="email"
              required
              autoComplete="username webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-sm outline-none focus:border-ink"
            />
            <button type="submit" disabled={busy || !email.includes("@")} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold disabled:opacity-40 ${mode === "save" ? "bg-ink text-white" : "border border-ink"}`}>
              Send code
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => verifyCode(email.trim(), code), onDone);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`code-${mode}`} className="text-[13px] font-medium">
            The 6-digit code we sent to {email}
          </label>
          <div className="flex gap-2">
            <input
              id={`code-${mode}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="min-h-11 w-32 rounded-full border border-line bg-white px-4 text-center font-mono tracking-[0.3em] outline-none focus:border-ink"
            />
            <button type="submit" disabled={busy || code.length !== 6} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
              {mode === "save" ? "Save" : "Continue"}
            </button>
          </div>
          <button type="button" onClick={() => setSent(false)} className="min-h-9 self-start text-[13px] text-slate underline underline-offset-2">
            Use a different email
          </button>
        </form>
      )}
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

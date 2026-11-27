"use client";

import { useState } from "react";
import { addPasskey, signOut } from "@/lib/account";
import { SignIn } from "./SignIn";

// In the profile: save your agent to an account, or, once saved, manage how you sign in.
export function AccountSection({ savedTo, onSaved, onSignedOut }: { savedTo: string | null; onSaved: () => void; onSignedOut: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
      setNote(done);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!savedTo)
    return (
      <section aria-label="Save your agent" className="rounded-2xl border border-line bg-white p-4">
        <SignIn mode="save" onDone={onSaved} />
      </section>
    );

  return (
    <section aria-label="Your account" className="flex flex-col gap-2 rounded-2xl bg-paper p-4 text-[13px]">
      <h3 className="font-mono text-[11px] tracking-wider text-slate">YOUR ACCOUNT</h3>
      <p>
        Your agent is saved to <strong>{savedTo}</strong>. Only you can reach it, from any device you sign in on.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void act(addPasskey, "Passkey added. Next time, sign in with it.")} className="min-h-10 rounded-full bg-ink px-4 font-semibold text-white disabled:opacity-40">
          Add a passkey
        </button>
        <button type="button" disabled={busy} onClick={() => void act(() => signOut("others"), "Signed out everywhere else.")} className="min-h-10 rounded-full border border-line bg-white px-4 disabled:opacity-40">
          Sign out other devices
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await signOut("local");
              onSignedOut();
            }, "Signed out.")
          }
          className="min-h-10 rounded-full px-3 underline underline-offset-2 disabled:opacity-40"
        >
          Sign out
        </button>
      </div>
      {note && (
        <p role="status" className="text-slate">
          {note}
        </p>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AgentAvatar } from "@/components/inbox/Avatar";
import { finishRedirect, RedirectProblem } from "@/lib/account";

// Where Google and emailed links bring people back: finishes signing in, then returns them where they started.
const PROBLEMS: Record<RedirectProblem["kind"], { title: string; body: string }> = {
  expired: { title: "That link has expired", body: "Links work once, for an hour. Go back and send a new email, or type the code from it." },
  "other-browser": {
    title: "Open it in the browser you started in",
    body: "For your safety, a sign-in link only works in the browser that asked for it. Go back to that one, or type the code from the email there.",
  },
  failed: { title: "That didn't sign you in", body: "The link may have been used already. Go back and try again." },
};

export function SignInReturn() {
  const [problem, setProblem] = useState<RedirectProblem["kind"] | null>(null);

  useEffect(() => {
    finishRedirect(new URL(window.location.href))
      .then((next) => window.location.replace(next))
      .catch((err) => setProblem(err instanceof RedirectProblem ? err.kind : "failed"));
  }, []);

  const shown = problem ? PROBLEMS[problem] : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader label="SIGNING IN" mode={null} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
        <AgentAvatar size={64} state={shown ? "idle" : "learning"} />
        {shown ? (
          <>
            <h1 className="font-display text-2xl">{shown.title}</h1>
            <p className="text-sm text-slate">{shown.body}</p>
            <a href="/inbox" className="flex min-h-11 items-center justify-center self-start rounded-full bg-ink px-5 text-sm font-semibold text-white">
              Back to Open
            </a>
          </>
        ) : (
          <p role="status" className="text-sm text-slate">
            Signing you in…
          </p>
        )}
      </main>
    </div>
  );
}

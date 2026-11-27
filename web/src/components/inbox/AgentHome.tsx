"use client";

import { AgentAvatar, type AgentState } from "./Avatar";

// The top of the inbox: what your agent is doing right now, what it's waiting on, and the one thing to do next.
// On a phone it's the first thing you see, instead of a near-empty list.
export function AgentHome({
  state,
  headline,
  lines,
  action,
}: {
  state: AgentState;
  headline: string;
  lines: string[];
  action: { label: string; onClick: () => void } | null;
}) {
  return (
    <section aria-label="Your agent now" className="mx-2 mt-3 flex flex-col gap-3 rounded-2xl bg-ink p-4 text-white">
      <div className="flex items-center gap-3">
        <AgentAvatar size={52} state={state} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-wider text-mist">YOUR AGENT · AI</span>
          <p aria-live="polite" className="font-display text-[17px] leading-snug">
            {headline}
          </p>
        </div>
      </div>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px] text-haze">
          {lines.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span className="size-1 shrink-0 rounded-full bg-signal-light" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      )}
      {action && (
        <button type="button" onClick={action.onClick} className="min-h-11 self-start rounded-full bg-white px-5 text-sm font-semibold text-ink hover:bg-cloud">
          {action.label}
        </button>
      )}
    </section>
  );
}

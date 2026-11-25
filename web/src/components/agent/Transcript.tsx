"use client";

import { useEffect, useRef } from "react";
import { formatPrice } from "@/server/domain";
import type { Thread } from "./state";

function Why({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 text-[13px] leading-snug text-slate">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" />
      </svg>
      <span>
        <span className="sr-only">Why: </span>
        {children}
      </span>
    </p>
  );
}

export function Transcript({ thread, running }: { thread: Thread | null; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = thread?.messages.length ?? 0;
  // Follow a live negotiation; leave the page where it is when reopening a finished one.
  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [running, count, thread?.outcome]);

  if (!thread)
    return <p className="p-5 text-sm text-slate">Conversations appear here as your agent meets other agents. You&apos;ll see every message and why your agent made it.</p>;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-wider text-slate">{thread.about.toUpperCase()}</span>
        <h2 className="font-display text-xl font-medium">{thread.who}&apos;s agent and yours</h2>
        <Why>{thread.why}</Why>
      </div>

      {thread.room && (
        <div className="flex animate-rise flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-signal-light bg-[#fff7f3] p-3.5">
          <span className="font-mono text-[11px] tracking-wider text-signal-ink">ROOM OPENED · {thread.room.members.length} PEOPLE</span>
          <div className="flex flex-wrap gap-1.5">
            {thread.room.members.map((m) => (
              <span key={m} className="rounded-full bg-white px-2.5 py-1 text-sm">{m}</span>
            ))}
          </div>
          <Why>{thread.room.why}</Why>
        </div>
      )}

      <ol className="flex flex-col gap-4" aria-live="polite">
        {thread.messages.map((m, i) => {
          const mine = m.from === "you";
          return (
            <li key={i} className={`flex animate-rise flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
              <span className="font-mono text-[10px] tracking-wider text-slate">
                {m.who.toUpperCase()} · {m.action}
                {m.amount !== null && ` · ${formatPrice(m.amount, m.unit)}`}
              </span>
              <p className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] ${mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-[#f1f3f6]"}`}>{m.text}</p>
              <div className={`max-w-[88%] ${mine ? "text-right" : ""}`}>
                <Why>{m.why}</Why>
              </div>
            </li>
          );
        })}
      </ol>

      {running && !thread.outcome && (
        <span className="flex items-center gap-2 font-mono text-xs text-slate">
          <span className="size-1.5 animate-blink rounded-full bg-signal" />
          NEGOTIATING
        </span>
      )}
      {thread.outcome && (
        <p className={`animate-rise rounded-xl px-4 py-3 text-sm ${thread.outcome.result === "agreed" ? "bg-live-soft text-live-ink" : "bg-paper text-slate"}`}>
          <strong className="font-semibold">{thread.outcome.result === "agreed" ? "Agreed. " : "No fit. "}</strong>
          {thread.outcome.why}
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}

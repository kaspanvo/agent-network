"use client";

import { useState } from "react";
import { AgentAvatar, AvatarStack } from "./Avatar";

export type ConversationSummary = {
  id: string;
  kind: "agent" | "room";
  title: string;
  preview: string;
  people: string[];
  badge: { text: string; tone: "live" | "good" | "muted" | "signal" } | null;
  unread: number;
  typing: boolean;
  // What the person needs to do here, if anything: "Approve", "Answer", "Check in".
  needs: string | null;
  // Where it sits: needs you, waiting on someone or something else, or done.
  section: "needs" | "waiting" | "done";
};

const TONE = {
  live: "bg-signal-soft text-signal-ink",
  good: "bg-live-soft text-live-ink",
  muted: "bg-[#f1f2f4] text-slate",
  signal: "bg-ink text-white",
} as const;

function Row({ c, selected, onSelect }: { c: ConversationSummary; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${selected ? "bg-paper" : "hover:bg-paper/70"}`}
      >
        {c.kind === "agent" ? <AgentAvatar size={40} /> : <AvatarStack names={c.people} size={32} />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate ${c.unread ? "font-semibold" : "font-medium"}`}>{c.title}</span>
            {c.needs ? (
              <span className="shrink-0 rounded-full bg-signal px-2 py-0.5 font-mono text-[10px] tracking-wide text-white">{c.needs.toUpperCase()}</span>
            ) : (
              c.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide ${TONE[c.badge.tone]}`}>{c.badge.text}</span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2">
            {c.typing ? (
              <span className="flex items-center gap-1.5 text-sm text-signal-ink">
                <span className="flex gap-0.5" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1 animate-blink rounded-full bg-signal" style={{ animationDelay: `${i * 160}ms` }} />
                  ))}
                </span>
                Typing…
              </span>
            ) : (
              <span className={`truncate text-sm ${c.unread ? "text-ink" : "text-slate"}`}>{c.preview}</span>
            )}
            {c.unread > 0 && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-signal px-1.5 text-[11px] font-semibold text-white">
                <span className="sr-only">Unread: </span>
                {c.unread}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function Sidebar({
  conversations,
  selected,
  onSelect,
  query,
  onQuery,
}: {
  conversations: ConversationSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const [showDone, setShowDone] = useState(false);
  const agent = conversations.find((c) => c.kind === "agent");
  const matches = (c: ConversationSummary) => c.title.toLowerCase().includes(q);
  // Sorted by what each needs from the person, the way team inboxes for agents do it: what needs you stays at the top
  // until it's dealt with, not just until it's opened; what's waiting on others comes next; what's done folds away.
  const needs = conversations.filter((c) => c.needs && matches(c));
  const waiting = conversations.filter((c) => c.kind === "room" && !c.needs && c.section === "waiting" && matches(c));
  const done = conversations.filter((c) => c.kind === "room" && !c.needs && c.section === "done" && matches(c));
  const row = (c: ConversationSummary) => <Row key={c.id} c={c} selected={selected === c.id} onSelect={() => onSelect(c.id)} />;
  const heading = (text: string) => <h2 className="px-3 pb-1 pt-4 font-mono text-[11px] tracking-wider text-slate">{text}</h2>;
  return (
    <nav aria-label="Conversations" className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-3">
        <label htmlFor="search" className="sr-only">Search conversations</label>
        <input
          id="search"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search rooms"
          className="min-h-10 w-full rounded-full border border-line bg-paper px-4 text-sm outline-none focus:border-ink"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {needs.length > 0 && (
          <section aria-label="Needs you">
            <h2 className="flex items-center gap-2 px-3 pb-1 pt-2 font-mono text-[11px] tracking-wider text-signal-ink">
              <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
              NEEDS YOU · {needs.length}
            </h2>
            <ul className="flex flex-col">{needs.map(row)}</ul>
          </section>
        )}
        {agent && !agent.needs && <ul className="flex flex-col">{row(agent)}</ul>}
        {waiting.length + done.length === 0 ? (
          <>
            {heading("ROOMS")}
            <p className="px-3 py-2 text-sm text-slate">
              {query ? "No rooms match." : needs.length ? "Nothing else right now." : "When your agent starts talking with other agents, each conversation appears here."}
            </p>
          </>
        ) : (
          <>
            {waiting.length > 0 && (
              <section aria-label="Waiting on others">
                {heading(`WAITING ON OTHERS · ${waiting.length}`)}
                <ul className="flex flex-col">{waiting.map(row)}</ul>
              </section>
            )}
            {done.length > 0 && (
              <section aria-label="Done">
                <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone || !!q} className="flex min-h-10 w-full items-center justify-between px-3 pt-3 font-mono text-[11px] tracking-wider text-slate hover:text-ink">
                  <span>DONE · {done.length}</span>
                  <span aria-hidden="true">{showDone || q ? "−" : "+"}</span>
                </button>
                {(showDone || !!q) && <ul className="flex flex-col opacity-80">{done.map(row)}</ul>}
              </section>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

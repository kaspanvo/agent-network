"use client";

import { formatPrice, isInterest, lowerFirst, sharedLine, type AboutNote, type ProfileIntent, type Unit } from "@/server/domain";
import type { Check } from "@/server/audit";
import type { Opportunity } from "@/server/negotiation/types";
import type { AgentMode } from "@/server/pace";
import type { Disclosure } from "@/server/disclosure";
import type { LogActor, LogEntry } from "@/server/store";
import { useState } from "react";
import { NetworkGraph } from "../agent/NetworkGraph";
import { AgentPanel } from "../start/AgentPanel";
import { AgentAvatar, Avatar } from "./Avatar";
import type { Shortlist, Thread } from "./runState";

const DOT: Record<LogEntry["kind"], string> = {
  setup: "bg-mist",
  found: "bg-ink",
  shared: "bg-signal",
  offer: "bg-signal",
  you: "bg-[#d5d9e1]",
  decision: "bg-live",
  followup: "bg-live",
  withheld: "bg-[#b45309]",
  read: "bg-mist",
  hold: "bg-mist",
};

const BY: { value: LogActor | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "agent", label: "Your agent" },
  { value: "you", label: "You" },
  { value: "open", label: "Open" },
];

const SEEN: Record<Disclosure["status"], { label: (to: string) => string; cls: string }> = {
  shared: { label: (to) => `Shared with ${to}`, cls: "bg-signal-soft text-signal-ink" },
  private: { label: (to) => to, cls: "bg-live-soft text-live-ink" },
  on_yes: { label: () => "Only after everyone says yes", cls: "bg-[#eef0f4] text-ink" },
};

// What this room knows about the person, and the rule behind each item. Worked out in code from the room's record.
function WhoSeesWhat({ items }: { items: Disclosure[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Who sees what in this room" className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] tracking-wider text-slate">WHO SEES WHAT</h3>
      <ul className="flex flex-col gap-2">
        {items.map((d) => (
          <li key={d.what} className="flex flex-col gap-1 rounded-xl border border-line px-3 py-2">
            <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{d.what}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${SEEN[d.status].cls}`}>{SEEN[d.status].label(d.to)}</span>
            </span>
            <span className="text-[13px] text-slate">{d.because}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-slate">Worked out in code from this room&apos;s record, not by the AI.</p>
    </section>
  );
}

function time(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Everything the agent did in the person's name, newest first. What it said and to whom is marked in orange.
function ActivityLog({ log, intact, onOpenRoom }: { log: LogEntry[]; intact: boolean; onOpenRoom: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const [by, setBy] = useState<LogActor | "all">("all");
  // Entries from before actors were recorded were all written by the agent or the person; they show under All.
  const entries = [...log].reverse().filter((e) => by === "all" || e.by === by);
  const shown = all ? entries : entries.slice(0, 12);
  return (
    <section aria-label="Your agent's activity" className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="font-mono text-[11px] tracking-wider text-slate">ACTIVITY · ONLY YOU SEE THIS</h3>
      <p className="text-[13px] text-slate">
        Everything your agent did in your name. <span className="inline-block size-1.5 rounded-full bg-signal align-middle" aria-hidden="true" /> marks what it said to other agents.
      </p>
      {log.length > 0 && (
        <div role="group" aria-label="Show entries by who acted" className="flex flex-wrap gap-1.5">
          {BY.map((b) => (
            <button
              key={b.value}
              type="button"
              aria-pressed={by === b.value}
              onClick={() => setBy(b.value)}
              className={`min-h-8 rounded-full border px-3 text-[12px] ${by === b.value ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {log.length > 0 && (
        <p className={`text-[12px] ${intact ? "text-live-ink" : "text-signal-ink"}`}>
          {intact ? "✓ Each entry is chained to the one before, so any later edit would show." : "This log was changed after it was written."}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-slate">{log.length === 0 ? "Nothing yet." : "Nothing from them yet."}</p>
      ) : (
        <ol className="flex flex-col">
          {shown.map((entry, i) => {
            const body = (
              <>
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT[entry.kind]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-[13px] leading-snug">{entry.text}</span>
                <time dateTime={entry.at} className="shrink-0 font-mono text-[11px] text-slate">
                  {time(entry.at)}
                </time>
              </>
            );
            return (
              <li key={`${entry.at}-${i}`}>
                {entry.room ? (
                  <button type="button" onClick={() => onOpenRoom(entry.room!)} className="flex w-full gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-paper">
                    {body}
                  </button>
                ) : (
                  <div className="flex gap-2.5 px-1.5 py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {entries.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="min-h-9 self-start text-sm font-medium underline underline-offset-2">
          {all ? "Show less" : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}

// What the agent knows about the person, split by who gets to see it, with a way to make it forget.
function Knows({ intents, understanding, onForget }: { intents: ProfileIntent[]; understanding: { agreed: number; total: number; betterThanChance: boolean } | null; onForget: (id: string) => void }) {
  const active = intents.filter((i) => i.status === "confirmed");
  if (active.length === 0) return null;
  return (
    <section aria-label="What your agent knows" className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="font-mono text-[11px] tracking-wider text-slate">WHAT YOUR AGENT KNOWS</h3>
      {understanding && (
        <p className="text-sm">
          It guessed <strong>{understanding.agreed} of {understanding.total}</strong> of your either/or picks before going out
          {understanding.betterThanChance ? ", clearly better than guessing." : ". That's not yet clearly better than guessing, so it may miss what you want."}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Shares in rooms</span>
        <ul className="flex flex-col gap-1">
          {active.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-2 rounded-lg bg-paper px-2.5 py-1.5 text-[13px]">
              <span>{sharedLine(i)}</span>
              <button type="button" onClick={() => onForget(i.id)} aria-label={`Forget ${i.summary}`} className="min-h-7 shrink-0 text-slate underline underline-offset-2 hover:text-ink">
                Forget
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Keeps to itself</span>
        <ul className="flex flex-col gap-1 text-[13px] text-slate">
          {active.map((i) => (
            <li key={i.id} className="rounded-lg border border-line px-2.5 py-1.5">
              <span className="text-ink">{i.summary}</span>
              {!isInterest(i) && i.price !== null && ` · ${i.direction === "seek" ? "limit" : "floor"} ${formatPrice(i.price, i.unit)}, only for Open's matcher`}
              {i.priority === 1 && " · your top priority"}
              {i.evidence && <span className="block">From what you said: &ldquo;{i.evidence}&rdquo;</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Which model runs the agent, and that it's the same for everyone, so no one's agent out-bargains yours by being stronger.
function ModelNote({ mode, model }: { mode: AgentMode | null; model: string | null }) {
  return (
    <section className="flex flex-col gap-1 rounded-2xl bg-paper p-3.5">
      <h3 className="font-mono text-[11px] tracking-wider text-slate">YOUR AGENT&apos;S MODEL</h3>
      <span className="font-display text-lg">{mode !== "demo" && model ? model : "Demo agent, no AI model"}</span>
      <span className="text-[13px] text-slate">
        {mode === "open"
          ? "No Claude key is set, so an open model on Cloudflare Workers AI runs every agent in the pilot for now, the same model for everyone. If it's unavailable or today's free allowance runs out, the scripted agent takes over."
          : mode === "claude"
          ? "Everything that speaks or decides for someone in this pilot runs on this model, at the same effort, so nobody's agent gets better deals by being stronger than yours. Smaller models only word what code already decided, or read a page you shared."
          : "Scripted replies. Every agent in the demo follows the same rules, so none has an edge."}
      </span>
    </section>
  );
}

export function AgentDetails(props: {
  name: string;
  intents: ProfileIntent[];
  goals: string[];
  about: AboutNote[];
  ready: boolean;
  threads: Thread[];
  activeId: string | null;
  running: boolean;
  onDecide: (id: string, status: "confirmed" | "rejected") => void;
  onSendOut: () => void;
  sentOut: boolean;
  mode: AgentMode | null;
  model: string | null;
  log: LogEntry[];
  logIntact: boolean;
  understanding: { agreed: number; total: number; betterThanChance: boolean } | null;
  onOpenRoom: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ModelNote mode={props.mode} model={props.model} />
      <AgentPanel
        name={props.name}
        intents={props.intents}
        goals={props.goals}
        about={props.about}
        ready={props.ready}
        onDecide={props.onDecide}
        footer={
          !props.sentOut && (
            <button
              type="button"
              onClick={props.onSendOut}
              disabled={!props.ready}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink font-semibold text-white disabled:bg-[#e9ecf1] disabled:text-slate"
            >
              Send my agent out
            </button>
          )
        }
      />
      {props.threads.length > 0 && (
        <section aria-label="Your agent's network" className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="font-mono text-[11px] tracking-wider text-slate">NETWORK</h3>
          <NetworkGraph threads={props.threads} activeId={props.activeId} running={props.running} />
        </section>
      )}
      <Knows intents={props.intents} understanding={props.understanding} onForget={(id) => props.onDecide(id, "rejected")} />
      <ActivityLog log={props.log} intact={props.logIntact} onOpenRoom={props.onOpenRoom} />
    </div>
  );
}

export function RoomDetails({
  thread,
  you,
  opportunity,
  limit,
  busy,
  onMessage,
  shortlist,
  checks,
  disclosures,
}: {
  checks: Check[];
  disclosures: Disclosure[];
  thread: Thread;
  you: string;
  shortlist: Shortlist | undefined;
  opportunity: Opportunity | undefined;
  limit: { value: number; unit: Unit; direction: "seek" | "offer" } | null;
  busy: boolean;
  onMessage: (name: string) => void;
}) {
  const role = (name: string) => {
    if (thread.mode === "private") return "Answers from what they've shared";
    if (thread.mode === "circle") return `Into ${lowerFirst(thread.about)} too`;
    if (name === thread.who) return thread.grouped ? "Offers the group rate" : "The other side";
    return `Wants the same: ${lowerFirst(thread.about)}`;
  };
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5">
        <h3 className="font-mono text-[11px] tracking-wider text-slate">IN THIS ROOM</h3>
        <ul className="flex flex-col gap-2">
          <li className="flex items-center gap-2.5">
            <AgentAvatar size={30} />
            <span className="flex flex-col">
              <span className="font-medium">Your agent</span>
              <span className="text-[13px] text-slate">Speaks for {you}</span>
            </span>
          </li>
          {thread.others.map((name) => (
            <li key={name} className="flex items-center gap-2.5">
              <Avatar name={name} size={30} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{name}&apos;s agent</span>
                <span className="text-[13px] text-slate">{role(name)}</span>
              </span>
              {thread.mode !== "private" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMessage(name)}
                  aria-label={`Message ${name}'s agent privately`}
                  className="min-h-9 shrink-0 rounded-full border border-line px-3 text-[13px] font-medium hover:border-ink disabled:opacity-40"
                >
                  Message
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {limit && (
        <section className="flex flex-col gap-1 rounded-2xl bg-paper p-3.5">
          <h3 className="font-mono text-[11px] tracking-wider text-slate">YOUR PRIVATE {limit.direction === "seek" ? "LIMIT" : "FLOOR"}</h3>
          <span className="font-display text-xl">{formatPrice(limit.value, limit.unit)}</span>
          <span className="text-[13px] text-slate">Only Open&apos;s matcher sees this, in code. No agent and no AI model ever does.</span>
        </section>
      )}

      {opportunity && (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[11px] tracking-wider text-slate">{opportunity.kind === "plan" ? "PLAN" : `PROPOSAL · VERSION ${opportunity.version}`}</h3>
          <p className="font-medium">{opportunity.title}</p>
          <p className="flex flex-wrap gap-1.5">
            {opportunity.terms.map((t) => (
              <span key={t} className="rounded-full bg-paper px-2.5 py-1 text-sm">{t}</span>
            ))}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-slate">
            {opportunity.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {checks.length > 0 && (
        <section aria-label="Checks on your agent" className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[11px] tracking-wider text-slate">
            CHECKS · {checks.filter((c) => c.ok).length} OF {checks.length} PASSED
          </h3>
          <ul className="flex flex-col gap-1">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-2 text-sm">
                <span aria-hidden="true" className={c.ok ? "text-live-ink" : "text-signal-ink"}>
                  {c.ok ? "✓" : "!"}
                </span>
                <span>
                  {c.label}
                  <span className="sr-only">{c.ok ? ": passed" : ": failed"}</span>
                  <span className="block text-[13px] text-slate">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-slate">Checked in code from the room&apos;s record, not by the AI.</p>
        </section>
      )}

      <WhoSeesWhat items={disclosures} />

      {shortlist && (
        <section className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[11px] tracking-wider text-slate">{shortlist.chosen === thread.id ? "PICKED OVER" : "YOUR AGENT PICKED INSTEAD"}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {shortlist.options
              .filter((o) => (shortlist.chosen === thread.id ? o.threadId !== thread.id : o.threadId === shortlist.chosen))
              .map((o) => (
                <li key={o.threadId} className="flex justify-between gap-3">
                  <span>
                    {o.who} <span className="text-slate">· {o.group ? "small group" : "one-to-one"}</span>
                  </span>
                  <span className="font-mono text-xs">{formatPrice(o.price, o.unit)}</span>
                </li>
              ))}
          </ul>
          <p className="text-[13px] text-slate">{shortlist.why}</p>
        </section>
      )}

      <section className="flex flex-col gap-1 border-t border-line pt-4">
        <h3 className="font-mono text-[11px] tracking-wider text-slate">WHY YOUR AGENT OPENED THIS</h3>
        <p className="text-sm text-slate">{thread.why}</p>
      </section>
    </div>
  );
}

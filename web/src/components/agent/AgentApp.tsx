"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { formatPrice } from "@/server/domain";
import type { AgentMode } from "@/server/pace";
import type { PublicSession } from "@/server/store";
import { AppHeader } from "../AppHeader";
import { NetworkGraph } from "./NetworkGraph";
import { emptyRun, reduce, threadState, type RunState } from "./state";
import { Transcript } from "./Transcript";

const STATE_LABEL = {
  talking: { text: "NEGOTIATING", cls: "bg-signal-soft text-signal-ink", dot: "bg-signal" },
  agreed: { text: "AGREED", cls: "bg-live-soft text-live-ink", dot: "bg-live" },
  no_fit: { text: "NO FIT", cls: "bg-[#f1f2f4] text-slate", dot: "border-2 border-[#b7bfcc]" },
} as const;

export function AgentApp() {
  const [mode, setMode] = useState<AgentMode | null>(null);
  const [session, setSession] = useState<PublicSession | null | undefined>(undefined);
  const [run, setRun] = useState<RunState>(emptyRun);
  const [running, setRunning] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<PublicSession["decisions"]>({});
  const started = useRef(false);

  const go = async () => {
    setRunning(true);
    setRun(emptyRun);
    setPicked(null);
    setDecisions({});
    try {
      for await (const event of await api.run()) setRun((s) => reduce(s, event));
    } catch (err) {
      setRun((s) => ({ ...s, error: (err as Error).message }));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .session()
      .then(({ mode, session }) => {
        setMode(mode);
        setSession(session);
        if (!session) return;
        setDecisions(session.decisions);
        if (session.run) setRun(session.run.events.reduce(reduce, emptyRun));
        else if (session.ready) void go();
      })
      .catch(() => setSession(null));
  }, []);

  const decide = async (id: string, decision: "approved" | "declined") => {
    const result = await api.decide(id, decision);
    setDecisions(result.decisions);
  };

  const selectedId = picked ?? run.activeId;
  const selected = run.threads.find((t) => t.id === selectedId) ?? null;
  const stats = run.stats ?? {
    contacted: run.threads.length,
    rooms: run.threads.filter((t) => t.room).length,
    ready: run.opportunities.length,
  };

  if (session === null || (session && !session.ready && !session.run)) {
    return (
      <div className="flex min-h-dvh flex-col">
        <AppHeader label="YOUR AGENT" mode={mode} />
        <main className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-4 px-4">
          <h1 className="font-display text-3xl tracking-tight">Your agent isn&apos;t ready yet</h1>
          <p className="text-slate">Tell it what you&apos;d be open to and set a price, and it can start negotiating.</p>
          <Link href="/start" className="rounded-full bg-ink px-6 py-3 font-semibold text-white">
            Set up my agent
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader label="YOUR AGENT" mode={mode}>
        <Link href="/start" className="flex min-h-11 items-center rounded-full border border-navy-600 px-3.5 text-sm hover:border-mist">
          Adjust intents
        </Link>
        <button type="button" onClick={go} disabled={running || !session} className="min-h-11 rounded-full border border-navy-600 px-3.5 text-sm hover:border-mist disabled:opacity-40">
          Run again
        </button>
      </AppHeader>

      <section className="bg-navy-950 text-cloud">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pb-7 pt-3 sm:px-6 lg:px-10">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 font-mono text-xs tracking-wider text-mist">
              <span aria-hidden="true" className={`size-1.5 rounded-full ${running ? "animate-blink bg-live" : "bg-mist"}`} />
              {running ? "LIVE · LISBON PILOT" : "LISBON PILOT"}
            </span>
            <h1 className="font-display text-[clamp(1.9rem,4.6vw,3.2rem)] leading-tight tracking-[-0.03em]">
              {running ? "Your agent is out talking" : run.threads.length ? "What your agent found" : "Getting ready"}
            </h1>
            <p className="min-h-6 text-mist" aria-live="polite">
              {run.error ?? run.status ?? (running ? "" : `Talked with ${stats.contacted} agent${stats.contacted === 1 ? "" : "s"}.`)}
            </p>
          </div>
          <dl className="flex flex-wrap gap-2.5">
            {[
              ["agents contacted", stats.contacted],
              ["rooms opened", stats.rooms],
              ["ready for you", stats.ready],
            ].map(([label, value], i) => (
              <div key={label} className="flex flex-col-reverse rounded-2xl border border-navy-700 bg-navy-900 px-4 py-2.5">
                <dt className="text-xs text-mist">{label}</dt>
                <dd className={`font-display text-2xl tabular-nums ${i === 2 && Number(value) > 0 ? "text-signal-light" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-10">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Your agent's network" className="rounded-3xl border border-line bg-white p-4">
            <NetworkGraph threads={run.threads} activeId={selectedId} running={running} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[13px] text-slate">
              {Object.values(STATE_LABEL).map((s) => (
                <span key={s.text} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`size-2.5 rounded-full ${s.dot}`} />
                  {s.text.charAt(0) + s.text.slice(1).toLowerCase()}
                </span>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-display text-xl font-medium">Conversations</h2>
            {run.threads.length === 0 && <p className="text-sm text-slate">{running ? "Looking for agents whose intents fit yours…" : "No conversations yet."}</p>}
            {run.threads.map((thread) => {
              const s = STATE_LABEL[threadState(thread)];
              const isOpen = thread.id === selectedId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  aria-pressed={isOpen}
                  onClick={() => setPicked(thread.id)}
                  className={`flex w-full animate-rise items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left ${isOpen ? "border-ink bg-white" : "border-line hover:bg-white"}`}
                >
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${s.dot}`} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <strong className="font-semibold">{thread.who}&apos;s agent</strong>
                    <span className="truncate text-sm text-slate">
                      {thread.about}
                      {thread.room ? ` · room of ${thread.room.members.length}` : ""}
                    </span>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${s.cls}`}>{s.text}</span>
                </button>
              );
            })}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Negotiation transcript" className="rounded-3xl border border-line bg-white lg:sticky lg:top-4 lg:max-h-[70vh] lg:overflow-y-auto">
            <Transcript thread={selected} running={running} />
          </section>

          {run.opportunities.map((o) => {
            const decision = decisions[o.id];
            return (
              <section key={o.id} aria-label={`Proposal: ${o.title}`} className="flex animate-rise flex-col gap-3 rounded-3xl border-[1.5px] border-signal bg-white p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-signal-ink">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
                    PROPOSAL · VERSION {o.version}
                  </span>
                  <span className="font-display text-2xl">{formatPrice(o.price, o.unit)}</span>
                </div>
                <h3 className="font-display text-lg font-medium">{o.title}</h3>
                <p className="flex flex-wrap gap-1.5">
                  {o.terms.map((t) => (
                    <span key={t} className="rounded-full bg-paper px-2.5 py-1 text-sm">{t}</span>
                  ))}
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-slate">
                  {o.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {decision ? (
                  <p className={`rounded-xl px-4 py-3 text-sm ${decision === "approved" ? "bg-live-soft text-live-ink" : "bg-paper text-slate"}`}>
                    {decision === "approved"
                      ? "Approved. Once everyone in this room has said yes, your agent introduces you."
                      : "Declined. Your agent lets the others know, without sharing your reasons."}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => decide(o.id, "approved")} className="min-h-12 flex-1 rounded-full bg-ink px-5 font-semibold text-white">
                      Approve version {o.version}
                    </button>
                    <button type="button" onClick={() => decide(o.id, "declined")} className="min-h-12 rounded-full border border-[#d5d9e1] px-5">
                      Decline
                    </button>
                  </div>
                )}
                <p className="text-xs text-slate">Nothing is final until everyone approves this version. If a term changes, you&apos;re asked again.</p>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { ProfileIntent } from "@/server/domain";
import type { ChatItem, IntakeEvent } from "@/server/intake/types";
import type { AgentMode } from "@/server/pace";
import { Mark } from "../Brand";
import { AppHeader } from "../AppHeader";
import { AgentPanel } from "./AgentPanel";
import { ChoicesWidget, NumberWidget } from "./Widgets";

function AgentAvatar() {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink">
      <Mark size={12} />
    </span>
  );
}

function Typing() {
  return (
    <span className="flex gap-1 py-2" aria-label="Your agent is typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-blink rounded-full bg-slate" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

export function StartApp() {
  const [mode, setMode] = useState<AgentMode | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [intents, setIntents] = useState<ProfileIntent[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .session()
      .then(({ mode, session }) => {
        setMode(mode);
        if (session) {
          setName(session.name);
          setChat(session.chat);
          setIntents(session.intents);
          setReady(session.ready);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [chat]);

  const apply = (event: IntakeEvent) => {
    if (event.type === "agent_start") setChat((c) => [...c, { id: event.itemId, role: "agent", text: "" }]);
    else if (event.type === "text") setChat((c) => c.map((m) => (m.id === event.itemId ? { ...m, text: m.text + event.delta } : m)));
    else if (event.type === "widget") setChat((c) => c.map((m) => (m.id === event.itemId ? { ...m, widget: event.widget } : m)));
    else if (event.type === "intent")
      setIntents((list) => (list.some((i) => i.id === event.intent.id) ? list.map((i) => (i.id === event.intent.id ? event.intent : i)) : [...list, event.intent]));
    else if (event.type === "ready") setReady(true);
    else if (event.type === "error") setError(event.message);
  };

  const send = async (input: unknown, echo?: string, answeredId?: string) => {
    setBusy(true);
    setError(null);
    setChat((c) => [
      ...c.map((m) => (m.id === answeredId || (echo && m.widget && !answeredId) ? { ...m, answered: true } : m)),
      ...(echo ? [{ id: `local-${Date.now()}`, role: "user" as const, text: echo }] : []),
    ]);
    try {
      for await (const event of await api.intake(input)) apply(event);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const { session } = await api.start(trimmed);
      setName(session!.name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      return;
    }
    await send({ kind: "start" });
  };

  const submitText = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send({ kind: "text", text }, text);
  };

  const decide = async (id: string, status: "confirmed" | "rejected") => {
    try {
      const result = await api.setIntent(id, status);
      setIntents(result.intents);
      setReady(result.ready);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startOver = async () => {
    await api.reset();
    window.location.reload();
  };

  const pending = intents.filter((i) => i.status === "pending").length;
  // Between sending and the agent's reply starting, there is no agent message to show the dots in yet.
  const awaitingAgent = busy && (chat.length === 0 || chat.at(-1)?.role === "user");

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader label="SETTING UP YOUR AGENT" mode={mode}>
        {name && (
          <>
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="relative flex min-h-11 items-center gap-2 rounded-full border border-navy-600 px-3.5 text-sm lg:hidden"
            >
              Your agent
              <span className="rounded-full bg-cloud px-1.5 font-mono text-xs text-ink">{intents.filter((i) => i.status !== "rejected").length}</span>
              {pending > 0 && <span aria-label={`${pending} to confirm`} className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-signal" />}
            </button>
            <button type="button" onClick={startOver} className="min-h-11 px-2 text-sm text-mist hover:text-cloud">
              Start over
            </button>
          </>
        )}
      </AppHeader>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-6 px-0 lg:px-10">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-6 sm:px-6 lg:px-0" aria-live="polite">
            <div className="mx-auto flex max-w-[720px] flex-col gap-5">
              {!loaded ? (
                <Typing />
              ) : !name ? (
                <div className="flex animate-rise gap-3">
                  <AgentAvatar />
                  <div className="flex flex-1 flex-col gap-3">
                    <p className="pt-1 text-[17px]">Hi, I&apos;m your agent on Open. I&apos;ll learn what you&apos;d be open to, then look for the people who fit. What should I call you?</p>
                    <form onSubmit={begin} className="flex max-w-sm gap-2">
                      <label htmlFor="name" className="sr-only">Your first name</label>
                      <input
                        id="name"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        autoComplete="given-name"
                        placeholder="Your first name"
                        maxLength={40}
                        className="min-h-12 min-w-0 flex-1 rounded-full border border-line bg-white px-4 outline-none focus:border-ink"
                      />
                      <button type="submit" disabled={busy || !nameDraft.trim()} className="min-h-12 rounded-full bg-ink px-5 font-semibold text-white disabled:opacity-40">
                        Start
                      </button>
                    </form>
                    <p className="text-xs text-slate">Claude, Anthropic&apos;s AI, runs this conversation. You see and approve everything your agent notes.</p>
                  </div>
                </div>
              ) : (
                chat.map((item) =>
                  item.role === "user" ? (
                    <p key={item.id} className="max-w-[85%] animate-rise self-end rounded-[20px_20px_6px_20px] bg-ink px-4 py-3 text-white">
                      {item.text}
                    </p>
                  ) : (
                    <div key={item.id} className="flex animate-rise gap-3">
                      <AgentAvatar />
                      <div className="flex min-w-0 flex-1 flex-col gap-3">
                        {item.text ? <p className="whitespace-pre-wrap pt-1 text-[17px] leading-relaxed">{item.text}</p> : <Typing />}
                        {item.widget && !item.answered && item.widget.kind === "choices" && (
                          <ChoicesWidget widget={item.widget} disabled={busy} onSubmit={(picked) => send({ kind: "choices", itemId: item.id, picked }, picked.join(", "), item.id)} />
                        )}
                        {item.widget && !item.answered && item.widget.kind === "number" && (
                          <NumberWidget
                            widget={item.widget}
                            disabled={busy}
                            onSubmit={(value) => item.widget?.kind === "number" && send({ kind: "number", itemId: item.id, value }, `${value} ${item.widget.unit}`, item.id)}
                          />
                        )}
                      </div>
                    </div>
                  ),
                )
              )}
              {awaitingAgent && name && (
                <div className="flex gap-3">
                  <AgentAvatar />
                  <Typing />
                </div>
              )}
              {error && (
                <p role="alert" className="rounded-xl bg-signal-soft px-4 py-3 text-sm text-signal-ink">
                  {error}
                </p>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {name && (
            <form onSubmit={submitText} className="shrink-0 border-t border-line bg-paper px-4 py-3 sm:px-6 lg:px-0">
              <div className="mx-auto flex max-w-[720px] items-center gap-2 rounded-full border border-line bg-white py-1.5 pl-5 pr-1.5 shadow-[0_12px_28px_-16px_rgba(11,18,32,0.25)] focus-within:border-ink">
                <label htmlFor="message" className="sr-only">Message your agent</label>
                <input
                  id="message"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={busy ? "Your agent is replying…" : "Tell your agent anything"}
                  maxLength={2000}
                  className="min-h-11 min-w-0 flex-1 bg-transparent outline-none"
                />
                <button type="submit" aria-label="Send" disabled={busy || !draft.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white disabled:opacity-30">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </button>
              </div>
            </form>
          )}
        </main>

        {name && (
          <aside
            aria-label="Your agent"
            className={`${panelOpen ? "fixed inset-0 z-20 flex flex-col bg-paper" : "hidden"} lg:static lg:flex lg:w-[380px] lg:shrink-0 lg:flex-col lg:bg-transparent lg:py-6`}
          >
            <div className="flex items-center justify-between border-b border-line bg-white px-4 py-2 lg:hidden">
              <span className="font-mono text-xs tracking-wider text-slate">YOUR AGENT</span>
              <button type="button" onClick={() => setPanelOpen(false)} className="min-h-11 px-2 text-sm font-semibold">
                Back to chat
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:rounded-3xl lg:border lg:border-line lg:bg-white lg:p-5">
              <AgentPanel name={name} intents={intents} ready={ready} onDecide={decide} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

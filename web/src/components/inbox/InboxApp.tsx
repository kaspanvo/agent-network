"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { AgentMode } from "@/server/pace";
import type { PublicSession } from "@/server/store";
import { AppHeader } from "../AppHeader";
import { AgentChat } from "./AgentChat";
import { AgentAvatar } from "./Avatar";
import { AgentDetails, RoomDetails } from "./Details";
import { TurnstileCheck } from "../start/Turnstile";
import { useIntake, useRun } from "./hooks";
import { RoomChat } from "./RoomChat";
import { followupOf, lastLine, notPicked, priceOf, threadTitle, type Thread } from "./runState";
import { Sidebar, type ConversationSummary } from "./Sidebar";

const AGENT = "agent";
const UNDO_MS = 8000;

type Trust = Pick<PublicSession, "log" | "logIntact" | "checks" | "disclosures" | "understanding" | "stale">;
const NO_TRUST: Trust = { log: [], logIntact: true, checks: {}, disclosures: {}, understanding: null, stale: [] };
type Pending = { id: string; decision: "approved" | "declined"; until: number };

function trustOf(session: PublicSession): Trust {
  return { log: session.log, logIntact: session.logIntact, checks: session.checks, disclosures: session.disclosures, understanding: session.understanding, stale: session.stale };
}

function readWhy(): boolean {
  try {
    return localStorage.getItem("open:showWhy") !== "0";
  } catch {
    return true;
  }
}

function urlConversation(): string | null {
  return new URLSearchParams(window.location.search).get("c");
}

export function InboxApp() {
  const intake = useIntake();
  const currentRef = useRef<string>(AGENT);
  const [toast, setToast] = useState<{ text: string; room: string } | null>(null);
  // A proposal that lands while you're in another conversation gets a toast.
  const runs = useRun((event) => {
    if (event.type === "opportunity" && event.opportunity.threadId !== currentRef.current)
      setToast({
        text: priceOf(event.opportunity) ? `New proposal: ${event.opportunity.title}, ${priceOf(event.opportunity)}` : `New plan: ${event.opportunity.title}. Are you in?`,
        room: event.opportunity.threadId,
      });
  });
  const [mode, setMode] = useState<AgentMode | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [resting, setResting] = useState(false);
  // What the server knows that the browser can't work out: the activity log, the per-room checks, stale proposals.
  const [trust, setTrust] = useState<Trust>(NO_TRUST);
  // A yes or no waits a few seconds before anyone is told, so it can be undone.
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Only read on the client after loading, so the server render and the first client render match.
  const [selected, setSelected] = useState<string | null>(() => (typeof window === "undefined" ? null : urlConversation()));
  const [showWhy, setShowWhy] = useState(() => (typeof window === "undefined" ? true : readWhy()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [nameDraft, setNameDraft] = useState("");
  const [starting, setStarting] = useState(false);
  // Cloudflare Turnstile on starting an agent, when the server asks for it.
  const [turnstileKey, setTurnstileKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);
  // The person said they're 18 or over. Open is for adults.
  const [adult, setAdult] = useState(false);

  const { run, running, busyRoom, decisions } = runs;
  // The agent is out on a run, as opposed to streaming one room's replies, a yes, or a check-in.
  const out = running && !busyRoom;
  // A room shows typing while its agents negotiate during a run, or while they answer something you wrote.
  const isLive = (t: Thread) => busyRoom === t.id || (running && !busyRoom && run.activeId === t.id && t.status === "talking");
  const current = selected ?? AGENT;
  const thread = run.threads.find((t) => t.id === current);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const countFor = (id: string) => (id === AGENT ? intake.chat.filter((c) => c.role === "agent").length : (run.threads.find((t) => t.id === id)?.timeline.length ?? 0));

  useEffect(() => {
    const onPop = () => setSelected(urlConversation());
    window.addEventListener("popstate", onPop);
    api
      .session()
      .then(({ mode, model, resting, busy, turnstile, session }) => {
        setMode(mode);
        setModel(model);
        setResting(resting);
        setTurnstileKey(turnstile);
        if (!session) return;
        setName(session.name);
        setTrust(trustOf(session));
        intake.load(session);
        runs.load(session);
        if (busy) void runs.resume(session.run?.events.length ?? 0);
        // Everything that was there before this visit counts as read.
        const counts: Record<string, number> = { [AGENT]: session.chat.filter((c) => c.role === "agent").length };
        for (const e of session.run?.events ?? []) if ("threadId" in e && e.type !== "discover") counts[e.threadId] = (counts[e.threadId] ?? 0) + 1;
        setSeen(counts);
      })
      .catch((err: Error) => intake.setError(err.message))
      .finally(() => setLoaded(true));
    return () => window.removeEventListener("popstate", onPop);
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The activity log is written on the server as the agent works; fetch it again whenever the agent settles.
  const settled = !runs.running && !intake.busy;
  useEffect(() => {
    if (!name || !settled) return;
    let live = true;
    api
      .session()
      .then(({ session }) => live && session && setTrust(trustOf(session)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name, settled, runs.decisions, intake.intents]);

  // When the undo window closes, the decision goes out. Starting another one sends the first straight away.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(null);
      void runs.decide(pending.id, pending.decision);
    }, Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(timer);
    // runs.decide reads the latest run state when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const decideLater = (id: string, decision: "approved" | "declined") => {
    if (pending) void runs.decide(pending.id, pending.decision);
    setPending({ id, decision, until: Date.now() + UNDO_MS });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Leaving a conversation marks what you saw in it as read.
  const select = (id: string | null) => {
    setSeen((s) => ({ ...s, [current]: countFor(current), ...(id ? { [id]: countFor(id) } : {}) }));
    setSelected(id);
    setDetailsOpen(false);
    window.history.pushState(null, "", id ? `?c=${encodeURIComponent(id)}` : window.location.pathname);
  };

  const toggleWhy = () => {
    setShowWhy((v) => {
      try {
        localStorage.setItem("open:showWhy", v ? "0" : "1");
      } catch {}
      return !v;
    });
  };

  // Sending the agent out. If the recap needs another look first, the agent shows it, instead of a refusal.
  // When the person asked to go out but had to check the recap first, the agent goes as soon as they confirm it.
  const wantsOut = useRef(false);
  // The agent got too many of the person's picks wrong: it asks before going out.
  const [lowFit, setLowFit] = useState<{ agreed: number; total: number } | null>(null);
  const sendOut = async (anyway = false) => {
    wantsOut.current = false;
    setLowFit(null);
    const refused = await runs.start(anyway);
    if (refused?.needs === "recap" || refused?.needs === "calibration") {
      wantsOut.current = true;
      await intake.refresh(refused.needs);
    } else if (refused?.needs === "understanding") {
      setLowFit({ agreed: Number(refused.detail.agreed), total: Number(refused.detail.total) });
    }
  };
  const sendToAgent = async (input: unknown, echo?: string, answeredId?: string) => {
    const becameReady = await intake.send(input, echo, answeredId);
    if (becameReady && wantsOut.current) await sendOut();
  };

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed || !adult || (turnstileKey && !turnstileToken)) return;
    setStarting(true);
    try {
      const { session } = await api.start(trimmed, turnstileToken ?? undefined, adult);
      setName(session!.name);
      select(AGENT);
      await intake.send({ kind: "start" });
    } catch (err) {
      intake.setError((err as Error).message);
      // A Turnstile token works once: get a fresh one for the next try.
      if (turnstileKey) setTurnstileAttempt((n) => n + 1);
    } finally {
      setStarting(false);
    }
  };

  const renegotiate = async (threadId: string, limit: number) => {
    await runs.renegotiate(threadId, limit);
    const { session } = await api.session();
    if (session) intake.load(session);
  };

  // Start over deletes the agent and everything it holds, so it asks first.
  const startOver = async () => {
    if (!window.confirm("Start over deletes your agent and everything it knows about you, right now: your conversation, limits, rooms and activity log. Download a copy first if you want one. This can't be undone.")) return;
    try {
      await api.reset();
    } catch (err) {
      intake.setError((err as Error).message);
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    window.location.reload();
  };

  // Forgetting and consent change what the agent holds, its rooms and its log, so the whole session is reloaded.
  const privately = async (call: () => Promise<PublicSession>) => {
    try {
      const session = await call();
      setTrust(trustOf(session));
      intake.load(session);
      runs.load(session);
    } catch (err) {
      intake.setError((err as Error).message);
    }
  };
  const privacy = {
    onForget: (id: string) => {
      if (!window.confirm("Forget this? Your agent deletes it, every room and proposal that came from it, and every copy of your words about it. This can't be undone.")) return;
      if (selected?.startsWith(`${id}-`)) select(AGENT);
      void privately(() => api.forgetIntent(id));
    },
    onForgetNote: (id: string) => {
      if (!window.confirm("Forget this note? Your agent deletes it and every copy of your words about it. This can't be undone.")) return;
      void privately(() => api.forgetNote(id));
    },
    onConsent: (id: string, share: boolean) => void privately(() => api.consent(id, share)),
  };

  const openPrivate = async (person: string) => {
    const id = await runs.openPrivate(person);
    if (id) select(id);
  };

  const limitFor = (threadId: string) => {
    if (run.threads.find((t) => t.id === threadId)?.mode !== "deal") return null;
    const intent = intake.intents.find((i) => threadId.startsWith(`${i.id}-`));
    return intent && intent.price !== null ? { value: intent.price, unit: intent.unit, direction: intent.direction } : null;
  };

  const conversations: ConversationSummary[] = useMemo(() => {
    const pendingDecision = pending;
    const pendingIntents = intake.intents.filter((i) => i.status === "pending").length;
    const lastAgent = [...intake.chat].reverse().find((c) => c.role === "agent");
    const agent: ConversationSummary = {
      id: AGENT,
      kind: "agent",
      title: "Your agent",
      preview: out ? (run.status ?? "Out talking with other agents") : lastAgent?.text || "Tell me what you'd be open to",
      people: [],
      badge: out ? { text: "LIVE", tone: "live" } : pendingIntents ? { text: "CONFIRM", tone: "signal" } : intake.ready && run.threads.length === 0 ? { text: "READY", tone: "good" } : null,
      unread: current === AGENT ? 0 : Math.max(0, countFor(AGENT) - (seen[AGENT] ?? 0)),
      typing: false,
      needs: intake.busy || out ? null : lastAgent?.widget && !lastAgent.answered ? "Answer" : pendingIntents ? "Confirm" : null,
    };
    const rooms: ConversationSummary[] = run.threads.map((t) => {
      const offer = run.opportunities.find((o) => o.threadId === t.id);
      const decision = offer ? decisions[offer.id] : undefined;
      const price = offer ? priceOf(offer) : null;
      const last = t.timeline.at(-1);
      // Once you've decided, the preview says so, unless someone has written since.
      const followup = offer ? followupOf(t, offer.id) : { checkInDue: false, done: undefined };
      const decidedPreview =
        followup.done?.kind === "followup"
          ? followup.done.text
          : followup.checkInDue
            ? "You're introduced. Did it happen?"
            : decision === "lapsed"
              ? "Lapsed unanswered. The others are free again"
              : offer && decision && last?.kind !== "message"
          ? price
            ? decision === "approved"
              ? `You approved version ${offer.version} · ${price}`
              : "You declined"
            : decision === "approved"
              ? `You're in · ${offer.title}`
              : "You passed this time"
          : null;
      return {
        id: t.id,
        kind: "room",
        title: threadTitle(t),
        preview: decidedPreview ?? (!out && notPicked(t, run.opportunities) ? "Agreed, but your agent brought you a better fit" : lastLine(t)),
        people: t.others,
        badge:
          offer && !decision
            ? price
              ? { text: `V${offer.version} · ${price}`, tone: "signal" }
              : { text: "PLAN", tone: "signal" }
            : decision === "approved" && followup.done
              ? { text: "DONE", tone: "muted" }
              : decision === "approved" && followup.checkInDue
                ? { text: "CHECK IN", tone: "signal" }
                : decision === "approved"
                  ? { text: price ? "APPROVED" : "YOU'RE IN", tone: "good" }
              : decision === "declined"
                ? { text: price ? "DECLINED" : "PASSED", tone: "muted" }
                : decision === "lapsed"
                  ? { text: "LAPSED", tone: "muted" }
                : t.status === "no_fit"
                  ? { text: "NO FIT", tone: "muted" }
                  : !out && notPicked(t, run.opportunities)
                    ? { text: "NOT PICKED", tone: "muted" }
                  : t.mode === "private"
                    ? { text: "PRIVATE", tone: "muted" }
                    : t.status === "open"
                      ? { text: "OPEN", tone: "muted" }
                      : null,
        unread: current === t.id ? 0 : Math.max(0, t.timeline.length - (seen[t.id] ?? 0)),
        typing: isLive(t),
        needs:
          offer && !decision && pendingDecision?.id !== offer.id && !trust.stale.includes(offer.id)
            ? price
              ? "Approve"
              : "Answer"
            : followup.checkInDue
              ? "Check in"
              : null,
      };
    });
    return [agent, ...rooms];
    // countFor reads the same state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intake.chat, intake.intents, intake.ready, intake.busy, run, running, busyRoom, decisions, seen, current, pending, trust.stale]);

  if (!loaded)
    return (
      <div className="flex h-dvh flex-col">
        <AppHeader label="YOUR INBOX" mode={mode} resting={resting} />
      </div>
    );

  if (!name)
    return (
      <div className="flex min-h-dvh flex-col">
        <AppHeader label="YOUR INBOX" mode={mode} resting={resting} />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-10">
          <AgentAvatar size={52} />
          <h1 className="font-display text-3xl tracking-tight">Hi, I&apos;m your agent on Open</h1>
          <p className="text-lg text-slate">I&apos;ll learn what you&apos;d be open to, then talk with other people&apos;s agents and bring back only what fits. What should I call you?</p>
          <form onSubmit={begin} className="flex gap-2">
            <label htmlFor="name" className="sr-only">
              Your first name
            </label>
            <input
              id="name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              autoComplete="given-name"
              placeholder="Your first name"
              maxLength={40}
              className="min-h-12 min-w-0 flex-1 rounded-full border border-line bg-white px-4 outline-none focus:border-ink"
            />
            <button type="submit" disabled={starting || !nameDraft.trim() || !adult || (!!turnstileKey && !turnstileToken)} className="min-h-12 rounded-full bg-ink px-6 font-semibold text-white disabled:opacity-40">
              Start
            </button>
          </form>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="size-5 shrink-0 accent-ink" />
            <span>
              I&apos;m 18 or over, and I&apos;ve read{" "}
              <a href="/privacy" target="_blank" rel="noopener" className="underline underline-offset-2">
                how Open uses my data
              </a>
            </span>
          </label>
          {turnstileKey && <TurnstileCheck siteKey={turnstileKey} action="start" attempt={turnstileAttempt} onToken={setTurnstileToken} />}
          <p className="text-xs text-slate">
            {mode === "claude"
              ? "Claude, Anthropic's AI, runs your agent."
              : mode === "open"
                ? `${model ?? "An open model"}, an open model on Cloudflare Workers AI, runs your agent for now.`
                : "This is the demo agent: a fixed script, no AI model."}{" "}
            {mode !== "demo" && "It's an AI, and it tells other agents who it acts for. "}You see everything it notes, and nothing is agreed without your yes or a standing yes you set.
          </p>
          {intake.error && (
            <p role="alert" className="text-sm text-signal-ink">
              {intake.error}
            </p>
          )}
        </main>
      </div>
    );

  const sentOut = running || run.threads.length > 0;
  const offer = thread ? run.opportunities.find((o) => o.threadId === thread.id) : undefined;

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader label="YOUR INBOX" mode={mode} resting={resting}>
        <button type="button" onClick={startOver} className="min-h-11 px-2 text-sm text-mist hover:text-cloud">
          Start over
        </button>
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <aside className={`${selected ? "hidden" : "flex"} w-full flex-col border-r border-line bg-white md:flex md:w-[300px] lg:w-[330px]`} aria-label="Inbox">
          <div className="flex items-baseline justify-between px-5 pt-4">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Inbox</h1>
            <span className="text-sm text-slate">{name}</span>
          </div>
          <Sidebar conversations={conversations} selected={current} onSelect={select} query={query} onQuery={setQuery} />
        </aside>

        <main className={`${selected ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}>
          {thread ? (
            <RoomChat
              key={thread.id}
              thread={thread}
              you={name}
              opportunity={offer}
              decision={offer ? decisions[offer.id] : undefined}
              limit={limitFor(thread.id)}
              live={isLive(thread)}
              busy={running}
              error={run.error}
              showWhy={showWhy}
              onToggleWhy={toggleWhy}
              onDecide={decideLater}
              pending={pending && offer && pending.id === offer.id ? pending : null}
              onUndo={() => setPending(null)}
              stale={offer ? trust.stale.includes(offer.id) : false}
              onCheckIn={runs.checkIn}
              onExtend={runs.extend}
              onRenegotiate={(limit) => renegotiate(thread.id, limit)}
              onSay={(text) => runs.say(thread.id, text)}
              onBack={() => select(null)}
              onDetails={() => setDetailsOpen(true)}
            />
          ) : (
            <AgentChat
              name={name}
              chat={intake.chat}
              intents={intake.intents}
              ready={intake.ready}
              busy={intake.busy}
              error={intake.error}
              run={run}
              running={out}
              decisions={decisions}
              onSend={sendToAgent}
              onStop={intake.stop}
              onDecideIntent={intake.decideIntent}
              onSendOut={() => void sendOut()}
              lowFit={lowFit}
              onSendAnyway={() => void sendOut(true)}
              onTellMore={() => {
                setLowFit(null);
                void sendToAgent({ kind: "text", text: "Let me tell you more about what I'm after." }, "Let me tell you more about what I'm after.");
              }}
              onOpenRoom={select}
              understanding={trust.understanding}
              onBack={() => select(null)}
              onDetails={() => setDetailsOpen(true)}
            />
          )}
        </main>

        <aside
          aria-label={thread ? "Room details" : "Your agent's profile"}
          className={`${detailsOpen ? "fixed inset-0 z-30 flex justify-end bg-ink/30" : "hidden"} xl:static xl:z-auto xl:flex xl:w-[340px] xl:bg-transparent`}
          onClick={(e) => e.target === e.currentTarget && setDetailsOpen(false)}
        >
          <div className="flex h-full w-full max-w-[380px] flex-col border-l border-line bg-white xl:max-w-none">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-mono text-[11px] tracking-wider text-slate">{thread ? "ROOM DETAILS" : "YOUR AGENT"}</h2>
              <button type="button" onClick={() => setDetailsOpen(false)} className="min-h-10 px-2 text-sm font-semibold xl:hidden">
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {thread ? (
                <RoomDetails
                  thread={thread}
                  you={name}
                  shortlist={run.shortlists.find((s) => s.options.some((o) => o.threadId === thread.id))}
                  checks={trust.checks[thread.id] ?? []}
                  disclosures={trust.disclosures[thread.id] ?? []}
                  opportunity={offer} limit={limitFor(thread.id)} busy={running} onMessage={openPrivate} />
              ) : (
                <AgentDetails
                  name={name}
                  intents={intake.intents}
                  goals={intake.goals}
                  about={intake.about}
                  mandate={{ onSet: (id, price, days) => void intake.setMandate(id, price, days), onDrop: (id) => void intake.dropMandate(id) }}
                  ready={intake.ready}
                  threads={run.threads}
                  activeId={run.activeId}
                  running={out}
                  onDecide={intake.decideIntent}
                  privacy={privacy}
                  onSendOut={() => void sendOut()}
                  sentOut={sentOut}
                  mode={mode}
                  model={model}
                  log={trust.log}
                  logIntact={trust.logIntact}
                  understanding={trust.understanding}
                  onOpenRoom={select}
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex justify-center sm:inset-x-auto sm:right-6 sm:justify-end">
        {toast && (
          <div className="pointer-events-auto flex animate-rise items-center gap-3 rounded-2xl bg-ink py-2.5 pl-4 pr-2.5 text-sm text-white shadow-xl">
            <span className="size-2 shrink-0 rounded-full bg-signal" aria-hidden="true" />
            <span className="max-w-[46ch]">{toast.text}</span>
            <button
              type="button"
              onClick={() => {
                select(toast.room);
                setToast(null);
              }}
              className="min-h-9 rounded-full bg-white px-3.5 font-semibold text-ink"
            >
              Open
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

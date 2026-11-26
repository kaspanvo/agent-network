"use client";

import { useState } from "react";
import type { ProfileIntent } from "@/server/domain";
import type { ChatItem } from "@/server/intake/types";
import type { Opportunity, Outcome } from "@/server/negotiation/types";
import { formatPrice, isInterest, lowerFirst } from "@/server/domain";
import { RECAP_CHANGE, RECAP_CONFIRMED } from "@/server/intake/types";
import { ChoicesWidget, NumberWidget, PairsWidget, RecapWidget } from "../start/Widgets";
import { AgentAvatar, AvatarStack } from "./Avatar";
import { ConversationHeader, Dots, JumpToLatest, QuickReplies, useStickToBottom } from "./ChatFrame";
import { Composer } from "./Composer";
import { priceOf, statusOf, threadTitle, type RunState, type Shortlist } from "./runState";

// What your agent compared before choosing. Offers were heard in random order, so nobody wins for answering first.
function Compared({ shortlist, onOpen }: { shortlist: Shortlist; onOpen: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3" aria-label={`Offers compared for ${shortlist.about}`}>
      <h3 className="font-mono text-[11px] tracking-wider text-slate">
        COMPARED {shortlist.options.length} OFFERS · {shortlist.about.toUpperCase()}
      </h3>
      <ul className="flex flex-col gap-1">
        {shortlist.options.map((o) => {
          const picked = o.threadId === shortlist.chosen;
          return (
            <li key={o.threadId}>
              <button type="button" onClick={() => onOpen(o.threadId)} className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-paper ${picked ? "bg-live-soft/60" : ""}`}>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{o.who}</span>
                  <span className="text-slate"> · {o.group ? "small group" : "one-to-one"}{o.schedule ? ` · ${o.schedule.toLowerCase()}` : ""}</span>
                </span>
                <span className="font-mono text-xs">{formatPrice(o.price, o.unit)}</span>
                {picked && <span className="rounded-full bg-live-soft px-2 py-0.5 font-mono text-[10px] text-live-ink">PICKED</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-slate">
        {shortlist.why} Heard {shortlist.heard} agents in random order before choosing.
      </p>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        )
      }
      className="flex min-h-8 items-center gap-1 rounded-full px-2 text-xs text-slate opacity-70 hover:bg-white hover:opacity-100 focus-visible:opacity-100"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// What the agent will do once it's out, shown before it goes, so the person can approve the plan rather than discover it.
function PlanCard({ intents, understanding, onSend, onChange }: { intents: ProfileIntent[]; understanding: { agreed: number; total: number } | null; onSend: () => void; onChange: () => void }) {
  const active = intents
    .filter((i) => i.status === "confirmed" && (isInterest(i) || i.price !== null))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const steps = [
    ...active.map((i) =>
      isInterest(i)
        ? `Find people into ${lowerFirst(i.summary)}${i.conditions.length ? `, ${i.conditions.join(" or ")}` : ""}, and suggest plans`
        : `Send sealed offers for “${i.summary}”. Only Open's matcher sees your ${formatPrice(i.price!, i.unit)} ${i.direction === "seek" ? "limit" : "floor"}`,
    ),
    "Hear every offer in random order, then bring you the best fit, never more than three",
    "Ask you before agreeing to anything, meeting anyone or sharing contact details",
  ];
  return (
    <section aria-label="Your agent's plan" className="flex animate-rise flex-col gap-3 rounded-2xl bg-ink p-5 text-white sm:ml-11">
      <span className="font-mono text-[11px] tracking-wider text-haze">HERE&apos;S MY PLAN</span>
      <ol className="flex flex-col gap-2">
        {steps.map((step, n) => (
          <li key={step} className="flex gap-3 text-[15px] leading-snug">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[11px]">{n + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      {understanding && (
        <p className="text-sm text-haze">
          I guessed {understanding.agreed} of {understanding.total} of your picks{understanding.agreed < understanding.total ? ", and noted what I missed" : ""}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onSend} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-ink">
          Send my agent out
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        <button type="button" onClick={onChange} className="min-h-12 rounded-full border border-white/25 px-5 text-sm">
          Change something
        </button>
      </div>
    </section>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="What your agent did">
      {steps.map((step, i) => (
        <li key={i} className="flex animate-rise items-center gap-2 text-[13px] text-slate">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#15803d" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l4 4L19 7" />
          </svg>
          {step}
        </li>
      ))}
    </ul>
  );
}

export function AgentChat(props: {
  name: string;
  chat: ChatItem[];
  intents: ProfileIntent[];
  ready: boolean;
  busy: boolean;
  error: string | null;
  run: RunState;
  running: boolean;
  decisions: Record<string, Outcome>;
  onSend: (input: unknown, echo?: string, answeredId?: string) => void;
  onStop: () => void;
  onDecideIntent: (id: string, status: "confirmed" | "rejected") => void;
  onSendOut: () => void;
  onOpenRoom: (id: string) => void;
  understanding: { agreed: number; total: number } | null;
  onBack: () => void;
  onDetails: () => void;
}) {
  const { chat, intents, ready, busy, error, run, running } = props;
  const lastText = chat.at(-1)?.text.length ?? 0;
  const { ref, showJump, jump } = useStickToBottom(`${chat.length}:${lastText}:${run.threads.length}:${run.status}:${intents.length}:${busy}:${ready}`);
  const pending = intents.filter((i) => i.status === "pending");
  const last = chat.at(-1);
  const awaitingAgent = busy && (!last || last.role === "user");
  const suggestions = !busy && last?.role === "agent" && !(last.widget && !last.answered) ? (last.suggestions ?? []) : [];
  const toDecide = run.opportunities.filter((o) => !props.decisions[o.id]);
  const sentOut = running || run.threads.length > 0;

  // The plan card has its own send button, so the chip would only repeat it.
  const replies = sentOut || ready ? suggestions.filter((s) => s !== "Send my agent out") : suggestions;

  const sendText = (text: string) => {
    if (text === "Send my agent out" && ready) return props.onSendOut();
    props.onSend({ kind: "text", text }, text);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Your agent">
      <ConversationHeader
        avatar={<AgentAvatar size={36} />}
        title="Your agent"
        subtitle={
          running ? (
            <span className="flex items-center gap-1.5 text-signal-ink">
              <span className="size-1.5 animate-blink rounded-full bg-signal" />
              Out talking with other agents
            </span>
          ) : ready ? (
            "Ready to go out"
          ) : (
            "Learning what you'd be open to"
          )
        }
        onBack={props.onBack}
      >
        <button type="button" onClick={props.onDetails} className="min-h-10 rounded-full border border-line px-3.5 text-sm font-medium hover:border-ink xl:hidden">
          Profile
          {pending.length > 0 && <span className="ml-1.5 inline-block size-2 rounded-full bg-signal align-middle" aria-label={`${pending.length} to confirm`} />}
        </button>
      </ConversationHeader>

      <div className="relative min-h-0 flex-1">
        <div ref={ref} className="h-full overflow-y-auto px-4 py-6 sm:px-6" aria-live="polite">
          <div className="mx-auto flex max-w-[760px] flex-col gap-5">
            {chat.map((item, index) =>
              item.role === "user" ? (
                <p key={item.id} className="max-w-[85%] animate-rise self-end whitespace-pre-wrap rounded-[20px_20px_6px_20px] bg-ink px-4 py-3 text-white">
                  {item.text}
                </p>
              ) : (
                <article key={item.id} className="group flex animate-rise gap-3">
                  <AgentAvatar />
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {item.text ? <p className="whitespace-pre-wrap pt-1 text-[17px] leading-relaxed">{item.text}</p> : !item.stopped && <Dots label="Your agent is typing" />}
                    {item.stopped && <span className="font-mono text-[11px] tracking-wider text-slate">STOPPED</span>}
                    {item.activity && item.activity.length > 0 && <Steps steps={item.activity} />}
                    {item.widget && !item.answered && item.widget.kind === "choices" && (
                      <ChoicesWidget widget={item.widget} disabled={busy} onSubmit={(picked) => props.onSend({ kind: "choices", itemId: item.id, picked }, picked.join(", "), item.id)} />
                    )}
                    {item.widget && !item.answered && item.widget.kind === "pairs" && (
                      <PairsWidget
                        widget={item.widget}
                        disabled={busy}
                        onSubmit={(picks) => {
                          if (item.widget?.kind !== "pairs") return;
                          const chosen = item.widget.pairs.map((p) => p[picks[p.id]!].title);
                          props.onSend({ kind: "pairs", itemId: item.id, picks }, `I'd pick: ${chosen.join("; ")}`, item.id);
                        }}
                      />
                    )}
                    {item.widget && !item.answered && item.widget.kind === "recap" && (
                      <RecapWidget
                        widget={item.widget}
                        hidden={intents.filter((i) => i.status === "rejected").map((i) => i.id)}
                        disabled={busy}
                        onAnswer={(answer) => props.onSend({ kind: "recap", itemId: item.id, answer }, answer === "confirm" ? RECAP_CONFIRMED : RECAP_CHANGE, item.id)}
                        onLeaveOut={(id) => props.onDecideIntent(id, "rejected")}
                      />
                    )}
                    {item.widget && !item.answered && item.widget.kind === "number" && (
                      <NumberWidget
                        widget={item.widget}
                        disabled={busy}
                        onSubmit={(value) => item.widget?.kind === "number" && props.onSend({ kind: "number", itemId: item.id, value }, `${value} ${item.widget.unit}`, item.id)}
                      />
                    )}
                    {item.text && !(busy && index === chat.length - 1) && (
                      <div className="-ml-2 flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                        <CopyButton text={item.text} />
                      </div>
                    )}
                  </div>
                </article>
              ),
            )}

            <QuickReplies options={replies} onPick={sendText} />

            {awaitingAgent && (
              <div className="flex gap-3">
                <AgentAvatar />
                <Dots label="Your agent is typing" />
              </div>
            )}

            {pending.length > 0 && !busy && (
              <div className="flex animate-rise flex-col gap-3 rounded-2xl border-[1.5px] border-dashed border-signal-light bg-[#fff7f3] p-4 sm:ml-11">
                <span className="font-mono text-[11px] tracking-wider text-signal-ink">YOUR AGENT NOTICED · IS THIS RIGHT?</span>
                {pending.map((intent) => (
                  <div key={intent.id} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <strong className="font-semibold">{intent.summary}</strong>
                      {intent.evidence && <span className="text-[13px] text-slate">From &ldquo;{intent.evidence}&rdquo;</span>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => props.onDecideIntent(intent.id, "confirmed")} className="min-h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
                        Yes
                      </button>
                      <button type="button" onClick={() => props.onDecideIntent(intent.id, "rejected")} className="min-h-10 rounded-full border border-[#d5d9e1] bg-white px-4 text-sm">
                        Not really
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {run.error && !sentOut && (
              <p role="alert" className="rounded-xl bg-signal-soft px-4 py-3 text-sm text-signal-ink sm:ml-11">
                Your agent couldn&apos;t go out: {run.error}
              </p>
            )}

            {ready && !sentOut && !busy && <PlanCard intents={intents} understanding={props.understanding} onSend={props.onSendOut} onChange={() => sendText("I want to change something.")} />}

            {sentOut && (
              <div className="flex animate-rise flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:ml-11">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-slate">
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${running ? "animate-blink bg-live" : "bg-mist"}`} />
                    {running ? "LIVE · LISBON PILOT" : "WHAT YOUR AGENT FOUND"}
                  </span>
                  {!running && run.stats && (
                    <span className="text-[13px] text-slate">
                      {run.stats.contacted} agents · {run.stats.rooms} room{run.stats.rooms === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {run.status && <p className="text-sm text-slate">{run.status}…</p>}
                {run.error && <p role="alert" className="text-sm text-signal-ink">{run.error}</p>}
                <ul className="flex flex-col gap-1.5">
                  {run.threads.map((t) => {
                    const pill = statusOf(t, running ? undefined : run.opportunities, props.decisions);
                    const offer: Opportunity | undefined = run.opportunities.find((o) => o.threadId === t.id);
                    return (
                      <li key={t.id}>
                        <button type="button" onClick={() => props.onOpenRoom(t.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-paper">
                          <AvatarStack names={t.others} size={26} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{threadTitle(t)}</span>
                          {offer && priceOf(offer) && <span className="font-mono text-xs">{priceOf(offer)}</span>}
                          <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${pill.cls}`}>{pill.text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {run.shortlists.map((shortlist) => (
                  <Compared key={shortlist.intentId} shortlist={shortlist} onOpen={props.onOpenRoom} />
                ))}
                {!running && toDecide.length > 0 && (
                  <button
                    type="button"
                    onClick={() => props.onOpenRoom(toDecide[0]!.threadId)}
                    className="flex min-h-11 items-center justify-center rounded-full bg-signal px-5 text-sm font-semibold text-white"
                  >
                    {toDecide.length === 1 ? "1 thing needs your decision" : `${toDecide.length} things need your decision`}
                  </button>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-signal-soft px-4 py-3 text-sm text-signal-ink">
                {error}
              </p>
            )}
          </div>
        </div>
        {showJump && <JumpToLatest onClick={jump} />}
      </div>

      <Composer placeholder={busy ? "Your agent is replying…" : "Tell your agent anything"} busy={busy} onSend={sendText} onStop={props.onStop} />
    </section>
  );
}

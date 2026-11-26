"use client";

import { useEffect, useState } from "react";
import { formatPrice, lowerFirst, type Unit } from "@/server/domain";
import type { Card, CheckIn, Opportunity } from "@/server/negotiation/types";
import { AgentAvatar, Avatar, AvatarStack } from "./Avatar";
import { ConversationHeader, Dots, JumpToLatest, useStickToBottom } from "./ChatFrame";
import { Composer } from "./Composer";
import { followupOf, priceOf, statusOf, threadTitle, type Thread, type TimelineItem } from "./runState";

const CHECK_INS: { answer: CheckIn; label: string }[] = [
  { answer: "again", label: "It happened, I'd go again" },
  { answer: "once", label: "Once was enough" },
  { answer: "missed", label: "It didn't happen" },
];

const SUGGESTIONS = {
  deal: ["Are the times flexible?", "Tell me more about them"],
  circle: ["What's on this week?", "Anyone free on Saturday?"],
  private: ["When are they usually free?", "What are they into?"],
} as const;

function CardView({ card, mine }: { card: Card; mine: boolean }) {
  if (card.kind === "offer")
    return (
      <span className={`mt-2 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${mine ? "bg-white/10" : "bg-paper"}`}>
        <span className="font-mono text-[10px] tracking-wider text-slate">PAID OFFER</span>
        <span className="font-medium">{card.title}</span>
        <span className="text-slate">· {card.who}</span>
      </span>
    );
  const [day, time] = card.when.split(", ");
  return (
    <span className="mt-2 flex gap-3 rounded-xl border border-line bg-white p-3 text-ink">
      <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-signal-soft py-1.5 text-signal-ink">
        <span className="font-mono text-[10px] tracking-wider">{day?.slice(0, 3).toUpperCase()}</span>
        <span className="font-display text-lg leading-tight">{time?.match(/\d{2}:\d{2}/)?.[0] ?? "·"}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <strong className="font-semibold">{card.title}</strong>
        <span className="text-[13px] text-slate">{card.when}</span>
        <span className="text-[13px] text-slate">{card.where}</span>
        <span className="text-[13px]">{card.cost}</span>
      </span>
    </span>
  );
}

const RANGE: Record<Unit, { min: number; max: number; step: number }> = {
  hour: { min: 5, max: 60, step: 1 },
  month: { min: 5, max: 500, step: 5 },
  "one-off": { min: 10, max: 2000, step: 10 },
};

function Reasoning({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <p className={`flex max-w-[85%] gap-1.5 text-[13px] leading-snug text-slate ${align === "right" ? "self-end text-right" : ""}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <span>
        <span className="sr-only">Your agent&apos;s reasoning, visible only to you: </span>
        {children}
      </span>
    </p>
  );
}

function SystemLine({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-[90%] animate-rise rounded-full bg-[#eef0f4] px-3.5 py-1.5 text-center text-[13px] text-slate">{children}</p>;
}

function FollowUp({ item, due, busy, onCheckIn }: { item: Extract<TimelineItem, { kind: "followup" }>; due: boolean; busy: boolean; onCheckIn: (answer: CheckIn) => void }) {
  if (item.stage === "done") return <SystemLine>{item.text}</SystemLine>;
  if (item.stage === "introduced")
    return (
      <div className="mx-auto flex w-full max-w-md animate-rise flex-col gap-1 rounded-2xl bg-live-soft px-4 py-3 text-live-ink">
        <span className="font-mono text-[11px] tracking-wider">INTRODUCED</span>
        <p className="text-sm">{item.text}</p>
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-md animate-rise flex-col gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line bg-white px-4 py-3">
      <span className="font-mono text-[11px] tracking-wider text-slate">CHECK-IN · DID IT HAPPEN?</span>
      <p className="text-sm">{item.text}</p>
      {due && (
        <div className="flex flex-wrap gap-2">
          {CHECK_INS.map(({ answer, label }, i) => (
            <button
              key={answer}
              type="button"
              disabled={busy}
              onClick={() => onCheckIn(answer)}
              className={`min-h-10 rounded-full px-3.5 text-sm disabled:opacity-40 ${i === 0 ? "bg-ink font-semibold text-white" : "border border-[#d5d9e1] bg-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ item, previous, showWhy, you, deal }: { item: Exclude<TimelineItem, { kind: "followup" }>; previous: TimelineItem | undefined; showWhy: boolean; you: string; deal: boolean }) {
  if (item.kind === "note") return <SystemLine>{item.text}</SystemLine>;
  if (item.kind === "room")
    return (
      <div className="mx-auto flex w-full max-w-md animate-rise flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-signal-light bg-[#fff7f3] p-4 text-center">
        <span className="font-mono text-[11px] tracking-wider text-signal-ink">ROOM OPENED · {item.members.length} PEOPLE</span>
        <span className="flex flex-wrap justify-center gap-1.5">
          {item.members.map((m) => (
            <span key={m} className="flex items-center gap-1.5 rounded-full bg-white py-1 pl-1 pr-2.5 text-sm">
              <Avatar name={m} size={20} />
              {m}
            </span>
          ))}
        </span>
        {showWhy && <Reasoning>{item.why}</Reasoning>}
      </div>
    );
  if (item.kind === "outcome")
    return (
      <p className={`mx-auto max-w-md animate-rise rounded-2xl px-4 py-3 text-center text-sm ${item.result === "agreed" ? "bg-live-soft text-live-ink" : item.result === "open" ? "bg-[#eef0f4] text-ink" : "bg-[#f1f2f4] text-slate"}`}>
        <strong className="font-semibold">{item.result === "agreed" ? (deal ? "Agreed. " : "Plan ready. ") : item.result === "open" ? "Still open. " : "No fit. "}</strong>
        {item.why}
      </p>
    );

  const m = item.event;
  // Open's matcher is code, not an agent: its line sits in the middle, with the price it set.
  if (m.from === "open")
    return (
      <div className="mx-auto flex w-full max-w-md animate-rise flex-col items-center gap-1.5 rounded-2xl border border-line bg-white px-4 py-3 text-center">
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-slate">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
          OPEN&apos;S MATCHER · SET IN CODE
        </span>
        {m.amount !== null && m.unit && <span className="font-display text-2xl">{formatPrice(m.amount, m.unit)}</span>}
        <p className="text-sm">{m.text}</p>
        {showWhy && m.why && <Reasoning>{m.why}</Reasoning>}
      </div>
    );
  // The person's own words sit on the right, like in any messenger; their agent's messages sit beside them.
  const person = m.from === "person";
  const mine = m.from === "you" || person;
  const sameSpeaker = previous?.kind === "message" && previous.event.who === m.who && previous.event.from === m.from;
  const amount = m.amount !== null && m.unit ? formatPrice(m.amount, m.unit) : null;
  const label = m.withheld
    ? "WITHHELD BY OPEN'S PRIVACY CHECK"
    : amount && m.action !== "DECLINE"
      ? `${m.action} · ${amount}`
      : m.action === "SEAL"
        ? "SEALED OFFER · AMOUNT HIDDEN"
        : m.action === "PLAN"
          ? "PLAN"
          : m.action === "PASS"
            ? `PASSING IT ON TO ${m.who.replace(/'s agent$/, "").toUpperCase()}`
            : null;
  const bubble = person ? "rounded-tr-md bg-signal text-white" : mine ? "rounded-tr-md bg-ink text-white" : "rounded-tl-md border border-line bg-white";
  return (
    <div className={`flex animate-rise gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
      <span className="w-8 shrink-0">{!sameSpeaker && (person ? <Avatar name={you} /> : mine ? <AgentAvatar /> : <Avatar name={m.who.replace(/'s agent$/, "")} />)}</span>
      <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
        {!sameSpeaker && <span className="text-[13px] font-medium text-slate">{person ? "You" : mine ? "Your agent" : m.who}</span>}
        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] ${bubble}`}>
          <p className={`whitespace-pre-wrap ${m.withheld ? "italic opacity-80" : ""}`}>{m.text}</p>
          {m.card && <CardView card={m.card} mine={mine} />}
          {label && <span className={`mt-1 block font-mono text-[11px] tracking-wide ${mine ? "text-haze" : "text-slate"}`}>{label}</span>}
        </div>
        {showWhy && m.why && <Reasoning align={mine ? "right" : "left"}>{m.why}</Reasoning>}
      </div>
    </div>
  );
}

function LimitControl({ limit, busy, onSubmit, onCancel }: { limit: { value: number; unit: Unit; direction: "seek" | "offer" }; busy: boolean; onSubmit: (v: number) => void; onCancel: () => void }) {
  const range = RANGE[limit.unit];
  const [value, setValue] = useState(limit.value);
  const word = limit.direction === "seek" ? "Most you'd pay" : "Least you'd accept";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="limit" className="text-sm text-slate">
          {word} <span className="text-xs">(only your agent sees this)</span>
        </label>
        <output htmlFor="limit" className="font-mono text-lg">
          {formatPrice(value, limit.unit)}
        </output>
      </div>
      <input id="limit" type="range" min={range.min} max={range.max} step={range.step} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-ink" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || value === limit.value} onClick={() => onSubmit(value)} className="min-h-11 flex-1 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
          Reopen at {formatPrice(value, limit.unit)}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full border border-[#d5d9e1] bg-white px-5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// The current time, ticking while `every` is set, for countdowns.
function useNow(every: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (every === null) return;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

export function RoomChat(props: {
  thread: Thread;
  you: string;
  opportunity: Opportunity | undefined;
  decision: "approved" | "declined" | undefined;
  limit: { value: number; unit: Unit; direction: "seek" | "offer" } | null;
  live: boolean;
  busy: boolean;
  error: string | null;
  showWhy: boolean;
  onToggleWhy: () => void;
  onDecide: (id: string, decision: "approved" | "declined") => void;
  // A yes or no that hasn't been sent yet, with the moment it will be.
  pending: { decision: "approved" | "declined"; until: number } | null;
  onUndo: () => void;
  // Agreed under an intent the person has since changed: it can be declined, not approved.
  stale: boolean;
  onCheckIn: (id: string, answer: CheckIn) => void;
  onRenegotiate: (limit: number) => void;
  onSay: (text: string) => void;
  onBack: () => void;
  onDetails: () => void;
}) {
  const { thread, opportunity, decision, limit, live, busy, showWhy, pending, stale } = props;
  const now = useNow(pending ? 500 : null);
  // The clock only ticks while something is pending, so clamp to the undo window on the first render.
  const secondsLeft = pending ? Math.min(8, Math.max(1, Math.ceil((pending.until - now) / 1000))) : 0;
  const [editing, setEditing] = useState(false);
  const { ref, showJump, jump } = useStickToBottom(`${thread.id}:${thread.timeline.length}:${live}`);
  const status = statusOf(thread, busy ? undefined : opportunity ? [opportunity] : [], decision ? { [opportunity!.id]: decision } : {});
  const deal = thread.mode === "deal";
  const people = [...thread.others.map((o) => `${o}'s agent`), "your agent"].join(", ");
  const youSpoke = thread.timeline.some((t) => t.kind === "message" && t.event.from === "person");
  const price = opportunity ? priceOf(opportunity) : null;
  const followup = opportunity ? followupOf(thread, opportunity.id) : { checkInDue: false, done: undefined };
  const placeholder = thread.mode === "private" ? `Message ${thread.who}'s agent` : deal ? `Ask ${thread.who}'s agent something` : thread.grouped ? "Write to the room" : `Write to ${thread.who}'s agent`;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={threadTitle(thread)}>
      <ConversationHeader avatar={<AvatarStack names={thread.others} size={32} />} title={threadTitle(thread)} subtitle={people} onBack={props.onBack}>
        <span className={`hidden rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wide sm:inline ${status.cls}`}>{status.text}</span>
        <label title="Show each agent's private reasoning" className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm">
          <input type="checkbox" checked={showWhy} onChange={props.onToggleWhy} className="size-4 accent-ink" aria-label="Show reasoning" />
          <span className="hidden sm:inline">Reasoning</span>
          <svg className="sm:hidden" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </label>
        <button type="button" onClick={props.onDetails} aria-label="Room details" className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-line text-sm font-medium hover:border-ink sm:px-3.5 xl:hidden">
          <svg className="sm:hidden" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <span className="hidden sm:inline">Details</span>
        </button>
      </ConversationHeader>

      <div className="relative min-h-0 flex-1">
        <div ref={ref} role="log" aria-label={`Messages in ${threadTitle(thread)}`} className="h-full overflow-y-auto bg-paper px-3 py-6 sm:px-6" aria-live="polite">
          <div className="mx-auto flex max-w-[760px] flex-col gap-4">
            <SystemLine>
              {thread.mode === "private"
                ? `Private room with ${thread.who}'s agent. Nobody else sees it.`
                : thread.mode === "circle"
                  ? `A room for people into ${lowerFirst(thread.about)}`
                  : `Your agent found ${thread.who}'s agent`}
            </SystemLine>
            {showWhy && (
              <div className="mx-auto flex flex-col items-center gap-1">
                <Reasoning>{thread.why}</Reasoning>
                <span className="text-[12px] text-slate">Lines with a lock are your agent&apos;s notes. Only you see them.</span>
              </div>
            )}
            {thread.timeline.map((item, i) =>
              item.kind === "followup" ? (
                <FollowUp key={i} item={item} due={followupOf(thread, item.opportunityId).checkInDue} busy={busy} onCheckIn={(answer) => props.onCheckIn(item.opportunityId, answer)} />
              ) : (
                <Item key={i} item={item} previous={thread.timeline[i - 1]} showWhy={showWhy} you={props.you} deal={deal} />
              ),
            )}
            {live && (
              <div className="flex gap-2.5">
                <span className="w-8 shrink-0" />
                <span className="rounded-2xl border border-line bg-white px-3.5">
                  <Dots label={deal ? "The agents are negotiating" : "The agents are replying"} />
                </span>
              </div>
            )}
          </div>
        </div>
        {showJump && <JumpToLatest onClick={jump} />}
      </div>

      {(props.error || editing || opportunity || (deal && (thread.status === "no_fit" || (thread.status === "agreed" && !busy)))) && (
        <div className="shrink-0 border-t border-line bg-white px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[760px] flex-col gap-3">
            {props.error && !live && (
              <p role="alert" className="rounded-xl bg-signal-soft px-4 py-2.5 text-sm text-signal-ink">
                {props.error}
              </p>
            )}
            {editing && limit ? (
              <LimitControl
                limit={limit}
                busy={busy}
                onCancel={() => setEditing(false)}
                onSubmit={(v) => {
                  setEditing(false);
                  props.onRenegotiate(v);
                }}
              />
            ) : live && deal && !decision ? (
              <p className="py-1 text-sm text-slate">Your agent is negotiating. Nothing is agreed until you approve it.</p>
            ) : opportunity ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded-full bg-signal-soft px-2 py-0.5 font-mono text-[10px] tracking-wide text-signal-ink">{price ? `PROPOSAL V${opportunity.version}` : "PLAN"}</span>
                    <span className="truncate font-display text-xl">{price ?? opportunity.title}</span>
                    {price && thread.grouped && <span className="text-sm text-slate">each</span>}
                  </span>
                  <span className="text-sm text-slate">{opportunity.terms.slice(price ? 1 : 0, price ? undefined : 2).join(" · ")}</span>
                </div>
                {opportunity.previous && price && (
                  <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-slate">
                    <span className="font-mono text-[11px] tracking-wide">CHANGED SINCE V{opportunity.previous.version}</span>
                    {opportunity.previous.price !== null && opportunity.unit && <s>{formatPrice(opportunity.previous.price, opportunity.unit)}</s>}
                    <span aria-hidden="true">→</span>
                    <span className="text-ink">{price}</span>
                  </p>
                )}
                {pending ? (
                  <div className="flex flex-wrap items-center justify-between gap-2" role="status">
                    <p className="text-sm">
                      {pending.decision === "approved" ? (price ? `Approving version ${opportunity.version}.` : "You're in.") : price ? "Declining." : "Passing this time."} Your agent tells the room in {secondsLeft}s.
                    </p>
                    <button type="button" onClick={props.onUndo} className="min-h-11 rounded-full border border-ink px-5 text-sm font-semibold">
                      Undo
                    </button>
                  </div>
                ) : !decision && stale ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-signal-ink">You changed what you asked for after this was agreed, so it no longer stands. Send your agent out again for a fresh one.</p>
                    <button type="button" onClick={() => props.onDecide(opportunity.id, "declined")} className="min-h-11 rounded-full border border-[#d5d9e1] px-5 text-sm">
                      Dismiss
                    </button>
                  </div>
                ) : decision ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-sm ${decision === "approved" ? "text-live-ink" : "text-slate"}`}>
                      {decision === "declined"
                        ? price
                          ? "You declined. Your agent let the others know, without your reasons."
                          : "You passed this time. Your agent told the room, without your reasons."
                        : followup.done
                          ? "Done. Your agent knows how it went."
                          : followup.checkInDue
                            ? `${price ? `You approved version ${opportunity.version}` : "You're in"}, and you're introduced. Your agent will check it happened.`
                            : price
                              ? `You approved version ${opportunity.version}. Waiting for the others to say yes.`
                              : "You're in. Waiting for the others to say yes."}
                    </p>
                    {limit && (
                      <button type="button" onClick={() => setEditing(true)} className="min-h-10 text-sm font-medium underline underline-offset-2">
                        Change my limit
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => props.onDecide(opportunity.id, "approved")} className={`min-h-12 flex-1 whitespace-nowrap rounded-full bg-ink px-5 font-semibold text-white ${limit ? "max-sm:basis-full" : ""}`}>
                      {price ? `Approve version ${opportunity.version}` : "I'm in"}
                    </button>
                    {limit && (
                      <button type="button" onClick={() => setEditing(true)} disabled={busy} className="min-h-12 whitespace-nowrap rounded-full border border-[#d5d9e1] px-5 disabled:opacity-40 max-sm:flex-1">
                        Change my limit
                      </button>
                    )}
                    <button type="button" onClick={() => props.onDecide(opportunity.id, "declined")} className="min-h-12 rounded-full px-4 text-slate hover:bg-paper">
                      {price ? "Decline" : "Not this time"}
                    </button>
                  </div>
                )}
              </>
            ) : deal && thread.status === "agreed" ? (
              <p className="py-1 text-sm text-slate">Not picked. Your agent compared every offer and brought you a better fit for what you asked. Details shows which.</p>
            ) : (
              deal &&
              thread.status === "no_fit" && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate">No deal at your current {limit?.direction === "offer" ? "floor" : "limit"}.</p>
                  {limit && thread.timeline.some((t) => t.kind === "message") && (
                    <button type="button" onClick={() => setEditing(true)} disabled={busy} className="min-h-11 rounded-full border border-[#d5d9e1] px-5 text-sm disabled:opacity-40">
                      Try a different limit
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {!editing && (
        <Composer
          placeholder={live ? "The agents are replying…" : placeholder}
          busy={live || busy}
          onSend={(text) => {
            jump();
            props.onSay(text);
          }}
          suggestions={youSpoke || (deal && thread.status === "talking") || (opportunity && !decision) ? [] : [...SUGGESTIONS[thread.mode]]}
        />
      )}
    </section>
  );
}

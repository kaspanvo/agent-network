"use client";

import Link from "next/link";
import { formatPrice, type ProfileIntent } from "@/server/domain";
import { Mark } from "../Brand";

function readiness(intents: ProfileIntent[], ready: boolean): number {
  if (ready) return 100;
  const live = intents.filter((i) => i.status !== "rejected");
  if (live.length === 0) return 10;
  const priced = live.some((i) => i.status === "confirmed" && i.price !== null);
  const timed = live.some((i) => i.conditions.length > 0);
  return 35 + (priced ? 35 : 0) + (timed ? 15 : 0);
}

function IntentCard({ intent, onDecide }: { intent: ProfileIntent; onDecide: (status: "confirmed" | "rejected") => void }) {
  const pending = intent.status === "pending";
  const price = intent.price === null ? "Price not set yet" : `${intent.direction === "seek" ? "up to" : "from"} ${formatPrice(intent.price, intent.unit)}`;
  return (
    <li className={`flex animate-rise flex-col gap-2 rounded-2xl p-3.5 ${pending ? "border-[1.5px] border-dashed border-signal-light bg-[#fff7f3]" : "bg-paper"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-wider text-slate">{intent.direction === "seek" ? "WANTS" : "COULD OFFER"}</span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${pending ? "bg-signal-soft text-signal-ink" : "bg-live-soft text-live-ink"}`}>
          {pending ? "INFERRED · CONFIRM?" : intent.provenance === "inferred" ? "CONFIRMED" : "STATED"}
        </span>
      </div>
      <strong className="font-semibold">{intent.summary}</strong>
      <span className="font-mono text-xs text-ink">
        {price}
        {intent.conditions.length > 0 && ` · ${intent.conditions.join(", ")}`}
      </span>
      {intent.provenance === "inferred" && intent.evidence && <span className="text-[13px] text-slate">From what you said: &ldquo;{intent.evidence}&rdquo;</span>}
      {pending && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => onDecide("confirmed")} className="min-h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
            Yes, that&apos;s right
          </button>
          <button type="button" onClick={() => onDecide("rejected")} className="min-h-10 rounded-full border border-[#d5d9e1] bg-white px-4 text-sm">
            Not really
          </button>
        </div>
      )}
    </li>
  );
}

export function AgentPanel({ name, intents, ready, onDecide }: { name: string; intents: ProfileIntent[]; ready: boolean; onDecide: (id: string, status: "confirmed" | "rejected") => void }) {
  const score = readiness(intents, ready);
  const shown = intents.filter((i) => i.status !== "rejected");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink">
          <Mark size={14} />
        </span>
        <div className="flex flex-col">
          <strong className="font-display text-lg font-semibold">{name}&apos;s agent</strong>
          <span className="text-[13px] text-slate">{ready ? "Ready to go out" : "Building as you talk"}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between font-mono text-[11px] tracking-wide text-slate">
          <span>{ready ? "READY TO GO OUT" : "SETTING UP"}</span>
          <span>{score}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#e9ecf1]" role="progressbar" aria-label="How ready your agent is" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 rounded-full bg-ink transition-[width] duration-500" style={{ width: `${score}%` }} />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate">What you tell your agent shows up here as you talk, so you can check it.</p>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-live="polite">
          {shown.map((intent) => (
            <IntentCard key={intent.id} intent={intent} onDecide={(status) => onDecide(intent.id, status)} />
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-1.5 border-t border-line pt-3.5 text-[13px] text-slate">
        <li>Never shares your name before you approve</li>
        <li>Never accepts anything on your behalf</li>
      </ul>

      {ready ? (
        <Link href="/agent" className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink font-semibold text-white hover:bg-navy-800">
          Send my agent out
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      ) : (
        <span aria-disabled="true" className="flex min-h-12 items-center justify-center rounded-full bg-[#e9ecf1] font-semibold text-slate">
          Send my agent out
        </span>
      )}
    </div>
  );
}

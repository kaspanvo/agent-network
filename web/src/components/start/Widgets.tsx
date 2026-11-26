"use client";

import { useState } from "react";
import type { Widget } from "@/server/intake/types";

type Choices = Extract<Widget, { kind: "choices" }>;
type NumberAsk = Extract<Widget, { kind: "number" }>;

export function ChoicesWidget({ widget, disabled, onSubmit }: { widget: Choices; disabled: boolean; onSubmit: (picked: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (option: string) => {
    if (!widget.multiple) return onSubmit([option]);
    setPicked((p) => (p.includes(option) ? p.filter((x) => x !== option) : [...p, option]));
  };
  return (
    <fieldset disabled={disabled} className="flex animate-rise flex-col gap-3">
      <legend className="sr-only">{widget.prompt}</legend>
      <div className="flex flex-wrap gap-2">
        {widget.options.map((option) => {
          const on = picked.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={widget.multiple ? on : undefined}
              onClick={() => toggle(option)}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50 ${on ? "border-ink bg-ink text-white" : "border-[#d5d9e1] bg-white text-ink hover:border-ink"}`}
            >
              <span aria-hidden="true">{widget.multiple ? (on ? "✓ " : "+ ") : ""}</span>
              {option}
            </button>
          );
        })}
      </div>
      {widget.multiple && (
        <button
          type="button"
          onClick={() => onSubmit(picked)}
          disabled={picked.length === 0}
          className="min-h-11 self-start rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Continue{picked.length > 0 ? ` with ${picked.length}` : ""}
        </button>
      )}
    </fieldset>
  );
}

export function NumberWidget({ widget, disabled, onSubmit }: { widget: NumberAsk; disabled: boolean; onSubmit: (value: number) => void }) {
  const [value, setValue] = useState(widget.value);
  const clamp = (n: number) => Math.min(widget.max, Math.max(widget.min, n));
  const id = `number-${widget.label.replace(/\W+/g, "-")}`;
  return (
    <fieldset disabled={disabled} className="flex animate-rise flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-slate">{widget.label}</label>
        <output htmlFor={id} className="font-mono text-lg text-ink">
          {value} <span className="text-sm text-slate">{widget.unit}</span>
        </output>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Less" onClick={() => setValue((v) => clamp(v - widget.step))} className="size-11 shrink-0 rounded-full bg-paper text-lg">
          −
        </button>
        <input id={id} type="range" min={widget.min} max={widget.max} step={widget.step} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-ink" />
        <button type="button" aria-label="More" onClick={() => setValue((v) => clamp(v + widget.step))} className="size-11 shrink-0 rounded-full bg-paper text-lg">
          +
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate">Only your agent sees this.</span>
        <button type="button" onClick={() => onSubmit(value)} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
          Use {value} {widget.unit}
        </button>
      </div>
    </fieldset>
  );
}

type Recap = Extract<Widget, { kind: "recap" }>;

// What the agent understood, before it goes out with it: the person checks it and corrects anything wrong.
export function RecapWidget({
  widget,
  hidden,
  disabled,
  onAnswer,
  onLeaveOut,
}: {
  widget: Recap;
  // Intents the person has left out since the recap was shown.
  hidden: string[];
  disabled: boolean;
  onAnswer: (answer: "confirm" | "change") => void;
  onLeaveOut: (id: string) => void;
}) {
  const items = widget.items.filter((i) => !hidden.includes(i.id));
  return (
    <fieldset disabled={disabled} className="flex animate-rise flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <legend className="sr-only">Check what your agent will look for</legend>
      <span className="font-mono text-[11px] tracking-wider text-slate">RECAP · WHAT YOUR AGENT WILL LOOK FOR</span>
      <ol className="flex flex-col divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5 py-3 first:pt-1">
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                {item.rank !== null && <span className="font-mono text-xs text-slate">#{item.rank}</span>}
                <strong className="font-semibold">{item.summary}</strong>
              </span>
              <button type="button" onClick={() => onLeaveOut(item.id)} className="min-h-8 shrink-0 rounded-full px-2 text-[13px] text-slate underline underline-offset-2 hover:text-ink">
                Leave out
              </button>
            </div>
            <span className="flex flex-wrap gap-1.5 text-[13px]">
              <span className="rounded-full bg-paper px-2 py-0.5">{item.kind === "interest" ? "Things to do, no money" : "Deal"}</span>
              {item.limit && (
                <span className="flex items-center gap-1 rounded-full bg-paper px-2 py-0.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  {item.limit}
                  <span className="sr-only">, private</span>
                </span>
              )}
              {item.times.map((t) => (
                <span key={t} className="rounded-full bg-paper px-2 py-0.5 capitalize">
                  {t}
                </span>
              ))}
              {item.prefers && <span className="rounded-full bg-paper px-2 py-0.5">{item.prefers}</span>}
            </span>
            <span className="text-[13px] text-slate">
              Other agents hear: &ldquo;{item.shared}&rdquo;{item.limit ? " Never your limit." : ""}
            </span>
          </li>
        ))}
      </ol>
      {items.length === 0 ? (
        <p className="text-sm text-slate">You left everything out. Tell your agent what you&apos;d be open to instead.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAnswer("confirm")} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white">
            That&apos;s right
          </button>
          <button type="button" onClick={() => onAnswer("change")} className="min-h-11 rounded-full border border-[#d5d9e1] bg-white px-5 text-sm">
            Change something
          </button>
        </div>
      )}
    </fieldset>
  );
}

type Pairs = Extract<Widget, { kind: "pairs" }>;

// Either/or picks between real things on the network. The agent has already guessed; the person's picks show how well.
export function PairsWidget({ widget, disabled, onSubmit }: { widget: Pairs; disabled: boolean; onSubmit: (picks: Record<string, "a" | "b">) => void }) {
  const [picks, setPicks] = useState<Record<string, "a" | "b">>({});
  const done = widget.pairs.every((p) => picks[p.id]);
  return (
    <fieldset disabled={disabled} className="flex animate-rise flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <legend className="sr-only">Which would you pick?</legend>
      <span className="font-mono text-[11px] tracking-wider text-slate">WHICH WOULD YOU PICK? · YOUR AGENT HAS GUESSED</span>
      {widget.pairs.map((pair) => (
        <div key={pair.id} role="radiogroup" aria-label={pair.question} className="flex flex-col gap-2">
          <span className="text-sm font-medium">{pair.question}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["a", "b"] as const).map((side) => {
              const option = pair[side];
              const on = picks[pair.id] === side;
              return (
                <button
                  key={side}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicks((p) => ({ ...p, [pair.id]: side }))}
                  className={`flex min-h-14 flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${on ? "border-ink bg-ink text-white" : "border-[#d5d9e1] bg-white hover:border-ink"}`}
                >
                  <span className="text-sm font-semibold">{option.title}</span>
                  <span className={`text-[13px] ${on ? "text-haze" : "text-slate"}`}>{option.detail}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" disabled={!done} onClick={() => onSubmit(picks)} className="min-h-11 self-start rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40">
        {done ? "See how my agent did" : `Pick one from each (${Object.keys(picks).length}/${widget.pairs.length})`}
      </button>
    </fieldset>
  );
}

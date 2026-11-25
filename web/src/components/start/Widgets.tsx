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

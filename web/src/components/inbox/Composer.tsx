"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
};

function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function Composer({
  placeholder,
  busy,
  onSend,
  onStop,
}: {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const canDictate = useSyncExternalStore(
    noSubscribe,
    () => speechRecognition() !== null,
    () => false,
  );
  const area = useRef<HTMLTextAreaElement>(null);
  const recognition = useRef<Recognition | null>(null);

  // Grow with the text up to about six lines, then scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    recognition.current?.stop();
    setText("");
    onSend(value);
  };

  const toggleDictation = () => {
    if (listening) return recognition.current?.stop();
    const Speech = speechRecognition();
    if (!Speech) return;
    const r = new Speech();
    r.lang = navigator.language || "en-GB";
    r.interimResults = false;
    r.continuous = true;
    const before = text;
    let heard = "";
    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i]!.isFinal) heard += event.results[i]![0]!.transcript;
      setText(`${before}${before && heard ? " " : ""}${heard.trim()}`);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div className="shrink-0 border-t border-line bg-paper/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-[760px] flex-col gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-1.5 rounded-[26px] border border-line bg-white py-1.5 pl-4 pr-1.5 shadow-[0_12px_28px_-16px_rgba(11,18,32,0.25)] focus-within:border-ink"
        >
          <label htmlFor="composer" className="sr-only">
            {placeholder}
          </label>
          <textarea
            id="composer"
            ref={area}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={listening ? "Listening…" : placeholder}
            maxLength={2000}
            className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 leading-6 outline-none"
          />
          {canDictate && !busy && (
            <button
              type="button"
              onClick={toggleDictation}
              aria-pressed={listening}
              aria-label={listening ? "Stop dictation" : "Dictate"}
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${listening ? "bg-signal-soft text-signal-ink" : "text-slate hover:bg-paper"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
          {busy && onStop ? (
            <button type="button" onClick={onStop} aria-label="Stop" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white">
              <span aria-hidden="true" className="size-3 rounded-[3px] bg-white" />
            </button>
          ) : (
            <button type="submit" aria-label="Send" disabled={busy || !text.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white disabled:opacity-30">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          )}
        </form>
        <p className="hidden text-center text-[11px] text-slate sm:block">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}

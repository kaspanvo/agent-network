"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile didn't load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// Cloudflare Turnstile's check that a person, not a script, is starting an agent. Usually invisible; it only asks
// for a click when unsure. Tokens are single-use, so a new `attempt` resets the widget for a fresh one.
export function TurnstileCheck({ siteKey, action, attempt, onToken }: { siteKey: string; action: string; attempt: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenFor = useRef(onToken);
  useEffect(() => {
    tokenFor.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !box.current || widget.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          size: "flexible",
          callback: (token: string) => tokenFor.current(token),
          "expired-callback": () => tokenFor.current(null),
          "error-callback": () => tokenFor.current(null),
        });
      })
      .catch(() => tokenFor.current(null));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (attempt > 0 && widget.current) {
      tokenFor.current(null);
      window.turnstile?.reset(widget.current);
    }
  }, [attempt]);

  return <div ref={box} className="min-h-[65px]" />;
}

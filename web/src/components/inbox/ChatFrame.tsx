"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Keeps a conversation pinned to the newest message while the reader is at the bottom,
// and offers a jump button instead of yanking them down when they've scrolled up to read.
export function useStickToBottom(version: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  // True while a jump's smooth scroll is on its way down, so its own scroll events don't unpin it.
  const jumping = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const jump = () => {
    const el = ref.current;
    atBottom.current = true;
    jumping.current = true;
    setShowJump(false);
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (jumping.current) {
        if (near) jumping.current = false;
        return;
      }
      atBottom.current = near;
      if (near) setShowJump(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (jumping.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setShowJump(true);
  }, [version]);

  return { ref, showJump, jump };
}

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 flex min-h-10 -translate-x-1/2 animate-rise items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-white shadow-lg"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
      Jump to latest
    </button>
  );
}

export function ConversationHeader({
  avatar,
  title,
  subtitle,
  onBack,
  children,
}: {
  avatar: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-3 py-2.5 sm:px-5">
      <button type="button" onClick={onBack} aria-label="Back to conversations" className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-paper md:hidden">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate font-display text-[17px] font-semibold leading-tight">{title}</h1>
        <div className="truncate text-[13px] text-slate">{subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </header>
  );
}

export function Dots({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1 py-2" role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-blink rounded-full bg-slate" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

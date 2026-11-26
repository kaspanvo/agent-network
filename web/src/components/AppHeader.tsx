import { Brand } from "./Brand";

import type { AgentMode } from "@/server/pace";

export function AppHeader({ label, mode, children }: { label: string; mode: AgentMode | null; children?: React.ReactNode }) {
  return (
    <header className="shrink-0 bg-navy-950 text-cloud">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6 lg:px-10">
        <Brand />
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-xs tracking-wider text-mist sm:inline">{label}</span>
          {mode === "demo" && (
            <span title="No Claude key is set, so a scripted agent is answering" className="rounded-full border border-signal-light/50 px-2.5 py-1 font-mono text-[10px] tracking-wider text-signal-light">
              DEMO AGENT
            </span>
          )}
          {mode === "open" && (
            <span title="No Claude key is set, so an open model on Cloudflare Workers AI is answering" className="rounded-full border border-live/50 px-2.5 py-1 font-mono text-[10px] tracking-wider text-live-soft">
              OPEN MODEL
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

import type { Thread, ThreadStatus } from "../inbox/runState";

const W = 560;
const H = 260;
const CX = W / 2;
const CY = H / 2;

const COLORS: Record<ThreadStatus, { line: string; fill: string; stroke: string; dash?: string }> = {
  talking: { line: "#ff5a1f", fill: "#ff5a1f", stroke: "none" },
  agreed: { line: "#22c55e", fill: "#22c55e", stroke: "none" },
  open: { line: "#0f172a", fill: "#ffffff", stroke: "#0f172a" },
  no_fit: { line: "#b7bfcc", fill: "#ffffff", stroke: "#b7bfcc", dash: "4 4" },
};

export function NetworkGraph({ threads, activeId, running }: { threads: Thread[]; activeId: string | null; running: boolean }) {
  const placed = threads.map((thread, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(threads.length, 5) + 0.35;
    return { thread, x: CX + Math.cos(angle) * 200, y: CY + Math.sin(angle) * 92 };
  });
  const summary = threads.length === 0 ? "Your agent hasn't met anyone yet." : threads.map((t) => `${t.who}: ${t.status.replace("_", " ")}`).join("; ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Your agent's network. ${summary}`} className="block h-auto w-full">
      {placed.map(({ thread, x, y }) => {
        const c = COLORS[thread.status];
        return <line key={`l-${thread.id}`} x1={CX} y1={CY} x2={x} y2={y} stroke={c.line} strokeWidth={thread.id === activeId ? 2.5 : 1.5} strokeDasharray={c.dash} />;
      })}
      {placed.map(({ thread, x, y }) => {
        const c = COLORS[thread.status];
        const members = thread.others.filter((o) => o !== thread.who);
        return (
          <g key={thread.id} className="animate-rise">
            {members.map((member, j) => {
              const mx = x + (j === 0 ? -34 : 34);
              const my = y + 30;
              return (
                <g key={member}>
                  <line x1={x} y1={y} x2={mx} y2={my} stroke="#dde1e8" strokeWidth={1.5} />
                  <circle cx={mx} cy={my} r={7} fill="#0b1220" />
                  <text x={mx} y={my + 22} textAnchor="middle" fill="#5a6478" style={{ font: "500 12px var(--font-jetbrains)" }}>
                    {member.toUpperCase()}
                  </text>
                </g>
              );
            })}
            {thread.status === "talking" && running && thread.id === activeId && (
              <circle cx={x} cy={y} r={20} fill="none" stroke="#ff5a1f" strokeWidth={1.5} opacity={0.5} className="animate-blink" />
            )}
            <circle cx={x} cy={y} r={13} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
            <text x={x} y={y - 22} textAnchor="middle" fill="#0b1220" style={{ font: "500 14px var(--font-jetbrains)" }}>
              {thread.who.toUpperCase()}
            </text>
          </g>
        );
      })}
      <circle cx={CX} cy={CY} r={30} fill="#0b1220" />
      <circle cx={CX} cy={CY} r={12} fill="none" stroke="#ff8a5c" strokeWidth={2.5} strokeDasharray="4 3" />
      <text x={CX} y={CY + 48} textAnchor="middle" fill="#0b1220" style={{ font: "600 12px var(--font-jetbrains)" }}>
        YOU
      </text>
    </svg>
  );
}

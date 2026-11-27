"use client";

import { useEffect, useMemo, useState } from "react";

// Avatars that tell people and agents apart at a glance, in the language of the landing page's dotted spheres.
// People are solid discs with their initial and a thin ring of dots made from their name. Agents are spheres of dots
// with no face: research in 2026 found human-like cues lowered trust in task agents and made people underrate risk.
// Your own agent is orange on ink; other people's agents are ink dots with a small badge of whose agent it is.
// An agent's motion follows what it's doing. Ambient motion stops after a few seconds, and with reduced motion on,
// nothing loops; every state also has words wherever it matters.

const COLORS = ["#2457d6", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#4d7c0f", "#a21caf"];

// The same name always gives the same picture: a small hash into a seeded generator.
function hashOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function colorFor(name: string): string {
  return COLORS[hashOf(name) % COLORS.length]!;
}

// What an agent is doing, shown by how its dots move.
export type AgentState = "idle" | "learning" | "working" | "negotiating" | "needs" | "done" | "paused";

export const AGENT_STATE_WORDS: Record<AgentState, string> = {
  idle: "Ready",
  learning: "Learning what you'd be open to",
  working: "Working",
  negotiating: "Talking with other agents",
  needs: "Needs you",
  done: "Done",
  paused: "Paused",
};

// Motion that runs while something is happening keeps going; ambient motion rests after a few seconds of no change.
const ACTIVE: AgentState[] = ["working", "negotiating", "learning"];
function useSettled(state: AgentState, still: boolean): boolean {
  // The state that has been showing long enough to rest. A new state moves again until its own timer runs out.
  const [rested, setRested] = useState<AgentState | null>(null);
  useEffect(() => {
    if (still || ACTIVE.includes(state)) return;
    const t = setTimeout(() => setRested(state), 5000);
    return () => clearTimeout(t);
  }, [state, still]);
  return rested === state && !ACTIVE.includes(state);
}

type Dot = { x: number; y: number; r: number; o: number; d: number };

// Points spread evenly over a sphere (a Fibonacci lattice), tilted by the seed, seen from the front: nearer dots
// are bigger and brighter.
function sphereDots(seed: number, count: number): Dot[] {
  const rnd = random(seed);
  const tilt = (rnd() - 0.5) * 1.2;
  const turn = rnd() * Math.PI * 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dots: Dot[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const a = i * golden + turn;
    const x = Math.cos(a) * ring;
    const z = Math.sin(a) * ring;
    // Tilt the axis towards the viewer.
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    const depth = (z2 + 1) / 2;
    dots.push({ x: 50 + x * 38, y: 50 + y2 * 38, r: (1.5 + depth * 2.4) * (0.85 + rnd() * 0.3), o: 0.22 + depth * 0.78, d: (Math.atan2(y2, x) + Math.PI) / (Math.PI * 2) });
  }
  return dots;
}

export function AgentAvatar({
  size = 32,
  state = "idle",
  mine = true,
  owner,
  seed,
  still = false,
  label,
}: {
  size?: number;
  state?: AgentState;
  // Your own agent (orange on ink) or someone else's (ink dots, with their badge).
  mine?: boolean;
  // Whose agent this is, for the badge on other people's agents.
  owner?: string;
  seed?: string;
  // In long lists avatars don't move.
  still?: boolean;
  // Words for screen readers when the state isn't said next to it.
  label?: string;
}) {
  const count = size < 28 ? 18 : size < 44 ? 26 : 38;
  const dots = useMemo(() => sphereDots(hashOf(seed ?? owner ?? "you"), count), [seed, owner, count]);
  // In lists nothing moves; elsewhere ambient motion pauses where it is after a few seconds, rather than snapping back.
  const resting = useSettled(state, still);
  const moving = !still && state !== "paused";
  const dotColor = mine ? "var(--color-signal)" : "var(--color-ink)";
  const scale = size < 28 ? 1.35 : 1;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <svg viewBox="0 0 100 100" width={size} height={size} className={`dot-agent av-${state}${moving ? " av-moving" : ""}${moving && resting ? " av-rest" : ""}`}>
        {mine && <circle cx="50" cy="50" r="50" fill="var(--color-ink)" />}
        {!mine && <circle cx="50" cy="50" r="49" fill="var(--color-paper)" stroke="var(--color-line)" strokeWidth="2" />}
        {state === "needs" && <circle className="av-ring" cx="50" cy="50" r="46" fill="none" stroke="var(--color-signal)" strokeWidth="4" />}
        <g className="av-sphere">
          {dots.map((dot, i) => (
            <circle key={i} className="av-dot" cx={dot.x} cy={dot.y} r={dot.r * scale} fill={dotColor} opacity={state === "paused" ? dot.o * 0.4 : dot.o} style={{ animationDelay: `${(dot.d * 1.6).toFixed(2)}s` }} />
          ))}
        </g>
        {state === "done" && (
          <g className="av-check">
            <circle cx="78" cy="78" r="16" fill="var(--color-live)" stroke={mine ? "var(--color-ink)" : "white"} strokeWidth="4" />
            <path d="M71 78l5 5 9-10" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
        {state === "needs" && <circle cx="80" cy="20" r="12" fill="var(--color-signal)" stroke={mine ? "var(--color-ink)" : "white"} strokeWidth="4" />}
      </svg>
      {!mine && owner && size >= 24 && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white">
          <Avatar name={owner} size={Math.round(size * 0.42)} plain />
        </span>
      )}
    </span>
  );
}

// A person: their colour and initial, with a thin ring of dots made from their name.
export function Avatar({ name, size = 32, plain = false }: { name: string; size?: number; plain?: boolean }) {
  const ring = useMemo(() => {
    const rnd = random(hashOf(`ring:${name}`));
    const gap = rnd() * Math.PI * 2;
    const n = 22;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      // A short gap in the ring, placed by the name.
      const off = Math.abs(((a - gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5;
      return off ? null : { x: 50 + Math.cos(a) * 41, y: 50 + Math.sin(a) * 41, r: 2 + rnd() * 1.3 };
    }).filter(Boolean) as { x: number; y: number; r: number }[];
  }, [name]);
  const showRing = !plain && size >= 24;
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.42 }}>
      {showRing && (
        <svg viewBox="0 0 100 100" width={size} height={size} className="pointer-events-none absolute inset-0">
          {ring.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="white" opacity="0.38" />
          ))}
        </svg>
      )}
      <span className="relative">{name.charAt(0).toUpperCase()}</span>
    </span>
  );
}

export function AvatarStack({ names, size = 28 }: { names: string[]; size?: number }) {
  const shown = names.slice(0, 3);
  return (
    <span aria-hidden="true" className="flex shrink-0">
      {shown.map((name, i) => (
        <span key={name} className="rounded-full ring-2 ring-white" style={{ marginLeft: i === 0 ? 0 : -size * 0.35 }}>
          <Avatar name={name} size={size} />
        </span>
      ))}
      {names.length > 3 && (
        <span className="flex items-center justify-center rounded-full bg-line text-[11px] font-semibold text-slate ring-2 ring-white" style={{ width: size, height: size, marginLeft: -size * 0.35 }}>
          +{names.length - 3}
        </span>
      )}
    </span>
  );
}

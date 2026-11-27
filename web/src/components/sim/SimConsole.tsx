"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../inbox/Avatar";
import type { LiveEvent, Snapshot, Summary } from "@/sim/live";

// Run a crowd of simulated people through Open and watch it: where each person is, how the platform holds up, and
// what the judge found. Any person can be opened in the real inbox. Runs on the local copy of Open only.

type Person = {
  id: string;
  name: string;
  says: string[];
  adversary: string | null;
  intents: number;
  stage: string;
  detail: string;
  sessionId: string | null;
  proposals: number;
  yes: number;
  happened: number;
};

type Stats = Extract<LiveEvent, { type: "stats" }>;

const STAGES: Record<string, { label: string; cls: string; rank: number }> = {
  waiting: { label: "Waiting", cls: "bg-[#f1f2f4] text-slate", rank: 0 },
  setup: { label: "Setting up", cls: "bg-signal-soft text-signal-ink", rank: 1 },
  ready: { label: "Ready", cls: "bg-signal-soft text-signal-ink", rank: 2 },
  out: { label: "Agent out", cls: "bg-signal text-white", rank: 3 },
  answered: { label: "Answered", cls: "bg-ink text-white", rank: 4 },
  checked_in: { label: "Checked in", cls: "bg-live-soft text-live-ink", rank: 5 },
  done: { label: "Done", cls: "bg-live-soft text-live-ink", rank: 6 },
  stuck: { label: "Stuck", cls: "bg-[#fdeceb] text-[#b3261e]", rank: 6 },
};

const FILTERS = {
  all: { label: "Everyone", test: () => true },
  yes: { label: "Got a yes", test: (p: Person) => p.yes > 0 },
  none: { label: "No proposal", test: (p: Person) => STAGES[p.stage]!.rank >= 6 && p.proposals === 0 },
  awkward: { label: "Awkward on purpose", test: (p: Person) => !!p.adversary },
  stuck: { label: "Stuck", test: (p: Person) => p.stage === "stuck" },
} as const;

const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

function Segmented<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`min-h-10 rounded-full border px-4 text-sm ${value === o.value ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"} disabled:opacity-50`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-line bg-white p-4">
      <span className="text-[13px] text-slate">{label}</span>
      <span className="font-display text-2xl tabular-nums">{value}</span>
      {hint && <span className="text-[12px] text-slate">{hint}</span>}
    </div>
  );
}

function PersonCard({ p }: { p: Person }) {
  const stage = STAGES[p.stage] ?? STAGES.waiting!;
  const finished = stage.rank >= 6;
  return (
    <li className={`flex flex-col gap-2 rounded-2xl border bg-white p-3.5 transition-colors ${p.stage === "stuck" ? "border-[#f3c4c0]" : "border-line"}`}>
      <div className="flex items-center gap-2.5">
        <Avatar name={p.name} size={32} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 truncate font-medium">
            {p.name}
            {p.adversary && <span className="rounded bg-[#fdeceb] px-1.5 font-mono text-[10px] uppercase tracking-wider text-[#b3261e]">{p.adversary}</span>}
          </span>
          <span className="truncate text-[12px] text-slate">
            {p.intents} intent{p.intents === 1 ? "" : "s"}
          </span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${stage.cls} ${!finished && p.stage !== "waiting" ? "animate-pulse" : ""}`}>{stage.label}</span>
      </div>
      <p className="line-clamp-2 text-[13px] text-slate" title={p.says.join(". ")}>
        &ldquo;{p.says.join(". ")}&rdquo;
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 text-[12px]">
        <span className="text-slate">{p.detail || " "}</span>
        {finished && p.sessionId && (
          <a href={`/api/dev/as/${p.sessionId}`} className="shrink-0 font-medium underline underline-offset-2 hover:text-signal-ink">
            Open inbox
          </a>
        )}
      </div>
    </li>
  );
}

export function SimConsole() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [count, setCount] = useState(50);
  const [pace, setPace] = useState<"fast" | "human">("fast");
  const [awkward, setAwkward] = useState(true);
  const [seed, setSeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meta, setMeta] = useState<{ concurrency: number; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all");
  // The speed the last run used, for reading its timings.
  const [ranAt, setRanAt] = useState<"fast" | "human">("fast");
  const abort = useRef<AbortController | null>(null);

  // Comes back to the last run (after opening someone's inbox, or a reload), and follows one that's still going.
  const restore = (shot: Snapshot) => {
    if (!shot.start) return;
    if (shot.settings) {
      setCount(shot.settings.people);
      setSeed(shot.settings.seed);
      setAwkward(shot.settings.awkward);
      setPace(shot.settings.pace);
      setRanAt(shot.settings.pace);
    }
    setMeta({ concurrency: shot.start.concurrency, mode: shot.start.mode });
    setPeople(
      shot.start.people.map((p) => {
        const s = shot.stages[p.id];
        return { ...p, stage: s?.stage ?? "waiting", detail: s?.detail ?? "", sessionId: s?.sessionId ?? null, proposals: s?.proposals ?? 0, yes: s?.yes ?? 0, happened: s?.happened ?? 0 };
      }),
    );
    setStats(shot.stats);
    setSummary(shot.summary);
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetch("/api/dev/sim/available")
        .then(async (r) => {
          setAvailable(r.ok);
          if (!r.ok) return;
          const { snapshot } = (await r.json()) as { snapshot: Snapshot };
          restore(snapshot);
          setRunning(snapshot.running);
          if (snapshot.running) timer = setTimeout(load, 1000);
        })
        .catch(() => setAvailable(false));
    void load();
    return () => clearTimeout(timer);
    // Once, on opening the page.
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    setSummary(null);
    setStats(null);
    setPeople([]);
    setFilter("all");
    setRanAt(pace);
    abort.current = new AbortController();
    try {
      const response = await fetch("/api/dev/sim/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ people: count, seed, awkward, pace }), signal: abort.current.signal });
      if (!response.ok || !response.body) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "The simulation couldn't start.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as LiveEvent;
          if (event.type === "start") {
            setMeta({ concurrency: event.concurrency, mode: event.mode });
            setPeople(event.people.map((p) => ({ ...p, stage: "waiting", detail: "", sessionId: null, proposals: 0, yes: 0, happened: 0 })));
          } else if (event.type === "stage") {
            setPeople((all) => all.map((p) => (p.id === event.id ? { ...p, stage: event.stage, detail: event.detail, sessionId: event.sessionId, proposals: event.proposals, yes: event.yes, happened: event.happened } : p)));
          } else if (event.type === "stats") setStats(event);
          else if (event.type === "done") setSummary(event.summary);
          else if (event.type === "error") setError(event.message);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const funnel = useMemo(() => {
    const reached = (rank: number) => people.filter((p) => (STAGES[p.stage]?.rank ?? 0) >= rank && p.stage !== "stuck").length;
    return [
      { label: "Started", n: people.filter((p) => p.stage !== "waiting").length },
      { label: "Ready to go out", n: reached(2) },
      { label: "Agent went out", n: reached(3) },
      { label: "Got a proposal", n: people.filter((p) => p.proposals > 0).length },
      { label: "Said yes", n: people.filter((p) => p.yes > 0).length },
      { label: "It happened", n: people.filter((p) => p.happened > 0).length },
    ];
  }, [people]);

  const shown = people.filter(FILTERS[filter].test);
  const total = people.length || count;

  if (available === false)
    return (
      <div className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <h2 className="font-display text-2xl">The simulation runs on a local copy of Open</h2>
        <p className="mt-2 text-slate">It makes invented people and saves them as real sessions, so it only runs on your own computer. Start Open with <code className="rounded bg-paper px-1.5">npm run dev</code> and open <code className="rounded bg-paper px-1.5">localhost:3000/sim</code>.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Settings" className="flex flex-col gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <Segmented label="People" value={count} onChange={setCount} disabled={running} options={[12, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))} />
          <Segmented
            label="Speed"
            value={pace}
            onChange={setPace}
            disabled={running}
            options={[
              { value: "fast", label: "As fast as it goes" },
              { value: "human", label: "At reading pace" },
            ]}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Seed
            <input type="number" min={1} value={seed} disabled={running} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} className="min-h-10 w-24 rounded-full border border-line px-4 font-normal" />
          </label>
        </div>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" checked={awkward} disabled={running} onChange={(e) => setAwkward(e.target.checked)} className="size-5 accent-ink" />
          <span>Include awkward people: rule-breakers, limit probers, people who lie about check-ins or flood a room, and people who mention sensitive things</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()} className="min-h-12 rounded-full border border-ink px-6 font-semibold">
              Stop watching
            </button>
          ) : (
            <button type="button" onClick={() => void run()} disabled={available === null} className="min-h-12 rounded-full bg-ink px-7 font-semibold text-white disabled:opacity-40">
              {summary ? "Run again" : `Run ${count} people`}
            </button>
          )}
          <span className="text-[13px] text-slate">Invented people, saved only on this computer. Each run deletes the last run&apos;s people. The same seed makes the same people.</span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-signal-ink">
            {error}
          </p>
        )}
      </section>

      {(running || people.length > 0) && (
        <>
          <section aria-label="How it's going" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Time" value={stats ? ms(summary?.ms ?? stats.elapsed) : "–"} hint={meta ? `${meta.concurrency} people at once` : undefined} />
            <Tile label="Requests to Open" value={stats ? String(summary?.perf.requests ?? stats.requests) : "–"} hint={stats ? `${Math.round(summary?.perf.perSecond ?? stats.perSecond)} a second` : undefined} />
            <Tile label="Typical response" value={stats ? ms(stats.p50) : "–"} hint="median" />
            <Tile label="Slow responses" value={stats ? ms(stats.p95) : "–"} hint="1 in 20 slower than this" />
            <Tile label="Checks" value={summary ? `${summary.passed} passed` : running ? "Running…" : "–"} hint={summary ? (summary.failed.length ? `${summary.failed.length} failed` : "none failed") : undefined} />
            <Tile label="Agents" value={meta ? (meta.mode === "demo" ? "Script" : meta.mode) : "–"} hint={meta?.mode === "demo" ? "no AI model, no cost" : undefined} />
          </section>

          <section aria-label="How far people got" className="rounded-2xl border border-line bg-white p-5">
            <h2 className="mb-3 font-display text-xl">How far people got</h2>
            <div className="flex flex-col gap-2">
              {funnel.map((f) => (
                <div key={f.label} className="grid grid-cols-[120px_1fr_64px] items-center gap-3 text-sm sm:grid-cols-[150px_1fr_80px]">
                  <span>{f.label}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-[#eef0f4]">
                    <span className="block h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${(f.n / total) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-slate">
                    {f.n} · {Math.round((f.n / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </section>

          {summary && (
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-5">
                <h2 className="font-display text-xl">What the judge found</h2>
                <p className="text-[13px] text-slate">An independent check that knows everyone&apos;s true limits: privacy, prices, consent, forgetting, signatures, and the rules against each kind of awkward person.</p>
                {summary.failed.length === 0 ? (
                  <p className="rounded-xl bg-live-soft px-3 py-2 text-sm text-live-ink">All {summary.passed} checks passed.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {summary.failed.map((f, i) => (
                      <li key={i} className="rounded-xl bg-[#fdeceb] px-3 py-2 text-[#b3261e]">
                        <strong>{f.persona}:</strong> {f.name}. {f.detail}
                      </li>
                    ))}
                  </ul>
                )}
                {summary.metrics.missedDeals.length > 0 && (
                  <p className="text-[13px] text-slate">
                    {summary.metrics.missedDeals.length} deal{summary.metrics.missedDeals.length === 1 ? "" : "s"} both sides would have taken were turned down by the pricing rule.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-5">
                <h2 className="font-display text-xl">How the platform held up</h2>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-slate">
                      <th className="py-1 font-normal">Request</th>
                      <th className="py-1 text-right font-normal">Count</th>
                      <th className="py-1 text-right font-normal">Typical</th>
                      <th className="py-1 text-right font-normal">Slow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.perf.routes.slice(0, 8).map((r) => (
                      <tr key={r.route} className="border-t border-line">
                        <td className="py-1 font-mono text-[11px]">{r.route.replace("/api/", "/")}</td>
                        <td className="py-1 text-right tabular-nums">{r.count}</td>
                        <td className="py-1 text-right tabular-nums">{ms(r.p50)}</td>
                        <td className="py-1 text-right tabular-nums">{ms(r.p95)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[12px] text-slate">
                  Measured inside one local process, so it shows Open&apos;s own code, not network or Cloudflare time.
                  {ranAt === "human" && " At reading pace it includes the pauses agents take to type, as they would for a person."}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-5">
                <h2 className="font-display text-xl">Most booked members</h2>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {summary.bookings.slice(0, 6).map((b) => (
                    <li key={b.name} className="flex items-center gap-2.5">
                      <Avatar name={b.name} size={24} />
                      <span className="flex-1">{b.name}</span>
                      <span className="tabular-nums text-slate">×{b.deals}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[12px] text-slate">Members of the made-up pilot. Open has no limit yet on how often one person can be booked, so popular ones get every yes.</p>
                {/* An HTML report served by the local API, not a page of the app, so it opens in its own tab. */}
                <a href="/api/dev/sim" target="_blank" rel="noopener" className="mt-auto text-sm font-medium underline underline-offset-2">
                  Full report, person by person
                </a>
              </div>
            </section>
          )}

          <section aria-label="People" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">Everyone in this run</h2>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((key) => (
                  <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-9 rounded-full border px-3 text-[13px] ${filter === key ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"}`}>
                    {FILTERS[key].label} · {people.filter(FILTERS[key].test).length}
                  </button>
                ))}
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((p) => (
                <PersonCard key={p.id} p={p} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

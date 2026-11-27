// Runs the simulation from the command line:
//
//   npm run sim                      12 simulated people, scripted agents, free, about a second
//   npm run sim -- --seed 7          a different (but repeatable) run
//   npm run sim -- --runs 20         20 seeds, to see how much the numbers move between runs
//   npm run sim -- --people 100 --concurrency 10   a generated crowd, ten using Open at once
//   npm run sim -- --live-model      the person's agent runs on whatever model the environment gives it (costs money)
//
// It writes .data/sim/<time>/report.html and run.json (gitignored) and saves each simulated person's agent to the
// local store, so with `npm run dev` running you can open the report at /api/dev/sim and step into any of them.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

// Before Open's modules read their settings: no pauses, and the scripted agent unless a live model was asked for.
process.env.OPEN_PACE = "0";
if (!flag("live-model")) process.env.OPEN_AGENT_MODE = "demo";

const { runScenario } = await import("./scenario");
const { reportHtml } = await import("./report");
const { saveSession } = await import("../server/local/files");
const { cohortOf } = await import("./generate");

const seed = value("seed", 1);
const runs = Math.max(1, Math.min(100, value("runs", 1)));
const people = Math.max(4, Math.min(500, value("people", 12)));
const concurrency = Math.max(1, Math.min(50, value("concurrency", 1)));
const out = join(process.cwd(), ".data", "sim", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });

const results: Awaited<ReturnType<typeof runScenario>>[] = [];
for (let r = 0; r < runs; r++) {
  const first = r === 0;
  const run = await runScenario({
    seed: seed + r,
    personas: cohortOf(people, seed + r, { awkward: !flag("no-awkward") }),
    concurrency,
    // Only the first run's people are saved to open in the app; the rest are for the numbers.
    save: first ? saveSession : undefined,
    onPerson: (t) => first && people <= 20 && console.log(`  ${t.persona.name.padEnd(6)} ${t.sentOut ? `out · ${t.choices.length} proposals · ${t.choices.filter((c) => c.decision === "approved").length} yes` : `not out: ${t.stuck}`}`),
  });
  results.push(run);
  if (first) {
    const html = reportHtml(run, (id) => `/api/dev/as/${id}`);
    writeFileSync(join(out, "report.html"), html);
    writeFileSync(join(process.cwd(), ".data", "sim", "latest.html"), html);
    writeFileSync(join(out, "run.json"), JSON.stringify({ ...run, traces: run.traces.map((t) => ({ ...t, session: { id: t.session.id, intents: t.session.intents, run: t.session.run, decisions: t.session.decisions } })) }, null, 2));
  }
}

const first = results[0]!;
const failed = first.checks.filter((c) => !c.pass);
console.log(`\n${first.traces.length} people · agents: ${first.mode} · seed ${seed} · ${(first.ms / 1000).toFixed(1)} s`);
const m = first.metrics;
console.log(`Funnel: ${m.people} started → ${m.ready} ready → ${m.sentOut} out → ${m.gotProposal} got a proposal → ${m.saidYes} said yes → ${m.happened} happened`);
console.log(`Deals lost to the pricing rule: ${m.missedDeals.length}${m.missedDeals.length ? ` (${m.missedDeals.map((d) => `${d.person}–${d.with}`).join(", ")})` : ""}`);
console.log(`Checks: ${first.checks.length - failed.length} passed, ${failed.length} failed`);
console.log(`Load: ${first.perf.requests} requests, ${first.perf.perSecond.toFixed(0)}/s with ${first.perf.concurrency} at once; slowest p95: ${first.perf.routes.slice().sort((a, b) => b.p95 - a.p95).slice(0, 3).map((r) => `${r.route} ${r.p95.toFixed(0)} ms`).join(", ")}`);
if (first.bookings[0]) console.log(`Most booked: ${first.bookings.slice(0, 3).map((b) => `${b.name} ×${b.deals}`).join(", ")} (no capacity limits yet)`);
for (const c of failed) console.log(`  ✗ ${c.persona}: ${c.name}. ${c.detail}`);

if (runs > 1) {
  const spread = (pick: (run: (typeof results)[number]) => number) => {
    const xs = results.map(pick).sort((a, b) => a - b);
    return `${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)} (${xs[0]!.toFixed(2)}–${xs.at(-1)!.toFixed(2)})`;
  };
  console.log(`\nAcross ${runs} seeds, mean (min–max):`);
  console.log(`  said yes, share of proposals  ${spread((r) => r.metrics.approvalRate)}`);
  console.log(`  people with a yes             ${spread((r) => r.metrics.saidYes)}`);
  console.log(`  their share of the deal room  ${spread((r) => r.metrics.surplusShare ?? 0)}`);
  console.log(`  deals lost to the pricing rule ${spread((r) => r.metrics.missedDeals.length)}`);
  console.log(`  failed checks                 ${spread((r) => r.checks.filter((c) => !c.pass).length)}`);
}

console.log(`\nReport: ${join(out, "report.html")}`);
console.log("With `npm run dev` running: http://localhost:3000/api/dev/sim");
process.exitCode = failed.length ? 1 : 0;

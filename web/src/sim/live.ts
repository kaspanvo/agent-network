import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../server/env";
import { agentMode } from "../server/pace";
import { deleteSession, saveSession } from "../server/local/files";
import { cohortOf } from "./generate";
import { reportHtml } from "./report";
import { perfOf, runScenario, type Run } from "./scenario";

// A simulation run you can watch from the app (local development only): it streams where every simulated person is
// as it happens, with live request timings, then the judge's verdict. The people it makes are saved as ordinary
// (synthetic) sessions, so each can be opened in the real inbox; the previous run's people are deleted first.

const DIR = () => join(process.cwd(), ".data", "sim");
const LIST = () => join(DIR(), "sessions.json");

const Params = z.object({
  people: z.number().int().min(4).max(200).default(50),
  seed: z.number().int().min(1).max(1_000_000).default(1),
  awkward: z.boolean().default(true),
  // "fast": no pauses. "human": the agents take their time to type, as they do for a person.
  pace: z.enum(["fast", "human"]).default("fast"),
  concurrency: z.number().int().min(1).max(50).optional(),
});

export type LiveEvent =
  | { type: "start"; people: { id: string; name: string; says: string[]; adversary: string | null; intents: number }[]; concurrency: number; mode: string }
  | { type: "stage"; id: string; stage: string; detail: string; sessionId: string; proposals: number; yes: number; happened: number }
  | { type: "stats"; requests: number; perSecond: number; p50: number; p95: number; elapsed: number }
  | { type: "done"; summary: Summary }
  | { type: "error"; message: string };

export type Summary = Pick<Run, "metrics" | "perf" | "bookings" | "ms" | "seed" | "mode"> & { passed: number; failed: { persona: string; name: string; detail: string }[] };

// The latest run as the page shows it, kept so the page can come back to it (after opening someone's inbox, or a
// reload) and follow a run that's still going.
export type Snapshot = {
  running: boolean;
  settings: { people: number; seed: number; awkward: boolean; pace: "fast" | "human" } | null;
  start: Extract<LiveEvent, { type: "start" }> | null;
  stages: Record<string, Extract<LiveEvent, { type: "stage" }>>;
  stats: Extract<LiveEvent, { type: "stats" }> | null;
  summary: Summary | null;
};

const g = globalThis as typeof globalThis & { __openSimRunning?: boolean; __openSimSnapshot?: Snapshot };

export function snapshot(): Snapshot {
  return g.__openSimSnapshot ?? { running: false, settings: null, start: null, stages: {}, stats: null, summary: null };
}

function forgetLastRun() {
  try {
    if (!existsSync(LIST())) return;
    for (const id of JSON.parse(readFileSync(LIST(), "utf8")) as string[]) deleteSession(id);
  } catch (err) {
    console.warn("Couldn't clear the last simulation's people:", err);
  }
}

export async function liveRun(request: Request): Promise<Response> {
  const parsed = Params.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Those settings don't work." }, { status: 400 });
  if (g.__openSimRunning) return Response.json({ error: "A simulation is already running. Wait for it to finish." }, { status: 409 });
  const p = parsed.data;
  const personas = cohortOf(p.people, p.seed, { awkward: p.awkward });
  const concurrency = p.concurrency ?? Math.min(p.pace === "human" ? 20 : 10, p.people);
  const encoder = new TextEncoder();
  const ids: string[] = [];

  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const shot: Snapshot = (g.__openSimSnapshot = { running: true, settings: { people: p.people, seed: p.seed, awkward: p.awkward, pace: p.pace }, start: null, stages: {}, stats: null, summary: null });
      const send = (event: LiveEvent) => {
        if (event.type === "start") shot.start = event;
        else if (event.type === "stage") shot.stages[event.id] = event;
        else if (event.type === "stats") shot.stats = event;
        else if (event.type === "done") shot.summary = event.summary;
        // The page may have gone to someone's inbox; the run carries on and the snapshot keeps up.
        if (open) {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            open = false;
          }
        }
      };
      g.__openSimRunning = true;
      const pace = env.OPEN_PACE;
      if (p.pace === "fast") env.OPEN_PACE = 0;
      const calls: { route: string; ms: number; status: number }[] = [];
      const started = Date.now();
      const ticker = setInterval(() => {
        const perf = perfOf(calls, Date.now() - started, concurrency);
        const all = calls.map((c) => c.ms).sort((a, b) => a - b);
        send({ type: "stats", requests: perf.requests, perSecond: perf.perSecond, p50: all[Math.floor(all.length / 2)] ?? 0, p95: all[Math.floor(all.length * 0.95)] ?? 0, elapsed: Date.now() - started });
      }, 400);
      try {
        forgetLastRun();
        send({ type: "start", concurrency, mode: agentMode(), people: personas.map((x) => ({ id: x.id, name: x.name, says: x.lines[0]!.split(/\.\s+/), adversary: x.adversary ?? null, intents: x.wants.length })) });
        const run = await runScenario({
          personas,
          seed: p.seed,
          concurrency,
          save: (s) => {
            if (!ids.includes(s.id)) ids.push(s.id);
            saveSession(s);
          },
          onCall: (route, ms, status) => calls.push({ route, ms, status }),
          onStage: (persona, stage, detail, session) => {
            const choices = Object.values(session.decisions);
            const happened = Object.values(session.followups).filter((f) => f.answer === "again" || f.answer === "once").length;
            send({ type: "stage", id: persona.id, stage, detail, sessionId: session.id, proposals: session.run?.opportunities.length ?? 0, yes: choices.filter((d) => d === "approved").length, happened });
          },
        });
        mkdirSync(DIR(), { recursive: true });
        writeFileSync(join(DIR(), "latest.html"), reportHtml(run, (id) => `/api/dev/as/${id}`));
        writeFileSync(LIST(), JSON.stringify(ids));
        const failed = run.checks.filter((c) => !c.pass).map((c) => ({ persona: c.persona, name: c.name, detail: c.detail }));
        const summary: Summary = { metrics: run.metrics, perf: run.perf, bookings: run.bookings, ms: run.ms, seed: run.seed, mode: run.mode, passed: run.checks.length - failed.length, failed };
        send({ type: "done", summary });
      } catch (err) {
        console.error(err);
        send({ type: "error", message: err instanceof Error ? err.message : "The simulation stopped." });
      } finally {
        clearInterval(ticker);
        // One last reading of the timings, so a page opened afterwards shows the final numbers.
        const all = calls.map((c) => c.ms).sort((a, b) => a - b);
        shot.stats = { type: "stats", requests: calls.length, perSecond: calls.length / ((Date.now() - started) / 1000), p50: all[Math.floor(all.length / 2)] ?? 0, p95: all[Math.floor(all.length * 0.95)] ?? 0, elapsed: Date.now() - started };
        shot.running = false;
        env.OPEN_PACE = pace;
        g.__openSimRunning = false;
        if (open) controller.close();
        open = false;
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

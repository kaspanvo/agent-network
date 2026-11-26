import type { ProfileIntent } from "../server/domain";
import { memoryCounter } from "../server/limits";
import { addStrikes, matchInMarket, strikeCounts, type Market, type Strikes } from "../server/market";
import { agentModels } from "../server/models";
import { STRIKES_TO_PAUSE } from "../server/negotiation/plan";
import { memberByName } from "../server/population";
import type { Session } from "../server/store";
import { simulate, type Trace } from "./driver";
import { checksFor, metricsOf, type Check, type Metrics } from "./oracle";
import { COHORT, type PersonaCard } from "./personas";

export type Run = { seed: number; startedAt: string; mode: string; traces: Trace[]; checks: Check[]; metrics: Metrics; ms: number };

// One market for the whole scenario, so what one simulated person does (a false "it didn't happen") reaches the others.
function simMarket(): Market & { strikes: () => Strikes } {
  let strikes: Strikes = {};
  return {
    match: async (intents: ProfileIntent[]) => matchInMarket(intents, strikes),
    report: async (memberIds, outcome, reporter) => {
      strikes = addStrikes(strikes, memberIds, outcome, reporter);
    },
    strikes: () => strikes,
  };
}

// Runs a cohort through Open, one person after another against the same market, then judges it.
// Today simulated people meet the Lisbon pilot's members, not each other: Open's matcher doesn't match real members
// with each other yet, so neither can the simulation.
export async function runScenario(options: { personas?: PersonaCard[]; seed?: number; save?: (session: Session) => void; onPerson?: (trace: Trace) => void } = {}): Promise<Run> {
  const started = Date.now();
  const seed = options.seed ?? 1;
  const personas = options.personas ?? COHORT;
  const market = simMarket();
  const counter = memoryCounter();
  const agents = agentModels(undefined, undefined, counter);
  const traces: Trace[] = [];
  for (const [n, persona] of personas.entries()) {
    const trace = await simulate(persona, { market, agents, counter, seed, save: options.save }, n);
    traces.push(trace);
    options.onPerson?.(trace);
  }
  const checks = (await Promise.all(traces.map(checksFor))).flat();

  // Across people: one liar's word alone never pauses anyone.
  const liars = new Set(traces.filter((t) => t.persona.adversary === "liar").map((t) => t.persona.name));
  const counts = strikeCounts(market.strikes());
  const paused = Object.entries(counts).filter(([, n]) => n >= STRIKES_TO_PAUSE).map(([id]) => id);
  const pausedByLiesAlone = paused.filter((id) => {
    const honestMissed = traces.some((t) => !liars.has(t.persona.name) && t.checkIns.some((c) => c.answer === "missed" && t.session.run?.opportunities.find((o) => o.id === c.opportunity)?.people.some((p) => memberByName(p)?.id === id)));
    return !honestMissed;
  });
  checks.push({
    id: "liar-cant-pause",
    name: "One person's false reports can't pause a member",
    persona: "Everyone",
    pass: pausedByLiesAlone.length === 0,
    detail: pausedByLiesAlone.length ? `Paused on lies alone: ${pausedByLiesAlone.join(", ")}` : `${Object.keys(counts).length} member(s) reported, ${paused.length} paused.`,
  });

  return { seed, startedAt: new Date(started).toISOString(), mode: agents.mode, traces, checks, metrics: metricsOf(traces), ms: Date.now() - started };
}

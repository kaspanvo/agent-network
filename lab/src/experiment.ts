import type { Deal, Engine, EngineNote, PopulationIndex, Proposal } from "./domain";
import { bilateralEngine } from "./engines/bilateral";
import { roomEngine } from "./engines/rooms";
import { similarityEngine } from "./engines/similarity";
import { evaluate, type Verdict } from "./feasibility";
import { formatMoney } from "./money";

export const ENGINES: Engine[] = [similarityEngine, bilateralEngine, roomEngine];

export type EngineRun = { engine: string; verdicts: Verdict[]; notes: EngineNote[] };

export type Summary = {
  engine: string;
  proposals: number;
  feasible: number;
  infeasible: number;
  conflict: number;
  seeksMet: string[];
  multiParty: number;
};

export function runExperiment(idx: PopulationIndex, engines: Engine[] = ENGINES): EngineRun[] {
  return engines.map((engine) => {
    const { proposals, notes } = engine.run(idx);
    return { engine: engine.name, verdicts: evaluate(proposals, idx), notes };
  });
}

export function participants(p: Proposal, idx: PopulationIndex): Set<string> {
  const ids = new Set<string>();
  for (const d of p.deals) {
    ids.add(idx.intents.get(d.forIntentId)?.principalId ?? d.forIntentId);
    ids.add(idx.intents.get(d.offerIntentId)?.principalId ?? d.offerIntentId);
  }
  return ids;
}

export function summarize(run: EngineRun, idx: PopulationIndex): Summary {
  const feasible = run.verdicts.filter((v) => v.status === "feasible");
  const seeksMet = new Set(feasible.flatMap((v) => v.proposal.deals.filter((d) => d.blockerIndex === undefined).map((d) => d.forIntentId)));
  return {
    engine: run.engine,
    proposals: run.verdicts.length,
    feasible: feasible.length,
    infeasible: run.verdicts.filter((v) => v.status === "infeasible").length,
    conflict: run.verdicts.filter((v) => v.status === "conflict").length,
    seeksMet: [...seeksMet],
    multiParty: feasible.filter((v) => participants(v.proposal, idx).size > 2).length,
  };
}

function describeDeal(d: Deal, idx: PopulationIndex): string {
  const tag = idx.intents.get(d.offerIntentId)?.tag ?? "?";
  let text = `${idx.nameOf(d.offerIntentId)} → ${idx.nameOf(d.forIntentId)} ${tag} ${formatMoney(d.price)}`;
  const thirdParty = d.paidBy.filter((p) => p.fromIntentId !== d.forIntentId);
  if (thirdParty.length > 0)
    text += ` (paid by ${d.paidBy.map((p) => `${idx.nameOf(p.fromIntentId)} ${formatMoney(p.amount)}`).join(", ")})`;
  return text;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join("  ")).join("\n");
}

export function formatReport(idx: PopulationIndex, runs: EngineRun[], baseline: string, candidate: string): string {
  const pop = idx.population;
  const out: string[] = [];
  out.push(
    `Population: ${pop.name} (${pop.synthetic ? "synthetic" : "REAL participants"}) · ${pop.principals.length} principals · ${pop.intents.length} intents · ${idx.seeks.length} seeking`,
    "",
  );

  const summaries = runs.map((r) => summarize(r, idx));
  out.push(
    table([
      ["Engine", "Proposals", "Feasible", "Infeasible", "Conflict", "Seeks met", "Multi-party"],
      ...summaries.map((s) => [
        s.engine,
        String(s.proposals),
        String(s.feasible),
        String(s.infeasible),
        String(s.conflict),
        `${s.seeksMet.length}/${idx.seeks.length}`,
        String(s.multiParty),
      ]),
    ]),
    "",
  );

  const base = summaries.find((s) => s.engine === baseline);
  const cand = runs.find((r) => r.engine === candidate);
  if (base && cand) {
    const candSummary = summarize(cand, idx);
    const gained = candSummary.seeksMet.filter((id) => !base.seeksMet.includes(id));
    const lost = base.seeksMet.filter((id) => !candSummary.seeksMet.includes(id));
    out.push(`Seeks met by ${candidate} but not ${baseline}: ${gained.length}`);
    for (const seekId of gained) {
      const verdict = cand.verdicts.find((v) => v.status === "feasible" && v.proposal.deals.some((d) => d.forIntentId === seekId));
      out.push(`  + ${idx.nameOf(seekId)}: "${idx.intents.get(seekId)?.summary}"`);
      for (const d of verdict?.proposal.deals ?? []) out.push(`      ${describeDeal(d, idx)}`);
    }
    out.push(`Seeks met by ${baseline} but not ${candidate}: ${lost.length}`);
    for (const seekId of lost) out.push(`  - ${idx.nameOf(seekId)}: "${idx.intents.get(seekId)?.summary}"`);
    out.push("");
  }

  out.push("Proposals");
  for (const run of runs) {
    out.push(`  ${run.engine}`);
    for (const v of run.verdicts) {
      out.push(`    ${v.proposal.id.padEnd(5)} ${v.status.padEnd(10)} ${v.proposal.deals.map((d) => describeDeal(d, idx)).join(" + ")}`);
      for (const reason of v.reasons) out.push(`          - ${reason}`);
    }
  }
  out.push("");

  out.push("Engine notes (missing seats are invite opportunities)");
  for (const run of runs)
    for (const n of run.notes) out.push(`  ${run.engine.padEnd(16)} ${n.intentId.padEnd(15)} ${n.kind}: ${n.detail}`);

  return out.join("\n");
}

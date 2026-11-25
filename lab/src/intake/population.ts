import { Population } from "../domain";
import type { Session } from "./schema";

export function buildPopulation(sessions: Session[], name: string): Population {
  const principals: Population["principals"] = [];
  const intents: Population["intents"] = [];
  for (const s of sessions) {
    if (!s.confirmed) continue;
    const principalId = `p-${s.id.slice(0, 8)}`;
    principals.push({ id: principalId, kind: s.participant.kind, name: s.participant.name, hoursPerWeek: s.confirmed.hoursPerWeek });
    s.confirmed.intents.forEach(({ evidence: _evidence, ...intent }, i) => intents.push({ ...intent, id: `${principalId}-${i + 1}`, principalId }));
  }
  return Population.parse({ name, synthetic: false, principals, intents });
}

// A seek whose tag nobody offers can't be met by any engine, so this is the first read on complementarity.
export function tagCoverage(population: Population): { tag: string; seeks: number; offers: number }[] {
  const counts = new Map<string, { seeks: number; offers: number }>();
  const add = (tag: string, side: "seeks" | "offers") => {
    const c = counts.get(tag) ?? { seeks: 0, offers: 0 };
    c[side]++;
    counts.set(tag, c);
  };
  for (const i of population.intents) {
    add(i.tag, i.direction === "seek" ? "seeks" : "offers");
    for (const b of i.blockers) add(b.resolvedBy, "seeks");
  }
  return [...counts].map(([tag, c]) => ({ tag, ...c })).sort((a, b) => a.tag.localeCompare(b.tag));
}

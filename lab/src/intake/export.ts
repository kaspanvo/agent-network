import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_POPULATION_PATH, SESSIONS_DIR } from "./paths";
import { buildPopulation, tagCoverage } from "./population";
import { SessionStore } from "./store";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: DEFAULT_POPULATION_PATH },
    name: { type: "string", default: `intake-${new Date().toISOString().slice(0, 10)}` },
  },
});

const sessions = new SessionStore(SESSIONS_DIR).list();
const population = buildPopulation(sessions, values.name);
writeFileSync(values.out, JSON.stringify(population, null, 2), { mode: 0o600 });

const unconfirmed = sessions.length - population.principals.length;
console.log(`Wrote ${values.out}`);
console.log(
  `${population.principals.length} confirmed participant(s), ${population.intents.length} intent(s)` +
    (unconfirmed > 0 ? `; ${unconfirmed} interview(s) not confirmed yet` : ""),
);

const coverage = tagCoverage(population);
if (coverage.length > 0) {
  const width = Math.max(3, ...coverage.map((c) => c.tag.length));
  console.log(`\n${"Tag".padEnd(width)}  Seeks  Offers`);
  for (const { tag, seeks, offers } of coverage)
    console.log(
      `${tag.padEnd(width)}  ${String(seeks).padStart(5)}  ${String(offers).padStart(6)}${seeks > 0 && offers === 0 ? "   nobody offers this" : ""}`,
    );
}
console.log(`\nRun the lab on it:\n  npm run lab -- ${values.out}`);

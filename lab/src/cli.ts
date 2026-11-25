import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { bilateralEngine } from "./engines/bilateral";
import { roomEngine } from "./engines/rooms";
import { formatReport, runExperiment, summarize } from "./experiment";
import { indexPopulation, loadPopulation } from "./population";

const { values, positionals } = parseArgs({
  options: { json: { type: "boolean", default: false } },
  allowPositionals: true,
});

const path = positionals[0] ?? fileURLToPath(new URL("../fixtures/founding-village.json", import.meta.url));

let population;
try {
  population = loadPopulation(path);
} catch (err) {
  console.error(`Could not load population from ${path}:`);
  console.error(err instanceof z.ZodError ? z.prettifyError(err) : String(err));
  process.exit(1);
}

const idx = indexPopulation(population);
const runs = runExperiment(idx);

if (values.json) {
  const report = {
    population: population.name,
    synthetic: population.synthetic,
    runs: runs.map((run) => ({ ...run, summary: summarize(run, idx) })),
  };
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatReport(idx, runs, bilateralEngine.name, roomEngine.name));
}

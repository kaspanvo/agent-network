import { readFileSync } from "node:fs";
import { Population, type PopulationIndex } from "./domain";

export function loadPopulation(path: string): Population {
  return Population.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function indexPopulation(population: Population): PopulationIndex {
  const principals = new Map(population.principals.map((p) => [p.id, p]));
  const intents = new Map(population.intents.map((i) => [i.id, i]));
  return {
    population,
    principals,
    intents,
    seeks: population.intents.filter((i) => i.direction === "seek"),
    offers: population.intents.filter((i) => i.direction === "offer"),
    nameOf(intentId) {
      const intent = intents.get(intentId);
      return (intent && principals.get(intent.principalId)?.name) ?? intentId;
    },
  };
}

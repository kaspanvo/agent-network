import { fileURLToPath } from "node:url";

export const SESSIONS_DIR = fileURLToPath(new URL("../../data/intake/", import.meta.url));
export const DEFAULT_POPULATION_PATH = fileURLToPath(new URL("../../data/population.json", import.meta.url));

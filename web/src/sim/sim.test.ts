import { describe, expect, it } from "vitest";
import { runScenario } from "./scenario";

// Tier 0 in CI: the whole cohort, scripted agents, no model calls, a few seeds. Any check the judge fails is a
// regression a real member could run into, so the build fails with it.
describe("simulated members, end to end", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: everyone gets through setup and out, and every check holds`, async () => {
      const run = await runScenario({ seed });
      const failed = run.checks.filter((c) => !c.pass).map((c) => `${c.persona}: ${c.name}. ${c.detail}`);
      expect(failed).toEqual([]);
      expect(run.metrics.sentOut).toBe(run.traces.length);
      expect(run.metrics.gotProposal).toBeGreaterThan(run.traces.length / 2);
    });
  }
});

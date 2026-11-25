import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: { OPEN_PACE: "0", OPEN_AGENT_MODE: "demo" },
  },
});

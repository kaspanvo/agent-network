import { getAgentByName } from "agents";
import { cookieOf, crossSite, handleApi } from "../src/server/api";
import { jsonError } from "../src/server/http";
import { agentModels } from "../src/server/models";
import { isSessionId, SESSION_COOKIE } from "../src/server/store";
import { clientIp } from "../src/server/turnstile";
import { budgetCounter } from "./budget";

export { PersonAgent } from "./person";
export { MarketAgent } from "./market";
export { Budget } from "./budget";

// Open on Cloudflare. Static pages are served straight from Workers Static Assets; only /api/* reaches this code.
// Each request goes to the Durable Object of the person in the session cookie. A new person gets a new object.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const refused = crossSite(request);
    if (refused) return refused;

    // Flood guards per address, before any agent wakes or any model is called.
    const ip = clientIp(request);
    const starting = request.method === "POST" && url.pathname === "/api/session";
    if (!(await env.API_LIMITER.limit({ key: ip })).success || (starting && !(await env.SESSION_LIMITER.limit({ key: ip })).success)) {
      return jsonError("That's a lot of requests at once. Wait a minute and try again.", 429);
    }

    const counter = budgetCounter(env.BUDGET);
    if (starting) {
      const agent = await getAgentByName(env.PERSON_AGENT, crypto.randomUUID());
      return agent.fetch(request);
    }
    const id = cookieOf(request, SESSION_COOKIE);
    if (!isSessionId(id) || (request.method === "DELETE" && url.pathname === "/api/session")) {
      // No agent yet, or leaving: nothing to wake.
      // Still answers which model runs agents, so the first screen says it truthfully.
      return handleApi(request, { actor: undefined, counter, agents: agentModels(undefined, env.AI, counter), start: () => { throw new Error("Start a session first."); } });
    }
    const agent = await getAgentByName(env.PERSON_AGENT, id);
    return agent.fetch(request);
  },
} satisfies ExportedHandler<Env>;

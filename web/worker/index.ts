import { getAgentByName } from "agents";
import { cookieOf, crossSite, handleApi } from "../src/server/api";
import { agentModels } from "../src/server/models";
import { isSessionId, SESSION_COOKIE } from "../src/server/store";

export { PersonAgent } from "./person";
export { MarketAgent } from "./market";

// Open on Cloudflare. Static pages are served straight from Workers Static Assets; only /api/* reaches this code.
// Each request goes to the Durable Object of the person in the session cookie. A new person gets a new object.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const refused = crossSite(request);
    if (refused) return refused;

    if (request.method === "POST" && url.pathname === "/api/session") {
      const agent = await getAgentByName(env.PERSON_AGENT, crypto.randomUUID());
      return agent.fetch(request);
    }
    const id = cookieOf(request, SESSION_COOKIE);
    if (!isSessionId(id) || (request.method === "DELETE" && url.pathname === "/api/session")) {
      // No agent yet, or leaving: nothing to wake.
      // Still answers which model runs agents, so the first screen says it truthfully.
      return handleApi(request, { actor: undefined, agents: agentModels(undefined, env.AI), start: () => { throw new Error("Start a session first."); } });
    }
    const agent = await getAgentByName(env.PERSON_AGENT, id);
    return agent.fetch(request);
  },
} satisfies ExportedHandler<Env>;

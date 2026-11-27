import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handleApi, cookieOf } from "@/server/api";
import { loadSession } from "@/server/local/files";
import { liveRun, snapshot } from "@/sim/live";
import { actorFor, eraseActor, startActor } from "@/server/local/registry";
import { SESSION_COOKIE } from "@/server/store";

// Local development: every /api request goes to the same handler the Cloudflare Worker uses, with the
// person's agent kept in this process instead of in a Durable Object.
// Development only, never on Cloudflare: the latest simulation report, and stepping into a simulated person's agent
// to see their experience in the real app. Only sessions the harness itself marked synthetic can be opened.
// Where your own local agent's id waits while you look at a simulated member's inbox.
const HOME_COOKIE = "open_sid_home";

function dev(request: Request): Response | Promise<Response> | null {
  if (process.env.NODE_ENV === "production") return null;
  const path = new URL(request.url).pathname;
  // Run a simulation and watch it from the Simulation page.
  if (path === "/api/dev/sim/run" && request.method === "POST") return liveRun(request);
  if (path === "/api/dev/sim/available") return Response.json({ ok: true, snapshot: snapshot() });
  if (path === "/api/dev/sim") {
    const file = join(process.cwd(), ".data", "sim", "latest.html");
    if (!existsSync(file)) return new Response("No simulation yet. Run `npm run sim` first.", { status: 404 });
    return new Response(readFileSync(file, "utf8"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const as = /^\/api\/dev\/as\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (as) {
    const session = loadSession(as);
    if (!session?.synthetic) return new Response("That isn't a simulated member.", { status: 404 });
    // Your own agent is set aside while you look, and given back when you return to the simulation.
    const mine = cookieOf(request, SESSION_COOKIE);
    const own = loadSession(mine);
    const headers = new Headers({ Location: "/inbox" });
    headers.append("Set-Cookie", `${SESSION_COOKIE}=${as}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
    if (own && !own.synthetic) headers.append("Set-Cookie", `${HOME_COOKIE}=${mine}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return new Response(null, { status: 302, headers });
  }
  // Back from a simulated member's inbox: your own agent again (or none), and the simulation page.
  if (path === "/api/dev/back") {
    const home = cookieOf(request, HOME_COOKIE);
    const headers = new Headers({ Location: "/sim" });
    headers.append("Set-Cookie", home ? `${SESSION_COOKIE}=${home}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}` : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    headers.append("Set-Cookie", `${HOME_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  }
  return null;
}

function handle(request: Request): Promise<Response> {
  const local = dev(request);
  if (local) return Promise.resolve(local);
  const actor = actorFor(cookieOf(request, SESSION_COOKIE));
  return handleApi(request, { actor, start: startActor, erase: async () => actor && eraseActor(actor.session.id) });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };

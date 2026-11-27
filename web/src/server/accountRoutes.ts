import { z } from "zod";
import type { AccountConfig, Directory, Who } from "./account";
import { sessionCookie } from "./api";
import { jsonError } from "./http";
import { RETENTION_DAYS } from "./retention";

// Linking accounts and agents. These routes can touch two agents at once (the one on this device and the one saved to
// the account), so they run before a request reaches any one agent: in the Worker on Cloudflare, in the dev server
// locally.

export type AgentInfo = { exists: boolean; owner: string | null; started: boolean };

export type AccountHost = {
  config: AccountConfig | null;
  who: Who | null;
  directory: Directory;
  // The agent this device's cookie points at, if any.
  current: string | null;
  info: (agentId: string) => Promise<AgentInfo>;
  claim: (agentId: string, who: Who) => Promise<void>;
  erase: (agentId: string) => Promise<void>;
};

const DAY = 24 * 60 * 60;

export async function handleAccount(request: Request, host: AccountHost): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/account/")) return null;

  // What the page needs to start Supabase in the browser. Public by design.
  if (path === "/api/account/config" && request.method === "GET") return Response.json({ enabled: !!host.config, ...(host.config ?? {}) });

  if (path === "/api/account/signout" && request.method === "POST") {
    // Signing out leaves the saved agent where it is; this device just stops pointing at it.
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, "", 0) } });
  }

  if (path === "/api/account/link" && request.method === "POST") {
    if (!host.config) return jsonError("Accounts aren't switched on.", 404);
    if (!host.who) return Response.json({ error: "Sign in first.", needs: "signin" }, { status: 401 });
    const input = z.object({ choose: z.enum(["this", "saved"]).optional() }).safeParse(await request.json().catch(() => ({})));
    if (!input.success) return jsonError("Choose which agent to keep.", 400);
    const { who, directory, current } = host;
    // This device's cookie points at the account's agent, refreshed on each visit like any other.
    const openAgent = (agentId: string, status: string) => Response.json({ status }, { headers: { "Set-Cookie": sessionCookie(request, agentId, RETENTION_DAYS * DAY) } });

    const here = current ? await host.info(current) : null;
    const claimable = !!current && !!here?.exists && (!here.owner || here.owner === who.sub);
    let saved = await directory.get(who.sub);
    if (saved && !(await host.info(saved)).exists) saved = null;

    // No saved agent yet: this device's agent becomes it, or there's nothing to link and they start one.
    if (!saved) {
      if (!claimable) return Response.json({ status: "none" });
      await host.claim(current!, who);
      await directory.set(who.sub, current!);
      return openAgent(current!, "linked");
    }
    if (current === saved) return openAgent(saved, "linked");
    // Nothing worth keeping here (no agent, an empty one, or one already theirs): open the saved agent.
    if (!here?.exists || !here.started || here.owner === who.sub || input.data.choose === "saved") return openAgent(saved, "switched");
    // An agent with a conversation on this device, and a saved one elsewhere: the person chooses.
    if (!input.data.choose) return Response.json({ status: "conflict" });
    if (!claimable) return jsonError("The agent on this device belongs to another account.", 409);
    // Keep this one: it becomes the saved agent, and the old saved one is deleted, as they confirmed.
    await host.erase(saved);
    await host.claim(current!, who);
    await directory.set(who.sub, current!);
    return openAgent(current!, "linked");
  }
  return jsonError("Not found.", 404);
}


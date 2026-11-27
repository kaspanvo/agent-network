import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeActor } from "./actor";
import { isFresh, verifyToken, whoFrom, type Directory, type Who } from "./account";
import { handleAccount, type AccountHost, type AgentInfo } from "./accountRoutes";
import { handleApi, type Host } from "./api";
import { env } from "./env";
import { saveIntent } from "./intake/profile";
import { createSession, type Session } from "./store";

const at = (path: string, init?: RequestInit) => new Request(`http://localhost:3000${path}`, init);
const now = () => Math.floor(Date.now() / 1000);
const ana: Who = { sub: "user-ana", email: "ana@example.com", freshAt: now() };

function memoryDirectory(): Directory & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: async (sub) => map.get(sub) ?? null, set: async (sub, id) => void map.set(sub, id) };
}

function hostFor(session: Session, who: Who | null, extra: Partial<Host> = {}): Host {
  return { actor: makeActor(session, () => {}), start: () => makeActor(session, () => {}), identify: async () => who, ...extra };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.OPEN_SUPABASE_URL;
  delete env.OPEN_SUPABASE_PUBLISHABLE_KEY;
});

describe("checking Supabase's signed tokens", () => {
  it("accepts a token signed by the project's published key, and refuses tampering, expiry and the wrong issuer", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } }));
    const config = { url: "https://proj.supabase.co", publishableKey: "pk" };
    const sign = (claims: Record<string, unknown>, issuer = `${config.url}/auth/v1`, exp = "1h") =>
      new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(issuer).setAudience("authenticated").setSubject("user-ana").setIssuedAt().setExpirationTime(exp).sign(privateKey);
    const amr = [{ method: "otp", timestamp: now() - 60 }];
    const who = await verifyToken(await sign({ email: "ana@example.com", amr }), config);
    expect(who).toMatchObject({ sub: "user-ana", email: "ana@example.com", freshAt: amr[0]!.timestamp });
    expect(await verifyToken(await sign({ amr }, "https://evil.example/auth/v1"), config)).toBeNull();
    expect(await verifyToken(await sign({ amr }, undefined, "-1m"), config)).toBeNull();
    const token = await sign({ amr });
    expect(await verifyToken(`${token.slice(0, -4)}AAAA`, config)).toBeNull();
    // Anonymous Supabase users don't count as accounts.
    expect(await verifyToken(await sign({ is_anonymous: true }), config)).toBeNull();
  });

  it("takes the latest sign-in moment as when they last proved it's them", () => {
    expect(whoFrom({ sub: "u", amr: [{ method: "otp", timestamp: 100 }, { method: "passkey", timestamp: 500 }] })!.freshAt).toBe(500);
    expect(isFresh({ sub: "u", freshAt: now() - 60 })).toBe(true);
    expect(isFresh({ sub: "u", freshAt: now() - 3600 })).toBe(false);
  });
});

describe("a saved agent answers only its account", () => {
  const saved = () => {
    const session = createSession("Ana");
    session.owner = { sub: ana.sub, email: ana.email, linkedAt: new Date().toISOString() };
    return session;
  };

  it("refuses anyone else, even with the agent's cookie", async () => {
    expect((await handleApi(at("/api/session"), hostFor(saved(), null))).status).toBe(401);
    expect((await handleApi(at("/api/session"), hostFor(saved(), { ...ana, sub: "someone-else" }))).status).toBe(401);
    expect((await handleApi(at("/api/session"), hostFor(saved(), ana))).status).toBe(200);
  });

  it("asks for a fresh sign-in before exporting or deleting", async () => {
    const stale = { ...ana, freshAt: now() - 3600 };
    const reply = await handleApi(at("/api/session/export"), hostFor(saved(), stale));
    expect(reply.status).toBe(403);
    expect((await reply.json()).needs).toBe("reauth");
    expect((await handleApi(at("/api/session/export"), hostFor(saved(), ana))).status).toBe(200);
    expect((await handleApi(at("/api/session", { method: "DELETE" }), hostFor(saved(), stale))).status).toBe(403);
  });

  it("only lets a saved agent hold a standing yes once accounts are on", async () => {
    env.OPEN_SUPABASE_URL = "https://proj.supabase.co";
    env.OPEN_SUPABASE_PUBLISHABLE_KEY = "pk";
    const session = createSession("Ana");
    const intent = saveIntent(session, { direction: "seek", summary: "Learn Spanish", tag: "spanish-lessons", provenance: "stated", evidence: "", price: 15, unit: "hour" });
    const body = JSON.stringify({ price: 14, days: 7 });
    const anonymous = await handleApi(at(`/api/intents/${intent.id}/mandate`, { method: "PUT", body }), hostFor(session, null));
    expect((await anonymous.json()).needs).toBe("account");
    session.owner = { sub: ana.sub, linkedAt: new Date().toISOString() };
    expect((await handleApi(at(`/api/intents/${intent.id}/mandate`, { method: "PUT", body }), hostFor(session, ana))).status).toBe(200);
  });

  it("saves a new agent to the account of whoever starts it signed in, and won't make them a second", async () => {
    const directory = memoryDirectory();
    let made: Session | undefined;
    const host: Host = { actor: undefined, identify: async () => ana, directory, start: (name) => makeActor((made = createSession(name)), () => {}) };
    const reply = await handleApi(at("/api/session", { method: "POST", body: JSON.stringify({ name: "Ana", adult: true }) }), host);
    expect(reply.status).toBe(200);
    expect(made!.owner?.sub).toBe(ana.sub);
    expect(directory.map.get(ana.sub)).toBe(made!.id);
    const again = await handleApi(at("/api/session", { method: "POST", body: JSON.stringify({ name: "Ana", adult: true }) }), { ...host, actor: undefined });
    expect((await again.json()).needs).toBe("switch");
  });
});

describe("linking this device's agent and the account's", () => {
  function world(agents: Record<string, AgentInfo>, current: string | null, saved?: string) {
    const directory = memoryDirectory();
    if (saved) directory.map.set(ana.sub, saved);
    const erased: string[] = [];
    const host: AccountHost = {
      config: { url: "https://proj.supabase.co", publishableKey: "pk" },
      who: ana,
      directory,
      current,
      info: async (id) => agents[id] ?? { exists: false, owner: null, started: false },
      claim: async (id, who) => void (agents[id] = { ...agents[id]!, owner: who.sub }),
      erase: async (id) => void (erased.push(id), delete agents[id]),
    };
    return { host, directory, erased, agents };
  }
  const link = (host: AccountHost, choose?: "this" | "saved") => handleAccount(at("/api/account/link", { method: "POST", body: JSON.stringify(choose ? { choose } : {}) }), host);

  it("saves this device's agent when the account has none", async () => {
    const { host, directory, agents } = world({ a1: { exists: true, owner: null, started: true } }, "a1");
    const reply = (await link(host))!;
    expect((await reply.json()).status).toBe("linked");
    expect(directory.map.get(ana.sub)).toBe("a1");
    expect(agents.a1!.owner).toBe(ana.sub);
  });

  it("opens the saved agent on a new device, setting this device's cookie to it", async () => {
    const { host } = world({ saved1: { exists: true, owner: ana.sub, started: true } }, null, "saved1");
    const reply = (await link(host))!;
    expect((await reply.json()).status).toBe("switched");
    expect(reply.headers.get("set-cookie")).toContain("open_sid=saved1");
  });

  it("asks which to keep when both have a conversation, and does what they chose", async () => {
    const both = () => world({ here1: { exists: true, owner: null, started: true }, saved1: { exists: true, owner: ana.sub, started: true } }, "here1", "saved1");
    expect((await (await link(both().host))!.json()).status).toBe("conflict");
    const keepSaved = both();
    expect((await (await link(keepSaved.host, "saved"))!.json()).status).toBe("switched");
    expect(keepSaved.erased).toEqual([]);
    const keepThis = both();
    expect((await (await link(keepThis.host, "this"))!.json()).status).toBe("linked");
    expect(keepThis.erased).toEqual(["saved1"]);
    expect(keepThis.directory.map.get(ana.sub)).toBe("here1");
  });

  it("never takes over an agent saved to someone else", async () => {
    const { host, directory } = world({ theirs: { exists: true, owner: "someone-else", started: true } }, "theirs");
    expect((await (await link(host))!.json()).status).toBe("none");
    expect(directory.map.size).toBe(0);
  });

  it("needs a signed-in person, and says when accounts are off", async () => {
    const { host } = world({}, null);
    expect((await link({ ...host, who: null }))!.status).toBe(401);
    expect((await link({ ...host, config: null }))!.status).toBe(404);
    expect(await (await handleAccount(at("/api/account/config"), { ...host, config: null }))!.json()).toEqual({ enabled: false });
  });
});

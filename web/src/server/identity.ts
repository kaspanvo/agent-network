import type { Session } from "./store";

// Each person's agent has its own signing key (Ed25519), made in and kept by its Durable Object. Everything the
// agent says in a room is signed, so a message can be checked as really coming from this agent and unchanged since,
// the way A2A's signed Agent Cards and Web Bot Auth bind an agent to a key. The private key never leaves the session;
// only the public key and its short id are shown.

export type AgentKey = { id: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey };

const ALGORITHM = { name: "Ed25519" } as const;

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function agentKey(session: Session): Promise<AgentKey> {
  if (session.agentKey) return session.agentKey;
  const pair = (await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const id = b64url(await crypto.subtle.digest("SHA-256", new Uint8Array(new TextEncoder().encode(publicJwk.x ?? "")))).slice(0, 12);
  session.agentKey = { id, publicJwk, privateJwk };
  return session.agentKey;
}

// What the person let their agent do, for how long, and where: a scoped permission, like the owner-signed
// authorisations agent workspaces give each agent key (Buzz, 2026). People here hold no keys of their own (backing up
// keys is where consumer key schemes fail), so the person's say-so is the recap they confirmed, fingerprinted in
// `consent`; the agent signs the permission, and every message names it. A message outside its permission, or
// after it ends, doesn't check out.
export type Delegation = {
  v: 1;
  id: string;
  agent: string;
  community: string;
  may: ("share" | "negotiate" | "propose" | "accept_within_standing_yes")[];
  tags: string[];
  issuedAt: string;
  until: string;
  // A fingerprint of the recap the person confirmed: what the agent may look for and say.
  consent: string;
  signature: string;
};

// Replay protection for each message: a counter that only goes up, the time, and who it was for.
export type Envelope = { v: 2; seq: number; at: string; to: string[]; scope: string };

export const DELEGATION_DAYS = 30;
const COMMUNITY = "lisbon-pilot";

const sha = async (text: string) => b64url(await crypto.subtle.digest("SHA-256", new Uint8Array(new TextEncoder().encode(text)))).slice(0, 16);

function delegationBody(d: Omit<Delegation, "id" | "signature">): string {
  return JSON.stringify([d.v, d.agent, d.community, d.may, d.tags, d.issuedAt, d.until, d.consent]);
}

async function signBytes(session: Session, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await agentKey(session);
  const privateKey = await crypto.subtle.importKey("jwk", key.privateJwk, ALGORITHM, false, ["sign"]);
  return b64url(await crypto.subtle.sign(ALGORITHM, privateKey, bytes));
}

const bytesOf = (text: string) => new Uint8Array(new TextEncoder().encode(text));

// The permission for what the person confirmed. Issued again whenever what they confirmed changes.
export async function delegationFor(session: Session, tags: string[], consentBasis: string, now = new Date()): Promise<Delegation> {
  const key = await agentKey(session);
  const consent = await sha(consentBasis);
  const current = session.delegations?.at(-1);
  if (current && current.consent === consent && Date.parse(current.until) > now.getTime()) return current;
  const body = {
    v: 1 as const,
    agent: key.id,
    community: COMMUNITY,
    may: ["share", "negotiate", "propose", "accept_within_standing_yes"] as Delegation["may"],
    tags: [...new Set(tags)].sort(),
    issuedAt: now.toISOString(),
    until: new Date(now.getTime() + DELEGATION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    consent,
  };
  const delegation: Delegation = { ...body, id: await sha(delegationBody(body)), signature: await signBytes(session, bytesOf(delegationBody(body))) };
  // A few kept, so older messages can still be checked against the permission they were sent under.
  session.delegations = [...(session.delegations ?? []), delegation].slice(-5);
  return delegation;
}

// What gets signed. Version 2 adds the counter, the time, who it was for and the permission, so a message can't be
// replayed in another room, to someone else, later, or out of order. Version 1 (agent, room, words) is still checked
// for messages signed before.
function payload(keyId: string, threadId: string, text: string, envelope?: Envelope): Uint8Array<ArrayBuffer> {
  return bytesOf(JSON.stringify(envelope ? [2, keyId, threadId, envelope.to, envelope.seq, envelope.at, envelope.scope, text] : [keyId, threadId, text]));
}

// Who a message in a room is for: everyone in it but the person's own side.
export function audienceOf(session: Session, threadId: string): string[] {
  const names = new Set<string>();
  for (const e of session.run?.events ?? []) {
    if (e.type === "discover" && e.threadId === threadId) names.add(e.who);
    if (e.type === "room" && e.threadId === threadId) for (const m of e.members) if (m !== session.name) names.add(m);
  }
  return [...names].sort();
}

// `to` names who the message is for when it isn't a room (a first message to one agent).
export async function sign(session: Session, threadId: string, text: string, scope?: string, to?: string[]): Promise<{ signature: string; envelope?: Envelope }> {
  const key = await agentKey(session);
  if (!scope) return { signature: await signBytes(session, payload(key.id, threadId, text)) };
  session.agentSeq = (session.agentSeq ?? 0) + 1;
  const envelope: Envelope = { v: 2, seq: session.agentSeq, at: new Date().toISOString(), to: to ?? audienceOf(session, threadId), scope };
  return { signature: await signBytes(session, payload(key.id, threadId, text, envelope)), envelope };
}

export async function verify(key: { id: string; publicJwk: JsonWebKey }, threadId: string, text: string, signature: string, envelope?: Envelope): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("jwk", key.publicJwk, ALGORITHM, false, ["verify"]);
    return await crypto.subtle.verify(ALGORITHM, publicKey, unb64url(signature), payload(key.id, threadId, text, envelope));
  } catch {
    return false;
  }
}

export async function verifyDelegation(key: { id: string; publicJwk: JsonWebKey }, d: Delegation): Promise<boolean> {
  try {
    const body = { v: d.v, agent: d.agent, community: d.community, may: d.may, tags: d.tags, issuedAt: d.issuedAt, until: d.until, consent: d.consent };
    const signature = d.signature;
    const publicKey = await crypto.subtle.importKey("jwk", key.publicJwk, ALGORITHM, false, ["verify"]);
    return d.agent === key.id && (await sha(delegationBody(body))) === d.id && (await crypto.subtle.verify(ALGORITHM, publicKey, unb64url(signature), bytesOf(delegationBody(body))));
  } catch {
    return false;
  }
}

// What a receiving agent checks before believing a message. Returns why it's refused, or null to accept.
// `lastSeq` is the highest counter already seen from this agent; `me` is the receiver; `now` checks it's fresh.
export async function checkMessage(
  key: { id: string; publicJwk: JsonWebKey },
  message: { threadId: string; text: string; signature?: string; envelope?: Envelope },
  options: { delegations: Delegation[]; tag?: string; lastSeq?: number; me?: string; now?: Date; maxSkewMs?: number },
): Promise<string | null> {
  const { envelope, signature } = message;
  if (!signature || !envelope) return "not signed with a counter and permission";
  if (!(await verify(key, message.threadId, message.text, signature, envelope))) return "the signature doesn't match";
  if (options.lastSeq !== undefined && envelope.seq <= options.lastSeq) return "replayed or out of order";
  const delegation = options.delegations.find((d) => d.id === envelope.scope);
  if (!delegation || !(await verifyDelegation(key, delegation))) return "sent under no valid permission";
  const at = Date.parse(envelope.at);
  if (at < Date.parse(delegation.issuedAt) || at > Date.parse(delegation.until)) return "sent outside its permission's dates";
  if (options.tag && !delegation.tags.includes(options.tag)) return "about something its person didn't allow";
  if (options.me && !envelope.to.includes(options.me)) return "meant for someone else";
  if (options.now && Math.abs(options.now.getTime() - at) > (options.maxSkewMs ?? 5 * 60 * 1000)) return "too old";
  return null;
}

// Signs anything the person's agent said that isn't signed yet, before the session is saved. Most messages are
// signed as they're sent; this catches the rest (a yes, a check-in), so the record is always complete.
export async function signUnsigned(session: Session): Promise<void> {
  for (const event of session.run?.events ?? []) {
    if (event.type !== "message" || event.signature || (event.from !== "you" && event.from !== "person")) continue;
    const scope = await scopeFor(session);
    Object.assign(event, await sign(session, event.threadId, event.text, scope));
  }
}

// The current permission's id, issued from the confirmed recap if there isn't one yet. Undefined before the person
// has confirmed anything: then messages are signed the old way, without a permission.
export async function scopeFor(session: Session): Promise<string | undefined> {
  if (!session.recapConfirmed) return session.delegations?.at(-1)?.id;
  const active = session.intents.filter((i) => i.status === "confirmed" && (!i.sensitive || i.consentAt));
  const basis = JSON.stringify(active.map((i) => [i.id, i.tag, i.direction, i.summary, i.price, i.unit, i.conditions, i.consentAt ?? null]));
  return (await delegationFor(session, active.map((i) => i.tag), basis)).id;
}

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

// What gets signed: which agent, which room, and the exact words.
function payload(keyId: string, threadId: string, text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify([keyId, threadId, text])));
}

export async function sign(session: Session, threadId: string, text: string): Promise<string> {
  const key = await agentKey(session);
  const privateKey = await crypto.subtle.importKey("jwk", key.privateJwk, ALGORITHM, false, ["sign"]);
  return b64url(await crypto.subtle.sign(ALGORITHM, privateKey, payload(key.id, threadId, text)));
}

export async function verify(key: { id: string; publicJwk: JsonWebKey }, threadId: string, text: string, signature: string): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("jwk", key.publicJwk, ALGORITHM, false, ["verify"]);
    return await crypto.subtle.verify(ALGORITHM, publicKey, unb64url(signature), payload(key.id, threadId, text));
  } catch {
    return false;
  }
}

// Signs anything the person's agent said that isn't signed yet, before the session is saved. Most messages are
// signed as they're sent; this catches the rest (a yes, a check-in), so the record is always complete.
export async function signUnsigned(session: Session): Promise<void> {
  for (const event of session.run?.events ?? []) {
    if (event.type !== "message" || event.signature || (event.from !== "you" && event.from !== "person")) continue;
    event.signature = await sign(session, event.threadId, event.text);
  }
}

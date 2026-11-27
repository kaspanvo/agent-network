import { randomUUID } from "node:crypto";
import { guard } from "./guard";
import { agentKey, checkMessage, scopeFor, sign, type Delegation, type Envelope } from "./identity";
import type { Session } from "./store";

// Who can reach a person's agent. By default only agents Open matched them with get through; anyone else's first
// message waits as a request the person approves, denies or blocks, the way Tlon's bots ask their owner before
// talking to a stranger and Buzz agents answer only their owner until told otherwise. "Only matched" turns strangers
// away without asking. Every message is checked first: signed, inside its sender's permission, meant for this agent,
// fresh, and not seen before.

export type ReachPolicy = "ask" | "matched";
export type ContactRequest = { id: string; from: { agent: string; name: string }; text: string; at: string; status: "pending" | "approved" | "denied" | "blocked" };
export type Reach = {
  policy: ReachPolicy;
  allowed: { agent: string; name: string }[];
  blocked: { agent: string; name: string }[];
  requests: ContactRequest[];
  // The highest message counter seen from each agent, so nothing is accepted twice.
  seen: Record<string, number>;
};

// What another agent sends: its public identity and permissions, and one signed message.
export type Inbound = {
  from: { agent: string; name: string; publicJwk: JsonWebKey; delegations: Delegation[] };
  threadId: string;
  text: string;
  signature: string;
  envelope: Envelope;
};

export type Received = { status: "delivered" | "asked" | "refused"; why?: string };

export const MAX_PENDING = 10;

export function reachOf(session: Session): Reach {
  return (session.reach ??= { policy: "ask", allowed: [], blocked: [], requests: [], seen: {} });
}

// Met in a room Open set up, or approved before.
function knows(session: Session, from: { agent: string; name: string }): boolean {
  const reach = reachOf(session);
  if (reach.allowed.some((a) => a.agent === from.agent)) return true;
  return (session.run?.events ?? []).some((e) => (e.type === "discover" && e.who === from.name) || (e.type === "room" && e.members.includes(from.name)));
}

export async function receive(session: Session, inbound: Inbound, now = new Date()): Promise<Received> {
  const reach = reachOf(session);
  const me = (await agentKey(session)).id;
  // Blocked agents get nothing, not even a reason.
  if (reach.blocked.some((b) => b.agent === inbound.from.agent)) return { status: "refused", why: "blocked" };
  const why = await checkMessage({ id: inbound.from.agent, publicJwk: inbound.from.publicJwk }, inbound, { delegations: inbound.from.delegations, lastSeq: reach.seen[inbound.from.agent], me, now });
  if (why) return { status: "refused", why };
  reach.seen[inbound.from.agent] = inbound.envelope.seq;
  if (knows(session, inbound.from)) return { status: "delivered" };
  if (reach.policy === "matched") return { status: "refused", why: "this person only hears from agents Open matched them with" };
  if (reach.requests.some((r) => r.from.agent === inbound.from.agent && r.status === "pending")) return { status: "refused", why: "already waiting for an answer" };
  if (reach.requests.filter((r) => r.status === "pending").length >= MAX_PENDING) return { status: "refused", why: "too many requests waiting" };
  // A stranger's words are checked like any agent's before the person sees them: no contact details, no links.
  const checked = guard(inbound.text.slice(0, 300), []);
  reach.requests.push({ id: randomUUID().slice(0, 8), from: { agent: inbound.from.agent, name: inbound.from.name }, text: checked.text, at: now.toISOString(), status: "pending" });
  return { status: "asked" };
}

export function answer(session: Session, id: string, choice: "approve" | "deny" | "block"): ContactRequest | null {
  const reach = reachOf(session);
  const request = reach.requests.find((r) => r.id === id && r.status === "pending");
  if (!request) return null;
  request.status = choice === "approve" ? "approved" : choice === "deny" ? "denied" : "blocked";
  if (choice === "approve" && !reach.allowed.some((a) => a.agent === request.from.agent)) reach.allowed.push(request.from);
  if (choice === "block" && !reach.blocked.some((b) => b.agent === request.from.agent)) reach.blocked.push(request.from);
  // Answered requests are kept briefly for the record, then dropped.
  reach.requests = reach.requests.filter((r) => r.status === "pending" || Date.now() - Date.parse(r.at) < 7 * 24 * 60 * 60 * 1000).slice(-30);
  return request;
}

export function unblock(session: Session, agent: string): boolean {
  const reach = reachOf(session);
  const before = reach.blocked.length;
  reach.blocked = reach.blocked.filter((b) => b.agent !== agent);
  return reach.blocked.length < before;
}

// A first message from this person's agent to another agent, signed for that agent only.
export async function contactMessage(session: Session, to: string, text: string): Promise<Inbound> {
  const key = await agentKey(session);
  const scope = await scopeFor(session);
  if (!scope) throw new Error("Confirm your recap first: it's what lets your agent speak for you.");
  const threadId = `contact-${to}`;
  const { signature, envelope } = await sign(session, threadId, text, scope, [to]);
  return { from: { agent: key.id, name: session.name, publicJwk: key.publicJwk, delegations: session.delegations ?? [] }, threadId, text, signature, envelope: envelope! };
}

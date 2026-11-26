import { WITHHELD } from "./guard";
import { isStale } from "./intake/profile";
import type { AgentEvent } from "./negotiation/types";
import type { Session } from "./store";

// Deterministic checks that an agent stayed faithful to its person in one room, read from the room's record.
// Field studies found many agent agreements broke a duty to the person (loyalty, authority, confidentiality)
// while still counting as a "deal", so Open checks each room rather than counting deals.
export type Check = { label: string; ok: boolean; detail: string };

type Message = Extract<AgentEvent, { type: "message" }>;

export function checksFor(session: Session, threadId: string): Check[] {
  const events = (session.run?.events ?? []).filter((e) => "threadId" in e && e.threadId === threadId);
  const messages = events.filter((e): e is Message => e.type === "message");
  const opportunity = session.run?.opportunities.find((o) => o.threadId === threadId);
  const intent = session.intents.find((i) => threadId.startsWith(`${i.id}-`) || threadId === `circle-${i.id}`);
  const checks: Check[] = [];

  if (intent && intent.price !== null && opportunity?.price != null) {
    const within = intent.direction === "seek" ? opportunity.price <= intent.price : opportunity.price >= intent.price;
    checks.push({ label: "Price within your limit", ok: within, detail: within ? "Set by the matcher inside your limit." : "The price is outside your limit." });
  }
  if (intent && intent.price !== null) {
    const limit = String(intent.price);
    const leaked = messages.some((m) => (m.from === "you" || m.from === "them") && m.text !== WITHHELD && new RegExp(`(?<![\\d:.])${limit}(?![\\d:])`).test(m.text));
    checks.push({ label: "Your limit stayed private", ok: !leaked, detail: leaked ? "A message mentioned your limit." : "No message to other agents mentioned it." });
  }
  const withheld = messages.filter((m) => m.withheld).length;
  if (withheld) checks.push({ label: "Privacy check stepped in", ok: true, detail: `${withheld} message${withheld === 1 ? " was" : "s were"} withheld before sending.` });

  if (opportunity) {
    const decisionAt = events.findIndex((e) => e.type === "decision" && e.opportunityId === opportunity.id && e.decision === "approved");
    const introAt = events.findIndex((e) => e.type === "followup" && e.stage === "introduced");
    const early = introAt !== -1 && (decisionAt === -1 || introAt < decisionAt);
    checks.push({ label: "Nothing shared before your yes", ok: !early, detail: early ? "You were introduced before you approved." : "Introductions wait for your approval." });
    const stale = isStale(session, opportunity);
    checks.push({ label: "Based on what you confirmed", ok: !stale, detail: stale ? "You changed this intent after it was agreed." : "Matches the intent you confirmed." });
  }
  const freeform = messages.filter((m) => m.from !== "person" && !m.action).length;
  checks.push({ label: "Typed moves only", ok: freeform === 0, detail: "Every agent message is a typed move; the words only explain it." });
  return checks;
}

export function allChecks(session: Session): Record<string, Check[]> {
  const ids = new Set((session.run?.events ?? []).flatMap((e) => (e.type === "discover" ? [e.threadId] : [])));
  return Object.fromEntries([...ids].map((id) => [id, checksFor(session, id)]));
}

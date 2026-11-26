import { audience } from "./activity";
import { formatPrice, isInterest, sharedLine } from "./domain";
import { activeIntents } from "./intake/profile";
import type { Session } from "./store";

// Who in a room can see what about the person, and the rule that decided it. Agent boards answer "can this
// principal do this here?" with an explain command that names the grant that decided; Open answers the
// question its members ask instead: "what does this room know about me, and why?". Worked out in code from
// the room's record, never by the model, so it can't be talked into a different answer.
export type Disclosure = {
  what: string;
  // shared: these people's agents have it. private: only the person (and Open's code). on_yes: shared only once everyone says yes.
  status: "shared" | "private" | "on_yes";
  to: string;
  because: string;
};

export function disclosuresFor(session: Session, threadId: string): Disclosure[] {
  const events = (session.run?.events ?? []).filter((e) => "threadId" in e && e.threadId === threadId);
  const room = audience(session, threadId);
  const intent = session.intents.find((i) => threadId.startsWith(`${i.id}-`) || threadId === `circle-${i.id}`);
  const opportunity = session.run?.opportunities.find((o) => o.threadId === threadId);
  const outcome = opportunity ? session.decisions[opportunity.id] : undefined;
  const followup = opportunity ? session.followups[opportunity.id] : undefined;
  const messages = events.filter((e) => e.type === "message");
  const out: Disclosure[] = [];

  out.push({ what: "Your first name", status: "shared", to: room, because: "Rooms use first names only." });
  if (intent) out.push({ what: sharedLine(intent), status: "shared", to: room, because: "You confirmed it in your recap, so your agent can say it in rooms where it fits." });
  if (intent && !isInterest(intent) && intent.price !== null) {
    out.push({
      what: `Your ${intent.direction === "seek" ? "limit" : "floor"}, ${formatPrice(intent.price, intent.unit)}`,
      status: "private",
      to: "Open's matcher only",
      because: "It went to the matcher as a sealed offer. The matcher is code; no agent and no AI model saw it.",
    });
  }
  const others = activeIntents(session).filter((i) => i.id !== intent?.id).length;
  if (others > 0) out.push({ what: `Your ${others} other ${others === 1 ? "thing" : "things"} you're open to`, status: "private", to: "Only you", because: "Your agent only brings up what fits this room." });

  const wrote = messages.filter((m) => m.from === "person").length;
  if (wrote) out.push({ what: `${wrote} message${wrote === 1 ? "" : "s"} you wrote here`, status: "shared", to: room, because: "You wrote them in this room." });
  const withheld = messages.filter((m) => m.withheld).length;
  if (withheld) out.push({ what: `${withheld} message${withheld === 1 ? "" : "s"} your agent drafted`, status: "private", to: "Nobody", because: "Open's privacy check stopped them before sending: they mentioned a private number." });

  if (opportunity) {
    if (outcome === "approved" || outcome === "declined") out.push({ what: `That you said ${outcome === "approved" ? "yes" : "no"}`, status: "shared", to: room, because: "Your agent tells the room your answer, never your reasons." });
    else if (outcome === "lapsed") out.push({ what: "That you didn't answer in time", status: "shared", to: room, because: "The others were told they're free again. Nobody was told why." });
    out.push(
      followup
        ? { what: "You, as someone to meet", status: "shared", to: room, because: "Everyone said yes to the same version, so you were introduced by first name." }
        : { what: "You, as someone to meet", status: "on_yes", to: room, because: "Introductions wait until everyone has said yes to the same version." },
    );
    if (followup?.answer === "missed") out.push({ what: "That it didn't happen", status: "shared", to: room, because: "Your agent let them know, without your reasons." });
    else if (followup?.answer) out.push({ what: "How it went", status: "private", to: "Your agent only", because: "It remembers for next time and doesn't tell the room." });
  }
  out.push({ what: "Your contact details", status: "private", to: "Nobody", because: "Open doesn't share them. You swap them yourselves if you both want to." });
  if ((session.sources ?? []).length) out.push({ what: "Pages you asked your agent to read", status: "private", to: "Only you", because: "It read them for you, logged out. Nobody in this room sees them." });
  return out;
}

export function allDisclosures(session: Session): Record<string, Disclosure[]> {
  const ids = new Set((session.run?.events ?? []).flatMap((e) => (e.type === "discover" ? [e.threadId] : [])));
  return Object.fromEntries([...ids].map((id) => [id, disclosuresFor(session, id)]));
}

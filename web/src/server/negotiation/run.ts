import { formatPrice, lowerFirst, type ProfileIntent } from "../domain";
import { activeIntents, intentBasis } from "../intake/profile";
import { pause } from "../pace";
import { LISBON_PILOT } from "../population";
import { localMarket, type Market } from "../market";
import type { Session } from "../store";
import { guard } from "../guard";
import { holdUntil } from "../holds";
import type { Line, Narrator } from "./narrator";
import { circleScript, planCircles, planOpportunity, type CirclePlan } from "../rooms/circle";
import { listWords } from "./plan";
import type { AgentEvent, Opportunity, ShortlistOption, ThreadPlan } from "./types";

export function opportunityFor(thread: ThreadPlan, you: string, version = 1, compared = 1): Opportunity {
  const price = thread.agreedPrice!;
  const fmt = (n: number) => formatPrice(n, thread.unit);
  const them = thread.counterpart.name;
  const group = thread.kind === "group";
  const roomNames = thread.room.map((r) => r.name);
  return {
    id: `${thread.id}-v${version}`,
    threadId: thread.id,
    intentId: thread.intentId,
    kind: "deal",
    title: thread.direction === "seek" ? `${thread.intentSummary} with ${them}${group ? `, in a group of ${roomNames.length + 1}` : ""}` : `${thread.intentSummary}: ${them} would buy`,
    price,
    unit: thread.unit,
    people: [you, them, ...roomNames],
    terms: [`${fmt(price)}${group ? " each" : ""}`, ...(thread.schedule ? [thread.schedule] : []), ...(group ? [`With ${listWords(roomNames)}`] : [])],
    reasons: [
      thread.direction === "seek" ? `${fmt(price)} is within your ${fmt(thread.limit)} limit` : `${fmt(price)} is above your ${fmt(thread.limit)} floor`,
      ...(group ? [`${them} offered a group rate, and ${listWords(roomNames)} want the same`] : []),
      ...(thread.schedule ? [`${thread.schedule}, as you asked`] : []),
      ...(compared > 1 ? [`The best fit of ${compared} offers your agent compared`] : []),
    ],
    version,
  };
}

export const MATCHER = "Open's matcher";

// A deal room's messages. Every agent line passes the privacy check, with both sides' limits as the secrets.
export function dealMessages(thread: ThreadPlan, lines: Line[], you: string): AgentEvent[] {
  return thread.moves.map((move, i) => {
    const line = lines[i]!;
    const checked = move.from === "open" ? { text: line.text, withheld: false } : guard(line.text, [thread.limit, ...(thread.theirLimit !== undefined ? [thread.theirLimit] : [])]);
    return {
      type: "message",
      threadId: thread.id,
      from: move.from,
      who: move.from === "you" ? `${you}'s agent` : move.from === "open" ? MATCHER : `${thread.counterpart.name}'s agent`,
      action: move.action,
      amount: move.amount,
      unit: thread.unit,
      text: checked.text,
      why: checked.withheld ? "Open's privacy check stopped this message because it mentioned a private number. Nothing was sent." : line.why,
      ...(checked.withheld ? { withheld: true } : {}),
    };
  });
}

export function runStats(session: Session) {
  const events = session.run?.events ?? [];
  return {
    contacted: events.filter((e) => e.type === "discover" && e.mode !== "private").length,
    rooms: events.filter((e) => e.type === "room").length,
    ready: session.run?.opportunities.length ?? 0,
  };
}

// A stable shuffle, so the order agents are heard in doesn't depend on who joined the pilot first.
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const random = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type Choice = { intent: ProfileIntent; chosen: ThreadPlan; options: ThreadPlan[]; why: string };

const MAX_SHORTLIST = 3;

// Your agent hears every offer for an intent before choosing. It prefers the format you asked for
// (a small group or one-to-one), then the better price. Being first never helps.
export function choose(intent: ProfileIntent, threads: ThreadPlan[]): Choice | null {
  const agreed = threads.filter((t) => t.intentId === intent.id && t.agreedPrice !== null);
  if (agreed.length === 0) return null;
  const seek = intent.direction === "seek";
  const fits = (t: ThreadPlan) => (intent.prefers === "group" ? t.kind === "group" : intent.prefers === "solo" ? t.kind !== "group" : true);
  // On an equal price, one-to-one wins: fewer people have to say yes.
  const ranked = [...agreed].sort(
    (a, b) => Number(fits(b)) - Number(fits(a)) || (seek ? a.agreedPrice! - b.agreedPrice! : b.agreedPrice! - a.agreedPrice!) || Number(a.kind === "group") - Number(b.kind === "group"),
  );
  const chosen = ranked[0]!;
  const fmt = (t: ThreadPlan) => formatPrice(t.agreedPrice!, t.unit);
  const best = [...agreed].sort((a, b) => (seek ? a.agreedPrice! - b.agreedPrice! : b.agreedPrice! - a.agreedPrice!) || Number(a.kind === "group") - Number(b.kind === "group"))[0]!;
  const why =
    agreed.length === 1
      ? "The only offer that fit."
      : chosen !== best && chosen.agreedPrice === best.agreedPrice
        ? `Both came in at ${fmt(chosen)}, and you'd rather ${intent.prefers === "solo" ? "one-to-one" : "a small group"}, so ${chosen.counterpart.name}.`
        : chosen !== best
        ? `You'd rather ${intent.prefers === "solo" ? "one-to-one, even if it costs more" : "a small group"}, so ${chosen.counterpart.name} at ${fmt(chosen)} beats ${best.counterpart.name} at ${fmt(best)}.`
        : `${fmt(chosen)} is the ${seek ? "lowest" : "highest"} price of the offers that fit your times.`;
  return { intent, chosen, options: ranked.slice(0, MAX_SHORTLIST), why };
}

function optionOf(t: ThreadPlan): ShortlistOption {
  return { threadId: t.id, who: t.counterpart.name, price: t.agreedPrice!, unit: t.unit, group: t.kind === "group", schedule: t.schedule };
}

export async function runAgent(session: Session, narrator: Narrator, emit: (event: AgentEvent) => void, market: Market = localMarket()): Promise<void> {
  const you = session.name;
  const events: AgentEvent[] = [];
  const send = (event: AgentEvent) => {
    events.push(event);
    emit(event);
  };
  session.run = { at: new Date().toISOString(), events, opportunities: [] };

  send({ type: "status", text: `Looking for agents in the ${LISBON_PILOT.name} whose intents fit yours` });
  await pause(800);
  // Offers are heard in random order and compared before choosing, so being first gets nobody anywhere.
  // Matching happens in the market, which alone holds other members' sealed limits. Your agent only gets back the outcome.
  const threads = shuffled(await market.match(session.intents), session.id);
  const circles = planCircles(session.intents, LISBON_PILOT).filter((c) => c.members.length > 0);
  if (threads.length === 0 && circles.length === 0) {
    send({ type: "status", text: "Nobody in the pilot matches your intents yet. Your agent keeps listening as people join." });
    send({ type: "done", stats: { contacted: 0, rooms: 0, ready: 0 } });
    return;
  }

  // Start every narration now so the replies are ready by the time each conversation is shown.
  const narrations = new Map<string, Promise<Line[]>>();
  for (const t of threads) {
    if (t.moves.length === 0) continue;
    const pending = narrator.narrate(t, you);
    pending.catch(() => {});
    narrations.set(t.id, pending);
  }

  for (const thread of threads) {
    const them = thread.counterpart.name;
    send({
      type: "discover",
      threadId: thread.id,
      who: them,
      about: thread.intentSummary,
      why: `${them}'s agent ${thread.direction === "seek" ? "offers" : "is looking for"} ${thread.counterpart.blurb.toLowerCase()}, which fits "${thread.intentSummary.toLowerCase()}".`,
    });
    await pause(900);

    if (thread.moves.length === 0) {
      send({ type: "outcome", threadId: thread.id, result: "no_fit", why: thread.noFitReason ?? "No fit." });
      await pause(700);
      continue;
    }
    if (thread.kind === "group" || thread.room.length > 0) {
      send({
        type: "room",
        threadId: thread.id,
        members: [you, ...thread.room.map((r) => r.name)],
        why: `${them} offers a lower price per person for a group, and ${listWords(thread.room.map((r) => r.name))} want the same. Your agent opens a room for all of you.`,
      });
      await pause(900);
    }

    const lines = await narrations.get(thread.id)!;
    for (const event of dealMessages(thread, lines, you)) {
      send(event);
      await pause(1100);
    }
    send({
      type: "outcome",
      threadId: thread.id,
      result: thread.agreedPrice === null ? "no_fit" : "agreed",
      why: thread.agreedPrice === null ? (thread.noFitReason ?? "No price worked for both sides.") : `Matched at ${formatPrice(thread.agreedPrice, thread.unit)}. Your agent compares it with any other offers before bringing you one; nothing is final until you approve.`,
    });
    await pause(700);
  }

  for (const circle of circles) await runCircle(circle, you, send);

  // Then what matters most to you comes first: proposals and plans in the order you ranked them.
  const order = activeIntents(session).map((i) => i.id);
  const rank = (intentId: string) => (order.includes(intentId) ? order.indexOf(intentId) : order.length);
  const choices = session.intents.map((intent) => choose(intent, threads)).filter((c): c is Choice => c !== null);
  for (const c of choices) {
    const heard = threads.filter((t) => t.intentId === c.intent.id).length;
    if (heard < 2) continue;
    send({ type: "shortlist", intentId: c.intent.id, about: c.intent.summary, heard, options: c.options.map(optionOf), chosen: c.chosen.id, why: c.why });
    await pause(600);
  }
  const opportunities = [
    ...choices.map((c) => opportunityFor(c.chosen, you, 1, c.options.length)),
    ...circles.map((circle) => planOpportunity(circle, you)).filter((o): o is Opportunity => o !== null),
  ].sort((a, b) => rank(a.intentId) - rank(b.intentId));
  for (const opportunity of opportunities) {
    const intent = session.intents.find((i) => i.id === opportunity.intentId);
    if (intent) opportunity.basis = intentBasis(intent);
    opportunity.holdUntil = holdUntil();
    session.run.opportunities.push(opportunity);
    send({ type: "opportunity", opportunity });
    await pause(500);
  }
  send({ type: "done", stats: runStats(session) });
}

// A room around a shared interest: one-to-one when only one member shares it, a group when several do.
async function runCircle(circle: CirclePlan, you: string, send: (event: AgentEvent) => void): Promise<void> {
  const [first, ...rest] = circle.members;
  if (!first) return;
  const threadId = circle.id;
  const subject = lowerFirst(circle.intent.summary);
  send({
    type: "discover",
    threadId,
    who: first.name,
    about: circle.intent.summary,
    mode: "circle",
    why: rest.length
      ? `${circle.members.length} people in the pilot are into ${subject}. Your agent opens a room for all of you.`
      : `${first.name} is the one person in the pilot so far who shares "${subject}". Your agent starts a one-to-one room.`,
  });
  await pause(800);
  if (rest.length) {
    send({ type: "room", threadId, members: [you, ...rest.map((m) => m.name)], why: `Everyone here said they're into ${subject} and is free when you are.` });
    await pause(800);
  }
  if (circle.elsewhere.length) {
    send({ type: "note", threadId, text: `${listWords(circle.elsewhere.map((m) => m.name))} ${circle.elsewhere.length === 1 ? "is" : "are"} into this too, but only at times you didn't pick.` });
    await pause(500);
  }
  for (const line of circleScript(circle, you, LISBON_PILOT)) {
    send({ type: "message", threadId, amount: null, unit: null, ...line });
    await pause(1100);
  }
  const chosen = circle.chosen;
  send(
    chosen
      ? { type: "outcome", threadId, result: "agreed", why: `${chosen.title}, ${chosen.when}. Nothing happens until you say you're in.` }
      : { type: "outcome", threadId, result: "open", why: "No plan yet. The room stays open, and your agent tells you when something fits." },
  );
  await pause(700);
}

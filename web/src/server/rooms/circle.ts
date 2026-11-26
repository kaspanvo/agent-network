import { type Happening, type Intent, type Member, type Population, type ProfileIntent, isInterest, lowerFirst } from "../domain";
import { compatible, listWords, timesOf } from "../negotiation/plan";
import type { AgentEvent, Card, Opportunity } from "../negotiation/types";

// Paid offers worth mentioning in a circle, because they sit close to the interest.
const RELATED: Record<string, string[]> = { "live-music": ["guitar-lessons"], running: [], "board-games": [] };

const MAX_MEMBERS = 4;

export type CirclePlan = {
  id: string;
  intent: ProfileIntent;
  members: Member[];
  // Members who share the interest but never at times that suit you.
  elsewhere: Member[];
  happenings: Happening[];
  chosen: Happening | null;
  joiners: Member[];
};

export type CircleMessage = Omit<Extract<AgentEvent, { type: "message" }>, "type" | "threadId" | "unit" | "amount">;

export function circleId(intentId: string): string {
  return `circle-${intentId}`;
}

export function planCircles(intents: ProfileIntent[], population: Population): CirclePlan[] {
  const plans: CirclePlan[] = [];
  for (const intent of intents) {
    if (intent.status !== "confirmed" || !isInterest(intent)) continue;
    const yours = timesOf(intent.conditions);
    const sharing = population.interests.filter((i) => i.tag === intent.tag);
    const member = (id: string) => population.members.find((m) => m.id === id)!;
    const fits = sharing.filter((i) => compatible(yours, timesOf(i.conditions)));
    const members = fits.slice(0, MAX_MEMBERS).map((i) => member(i.memberId));
    const elsewhere = sharing.filter((i) => !fits.includes(i)).map((i) => member(i.memberId));
    const happenings = population.happenings.filter((h) => h.tag === intent.tag && members.some((m) => m.id === h.postedBy));
    // Something the person picked when their agent checked its guesses comes first, if it fits their times.
    const fitting = happenings.filter((h) => compatible(yours, timesOf(h.conditions)));
    const chosen = fitting.find((h) => pickedByPerson(intent, h.title)) ?? fitting[0] ?? null;
    const joiners = chosen
      ? members.filter((m) => {
          const theirs = sharing.find((i) => i.memberId === m.id)!;
          return m.id === chosen.postedBy || compatible(timesOf(theirs.conditions), timesOf(chosen.conditions));
        })
      : [];
    plans.push({ id: circleId(intent.id), intent, members, elsewhere, happenings, chosen, joiners });
  }
  return plans;
}

// True when the person chose this over something else in the either/or picks.
export function pickedByPerson(intent: ProfileIntent, title: string): boolean {
  return intent.evidence.includes(`Picked "${title}"`);
}

function cardFor(h: Happening, population: Population): Card {
  const poster = population.members.find((m) => m.id === h.postedBy)?.name ?? h.postedBy;
  return { kind: "happening", title: h.title, when: h.when, where: h.where, cost: h.cost, postedBy: poster };
}

// The conversation the agents have in a circle. Everything they say comes from what each member allowed their agent to share.
export function circleScript(plan: CirclePlan, you: string, population: Population): CircleMessage[] {
  const { intent, members, chosen } = plan;
  const subject = lowerFirst(intent.summary);
  const times = timesOf(intent.conditions);
  const free = times.length ? `, and is free ${listWords(times)}` : "";
  const agentOf = (m: Member) => `${m.name}'s agent`;
  const lines: CircleMessage[] = [];

  lines.push({
    from: "you",
    who: `${you}'s agent`,
    action: "ASK",
    text: members.length === 1 ? `Hi. ${you} is into ${subject} too${free}. What is ${members[0]!.name} up to?` : `Hi all. ${you} is into ${subject}${free}. What are your people up to?`,
    why: "Your agent shares your interest and when you're free. Nothing else about you.",
  });

  for (const m of members) {
    const interest = population.interests.find((i) => i.memberId === m.id && i.tag === intent.tag)!;
    const posted = plan.happenings.find((h) => h.postedBy === m.id);
    lines.push({
      from: "them",
      who: agentOf(m),
      action: "SHARE",
      text: interest.shares[0]!,
      why: `${m.name} allowed their agent to share this with people who are into the same thing.`,
      ...(posted ? { card: cardFor(posted, population) } : {}),
    });
  }

  const offer: Intent | undefined = population.intents.find((i) => i.direction === "offer" && (RELATED[intent.tag] ?? []).includes(i.tag) && members.some((m) => m.id === i.memberId));
  if (offer) {
    const m = members.find((x) => x.id === offer.memberId)!;
    lines.push({
      from: "them",
      who: agentOf(m),
      action: "SHARE",
      text: `${m.name} also offers ${lowerFirst(offer.summary)}. If anyone wants that, it would be a separate room with a price.`,
      why: "Close to what you're into. Your agent notes it without committing you to anything.",
      card: { kind: "offer", title: offer.summary, who: m.name },
    });
  }

  if (!chosen) {
    lines.push({
      from: "you",
      who: `${you}'s agent`,
      action: "SAY",
      text: `Nothing here fits when ${you} is free yet. I'll keep this room open and say when something does.`,
      why: times.length ? `Everything shared so far is outside your ${listWords(times)}.` : "Nobody has shared anything happening yet.",
    });
    return lines;
  }

  const poster = population.members.find((m) => m.id === chosen.postedBy)!;
  lines.push({
    from: "you",
    who: `${you}'s agent`,
    action: "PLAN",
    text: `The ${chosen.title.toLowerCase()} on ${chosen.when} fits when ${you} is free. Shall we each suggest it to our people?`,
    why: pickedByPerson(intent, chosen.title)
      ? `You picked it when your agent checked its guesses, it's inside your ${listWords(times) || "times"}, and ${poster.name} already goes.`
      : `${times.length ? `It's on ${chosen.when}, inside your ${listWords(times)}` : `It's the first thing shared here`}, and ${poster.name} already goes.`,
  });
  for (const m of plan.joiners.slice(0, 3)) {
    lines.push({
      from: "them",
      who: agentOf(m),
      action: "JOIN",
      text: m.id === poster.id ? `${m.name} will be there anyway and would be glad of company.` : `I'll suggest it to ${m.name}. It fits when they're free.`,
      why: `${m.name}'s agent can't commit them either. Everyone says yes for themself.`,
    });
  }
  return lines;
}

export function planOpportunity(plan: CirclePlan, you: string, version = 1): Opportunity | null {
  const { chosen, intent } = plan;
  if (!chosen) return null;
  const others = plan.joiners.map((m) => m.name);
  const times = timesOf(intent.conditions);
  return {
    id: `${plan.id}-v${version}`,
    threadId: plan.id,
    intentId: intent.id,
    kind: "plan",
    title: chosen.title,
    price: null,
    unit: null,
    people: [you, ...others],
    terms: [chosen.when, chosen.where, chosen.cost, ...(others.length ? [`With ${listWords(others)}`] : [])],
    reasons: [
      ...(pickedByPerson(intent, chosen.title) ? ["You picked this one when your agent checked its guesses"] : []),
      times.length ? `${chosen.when} is inside your ${listWords(times)}` : "You didn't set times, so any time works",
      `${plan.members.length + 1} people in this room are into ${lowerFirst(intent.summary)}`,
      `Shared by ${plan.members.find((m) => m.id === chosen.postedBy)?.name ?? "a member"}, who goes`,
    ],
    version,
  };
}

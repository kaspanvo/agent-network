import { formatPrice } from "./domain";
import { listWords } from "./negotiation/plan";
import { runStats } from "./negotiation/run";
import type { AgentEvent, CheckIn, Decision, Opportunity } from "./negotiation/types";
import { lapse } from "./holds";
import { everyoneSaidYes, termsOf, yesStillStands } from "./negotiation/terms";
import { pause } from "./pace";
import { isStale } from "./intake/profile";
import type { Session } from "./store";

// Field studies of agent marketplaces found deals that agents agreed but nobody delivered, because nothing tracked the hand-off.
// So a yes doesn't end the conversation: everyone else says yes, Open introduces you, and your agent checks it happened.

function opportunityOf(session: Session, id: string): Opportunity {
  const opportunity = session.run?.opportunities.find((o) => o.id === id);
  if (!opportunity) throw new Error("That proposal no longer exists.");
  return opportunity;
}

function othersIn(session: Session, opportunity: Opportunity): string[] {
  return opportunity.people.filter((p) => p !== session.name);
}

// When your agent will ask how it went.
export function checkInMoment(opportunity: Opportunity): string {
  if (opportunity.kind === "plan") return `after ${opportunity.terms[0] ?? "it happens"}`;
  return opportunity.unit === "one-off" ? "after the hand-over" : "after your first session";
}

// When to ask. Without real calendar data, a week after a deal and two days after a plan.
export function checkInAt(opportunity: Opportunity, from = new Date()): Date {
  const days = opportunity.kind === "plan" ? 2 : 7;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function decide(
  session: Session,
  id: string,
  decision: Decision,
  emit: (event: AgentEvent) => void,
  // The host wakes the agent at this time to ask how it went (a Durable Object alarm on Cloudflare).
  schedule?: (opportunityId: string, at: Date) => void,
): Promise<void> {
  const opportunity = opportunityOf(session, id);
  // A hold that ran out while the page sat open still counts: check the clock before taking the answer.
  const lapsed = lapse(session, id);
  if (lapsed) emit(lapsed);
  if (session.decisions[id] === "lapsed") throw new Error("This one lapsed before you answered, so the others are free again. Send your agent out again for a fresh one.");
  if (session.decisions[id]) throw new Error("You've already answered this one.");
  if (decision === "approved" && isStale(session, opportunity))
    throw new Error("You changed what you asked for after this was agreed, so it no longer stands. Send your agent out again for a fresh proposal.");
  const run = session.run!;
  const { threadId } = opportunity;
  const send = (event: AgentEvent) => {
    run.events.push(event);
    emit(event);
  };
  const you = session.name;
  const plan = opportunity.kind === "plan";
  const others = othersIn(session, opportunity);
  const price = opportunity.price !== null && opportunity.unit ? formatPrice(opportunity.price, opportunity.unit) : null;
  const message = (from: "you" | "them", who: string, action: "SAY" | "JOIN", text: string, why: string): AgentEvent => ({
    type: "message",
    threadId,
    from,
    who,
    action,
    amount: null,
    unit: null,
    text,
    why,
  });

  session.decisions[id] = decision;
  if (decision === "approved") opportunity.approvedTerms = termsOf(opportunity);
  send({ type: "decision", threadId, opportunityId: id, decision });
  await pause(500);

  if (decision === "declined") {
    send(message("you", `${you}'s agent`, "SAY", plan ? `${you} can't make this one. Thanks for asking.` : `${you} is passing on this one. Thanks for your time.`, "Your agent tells the others you said no, without your reasons."));
    send({ type: "done", stats: runStats(session) });
    return;
  }

  send(
    message(
      "you",
      `${you}'s agent`,
      "SAY",
      plan ? `${you} is in: ${opportunity.title}, ${opportunity.terms[0]}.` : `${you} approved version ${opportunity.version}: ${[price, ...opportunity.terms.slice(1)].filter(Boolean).join(", ")}.`,
      "You said yes, so your agent tells the room. It only says yes to these exact terms.",
    ),
  );
  // Everyone answers for themself. In the pilot the other members are simulated and say yes; the introduction
  // still waits on every one of them, so when real members answer on their own time nothing else has to change.
  const approvals: Record<string, "yes" | "waiting"> = Object.fromEntries([[you, "yes"], ...others.map((name) => [name, "waiting"])]);
  opportunity.approvals = approvals;
  await pause(900);
  for (const name of others) {
    approvals[name] = "yes";
    send(message("them", `${name}'s agent`, "JOIN", plan ? `${name} is in too.` : `${name} approved too.`, `${name} said yes for themself. Their agent can't do it for them.`));
    await pause(700);
  }
  if (!everyoneSaidYes(opportunity)) {
    send({ type: "done", stats: runStats(session) });
    return;
  }

  const due = checkInAt(opportunity);
  session.followups[id] = { stage: "introduced", dueAt: due.toISOString() };
  schedule?.(id, due);
  send({
    type: "followup",
    threadId,
    opportunityId: id,
    stage: "introduced",
    text: `${plan ? "Everyone's in" : `Everyone approved version ${opportunity.version}`}. You're introduced to ${listWords(others)} by first name in this room. Contact details are shared only if you both choose to.`,
  });
  await pause(600);
  send({
    type: "followup",
    threadId,
    opportunityId: id,
    stage: "check_in",
    text: `Your agent will ask ${checkInMoment(opportunity)}, around ${due.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, whether it happened. You can answer now if you like.`,
  });
  send({ type: "done", stats: runStats(session) });
}

// The agent wakes at the check-in time. If the person hasn't answered yet, it asks in the room.
// Safe to run twice: alarms can fire more than once.
export function checkInDue(session: Session, id: string): AgentEvent | null {
  const followup = session.followups[id];
  const opportunity = session.run?.opportunities.find((o) => o.id === id);
  if (!followup || followup.stage !== "introduced" || followup.asked || !opportunity || !session.run) return null;
  // Checked again when the alarm fires, not just when it was set: the yes must still stand.
  if (session.decisions[id] !== "approved" || !yesStillStands(opportunity)) return null;
  followup.asked = true;
  const event: AgentEvent = { type: "followup", threadId: opportunity.threadId, opportunityId: id, stage: "check_in", text: `It's ${checkInMoment(opportunity).replace(/^after /, "past ")}. Did it happen?` };
  session.run.events.push(event);
  return event;
}

const CHECK_IN_NOTE: Record<CheckIn, string> = {
  again: "happened and they'd do it again",
  once: "happened, but once was enough",
  missed: "didn't happen",
};

export async function checkIn(session: Session, id: string, answer: CheckIn, emit: (event: AgentEvent) => void): Promise<void> {
  const opportunity = opportunityOf(session, id);
  if (session.decisions[id] !== "approved") throw new Error("Only things you said yes to get a check-in.");
  if (session.followups[id]?.stage === "done") throw new Error("You already told your agent how it went.");
  const run = session.run!;
  const others = listWords(othersIn(session, opportunity));
  const text: Record<CheckIn, string> = {
    again: `It happened and you'd do it again. Your agent noted that for next time.`,
    once: `It happened, and once was enough. Your agent noted that for next time.`,
    missed: `It didn't happen. Your agent let ${others}'s agent${othersIn(session, opportunity).length > 1 ? "s" : ""} know, without your reasons, and keeps the room open.`,
  };
  session.followups[id] = { stage: "done", answer };
  // Your agent learns from it the next time you talk.
  session.pendingNotes.push(`[App note: ${session.name} said "${opportunity.title}" ${CHECK_IN_NOTE[answer]}.]`);
  const event: AgentEvent = { type: "followup", threadId: opportunity.threadId, opportunityId: id, stage: "done", text: text[answer], answer };
  run.events.push(event);
  emit(event);
  emit({ type: "done", stats: runStats(session) });
}

import { isInterest, type ProfileIntent } from "../domain";
import { compatible, listWords, timesOf } from "../negotiation/plan";
import { LISBON_PILOT } from "../population";
import type { Session } from "../store";
import { activeIntents } from "./profile";
import type { Widget } from "./types";

// Before the agent acts, it shows a few either/or picks between real things on the network, having already guessed
// which the person would choose. Project Swap found most lost value came from agents misreading their person, that
// rankings agreed only 61% of the time, and recommended exactly this: show a sample of the agent's choices first.

export type Option = { title: string; detail: string; times: string[]; group: boolean | null; words: string };
export type Pair = { id: string; intentId: string; question: string; a: Option; b: Option; predicted: "a" | "b" };
export type Calibration = { pairs: Pair[]; picks?: Record<string, "a" | "b">; agreed?: number; missed?: string[] };

const MAX_PAIRS = 3;

function optionsFor(intent: ProfileIntent): Option[] {
  if (isInterest(intent))
    return LISBON_PILOT.happenings
      .filter((h) => h.tag === intent.tag)
      .map((h) => ({ title: h.title, detail: `${h.when} · ${h.where} · ${h.cost}`, times: h.conditions, group: null, words: `${h.title} ${h.where}` }));
  // Only what members chose to share: who, what, when and format. Never their prices.
  return LISBON_PILOT.intents
    .filter((c) => c.tag === intent.tag && c.direction !== intent.direction)
    .map((c) => {
      const who = LISBON_PILOT.members.find((m) => m.id === c.memberId)!.name;
      const group = Boolean(c.groupPrice) || /group|course/i.test(c.summary);
      return { title: `${who}: ${c.summary}`, detail: `${group ? "Small group" : "One-to-one"} · ${c.conditions.length ? listWords(c.conditions) : "any time"}`, times: c.conditions, group, words: c.summary };
    });
}

// How well an option fits what the agent understood. The agent's guess is whichever scores higher.
export function fit(intent: ProfileIntent, option: Option): number {
  const yours = timesOf(intent.conditions);
  let score = yours.length && option.times.length ? (compatible(yours, option.times) ? 2 : 0) : 1;
  if (intent.prefers && option.group !== null) score += (intent.prefers === "group") === option.group ? 2 : 0;
  const said = `${intent.summary} ${intent.evidence}`.toLowerCase();
  score += option.words.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && said.includes(w)).length;
  return score;
}

export function calibrationPairs(session: Session): Pair[] {
  const pairs: Pair[] = [];
  for (const intent of activeIntents(session)) {
    const options = optionsFor(intent);
    for (let i = 0; i + 1 < options.length && pairs.length < MAX_PAIRS; i += 2) {
      const [a, b] = [options[i]!, options[i + 1]!];
      pairs.push({
        id: `${intent.id}-${i}`,
        intentId: intent.id,
        question: isInterest(intent) ? `${intent.summary}: which would you go to?` : `${intent.summary}: which would you rather?`,
        a,
        b,
        predicted: fit(intent, b) > fit(intent, a) ? "b" : "a",
      });
    }
  }
  return pairs;
}

// The widget never carries the agent's guesses, so the person can't see them before answering.
export function calibrationWidget(pairs: Pair[]): Widget {
  return { kind: "pairs", pairs: pairs.map(({ id, question, a, b }) => ({ id, question, a: { title: a.title, detail: a.detail }, b: { title: b.title, detail: b.detail } })) };
}

// Scores the person's picks against the agent's guesses, and records what it got wrong.
export function scoreCalibration(session: Session, picks: Record<string, "a" | "b">): Calibration {
  const calibration = session.calibration!;
  const missed = calibration.pairs.filter((p) => picks[p.id] && picks[p.id] !== p.predicted);
  session.calibration = { ...calibration, picks, agreed: calibration.pairs.length - missed.length, missed: missed.map((p) => p.id) };
  // What the person picked is evidence about what they want, kept with the intent for next time.
  for (const pair of missed) {
    const intent = session.intents.find((i) => i.id === pair.intentId);
    const chosen = pair[picks[pair.id]!];
    const other = pair[picks[pair.id] === "a" ? "b" : "a"];
    if (intent) intent.evidence = `${intent.evidence}${intent.evidence ? " " : ""}Picked "${chosen.title}" over "${other.title}".`.trim();
  }
  return session.calibration;
}

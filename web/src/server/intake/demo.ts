import { randomUUID } from "node:crypto";
import { LINK, readShared, type Reader } from "../tools/reader";
import { INTEREST_TAGS, isInterest, lowerFirst, type ProfileIntent } from "../domain";
import { pause } from "../pace";
import type { Session } from "../store";
import { calibrationPairs, calibrationWidget } from "./calibration";
import { activeIntents, isReady, recapWidget, saveIntent, setConditionsForAll, setTopPriority } from "./profile";
import { aboutEvent } from "./tools";
import { OPENING_CHOICES } from "./prompt";
import { activityFor, type ChatItem, type IntakeAgent, type IntakeEvent, type Widget } from "./types";

type Topic = { match: RegExp; tag: string; direction: "seek" | "offer"; summary: string; unit: "hour" | "one-off"; inferred: boolean };

// A fixed script for running the app without a Claude key. It recognises a handful of deals and interests.
// More specific wordings come first: only the first match for each tag is kept, so "a used camera" is a purchase, not a sale.
const BUYING = /\b(buy|find|get|want|need|looking for|used|second-?hand|not new|cheaper|pay less)\b/i;
const DEALS: Topic[] = [
  { match: /\b(teach|tutor)\w*\b[^.!?]*\bspanish\b/i, tag: "spanish-lessons", direction: "offer", summary: "Teach Spanish", unit: "hour", inferred: false },
  { match: /\bwalk(ing)? dogs\b|\b(mind|sit|look after)\w*\b[^.!?]*\b(other people's|people's|others') dogs\b/i, tag: "dog-sitting", direction: "offer", summary: "Look after other people's dogs", unit: "one-off", inferred: false },
  { match: new RegExp(`${BUYING.source}[^.!?]*\\bcamera\\b|\\bcamera\\b[^.!?]*${BUYING.source}`, "i"), tag: "used-camera", direction: "seek", summary: "Buy a used camera", unit: "one-off", inferred: false },
  { match: new RegExp(`${BUYING.source}[^.!?]*\\bbike\\b|\\bbike\\b[^.!?]*${BUYING.source}`, "i"), tag: "road-bike", direction: "seek", summary: "Buy a used road bike", unit: "one-off", inferred: false },
  { match: /spanish/i, tag: "spanish-lessons", direction: "seek", summary: "Learn Spanish", unit: "hour", inferred: false },
  { match: /guitar lesson|learn (the )?guitar/i, tag: "guitar-lessons", direction: "seek", summary: "Learn the guitar", unit: "hour", inferred: false },
  { match: /cook/i, tag: "cooking-lessons", direction: "seek", summary: "Learn to cook Portuguese food", unit: "hour", inferred: false },
  { match: /photo/i, tag: "photography-lessons", direction: "seek", summary: "Get better at photography", unit: "hour", inferred: false },
  { match: /dog/i, tag: "dog-sitting", direction: "seek", summary: "Find a weekend dog-sitter", unit: "one-off", inferred: false },
  { match: /bike/i, tag: "road-bike", direction: "offer", summary: "Sell my road bike", unit: "one-off", inferred: true },
  { match: /camera/i, tag: "used-camera", direction: "offer", summary: "Sell my camera", unit: "one-off", inferred: true },
];

const INTEREST_SUMMARY: Record<string, (text: string) => string> = {
  "live-music": (t) => {
    const styles = ["jazz", "fado", "indie", "rock", "electronic", "classical"].filter((s) => new RegExp(s, "i").test(t));
    return styles.length ? `Live music, mostly ${styles.join(" and ")}` : "Live music";
  },
  running: () => "Running with others",
  "board-games": () => "Board games",
};

export const TIMES_PROMPT = "When you're usually free";
export const FORMAT_PROMPT = "Group or one-to-one";
export const RANK_PROMPT = "What matters most";
export const WHY_PROMPT = "What made you pick it";
const GROUP = "A small group, if it's cheaper";
const SOLO = "One-to-one, even if it costs more";
const SKIP = /^(send my agent out|add something else)$/i;
export const OPENING_PROMPT = "Pick any";
const SPLITS_COST = /\b(group|together|split|share)\b/i;

// What to ask next for each opening pick: a question on its own, the same thing as a clause when several were picked,
// and replies the person might send that the script understands and the network can match.
const FOLLOW_UP: Record<string, { ask: string; clause: string; replies: string[] }> = {
  "Learn something new": { ask: "What would you like to learn?", clause: "what you'd like to learn", replies: ["I'd love to learn Spanish", "Guitar, from scratch"] },
  "Earn on the side": { ask: "What could you teach, or do for other people?", clause: "what you could teach or do for others", replies: ["I could teach Spanish", "I can walk dogs on weekends"] },
  "Sell or rent something": { ask: "What do you have that you'd sell or rent out?", clause: "what you'd sell or rent out", replies: ["My old bike just sits there", "My camera sits in a drawer"] },
  "Pay less for something": {
    ask: "What would you like to pay less for? I can look for someone selling one used, or a small group that splits the cost.",
    clause: "what you'd like to pay less for",
    replies: ["A used camera, not new", "Cheaper Spanish lessons in a group"],
  },
  "Meet people who share an interest": { ask: "What are you into?", clause: "what you're into", replies: ["I'm into jazz and live music", "I'd like people to run with"] },
  "Find things to do (music, sport, games)": { ask: "What do you like doing: music, sport or games?", clause: "what you like doing", replies: ["Jazz and fado nights", "Board games, any night"] },
  "Find help for a project": { ask: "What's the project, and what help would you need?", clause: "what help your project needs", replies: ["Someone to mind my dog on weekends", "Help taking better photos"] },
};

// Questions the person asks their agent. Each gets a short, true answer about what Open does, not an intent.
const ASKS_SOMETHING = /\?\s*$|^(what|how|who|why|can|could|does|do|is|are|will|where|when)\b/i;
const FAQ: { match: RegExp; answer: string }[] = [
  { match: /\b(private|privacy|who (sees|can see)|see my|my data|share|shared)\b/i, answer: "Your limits and notes stay with me. Other agents only hear a short line, like \u201cLooking for: learn Spanish\u201d, and your name is shared only after you approve a proposal." },
  { match: /\b(cost|free|fee|pay for (open|this)|charge)\b/i, answer: "Open is free during the pilot. Any price you agree with someone is between you and them." },
  { match: /\b(who are|what are) you\b|\b(ai|bot|human|real person)\b/i, answer: "I'm your agent on Open. Right now I'm the demo version: a fixed script, no AI model." },
  {
    match: /\b(what (can|do|will) you|how (does|do) (this|it|you|open) work|what is (this|open)|what happens|help me)\b/i,
    answer: "I learn what you'd be open to, then talk privately with other members' agents and bring you only proposals that fit. Nothing is agreed without your yes.",
  },
];

function answerTo(question: string): string {
  return FAQ.find((f) => f.match.test(question))?.answer ?? "I can't answer that one well yet. What I do: find people whose plans fit yours, and bring you proposals to approve.";
}

// Something the person said that helps find the right people but isn't an intent.
const NOTES: { match: RegExp; fact: (m: RegExpMatchArray) => string }[] = [
  { match: /\b(total |complete )?beginner\b|\bfrom scratch\b|\bnever (learned|played|done)\b/i, fact: () => "Starting from scratch" },
  {
    match: /\b(?:trip|travel(?:l?ing)?|moving)\b[^.!?]*\b(?:in|by|before) (january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    fact: (m) => `Trip coming up in ${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()}`,
  },
  { match: /\b(budget is tight|on a budget|money is tight|as cheap as possible)\b/i, fact: () => "Keeping costs down" },
];

function notesFrom(session: Session, text: string): string[] {
  const about = (session.about ??= []);
  const added: string[] = [];
  for (const { match, fact } of NOTES) {
    const m = text.match(match);
    if (!m) continue;
    const f = fact(m);
    if (about.some((n) => n.fact === f)) continue;
    about.push({ id: randomUUID().slice(0, 8), fact: f, evidence: sentenceWith(text, match), at: new Date().toISOString() });
    added.push(f);
  }
  return added;
}

function listed(parts: string[], last: "and" | "or"): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} ${last} ${parts.at(-1)}`;
}

// The reply to the opening picks follows what was picked, instead of one line for everyone.
function followUp(picked: string[]): { text: string; replies: string[] } {
  const known = picked.filter((p) => p in FOLLOW_UP).map((p) => FOLLOW_UP[p]!);
  if (known.length === 0) return { text: "In your own words, what do you have in mind?", replies: ["I'm into jazz and live music", "I'd love to learn Spanish"] };
  const replies = [...new Set(known.flatMap((f) => f.replies))];
  const pickedReplies = known.length === 1 ? replies.slice(0, 2) : known.slice(0, 3).map((f) => f.replies[0]!);
  if (known.length === 1) return { text: known[0]!.ask, replies: pickedReplies };
  const clauses = known.map((f) => f.clause);
  const text = known.length <= 3 ? `Tell me in your own words ${listed(clauses, "and")}.` : `Start with whichever matters most: ${listed(clauses, "or")}.`;
  return { text, replies: pickedReplies };
}

function sentenceWith(text: string, match: RegExp): string {
  return text.split(/(?<=[.!?])\s+/).find((s) => match.test(s))?.trim() ?? text.trim();
}

function firstUnpriced(session: Session, direction: "seek" | "offer"): ProfileIntent | undefined {
  return session.intents.find((i) => !isInterest(i) && i.direction === direction && i.price === null && i.status !== "rejected");
}

function priceWidget(intent: ProfileIntent): Widget {
  if (intent.direction === "seek")
    return { kind: "number", label: `Most you'd pay${intent.unit === "hour" ? " per hour" : ""}`, min: 5, max: intent.unit === "hour" ? 40 : 800, step: intent.unit === "hour" ? 1 : 10, value: intent.unit === "hour" ? 15 : 300, unit: intent.unit === "hour" ? "€/hour" : "€", intentId: intent.id };
  return { kind: "number", label: "Least you'd accept", min: 20, max: 1000, step: 10, value: 220, unit: "€ one-off", intentId: intent.id };
}

// The first lesson or service you'd pay for by the hour where group versus one-to-one hasn't come up yet.
function needsFormat(session: Session): ProfileIntent | undefined {
  return session.intents.find((i) => !isInterest(i) && i.direction === "seek" && i.unit === "hour" && i.price !== null && i.status === "confirmed" && !i.prefers);
}


export function demoIntakeAgent(reader?: Reader): IntakeAgent {
  return {
    async respond(session: Session, userText: string, emit: (event: IntakeEvent) => void, signal: AbortSignal) {
      const itemId = randomUUID();
      const item: ChatItem = { id: itemId, role: "agent", text: "" };
      const previous = session.chat.filter((c) => c.role === "agent").at(-1);
      const turn = session.chat.filter((c) => c.role === "agent").length;
      session.chat.push(item);
      emit({ type: "agent_start", itemId });

      const say = async (text: string) => {
        for (const word of text.split(/(?<= )/)) {
          if (signal.aborted) {
            item.stopped = true;
            return;
          }
          item.text += word;
          emit({ type: "text", itemId, delta: word });
          await pause(25);
        }
      };
      const show = (widget: Widget) => {
        if (signal.aborted) return;
        item.widget = widget;
        emit({ type: "widget", itemId, widget });
      };
      const suggest = (options: string[]) => {
        if (signal.aborted) return;
        item.suggestions = options;
        emit({ type: "suggestions", itemId, options });
      };
      const note = (text: string) => {
        item.activity = [...(item.activity ?? []), text];
        emit({ type: "activity", itemId, text });
      };

      await pause(400);
      const link = reader && turn > 0 ? LINK.exec(userText)?.[0] : undefined;
      if (link && reader) {
        try {
          const facts = await readShared(session, reader, link);
          emit({ type: "read", url: facts.url, title: facts.title });
          note(`Read · ${new URL(facts.url).hostname}`);
          await say(`I read that page: "${facts.title}".${facts.price ? ` It says ${facts.price}.` : ""} ${facts.summary} I only read it, logged out; I didn't click or sign up for anything. Tell me what you'd like me to look for around it.`);
        } catch (err) {
          await say(`I couldn't read that page. ${err instanceof Error ? err.message : ""} Tell me about it in your own words instead.`);
        }
        return;
      }
      if (turn === 0) {
        await say(`Hi ${session.name}. I'm your agent. Tell me what you'd be open to, and I'll look for the people who fit while you get on with your day. What sounds like you?`);
        show({ kind: "choices", prompt: OPENING_PROMPT, options: OPENING_CHOICES, multiple: true });
        return;
      }
      const picks = /^I picked:\s*/i.test(userText) && previous?.widget?.kind === "choices" && previous.widget.prompt === OPENING_PROMPT;
      if (picks) {
        const { text, replies } = followUp(userText.replace(/^I picked:\s*/i, "").split(", "));
        await say(text);
        suggest(replies);
        return;
      }

      // A question for the agent gets an answer, then the agent goes back to what it asked. A request that names
      // something it knows ("can you find me a Spanish teacher?") is still taken as an intent below.
      const named = DEALS.some((t) => t.match.test(userText)) || Object.values(INTEREST_TAGS).some((m) => m.test(userText));
      if (turn > 0 && ASKS_SOMETHING.test(userText.trim()) && !named && !/^I picked:/i.test(userText)) {
        const back = previous?.text.split(/(?<=[.!?])\s+/).filter((s) => s.endsWith("?")).at(-1);
        await say(`${answerTo(userText)}${back ? ` So, back to you: ${back}` : " What would you like me to look for?"}`);
        if (previous?.widget && (previous.widget.kind === "choices" || previous.widget.kind === "number")) show(previous.widget);
        else suggest(previous?.suggestions?.length ? previous.suggestions : ["I'd love to learn Spanish", "My old bike just sits there"]);
        return;
      }

      // What the person just answered decides what happens next. Typing instead of picking at the start counts as their own words.
      const answered = previous?.widget?.kind === "choices" && previous.widget.prompt === OPENING_PROMPT ? undefined : previous?.widget;
      const asked = (prompt: string) => session.chat.some((c) => c.widget?.kind === "choices" && c.widget.prompt === prompt);
      let opening = "";
      if (answered?.kind === "choices" && answered.prompt === TIMES_PROMPT) {
        for (const intent of setConditionsForAll(session, userText.match(/mornings|evenings|weekends/gi) ?? [])) emit({ type: "intent", intent });
        opening = "Noted.";
      } else if (answered?.kind === "choices" && answered.prompt === FORMAT_PROMPT) {
        const lesson = needsFormat(session);
        if (lesson) {
          const prefers = userText.includes(SOLO) ? "solo" : userText.includes(GROUP) ? "group" : undefined;
          if (prefers) emit({ type: "intent", intent: saveIntent(session, { ...lesson, prefers }) });
        }
        opening = "Good to know.";
      } else if (answered?.kind === "choices" && answered.prompt === RANK_PROMPT) {
        const top = session.intents.find((i) => userText.includes(i.summary));
        if (top) {
          setTopPriority(session, top.id);
          note(`Most important · ${top.summary}`);
        }
        opening = top ? `${top.summary} first, then.` : "";
      } else if (answered?.kind === "pairs" && session.calibration?.agreed !== undefined) {
        const { agreed, pairs, missed = [], picks = {} } = session.calibration;
        const first = pairs.find((p) => missed.includes(p.id));
        if (first) {
          const chosen = first[picks[first.id]!];
          await say(`I guessed ${agreed} of ${pairs.length}. You'd pick “${chosen.title}”, which I didn't expect. What made you choose it?`);
          show({ kind: "choices", prompt: WHY_PROMPT, options: ["The time suits me", "It sounds more like me", "The place", "Just a hunch"], multiple: false });
          return;
        }
        opening = `I called all ${pairs.length} of your picks, so I'll go out with that picture of you.`;
      } else if (answered?.kind === "choices" && answered.prompt === WHY_PROMPT) {
        const { pairs = [], missed = [], picks = {} } = session.calibration ?? {};
        const pair = pairs.find((p) => missed.includes(p.id));
        const intent = pair && session.intents.find((i) => i.id === pair.intentId);
        const reason = userText.replace(/^I picked:\s*/i, "").trim();
        if (intent && reason) {
          intent.evidence = `${intent.evidence} Reason: ${reason.toLowerCase()}.`;
          const side = picks[pair.id];
          (session.about ??= []).push({ id: randomUUID().slice(0, 8), fact: `Chooses on: ${lowerFirst(reason)}`, evidence: side ? `Picked “${pair[side].title}”` : "", at: new Date().toISOString() });
          emit(aboutEvent(session));
        }
        if (intent) note(`Learned · ${reason}`);
        opening = "Thanks, that helps me weigh things the way you would.";
      } else if (/\bchange something\b/i.test(userText) && !answered) {
        await say("What should I change? Tell me in your own words, or add something new, and I'll show you the recap again.");
        suggest(["Add something else"]);
        return;
      } else if (answered?.kind === "recap" && session.recapConfirmed) {
        opening = "";
      } else if (answered?.kind === "recap" && userText.includes("wants to change something")) {
        await say("What should I change? Tell me in your own words, or add something new, and I'll show you the recap again.");
        suggest(["Add something else"]);
        return;
      } else if (/^add something else$/i.test(userText.trim())) {
        await say("Sure. What else?");
        const have = new Set(session.intents.filter((i) => i.status !== "rejected").map((i) => i.tag));
        const ideas: [string, string][] = [["running", "I'm into running"], ["board-games", "Board games, any night"], ["used-camera", "My camera sits in a drawer"], ["spanish-lessons", "I'd love to learn Spanish"], ["live-music", "I'm into jazz and live music"], ["dog-sitting", "Someone to mind my dog on weekends"]];
        suggest(ideas.filter(([tag]) => !have.has(tag)).slice(0, 3).map(([, text]) => text));
        return;
      } else if ((!answered || answered.kind === "recap") && !SKIP.test(userText.trim())) {
        for (const fact of notesFrom(session, userText)) note(`Noted · ${fact}`);
        if (session.about?.length) emit(aboutEvent(session));
        const deals = DEALS.filter((t) => t.match.test(userText)).filter((t, n, all) => all.findIndex((x) => x.tag === t.tag) === n);
        const saved: ProfileIntent[] = [];
        for (const [tag, match] of Object.entries(INTEREST_TAGS)) {
          if (!match.test(userText)) continue;
          saved.push(saveIntent(session, { kind: "interest", direction: "seek", summary: INTEREST_SUMMARY[tag]!(userText), tag, provenance: "stated", evidence: sentenceWith(userText, match), unit: "one-off", price: null }));
        }
        for (const topic of deals) {
          saved.push(
            saveIntent(session, {
              kind: "deal",
              direction: topic.direction,
              summary: topic.summary,
              tag: topic.tag,
              provenance: topic.inferred ? "inferred" : "stated",
              evidence: sentenceWith(userText, topic.match),
              unit: topic.unit,
              price: null,
              // "Cheaper lessons in a group" already answers group or one-to-one.
              ...(topic.direction === "seek" && topic.unit === "hour" && SPLITS_COST.test(sentenceWith(userText, topic.match)) ? { prefers: "group" as const } : {}),
            }),
          );
        }
        if (saved.length === 0)
          saved.push(saveIntent(session, { kind: "deal", direction: "seek", summary: userText.trim().slice(0, 80), tag: "other", provenance: "stated", evidence: userText.trim(), unit: "one-off", price: null }));
        for (const intent of saved) {
          emit({ type: "intent", intent });
          note(activityFor(intent, true));
          await pause(250);
        }
        const interests = saved.filter(isInterest);
        const inferred = saved.some((i) => i.status === "pending");
        opening = [
          interests.length ? `${interests.map((i, n) => (n ? lowerFirst(i.summary) : i.summary)).join(" and ")}, nice. I'll find people in the pilot who are into ${interests.length > 1 ? "them" : "it"} too.` : "Got it.",
          inferred ? "I also picked up something you might sell; confirm it if I got it right." : "",
        ]
          .filter(Boolean)
          .join(" ");
      }

      const seek = firstUnpriced(session, "seek");
      if (seek) {
        await say(`${opening} What's the most you'd pay for "${lowerFirst(seek.summary)}"?`.trim());
        show(priceWidget(seek));
        return;
      }
      const lesson = needsFormat(session);
      if (lesson && !asked(FORMAT_PROMPT)) {
        await say(`${opening} For "${lowerFirst(lesson.summary)}": would you rather a small group if it's cheaper, or one-to-one even if it costs more?`.trim());
        show({ kind: "choices", prompt: FORMAT_PROMPT, options: [GROUP, SOLO], multiple: false });
        return;
      }
      if (!asked(TIMES_PROMPT) && session.intents.some((i) => i.status !== "rejected")) {
        await say(`${opening} When are you usually free?`.trim());
        show({ kind: "choices", prompt: TIMES_PROMPT, options: ["Mornings", "Evenings", "Weekends"], multiple: true });
        return;
      }
      const offer = firstUnpriced(session, "offer");
      if (offer) {
        await say(`${opening} One more: what's the least you'd accept for "${lowerFirst(offer.summary)}"?`.trim());
        show(priceWidget(offer));
        return;
      }
      // An either/or ranking says more about what someone wants than asking them to rate each thing.
      const active = activeIntents(session);
      if (active.length >= 2 && !asked(RANK_PROMPT)) {
        await say(`${opening} If only one of these could happen this month, which would you pick?`.trim());
        show({ kind: "choices", prompt: RANK_PROMPT, options: active.slice(0, 4).map((i) => i.summary), multiple: false });
        return;
      }
      if (isReady(session) && !session.recapConfirmed) {
        await say(`${opening} Here's what I'll look for, and exactly what other agents will hear. Did I get it right?`.trim());
        show(recapWidget(session));
        return;
      }
      // Then a few either/or picks between real things on the network, with the agent's guesses already made.
      if (isReady(session) && !session.calibration) {
        const pairs = calibrationPairs(session);
        if (pairs.length) {
          session.calibration = { pairs };
          await say(`${opening} One last check before I go out. I've already guessed which of each pair you'd pick. Let's see if I've read you right.`.trim());
          show(calibrationWidget(pairs));
          return;
        }
      }

      if (isReady(session) && !session.ready) {
        session.ready = true;
        emit({ type: "ready" });
        note("Ready to go out");
        await say(`${opening ? `${opening} ` : ""}Here's my plan. Send me out whenever you're ready.`);
        suggest(["Send my agent out", "Add something else"]);
        return;
      }
      await say(`${opening} Anything else you'd be open to? You can also send me out now.`.trim());
      suggest(["Send my agent out", "Add something else"]);
    },
  };
}

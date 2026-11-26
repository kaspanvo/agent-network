import { randomUUID } from "node:crypto";
import { LINK, readShared, type Reader } from "../tools/reader";
import { INTEREST_TAGS, isInterest, lowerFirst, type ProfileIntent } from "../domain";
import { pause } from "../pace";
import type { Session } from "../store";
import { calibrationPairs, calibrationWidget } from "./calibration";
import { activeIntents, isReady, recapWidget, saveIntent, setConditionsForAll, setTopPriority } from "./profile";
import { OPENING_CHOICES } from "./prompt";
import { activityFor, type ChatItem, type IntakeAgent, type IntakeEvent, type Widget } from "./types";

type Topic = { match: RegExp; tag: string; direction: "seek" | "offer"; summary: string; unit: "hour" | "one-off"; inferred: boolean };

// A fixed script for running the app without a Claude key. It recognises a handful of deals and interests.
const DEALS: Topic[] = [
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
        show({ kind: "choices", prompt: "Pick any", options: OPENING_CHOICES, multiple: true });
        return;
      }
      if (turn === 1) {
        await say("Good picks. In your own words, what do you have in mind? Something to learn, to sell, to find, or just something you enjoy doing with other people.");
        suggest(["I'm into jazz and live music", "I'd love to learn Spanish", "My old bike just sits there"]);
        return;
      }

      // What the person just answered decides what happens next.
      const answered = previous?.widget;
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
        const { pairs = [], missed = [] } = session.calibration ?? {};
        const pair = pairs.find((p) => missed.includes(p.id));
        const intent = pair && session.intents.find((i) => i.id === pair.intentId);
        const reason = userText.replace(/^I picked:\s*/i, "").trim();
        if (intent && reason) intent.evidence = `${intent.evidence} Reason: ${reason.toLowerCase()}.`;
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
        suggest(["I'm into running", "Board games, any night", "My camera sits in a drawer"]);
        return;
      } else if ((!answered || answered.kind === "recap") && !SKIP.test(userText.trim())) {
        const deals = DEALS.filter((t) => t.match.test(userText));
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

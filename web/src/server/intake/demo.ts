import { randomUUID } from "node:crypto";
import { formatPrice, type ProfileIntent } from "../domain";
import { pause } from "../pace";
import type { Session } from "../store";
import { isReady, saveIntent, setConditionsForAll } from "./profile";
import { OPENING_CHOICES } from "./prompt";
import type { IntakeAgent, IntakeEvent, Widget } from "./types";

type Topic = { match: RegExp; tag: string; direction: "seek" | "offer"; summary: string; unit: "hour" | "one-off"; inferred: boolean };

// A fixed script for running the app without a Claude key. It recognises a handful of topics.
const TOPICS: Topic[] = [
  { match: /spanish/i, tag: "spanish-lessons", direction: "seek", summary: "Learn Spanish", unit: "hour", inferred: false },
  { match: /guitar/i, tag: "guitar-lessons", direction: "seek", summary: "Learn the guitar", unit: "hour", inferred: false },
  { match: /cook/i, tag: "cooking-lessons", direction: "seek", summary: "Learn to cook Portuguese food", unit: "hour", inferred: false },
  { match: /photo/i, tag: "photography-lessons", direction: "seek", summary: "Get better at photography", unit: "hour", inferred: false },
  { match: /dog/i, tag: "dog-sitting", direction: "seek", summary: "Find a weekend dog-sitter", unit: "one-off", inferred: false },
  { match: /bike/i, tag: "road-bike", direction: "offer", summary: "Sell my road bike", unit: "one-off", inferred: true },
  { match: /camera/i, tag: "used-camera", direction: "offer", summary: "Sell my camera", unit: "one-off", inferred: true },
];

function sentenceWith(text: string, match: RegExp): string {
  return text.split(/(?<=[.!?])\s+/).find((s) => match.test(s))?.trim() ?? text.trim();
}

function firstUnpriced(session: Session, direction: "seek" | "offer"): ProfileIntent | undefined {
  return session.intents.find((i) => i.direction === direction && i.price === null && i.status !== "rejected");
}

function priceWidget(intent: ProfileIntent): Widget {
  if (intent.direction === "seek")
    return { kind: "number", label: `Most you'd pay${intent.unit === "hour" ? " per hour" : ""}`, min: 5, max: intent.unit === "hour" ? 40 : 800, step: intent.unit === "hour" ? 1 : 10, value: intent.unit === "hour" ? 15 : 300, unit: intent.unit === "hour" ? "€/hour" : "€", intentId: intent.id };
  return { kind: "number", label: "Least you'd accept", min: 20, max: 1000, step: 10, value: 220, unit: "€ one-off", intentId: intent.id };
}

export function demoIntakeAgent(): IntakeAgent {
  return {
    async respond(session: Session, userText: string, emit: (event: IntakeEvent) => void) {
      const itemId = randomUUID();
      const item: { id: string; role: "agent"; text: string; widget?: Widget } = { id: itemId, role: "agent", text: "" };
      const turn = session.chat.filter((c) => c.role === "agent").length;
      session.chat.push(item);
      emit({ type: "agent_start", itemId });

      const say = async (text: string) => {
        for (const word of text.split(/(?<= )/)) {
          item.text += word;
          emit({ type: "text", itemId, delta: word });
          await pause(25);
        }
      };
      const show = (widget: Widget) => {
        item.widget = widget;
        emit({ type: "widget", itemId, widget });
      };

      await pause(400);
      if (turn === 0) {
        await say(`Hi ${session.name}. I'm your agent. Tell me what you'd be open to, and I'll look for the people who fit while you get on with your day. What sounds like you?`);
        show({ kind: "choices", prompt: "Pick any", options: OPENING_CHOICES, multiple: true });
        return;
      }
      if (turn === 1) {
        await say("Good picks. In your own words, what do you have in mind? Something to learn, to sell, to find, even if you're not looking hard.");
        return;
      }

      if (turn === 2) {
        const found = TOPICS.filter((t) => t.match.test(userText));
        if (found.length === 0) found.push({ match: /./, tag: "other", direction: "seek", summary: userText.trim().slice(0, 80), unit: "one-off", inferred: false });
        for (const topic of found) {
          const intent = saveIntent(session, {
            direction: topic.direction,
            summary: topic.summary,
            tag: topic.tag,
            provenance: topic.inferred ? "inferred" : "stated",
            evidence: sentenceWith(userText, topic.match),
            unit: topic.unit,
            price: null,
          });
          emit({ type: "intent", intent });
          await pause(250);
        }
        const inferred = found.some((t) => t.inferred);
        const first = firstUnpriced(session, "seek") ?? firstUnpriced(session, "offer")!;
        await say(
          `Got it, I've noted that on the right.${inferred ? " I also picked up something you might sell; confirm it there if I got it right." : ""} ` +
            (first.direction === "seek" ? `What's the most you'd pay for "${first.summary.toLowerCase()}"?` : `What's the least you'd accept for "${first.summary.toLowerCase()}"?`),
        );
        show(priceWidget(first));
        return;
      }

      if (turn === 3) {
        await say("Thanks. When suits you best?");
        show({ kind: "choices", prompt: "Pick any", options: ["Mornings", "Evenings", "Weekends"], multiple: true });
        return;
      }

      if (turn === 4) {
        for (const intent of setConditionsForAll(session, userText.match(/mornings|evenings|weekends/gi) ?? [])) emit({ type: "intent", intent });
        const offer = firstUnpriced(session, "offer");
        if (offer) {
          await say(`Noted. One more: what's the least you'd accept for "${offer.summary.toLowerCase()}"?`);
          show(priceWidget(offer));
          return;
        }
      }

      if (isReady(session) && !session.ready) {
        session.ready = true;
        emit({ type: "ready" });
        const priced = session.intents.filter((i) => i.price !== null && i.status !== "rejected");
        await say(
          `That's all I need. I'll negotiate for ${priced.map((i) => `${i.summary.toLowerCase()} (${i.direction === "seek" ? "up to" : "from"} ${formatPrice(i.price!, i.unit)})`).join(" and ")}. Press "Send my agent out" whenever you're ready.`,
        );
        return;
      }
      await say("Noted. Anything else you'd be open to? You can also send your agent out now.");
    },
  };
}

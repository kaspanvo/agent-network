import { describe, expect, it } from "vitest";
import { profileOf } from "../domain";
import { handleApi, type Host } from "../api";
import { makeActor } from "../actor";
import { openModelResponder } from "../rooms/reply";
import { createSession, publicSession, type Session } from "../store";
import { demoIntakeAgent } from "./demo";
import { openModelIntakeAgent, salvage, type ChatModel, type ChatRequest, type ChatResponse } from "./openmodel";
import type { IntakeEvent } from "./types";

let n = 0;
const call = (name: string, input: unknown) => ({ id: `call-${++n}`, type: "function" as const, function: { name, arguments: JSON.stringify(input) } });
const says = (...tool_calls: ReturnType<typeof call>[]): ChatResponse => ({ choices: [{ message: { content: null, tool_calls } }] });
const text = (content: string): ChatResponse => ({ choices: [{ message: { content } }] });

// A model that answers from a script, and remembers what it was sent.
function scripted(...responses: ChatResponse[]): ChatModel & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const model = (async (request: ChatRequest) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("The script ran out");
    return next;
  }) as ChatModel & { requests: ChatRequest[] };
  model.requests = requests;
  return model;
}

async function turn(model: ChatModel, said: string, session: Session = createSession("Ana")) {
  const events: IntakeEvent[] = [];
  await openModelIntakeAgent(model, demoIntakeAgent()).respond(session, said, (e) => events.push(e), new AbortController().signal);
  const words = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  const chips = events.find((e): e is Extract<IntakeEvent, { type: "suggestions" }> => e.type === "suggestions")?.options ?? [];
  return { session, events, words, chips };
}

describe("the agent on an open model", () => {
  it("saves what the person wants, notes what helps, and ends with a question and answers to it", async () => {
    const model = scripted(
      says(
        call("save_intent", { kind: "deal", direction: "seek", summary: "Learn Spanish before a trip in March", tag: "spanish-lessons", provenance: "stated", evidence: "I'd love to learn Spanish before a trip in March" }),
        call("note_about_person", { fact: "Trip to Spain in March", evidence: "before a trip in March" }),
      ),
      says(call("reply", { text: "A March deadline helps. How much Spanish do you know already?", answers: ["Total beginner", "A few basics", "What do you mean?"] })),
    );
    const { session, words, chips } = await turn(model, "I'd love to learn Spanish before a trip in March.");
    expect(session.intents.map((i) => i.tag)).toEqual(["spanish-lessons"]);
    expect(session.about?.map((a) => a.fact)).toEqual(["Trip to Spain in March"]);
    expect(words).toBe("A March deadline helps. How much Spanish do you know already?");
    // A chip that asks the agent something back isn't an answer the person could tap.
    expect(chips).toEqual(["Total beginner", "A few basics"]);
    // Tools go out in the OpenAI format, with suggest_replies replaced by reply.
    const names = model.requests[0]!.tools.map((t) => t.function.name);
    expect(names).toContain("reply");
    expect(names).not.toContain("suggest_replies");
    expect(model.requests[0]!.tool_choice).toBe("required");
    // The second call carries the tool results back, matched to their calls.
    expect(model.requests[1]!.messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("shows a widget with the words that came with it", async () => {
    const model = scripted(says(call("show_choices", { text: "When are you usually free?", prompt: "When you're free", options: ["Mornings", "Evenings", "Weekends"], multiple: true })));
    const { events, words } = await turn(model, "Evenings mostly, I think");
    expect(words).toBe("When are you usually free?");
    expect(events.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "choices", options: ["Mornings", "Evenings", "Weekends"] } });
  });

  it("keeps the words and picks out the answers when the model replies in plain text", async () => {
    expect(salvage('What level are you?\n- Total beginner\n- Some basics')).toEqual({ text: "What level are you?", answers: ["Total beginner", "Some basics"] });
    expect(salvage('{"text": "What level are you?", "answers": ["Beginner"]}')).toEqual({ text: "What level are you?", answers: ["Beginner"] });
    const { words, chips } = await turn(scripted(text("<think>hm</think>What level are you?\n1. Total beginner\n2. Some basics")), "Spanish");
    expect(words).toBe("What level are you?");
    expect(chips).toEqual(["Total beginner", "Some basics"]);
  });

  it("hands the turn to the script when the model is unavailable, and keeps the conversation in its history", async () => {
    const failing: ChatModel = async () => {
      throw new Error("3036: You have used up your daily free allocation of 10,000 neurons");
    };
    const session = createSession("Ana");
    const { events } = await turn(failing, "[App note: start]", session);
    expect(events.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "choices", multiple: true } });
    expect(session.openHistory?.map((m) => m.role)).toEqual(["user", "assistant"]);
    // The person is told the script answered, on that message.
    expect(events.some((e) => e.type === "activity" && e.text.startsWith("Answered by the simple script"))).toBe(true);
  });

  it("says when today's AI budget is why the script answered", async () => {
    const { BudgetExceeded } = await import("../limits");
    const overBudget: ChatModel = async () => {
      throw new BudgetExceeded("AI");
    };
    const { events } = await turn(overBudget, "[App note: start]");
    expect(events.some((e) => e.type === "activity" && e.text.includes("back at 00:00 UTC"))).toBe(true);
  });
});

describe("the profile builds as the person talks", () => {
  it("sorts what they said into sections, with limits worded for them and what still needs an answer", () => {
    const session = createSession("Ana");
    session.goals = ["Learn something new", "Sell or rent something"];
    session.intents = [
      { id: "a", kind: "deal", direction: "seek", tag: "spanish-lessons", summary: "Learn Spanish", price: 15, unit: "hour", conditions: ["evenings"], provenance: "stated", evidence: "", status: "confirmed", priority: 1, prefers: "group" },
      { id: "b", kind: "deal", direction: "offer", tag: "road-bike", summary: "Sell my road bike", price: null, unit: "one-off", conditions: [], provenance: "inferred", evidence: "My bike just sits there", status: "pending" },
      { id: "c", kind: "interest", direction: "seek", tag: "live-music", summary: "Live music, mostly jazz", price: null, unit: "one-off", conditions: ["weekends"], provenance: "stated", evidence: "", status: "confirmed" },
      { id: "d", kind: "deal", direction: "seek", tag: "dog-sitting", summary: "Find a dog-sitter", price: null, unit: "one-off", conditions: [], provenance: "stated", evidence: "", status: "rejected" },
    ];
    const profile = profileOf(session);
    expect(profile.cameFor).toEqual(["Learn something new", "Sell or rent something"]);
    expect(profile.lookingFor.map((e) => [e.summary, e.limit, e.top])).toEqual([["Learn Spanish", "up to €15/h", true]]);
    expect(profile.offering.map((e) => [e.summary, e.status, e.missing])).toEqual([["Sell my road bike", "pending", "price"]]);
    expect(profile.into.map((e) => e.summary)).toEqual(["Live music, mostly jazz"]);
    expect(profile).toMatchObject({ free: ["evenings", "weekends"], format: "group", top: "Learn Spanish", toConfirm: 1 });
    expect(publicSession(session).profile.lookingFor).toHaveLength(1);
  });

  it("records the opening picks as what the person came for", async () => {
    const session = createSession("Ana");
    const host: Host = { actor: makeActor(session, () => {}), start: () => makeActor(session, () => {}) };
    const post = (body: unknown) => handleApi(new Request("http://localhost:3000/api/intake", { method: "POST", body: JSON.stringify(body) }), host).then((r) => r.text());
    await post({ kind: "start" });
    const widget = session.chat.find((c) => c.widget?.kind === "choices")!;
    const streamed = await post({ kind: "choices", itemId: widget.id, picked: ["Pay less for something"] });
    expect(session.goals).toEqual(["Pay less for something"]);
    expect(streamed).toContain('"type":"about"');
  });
});

describe("room replies on an open model", () => {
  const room = { you: "Ana", topic: "Spanish lessons", mode: "deal" as const, members: [{ name: "Bea", facts: ["Bea teaches Spanish on weekday evenings."], happenings: [] }], recent: [] };

  it("uses the model's replies when they check out", async () => {
    const model = scripted(says(call("send_replies", { replies: [{ speaker: "Bea", move: "ANSWER", text: "Bea teaches on weekday evenings.", why: "From what Bea shared.", attach_happening: null }] })));
    expect(await openModelResponder(model).reply(room, "When does Bea teach?")).toEqual([{ name: "Bea", move: "ANSWER", text: "Bea teaches on weekday evenings.", why: "From what Bea shared." }]);
  });

  it("falls back to the keyword replies when the model speaks for someone who isn't there, or fails", async () => {
    const stranger = scripted(says(call("send_replies", { replies: [{ speaker: "Zoe", move: "ANSWER", text: "Hi", why: "x", attach_happening: null }] })));
    expect((await openModelResponder(stranger).reply(room, "When does Bea teach?"))[0]?.name).toBe("Bea");
    expect((await openModelResponder(scripted()).reply(room, "When does Bea teach?"))[0]?.name).toBe("Bea");
  });
});

describe("calls made together in one step", () => {
  it("links a price slider to the intent saved in the same step", async () => {
    const model = scripted(
      says(
        call("save_intent", { kind: "deal", direction: "seek", summary: "Buy a used camera", tag: "used-camera", provenance: "stated", evidence: "A used camera" }),
        call("ask_number", { text: "What's the most you'd pay?", label: "Most you'd pay", min: 50, max: 800, step: 10, value: 300, unit: "€ one-off", intent_id: null }),
      ),
    );
    const { session, events } = await turn(model, "A used camera, not new");
    expect(model.requests).toHaveLength(1);
    expect(events.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "number", intentId: session.intents[0]!.id } });
  });
});

describe("a question while a widget waits", () => {
  it("answers it and brings the widget back instead of turning it into chips", async () => {
    const session = createSession("Ana");
    await turn(scripted(says(call("ask_number", { text: "Most you'd pay?", label: "Most you'd pay", min: 50, max: 800, step: 10, value: 300, unit: "€ one-off", intent_id: null }))), "A used camera", session);
    const { events, chips } = await turn(scripted(says(call("reply", { text: "I find people whose plans fit yours. Back to the camera: most you'd pay?", answers: ["Around 200 euros"] }))), "what can you do?", session);
    expect(events.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "number", label: "Most you'd pay" } });
    expect(chips).toEqual([]);
  });
});

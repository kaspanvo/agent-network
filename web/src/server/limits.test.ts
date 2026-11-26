import { afterEach, describe, expect, it, vi } from "vitest";
import { makeActor } from "./actor";
import { handleApi, type Host } from "./api";
import { demoIntakeAgent } from "./intake/demo";
import { openModelIntakeAgent, type ChatModel } from "./intake/openmodel";
import type { IntakeEvent } from "./intake/types";
import { BudgetExceeded, budgetedChat, budgetedFetch, CallTimedOut, DAILY, limitBehind, memoryCounter, PER_PERSON, spend, withTimeout, type Counter } from "./limits";
import { createSession, type Session } from "./store";
import { passesTurnstile } from "./turnstile";

afterEach(() => vi.useRealTimers());

const reply: ChatModel = async () => ({
  choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "reply", arguments: JSON.stringify({ text: "What would you like to learn?", answers: ["Spanish"] }) } }] } }],
  usage: { neurons: 120 },
});

describe("the daily budget for the whole service", () => {
  it("refuses past the cap and starts again the next UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T23:59:00Z"));
    const counter = memoryCounter();
    expect(await counter.take("sessions", 2)).toBe(true);
    expect(await counter.take("sessions", 2)).toBe(true);
    expect(await counter.take("sessions", 2)).toBe(false);
    vi.setSystemTime(new Date("2026-11-27T00:00:01Z"));
    expect(await counter.take("sessions", 2)).toBe(true);
  });

  it("counts the neurons each open-model call used, and refuses once the day's budget is spent", async () => {
    const counter = memoryCounter();
    const chat = budgetedChat(reply, counter, 200);
    await chat({ messages: [], tools: [], tool_choice: "auto", max_tokens: 10 });
    expect(await counter.used("neurons")).toBe(120);
    await chat({ messages: [], tools: [], tool_choice: "auto", max_tokens: 10 });
    await expect(chat({ messages: [], tools: [], tool_choice: "auto", max_tokens: 10 })).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("lets the script answer when the open model is over budget, so the conversation carries on", async () => {
    const counter = memoryCounter();
    await counter.add("neurons", DAILY.neurons);
    const events: IntakeEvent[] = [];
    await openModelIntakeAgent(budgetedChat(reply, counter), demoIntakeAgent()).respond(createSession("Ana"), "[App note: start]", (e) => events.push(e), new AbortController().signal);
    expect(events.find((e) => e.type === "widget")).toMatchObject({ widget: { kind: "choices", multiple: true } });
  });

  it("counts every Claude request, and the refusal survives the SDK wrapping it", async () => {
    const counter = memoryCounter();
    const inner = vi.fn(async () => new Response("{}"));
    const guarded = budgetedFetch(counter, 2, inner as unknown as typeof fetch);
    await guarded("https://api.anthropic.com/v1/messages");
    await guarded("https://api.anthropic.com/v1/messages");
    const refusal = await guarded("https://api.anthropic.com/v1/messages").catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(BudgetExceeded);
    expect(inner).toHaveBeenCalledTimes(2);
    // The SDK reports a fetch that threw as a connection error, with the original as its cause.
    expect(limitBehind(new Error("Connection error.", { cause: refusal }))).toBe(refusal);
  });

  it("gives up on a call that takes too long", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(CallTimedOut);
  });
});

describe("each person's daily quota", () => {
  function hostFor(session: Session, counter: Counter = memoryCounter()): Host {
    return { actor: makeActor(session, () => {}), start: (name) => makeActor(createSession(name), () => {}), counter };
  }

  it("allows a fixed number of runs a day, then explains why not", () => {
    const session = createSession("Ana");
    for (let i = 0; i < PER_PERSON.runs; i++) expect(spend(session, "runs")).toBeNull();
    expect(spend(session, "runs")).toContain("tomorrow");
  });

  it("refuses another turn with the agent once today's are used, before any model is called", async () => {
    const session = createSession("Ana");
    session.usage = { day: new Date().toISOString().slice(0, 10), counts: { turns: PER_PERSON.turns } };
    const response = await handleApi(new Request("http://localhost:3000/api/intake", { method: "POST", body: JSON.stringify({ kind: "text", text: "hi" }) }), hostFor(session));
    expect(response.status).toBe(429);
    expect(session.chat).toEqual([]);
  });

  it("starts a fresh quota on a new day", () => {
    const session = createSession("Ana");
    session.usage = { day: "2026-01-01", counts: { runs: PER_PERSON.runs } };
    expect(spend(session, "runs")).toBeNull();
  });
});

describe("starting new agents", () => {
  const start = (counter: Counter, ip: string) =>
    handleApi(
      new Request("http://localhost:3000/api/session", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ name: "Ana", adult: true }) }),
      { actor: undefined, start: (name) => makeActor(createSession(name), () => {}), counter },
    );

  it("allows a few new agents per address a day, without keeping the address", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < DAILY.sessionsPerIp; i++) expect((await start(counter, "203.0.113.7")).status).toBe(200);
    expect((await start(counter, "203.0.113.7")).status).toBe(429);
    expect((await start(counter, "198.51.100.2")).status).toBe(200);
  });

  it("stops new agents for everyone once the day's ceiling is reached", async () => {
    const counter = memoryCounter();
    await counter.add("sessions", DAILY.sessions);
    expect((await start(counter, "198.51.100.9")).status).toBe(429);
  });
});

describe("the bot check on new agents", () => {
  const config = { siteKey: "site", secret: "secret", hostnames: "open.viral-trends.workers.dev" };
  const request = new Request("https://open.viral-trends.workers.dev/api/session", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" } });
  const answers = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("accepts a token siteverify approved for this action and hostname", async () => {
    expect(await passesTurnstile("t", request, answers({ success: true, action: "start", hostname: "open.viral-trends.workers.dev" }), config)).toBe(true);
  });

  it("refuses the wrong action, the wrong hostname, a missing token, or siteverify failing", async () => {
    expect(await passesTurnstile("t", request, answers({ success: true, action: "login", hostname: "open.viral-trends.workers.dev" }), config)).toBe(false);
    expect(await passesTurnstile("t", request, answers({ success: true, action: "start", hostname: "evil.example" }), config)).toBe(false);
    expect(await passesTurnstile(undefined, request, answers({ success: true }), config)).toBe(false);
    expect(await passesTurnstile("t", request, answers({}, 500), config)).toBe(false);
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await passesTurnstile("t", request, down, config)).toBe(false);
  });

  it("lets everyone through until it's set up", async () => {
    expect(await passesTurnstile(undefined, request, answers({}), {})).toBe(true);
  });
});

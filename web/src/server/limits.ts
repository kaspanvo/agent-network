import { env } from "./env";
import type { ChatModel } from "./intake/openmodel";
import type { Session } from "./store";
import type { PageSource } from "./tools/reader";

// Everything that costs money has a ceiling, in three layers, the way metered AI platforms do it:
// - a daily budget for the whole service (a hard cap, like a provider's monthly spend limit) that switches the paid
//   models off and lets the script answer until the day resets;
// - a daily quota per person, so one person (or one bot that got in) can't use up everyone's budget;
// - a cap on every single call: output tokens, steps per turn, a timeout and a bounded number of retries.
// Rate limits per IP and the bot check on new sessions sit in front of all this, in the Worker.

// A day is a UTC day, the same as Workers AI's free allowance.
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Daily counters shared by every person. On Cloudflare a single Durable Object holds them, so every person's agent
// sees the same totals; locally and in tests they live in memory.
export interface Counter {
  // Adds `amount` to today's `name` only if that keeps it at or under `limit`. False means the cap is reached.
  take(name: string, limit: number, amount?: number): Promise<boolean>;
  // Adds what was actually used, after the fact. Returns today's total.
  add(name: string, amount: number): Promise<number>;
  used(name: string): Promise<number>;
}

export function memoryCounter(): Counter {
  let day = today();
  let counts = new Map<string, number>();
  const roll = () => {
    if (day !== today()) {
      day = today();
      counts = new Map();
    }
  };
  return {
    async take(name, limit, amount = 1) {
      roll();
      const next = (counts.get(name) ?? 0) + amount;
      if (next > limit) return false;
      counts.set(name, next);
      return true;
    },
    async add(name, amount) {
      roll();
      const next = (counts.get(name) ?? 0) + amount;
      counts.set(name, next);
      return next;
    },
    async used(name) {
      roll();
      return counts.get(name) ?? 0;
    },
  };
}

// The service's daily budget. The neuron default stays inside Workers AI's free 10,000 a day, so nothing is billed
// unless someone raises it on purpose.
export const DAILY = {
  neurons: env.OPEN_DAILY_NEURONS,
  claudeCalls: env.OPEN_DAILY_CLAUDE_CALLS,
  pageReads: env.OPEN_DAILY_PAGE_READS,
  sessions: env.OPEN_DAILY_SESSIONS,
  sessionsPerIp: env.OPEN_SESSIONS_PER_IP,
} as const;

// What one person can do in a day. A full setup takes 10 to 20 turns, so these leave room to change your mind.
export const PER_PERSON = {
  turns: 80,
  runs: 6,
  roomMessages: 40,
  renegotiations: 10,
  privateRooms: 10,
} as const;
export type QuotaKind = keyof typeof PER_PERSON;

const QUOTA_WORDS: Record<QuotaKind, string> = {
  turns: "talked with your agent a lot today",
  runs: "sent your agent out as often as it can go today",
  roomMessages: "written a lot in rooms today",
  renegotiations: "changed your limits a lot today",
  privateRooms: "opened a lot of private rooms today",
};

// Counts one use against the person's daily quota. Returns the refusal to show, or null to go ahead.
export function spend(session: Session, kind: QuotaKind): string | null {
  const day = today();
  if (session.usage?.day !== day) session.usage = { day, counts: {} };
  const used = session.usage.counts[kind] ?? 0;
  if (used >= PER_PERSON[kind]) return `You've ${QUOTA_WORDS[kind]}. Your agent will be ready for more tomorrow.`;
  session.usage.counts[kind] = used + 1;
  return null;
}

export class BudgetExceeded extends Error {
  constructor(what: string) {
    super(`Open has reached today's ${what} budget. Your agent is using its simple script until midnight UTC.`);
    this.name = "BudgetExceeded";
  }
}

export class CallTimedOut extends Error {
  constructor(ms: number) {
    super(`The model didn't answer within ${Math.round(ms / 1000)} seconds.`);
    this.name = "CallTimedOut";
  }
}

// The budget or timeout error behind `err`, if any. The Anthropic SDK wraps an error thrown by its fetch in a
// connection error, so the cause chain is followed.
export function limitBehind(err: unknown): BudgetExceeded | CallTimedOut | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof BudgetExceeded || e instanceof CallTimedOut) return e;
  }
  return null;
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new CallTimedOut(ms)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

// Warns once a day when spending passes 80% of a cap, so someone can look before it stops.
const warned = new Set<string>();
function warnNear(name: string, total: number, limit: number) {
  const key = `${today()}:${name}`;
  if (total < limit * 0.8 || warned.has(key)) return;
  warned.add(key);
  console.warn(JSON.stringify({ at: "budget", name, total, limit, note: "past 80% of today's budget" }));
}

export const MODEL_TIMEOUT_MS = 45_000;

// A Workers AI call that checks the day's neuron budget first and counts what it used after.
// Refused or timed out, it throws, and the caller falls back to the script.
export function budgetedChat(chat: ChatModel, counter: Counter, limit: number = DAILY.neurons): ChatModel {
  return async (request) => {
    if ((await counter.used("neurons")) >= limit) throw new BudgetExceeded("AI");
    const response = await withTimeout(chat(request), MODEL_TIMEOUT_MS);
    const total = await counter.add("neurons", Math.ceil(response.usage?.neurons ?? 0));
    warnNear("neurons", total, limit);
    return response;
  };
}

// Counts each Claude request against the day's cap before it goes out. Wraps the SDK's fetch, so every role and
// every retry is counted, streaming or not.
export function budgetedFetch(counter: Counter, limit: number = DAILY.claudeCalls, inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (!(await counter.take("claude_calls", limit))) throw new BudgetExceeded("AI");
    warnNear("claude_calls", await counter.used("claude_calls"), limit);
    return inner(input, init);
  };
}

// Page reads (Browser Run) against the day's cap.
export function budgetedPages(source: PageSource, counter: Counter, limit: number = DAILY.pageReads): PageSource {
  return {
    async fetch(url) {
      if (!(await counter.take("page_reads", limit))) throw new Error("Open has read as many pages as it can today. Tell me about it in your own words instead.");
      return source.fetch(url);
    },
  };
}

// Used when the host doesn't bring its own counter: the local dev server and tests.
const g = globalThis as typeof globalThis & { __openCounter?: Counter };
export const localCounter: Counter = (g.__openCounter ??= memoryCounter());

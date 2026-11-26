import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listen, observe, persist, record, type Actor } from "./actor";
import { formatPrice } from "./domain";
import { checkIn, decide } from "./followup";
import { extendHold, scheduleHolds, sweepHolds, type Scheduler } from "./holds";
import { jsonError, ndjson, rateLimited } from "./http";
import { scoreCalibration } from "./intake/calibration";
import { isReady, setIntentPrice } from "./intake/profile";
import { OPENING_CHOICES, openingMessage } from "./intake/prompt";
import { aboutEvent } from "./intake/tools";
import { RECAP_CHANGE, RECAP_CONFIRMED, type IntakeEvent } from "./intake/types";
import { DAILY, localCounter, spend, today, type Counter, type QuotaKind } from "./limits";
import { localMarket, type Market } from "./market";
import { agentModels, type Agents } from "./models";
import { renegotiate } from "./negotiation/renegotiate";
import { runAgent } from "./negotiation/run";
import type { AgentEvent } from "./negotiation/types";
import { openPrivateRoom, sayInRoom } from "./rooms/reply";
import { publicSession, SESSION_COOKIE } from "./store";
import { clientIp, passesTurnstile, turnstileSiteKey } from "./turnstile";

// Every /api route, written once against the standard Request and Response, so the same code serves
// `next dev` locally and the person's Durable Object on Cloudflare. The host decides where the agent lives.
export type Host = {
  // The person's live agent, if they have one.
  actor: Actor | undefined;
  // Starts a new person's agent. Locally a fresh id; on Cloudflare the id of the Durable Object handling the request.
  start: (name: string) => Actor;
  market?: Market;
  agents?: Agents;
  // Wakes the person's agent later: when a proposal's hold runs out, or when it's time to ask how something went.
  // A Durable Object alarm on Cloudflare. Locally there's none; holds are also swept on every visit.
  wake?: Scheduler;
  // The service's daily counters: one Durable Object on Cloudflare, memory locally.
  counter?: Counter;
};

export function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

// Requests that change anything must come from this site. A form or script on another site can't act as someone's agent.
export function crossSite(request: Request): Response | null {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return null;
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return jsonError("Requests must come from Open itself.", 403);
  return null;
}

function sessionCookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

type Route = { method: string; pattern: RegExp; handle: (request: Request, host: Host, params: string[]) => Promise<Response> | Response };

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/session$/, handle: getSession },
  { method: "POST", pattern: /^\/api\/session$/, handle: startSession },
  { method: "DELETE", pattern: /^\/api\/session$/, handle: endSession },
  { method: "POST", pattern: /^\/api\/intake$/, handle: intake },
  { method: "PATCH", pattern: /^\/api\/intents\/([^/]+)$/, handle: setIntent },
  { method: "POST", pattern: /^\/api\/agent\/run$/, handle: run },
  { method: "GET", pattern: /^\/api\/agent\/events$/, handle: events },
  { method: "POST", pattern: /^\/api\/opportunities\/([^/]+)$/, handle: decision },
  { method: "POST", pattern: /^\/api\/opportunities\/([^/]+)\/checkin$/, handle: checkin },
  { method: "POST", pattern: /^\/api\/opportunities\/([^/]+)\/hold$/, handle: hold },
  { method: "POST", pattern: /^\/api\/rooms\/private$/, handle: privateRoom },
  { method: "POST", pattern: /^\/api\/rooms\/([^/]+)\/messages$/, handle: message },
  { method: "POST", pattern: /^\/api\/rooms\/([^/]+)\/renegotiate$/, handle: renegotiateRoom },
];

const MAX_BODY = 64 * 1024;

export async function handleApi(incoming: Request, host: Host): Promise<Response> {
  const refused = crossSite(incoming);
  if (refused) return refused;
  // Read the whole body before answering. A route that doesn't need it would otherwise answer with the body
  // still in flight, which Cloudflare's runtime treats as an error once the request was forwarded to a Durable Object.
  let request = incoming;
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    const text = await incoming.text();
    if (text.length > MAX_BODY) return jsonError("That request is too large.", 413);
    request = new Request(incoming.url, { method: incoming.method, headers: incoming.headers, body: text || null });
  }
  const path = new URL(request.url).pathname;
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    if (route.method !== request.method) continue;
    return route.handle(request, host, match.slice(1).map(decodeURIComponent));
  }
  return routes.some((r) => r.pattern.test(path)) ? jsonError("Method not allowed.", 405) : jsonError("Not found.", 404);
}

// One use of the person's daily quota, saved with their session. Returns the refusal, or null to go ahead.
function quota(actor: Actor, kind: QuotaKind): Response | null {
  const refused = spend(actor.session, kind);
  if (refused) return jsonError(refused, 429);
  persist(actor);
  return null;
}

function agentsOf(host: Host): Agents {
  return host.agents ?? agentModels();
}

function sessionBody(host: Host, actor: Actor | undefined) {
  const agents = agentsOf(host);
  // Which model runs the agents, so the person can see their agent isn't a weaker tier than anyone else's.
  // `busy` tells a reopened page that the agent is still out, so it can follow the run live.
  // `turnstile` is the site key when new sessions need a bot check.
  return { mode: agents.mode, model: agents.label, busy: actor?.busy ?? null, turnstile: turnstileSiteKey(), session: actor ? publicSession(actor.session) : null };
}

function getSession(_request: Request, host: Host) {
  const actor = host.actor;
  // A sweep on every visit, as lease-based task boards do, so a hold that ran out is settled even if no alarm fired.
  if (actor && !actor.busy) {
    const lapsed = sweepHolds(actor.session);
    for (const event of lapsed) observe(actor, event);
    if (lapsed.length) persist(actor);
  }
  return Response.json(sessionBody(host, actor));
}

// A daily key per address, hashed with the day so no address is kept.
async function addressKey(request: Request): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${today()}|${clientIp(request)}`));
  return `ip:${[...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function startSession(request: Request, host: Host) {
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(40), turnstile: z.string().max(2048).optional() }));
  if (!input) return jsonError("Tell your agent your first name.", 400);
  // A new session gets a fresh daily quota, so starting one is where bots are stopped: the bot check, a few new
  // agents per address a day, and a ceiling on new agents for the whole service.
  if (!(await passesTurnstile(input.turnstile, request))) return jsonError("We couldn't check you're a person. Reload the page and try again.", 403);
  const counter = host.counter ?? localCounter;
  if (!(await counter.take(await addressKey(request), DAILY.sessionsPerIp))) return jsonError("You've started several agents today. Come back tomorrow, or keep using the one you have.", 429);
  if (!(await counter.take("sessions", DAILY.sessions))) return jsonError("Open is full for today. Try again tomorrow.", 429);
  const actor = host.start(input.name);
  persist(actor);
  return Response.json(sessionBody(host, actor), { headers: { "Set-Cookie": sessionCookie(request, actor.session.id, 60 * 60 * 24 * 30) } });
}

function endSession(request: Request) {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, "", 0) } });
}

const IntakeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal("choices"), itemId: z.string(), picked: z.array(z.string()).min(1).max(8) }),
  z.object({ kind: z.literal("number"), itemId: z.string(), value: z.number().finite() }),
  z.object({ kind: z.literal("recap"), itemId: z.string(), answer: z.enum(["confirm", "change"]) }),
  z.object({ kind: z.literal("refresh") }),
  z.object({ kind: z.literal("pairs"), itemId: z.string(), picks: z.record(z.string(), z.enum(["a", "b"])) }),
]);

async function intake(request: Request, host: Host) {
  const actor = host.actor;
  if (!actor) return jsonError("Start by telling your agent your name.", 401);
  const { session } = actor;
  const limited = rateLimited(actor);
  if (limited) return limited;
  const input = await body(request, IntakeInput);
  if (!input) return jsonError("That message couldn't be read.", 400);
  const over = quota(actor, "turns");
  if (over) return over;
  const early: IntakeEvent[] = [];

  let userText: string;
  if (input.kind === "start") {
    if (session.chat.length > 0) return jsonError("This conversation has already started.", 409);
    userText = openingMessage(session.name);
  } else if (input.kind === "refresh") {
    // The app asks for the recap again, after the person changed what their agent will look for. Nothing shows as theirs.
    if (session.recapConfirmed) return jsonError("The recap is already confirmed.", 409);
    userText = `[App note: ${session.name} changed what their agent will look for. Show the recap again so they can check it.]`;
  } else if (input.kind === "text") {
    // Typing instead of using a quick-pick answers it.
    for (const item of session.chat) if (item.widget && !item.answered) item.answered = true;
    session.chat.push({ id: randomUUID(), role: "user", text: input.text });
    userText = input.text;
  } else if (input.kind === "pairs") {
    const item = session.chat.find((c) => c.id === input.itemId);
    if (item?.widget?.kind !== "pairs" || item.answered || !session.calibration) return jsonError("Those picks have already been answered.", 409);
    const pairs = session.calibration.pairs;
    if (pairs.some((p) => !input.picks[p.id])) return jsonError("Pick one from each pair.", 400);
    item.answered = true;
    const result = scoreCalibration(session, input.picks);
    const chosen = pairs.map((p) => p[input.picks[p.id]!].title);
    session.chat.push({ id: randomUUID(), role: "user", text: `I'd pick: ${chosen.join("; ")}` });
    const missed = pairs.filter((p) => result.missed?.includes(p.id)).map((p) => `"${p[input.picks[p.id]!].title}" over "${p[input.picks[p.id] === "a" ? "b" : "a"].title}"`);
    userText = `[App note: ${session.name} answered the either/or picks. Their agent guessed ${result.agreed} of ${pairs.length} right.${missed.length ? ` It got these wrong: they'd pick ${missed.join(", and ")}.` : ""}]`;
  } else if (input.kind === "recap") {
    const item = session.chat.find((c) => c.id === input.itemId);
    if (item?.widget?.kind !== "recap" || item.answered) return jsonError("That recap has already been answered.", 409);
    item.answered = true;
    // Only the person can confirm the recap, and only by answering it here. The agent can't mark itself checked.
    session.recapConfirmed = input.answer === "confirm";
    userText = input.answer === "confirm" ? RECAP_CONFIRMED : RECAP_CHANGE;
    session.chat.push({ id: randomUUID(), role: "user", text: userText });
    userText = `[App note: ${session.name} ${input.answer === "confirm" ? "confirmed the recap" : "wants to change something in the recap"}.] ${userText}`;
  } else {
    const item = session.chat.find((c) => c.id === input.itemId);
    if (!item?.widget || item.answered || item.widget.kind !== input.kind) return jsonError("That question has already been answered.", 409);
    item.answered = true;
    if (input.kind === "choices" && item.widget.kind === "choices") {
      const options = item.widget.options;
      const picked = input.picked.filter((p) => options.includes(p));
      if (picked.length === 0) return jsonError("Pick one of the options.", 400);
      session.chat.push({ id: randomUUID(), role: "user", text: picked.join(", ") });
      userText = `I picked: ${picked.join(", ")}`;
      // The opening picks are what the person came for: they go in the profile as they are.
      if (picked.every((p) => OPENING_CHOICES.includes(p))) {
        session.goals = picked;
        early.push(aboutEvent(session));
      }
    } else if (input.kind === "number" && item.widget.kind === "number") {
      const { min, max, unit, intentId } = item.widget;
      const value = Math.min(max, Math.max(min, input.value));
      if (intentId) {
        const intent = setIntentPrice(session, intentId, value);
        if (intent) early.push({ type: "intent", intent });
      }
      session.chat.push({ id: randomUUID(), role: "user", text: `${value} ${unit}` });
      userText = `My answer: ${value} ${unit}`;
    } else {
      return jsonError("That answer doesn't match the question.", 400);
    }
  }

  if (session.pendingNotes.length > 0) {
    userText = `${session.pendingNotes.join("\n")}\n${userText}`;
    session.pendingNotes = [];
  }

  const agent = agentsOf(host).intake();
  return ndjson<IntakeEvent>(actor, async (emit, signal) => {
    for (const event of early) emit(event);
    await agent.respond(session, userText, emit, signal);
  });
}

async function setIntent(request: Request, host: Host, [id]: string[]) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  const { session } = actor;
  const input = await body(request, z.object({ status: z.enum(["confirmed", "rejected"]) }));
  if (!input) return jsonError("Choose confirm or reject.", 400);
  const intent = session.intents.find((i) => i.id === id);
  if (!intent) return jsonError("That intent no longer exists.", 404);

  intent.status = input.status;
  observe(actor, { type: "intent", intent });
  session.pendingNotes.push(`[App note: ${session.name} ${input.status === "confirmed" ? "confirmed" : "rejected"} the inferred intent "${intent.summary}".]`);
  // What the agent will look for changed, so the recap needs another look before it can go out. Ready always means
  // the recap is confirmed: otherwise "Send my agent out" would stay on screen and be refused.
  const recapNeeded = session.recapConfirmed;
  session.recapConfirmed = false;
  session.ready = false;
  persist(actor);
  return Response.json({ intents: session.intents, ready: session.ready, recapNeeded });
}

function run(_request: Request, host: Host) {
  const actor = host.actor;
  if (!actor) return jsonError("Set up your agent first.", 401);
  const limited = rateLimited(actor);
  if (limited) return limited;
  const { session } = actor;
  if (!isReady(session)) return jsonError("Give your agent something to go out with first: an interest, or a deal with a price.", 409);
  if (!session.recapConfirmed) return Response.json({ error: "Your agent needs you to check the recap first.", needs: "recap" }, { status: 409 });
  if (actor.busy) return jsonError("Your agent is already out. Wait for it to come back.", 409);
  const over = quota(actor, "runs");
  if (over) return over;
  const narrator = agentsOf(host).narrator();
  session.decisions = {};
  session.followups = {};
  return ndjson<AgentEvent>(
    actor,
    async (emit) => {
      await runAgent(session, narrator, emit, host.market ?? localMarket());
      scheduleHolds(session, host.wake);
    },
    "run",
  );
}

// Server-sent events for a run that's still going: replays what happened after `after`, then follows live
// until the run ends. A page reloaded while the agent is out picks up where it left off.
// Each event's id is its position in the run, so a reconnecting EventSource resumes from Last-Event-ID.
function events(request: Request, host: Host) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  const run = actor.session.run;
  const from = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? 0);
  const after = Number.isInteger(from) && from >= 0 ? from : 0;

  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let open = true;
      const send = (id: number, event: AgentEvent | { type: "end" }) => {
        if (open) controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (!open) return;
        send(run?.events.length ?? 0, { type: "end" });
        open = false;
        stop();
        controller.close();
      };
      // Replay and subscribe in the same tick, so nothing slips between them.
      for (const [i, event] of (run?.events ?? []).slice(after).entries()) send(after + i + 1, event);
      if (!actor.busy) return close();
      stop = listen(actor, { event: (event) => send(actor.session.run?.events.length ?? 0, event), end: close });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
}

// You approve or decline a proposal. On a yes, the others say yes too, you're introduced, and a check-in is set.
async function decision(request: Request, host: Host, [id]: string[]) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  // `version` is the version the person was looking at. Like a fenced claim, an answer to an older version changes nothing.
  const input = await body(request, z.object({ decision: z.enum(["approved", "declined"]), version: z.number().int().positive().optional() }));
  if (!input) return jsonError("Approve or decline.", 400);
  const { session } = actor;
  const opportunity = session.run?.opportunities.find((o) => o.id === id);
  if (!opportunity) return jsonError("That proposal no longer exists.", 404);
  if (input.version !== undefined && input.version !== opportunity.version) return jsonError(`This proposal is now version ${opportunity.version}. Look at it again before you answer.`, 409);
  if (session.decisions[id!] === "lapsed") return jsonError("This one lapsed before you answered, so the others are free again. Send your agent out again for a fresh one.", 409);
  if (session.decisions[id!]) return jsonError("You've already answered this one.", 409);
  return ndjson<AgentEvent>(actor, (emit) => decide(session, id!, input.decision, emit, (opportunityId, at) => host.wake?.({ kind: "check_in", opportunityId }, at)));
}

// The person needs more time to decide: the others hold their place a day longer, once.
function hold(_request: Request, host: Host, [id]: string[]) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  if (actor.busy) return jsonError("Your agent is still out. Wait for it to finish.", 409);
  // A refusal (already answered, already extended, lapsed) is an answer, not a failure: say so before streaming anything.
  let event: AgentEvent;
  try {
    event = extendHold(actor.session, id!, host.wake);
  } catch (err) {
    return jsonError((err as Error).message, 409);
  }
  return ndjson<AgentEvent>(actor, async (emit) => emit(event));
}

// After a yes: did it happen, and would you do it again?
async function checkin(request: Request, host: Host, [id]: string[]) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  const input = await body(request, z.object({ answer: z.enum(["again", "once", "missed"]) }));
  if (!input) return jsonError("Say whether it happened.", 400);
  return ndjson<AgentEvent>(actor, (emit) => checkIn(actor.session, id!, input.answer, emit));
}

// Opens a one-to-one room with one member's agent.
async function privateRoom(request: Request, host: Host) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  const limited = rateLimited(actor);
  if (limited) return limited;
  const input = await body(request, z.object({ name: z.string().min(1).max(80) }));
  if (!input) return jsonError("Choose who to message.", 400);
  const over = quota(actor, "privateRooms");
  if (over) return over;
  return ndjson<AgentEvent>(actor, async (emit) => {
    await openPrivateRoom(actor.session, input.name, emit);
  });
}

async function message(request: Request, host: Host, [id]: string[]) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  const limited = rateLimited(actor);
  if (limited) return limited;
  const input = await body(request, z.object({ text: z.string().trim().min(1).max(500) }));
  if (!input) return jsonError("Write a message first.", 400);
  const over = quota(actor, "roomMessages");
  if (over) return over;
  const responder = agentsOf(host).responder();
  return ndjson<AgentEvent>(actor, (emit) => sayInRoom(actor.session, id!, input.text, responder, emit));
}

async function renegotiateRoom(request: Request, host: Host, [id]: string[]) {
  const actor = host.actor;
  if (!actor) return jsonError("Your session has ended. Start again.", 401);
  const limited = rateLimited(actor);
  if (limited) return limited;
  if (actor.busy) return jsonError("Your agent is still out. Wait for it to finish.", 409);
  const input = await body(request, z.object({ limit: z.number().finite().positive().max(100000) }));
  if (!input) return jsonError("Choose a new limit.", 400);
  const over = quota(actor, "renegotiations");
  if (over) return over;
  const intent = actor.session.intents.find((i) => id!.startsWith(`${i.id}-`));
  if (intent) record(actor, { kind: "you", by: "you", room: id, text: `You changed your private ${intent.direction === "seek" ? "limit" : "floor"} for “${intent.summary}” to ${formatPrice(input.limit, intent.unit)}` });
  const narrator = agentsOf(host).narrator();
  return ndjson<AgentEvent>(
    actor,
    async (emit) => {
      await renegotiate(actor.session, id!, input.limit, narrator, emit, host.market ?? localMarket());
      scheduleHolds(actor.session, host.wake);
    },
    "renegotiate",
  );
}

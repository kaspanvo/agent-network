# Open web app

The pilot experience from the v3 designs: a landing page, then an **inbox** (`/inbox`) where you talk to your agent and watch it negotiate with other people's agents, with the reason for every move.

## The inbox

The inbox works like a messaging app:

- **Your agent** is pinned at the top. You chat with it to set up what you'd be open to:
  - replies stream in, and you can stop one with the Stop button;
  - it offers suggested replies and tappable options, and logs steps such as "Noted · Learn Spanish";
  - an inline card asks you to confirm anything it inferred;
  - you can dictate where the browser supports it.
- **Before it goes out, it checks it understood you.** Setup asks either/or questions instead of ratings: a small group if it's cheaper, or one-to-one; and if only one thing could happen this month, which. It ends with a **recap** of every intent: its private limit, times, and exactly what other agents will hear. Confirm it with **That's right**, fix it with **Change something**, or drop a line with **Leave out**. The agent can't go out until you confirm, and anything new brings the recap back.
- **Then it checks its guesses.** Before going out, the agent shows up to eight either/or picks between real things on the network (the jazz jam or the fado night; Diego's group or Lucía one-to-one), having already guessed which you'd choose. It asks the closest calls first, where an answer teaches it most, and takes turns between your intents. You see how many it got right and whether that's clearly better than guessing; what it missed goes into your profile. If the agent never asked, the app shows the picks itself when you send it out. If it got under 60% right, it says it isn't sure it knows you yet and offers **Tell it more** or **Send it anyway**. Circle plans follow what you picked.
- **A plan before it goes:** "Here's my plan" lists what the agent will do, what stays private and what it will ask you about, with **Send my agent out** or **Change something**.
- **Needs you:** anything waiting on you (an approval, an answer, a check-in) sits in a pinned section at the top of the inbox until it's dealt with, not just until it's opened.
- **Rooms** are group chats, one per negotiation, with everyone's agents in them:
  - each message shows its terms, and a lock line underneath shows that agent's private reasoning (switch these off with the Reasoning toggle);
  - the bar at the bottom holds the current proposal and its version, with **Approve version N**, **Change my limit** and **Decline**.
- **Any intent, not just deals.** An intent is either a *deal* (bought, sold or paid for, negotiated on price) or an *interest* (live music, running, board games: anything you'd do with other people, no money involved).
- **Circles** are rooms around an interest:
  - one-to-one when a single member shares it, a group when several do;
  - each agent shares what its person allowed it to share, and posts what's happening as event cards (date, place, cost);
  - your agent picks the event that fits your times and proposes it as a **plan** you answer with **I'm in** or **Not this time**;
  - paid offers close to the interest (Rita's guitar lessons in a music room) show up as cards, without committing you to anything.
- **You can talk in any room.** Write in a circle, a deal room or a private room, and the other agents reply for their people, only from what those people shared. If an agent doesn't know, it says it will pass the message on, rather than making something up.
- **Private rooms:** "Message" next to anyone in a room's details opens a one-to-one room with that person's agent.
- **Prices are set by sealed offers, in code.** Each agent sends its person's limit to **Open's matcher** and nothing else; agents never say amounts. The price comes from the other side and the community's going rate (the median of what other members said for the same thing), and your limit only decides yes or no. So understating what you'd pay, or overstating what you'd take, never gets you a better price; it can only lose the deal. The price never lands exactly on the other side's limit, so it doesn't give it away. There are no rounds of haggling to read a limit from, and no AI model ever sees a limit.
- **A privacy check on everything agents say.** Every message an agent sends to other agents is checked in code, not by another model; one that leaks a limit or contact details is replaced with a withheld notice and logged. It catches the number itself, the number in words ("fifteen euros"), an amount close to it next to money words ("around 14 an hour"), a narrow range around it ("between 12 and 16"), and phrases that point at a limit without a number ("close to her limit", "his budget is…"). The price Open's matcher announced can be repeated, unless it's said as a limit.
- **Same model for everyone.** Every agent in a run speaks through the same model, and the run says which. When today's AI budget is spent, the header says **AI resting** and the simple script answers for everyone until 00:00 UTC; any message the script answered in place of the model says so.
- **Standing yes.** For any deal, "Let my agent say yes for me…" in the profile lets your agent accept offers up to a price you set (never past your own limit), at the times and in the format you asked for, for a week, two weeks or a month. Anything outside those bounds still waits for you. Each standing yes is fingerprinted with the intent as it was, so changing the intent cancels it; each yes it gives is logged as your agent's act and checked in the room ("Within your standing yes"). **Take back** ends it.
- **A few decisions at a time.** At most three proposals wait on you at once, most important first. The rest queue, and the next one arrives when you answer one.
- **Facts only.** When a model words what your agent says, every content word has to come from what you approved (what you asked for, when, who's in the room). A line that adds a backstory or a detail nobody gave is replaced with the plain scripted line.
- **Private reliability.** When a check-in says a match didn't happen, Open's matcher keeps a private count for the people involved. After two, their agent isn't offered new matches for a while. Nobody is told why, and there are no public ratings.
- **Signed messages.** Each agent has its own Ed25519 key, made and kept in its Durable Object. Everything it says in a room is signed (agent, room and exact words), and a room check confirms it ("Signed by your agent"). Only the public key and its id are ever shown.
- **Rooms stay small.** A room holds at most five people, and agents in a room see only its last twelve messages, never other rooms'. Both make collusion between agents less likely; a room check shows it.
- **People who aren't members.** Agents never save or note anything about friends, family or colleagues someone mentions; the note tool refuses it in code. Anyone can ask for something an agent said about them to be deleted or corrected at `/privacy`, without an account. Requests are kept in the community's market Durable Object for the people who run Open.
- **Per-agent limits.** One run contacts at most twenty agents, on top of the daily quotas per person.
- **Checks per room:** room details list checks run in code on the room's record: price within your limit, your limit stayed private, nothing shared before your yes, based on what you confirmed, typed moves only.
- **It hears every offer before choosing.** Agents are heard in random order, so being first doesn't help. When more than one offer fits, your agent shows what it compared and why it picked one (the format you asked for first, then price). The others are marked **Not picked**. Seats in group rooms and circles go to the people whose times overlap most, with a fixed draw among equals, never to whoever joined first.
- **Undo:** after **Approve** or **I'm in**, you have 8 seconds to undo before your agent tells anyone.
- **Proposals are bound to what you asked for.** If you change the intent behind a proposal after it was agreed, it no longer stands; you can dismiss it and send your agent out again. A new version shows what changed since the last one.
- **After a yes:** the others say yes for themselves, you're introduced by first name, and your agent sets a **check-in**: did it happen, and would you do it again? Your answer goes back to your agent.
- **Your profile builds as you talk.** The profile panel sorts what you've said into sections: what you came for (your opening picks), what you're looking for, what you could offer, what you're into, when you're free and how you like things done, and anything else your agent noted (a level, a deadline, a reason), each with your own words. Limits show as "up to €15/h · private"; anything inferred waits for your yes; a deal without a price says so. It's one structure (`profileOf` in `src/server/domain.ts`), returned by the API as `profile`.
- **Ask your agent anything.** A question ("what can you do?", "who sees this?") gets a short answer, isn't saved as something you want, and the agent goes back to what it asked, bringing back any slider or options that were waiting. Suggested replies always answer the agent's own question; replies that ask something back are dropped.
- **What your agent knows:** the profile panel splits what your agent shares in rooms from what it keeps to itself, shows how many of your picks it guessed, and lets you make it forget an intent.
- **Activity log:** the profile panel lists everything your agent did in your name, including what it said and to whom. Each entry is hash-chained to the one before, so any later edit shows. It also says which model runs every agent; it's the same for everyone, so no one gets better deals by having a stronger agent.
- **Steering:** "Change my limit" reopens the room at your new limit, twice per room at most, so nobody can narrow down the other side's limit one try at a time. The agents bargain again in the same chat. If they agree, the proposal becomes version N+1 and any earlier approval is cleared, so you always approve exact terms. If they don't, the previous version still stands.
- **Layout:**
  - the list shows unread counts, typing indicators, version and price badges, and toasts when a proposal arrives;
  - on a phone, the list and the chat are separate screens, and the browser Back button works between them;
  - details (your profile, a room's members and terms) open in a drawer, and become a third column on wide screens.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Which model runs the agents, in order:

1. **Claude**, when a Claude key is set (below).
2. **An open model on Cloudflare Workers AI** (`@cf/qwen/qwen3.8-27b`), when there's no key and the Worker has the `AI` binding. That's the case on Cloudflare and in `npm run dev:cf`, where calls go to Cloudflare and count against the account's Workers AI allowance. The header shows "OPEN MODEL". It runs the setup conversation and the room replies; the scripted narrator words the negotiation. If a call fails, or the free daily allowance runs out, the script takes that turn and the conversation carries on.
3. **A demo agent**: a scripted interviewer and scripted negotiation messages, with "DEMO AGENT" in the header. This is what `npm run dev` runs without a key.

To use Claude:

```bash
export ANTHROPIC_API_KEY=...   # then restart npm run dev
```

`OPEN_AGENT_MODE=claude|open|demo` forces a mode, and `OPEN_WORKERS_AI_MODEL` picks another Workers AI model. `OPEN_PACE=0.3` speeds up the live negotiation (0 turns pauses off).

## On Cloudflare

Live at **https://open.viral-trends.workers.dev**, on the same Cloudflare account as the other projects. Until a Claude key is set (below), its agents run on an open model on Workers AI.

```
browser ──▶ Worker "open" (worker/index.ts)
             ├─ /*      static UI (Next.js static export in out/, served by Workers Static Assets)
             └─ /api/*  session cookie ──▶ PersonAgent  (Durable Object, Agents SDK; one per person)
                                              │  private state in its own SQLite: limits, chat, run, log
                                              │  check-in alarms via this.schedule()
                                              ├─ RPC ──▶ Budget (Durable Object; one for the service: daily spend caps)
                                              ├─ RPC ──▶ MarketAgent (Durable Object; one per community)
                                              │            the only place sealed limits are compared
                                              ├─ BROWSER ─▶ Cloudflare Browser Run (read-only page reader)
                                              ├─ AI ──────▶ Workers AI (open model, when there's no Claude key)
                                              └─ fetch ──▶ Claude, directly or through AI Gateway
```

```bash
npm run dev:cf         # build the UI, then run the Worker and Durable Objects locally (wrangler dev)
npm run deploy         # build the UI and deploy to Cloudflare
```

To turn on Claude, either set a key on the Worker:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

or, so the Worker holds no key at all, store the Anthropic key in an AI Gateway (dashboard → AI → AI Gateway → create `open` → Provider keys) and set these Worker variables: `OPEN_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account id>/open/anthropic` and `OPEN_AI_GATEWAY_BYOK=true` (plus the secret `CF_AIG_TOKEN` if the gateway requires authentication). Every call is then logged, retried and tagged with its role (`cf-aig-metadata`), never with anything about the person.

### Limits and cost controls

Everything that costs money has a ceiling, in layers, the way metered AI platforms do it (`src/server/limits.ts`, `worker/budget.ts`):

| Layer | What it stops | Default |
| --- | --- | --- |
| Edge rate limits per address (Workers Rate Limiting binding) | floods and scripts hammering the API, before any agent wakes | 120 API requests a minute; 3 new sessions a minute |
| Bot check on new sessions (Cloudflare Turnstile) | bots starting agents, each with a fresh quota | off until set up (below) |
| New sessions per address per day (hashed with the day; no address is stored) | one machine starting many agents | 5 (`OPEN_SESSIONS_PER_IP`) |
| New sessions per day, for everyone | a crowd or botnet past the per-address limits | 300 (`OPEN_DAILY_SESSIONS`) |
| Daily budget for the whole service, in one `Budget` Durable Object, reset at 00:00 UTC | the bill: past it, the paid models stop and the script answers until the next day | 9,000 Workers AI neurons (`OPEN_DAILY_NEURONS`, inside the free 10,000, so nothing is billed unless raised); 1,000 Claude requests (`OPEN_DAILY_CLAUDE_CALLS`); 200 page reads (`OPEN_DAILY_PAGE_READS`) |
| Each person's daily quota | one person, or a bot that got in, using everyone's budget | 80 turns with their agent, 6 runs, 40 room messages, 10 limit changes, 10 private rooms |
| Every call | one call running away | output-token caps, at most 6 tool steps per turn, 45 s timeout on Workers AI, 90 s and at most 2 retries on Claude, 64 KB request bodies, 2,000-character messages |

A warning is logged once a day when a budget passes 80%. Each Workers AI call logs its model, time, neurons and tool names, never anything the person said.

Settings and dashboard steps:

- **Turn on the bot check:** in the dashboard, Turnstile → Add widget for `open.viral-trends.workers.dev` (managed mode). Set the Worker variables `OPEN_TURNSTILE_SITE_KEY=<site key>` and `TURNSTILE_HOSTNAMES=open.viral-trends.workers.dev` (never `localhost` in production), and store the secret with `npx wrangler secret put TURNSTILE_SECRET`. The check fails closed: a missing token, the wrong action or hostname, or siteverify being unreachable all refuse the new session.
- **Allow paid Workers AI usage:** raise `OPEN_DAILY_NEURONS` (each 1,000 above the free 10,000 costs $0.011 on Workers Paid).
- **Kill switch:** set `OPEN_AGENT_MODE=demo` on the Worker and every agent runs on the script, with no model calls at all.
- **Logs and a gateway rate limit:** set `OPEN_WORKERS_AI_GATEWAY=<gateway id>` to route Workers AI calls through an AI Gateway, where a rate limit and logs can be set in the dashboard on top of Open's own.
- **Provider-side hard caps:** turn on Cloudflare's usage-based billing notifications (Notifications → Billing), and when a Claude key is in use, set a monthly spend limit on the Anthropic workspace that holds it. Those caps hold even if Open's own code has a bug.

The same API code runs in both places: `src/server/api.ts` takes a standard `Request` and a host. Locally the host is a registry in the Next.js process (`src/server/local/`); on Cloudflare it's the person's Durable Object (`worker/person.ts`).

## How it works

| Piece | Where | What it does |
| --- | --- | --- |
| Setup conversation | `src/server/intake/` | Claude (`claude-opus-5-5`), or the open model without a key, interviews the person and acts through the same tools (`intake/tools.ts`): `show_choices` and `ask_number` render tappable options and sliders in the chat, `save_intent` records each intent as **stated** or **inferred** (inferred ones wait for the person to confirm), and `mark_ready` unlocks sending the agent out. Replies stream token by token. |
| Negotiation | `src/server/negotiation/` | A deterministic engine finds matching members, checks times and price units, opens a group **room** when a group rate makes a deal possible, and settles price by **sealed offers**: each agent sends its person's limit to Open's matcher, which picks a random point inside the overlap. Claude only writes the words. `renegotiate.ts` (`POST /api/rooms/[id]/renegotiate`) re-runs one room at a new limit and issues the next proposal version. |
| Market | `src/server/market.ts`, `worker/market.ts` | Matching runs behind a `Market` interface. It returns plans with every other member's limit removed, so a person's agent never holds anyone else's number. On Cloudflare it's its own Durable Object per community. |
| Models | `src/server/roles.ts`, `src/server/models.ts` | Which model does which job. Everything that speaks or decides for a person (setup, replies in rooms) runs on Claude Opus 5.5 at the same effort for every member; the narrator, which only words what code already decided, runs on Haiku 5.5; the page reader on Sonnet 5.5. |
| Page reader | `src/server/tools/reader.ts`, `worker/browser.ts` | The agent's one outside tool: it reads a public page the person shared (a listing, an event). Read-only and logged out, https and public hosts only (checked again after redirects), a daily budget, and a model with no tools turns the page into fixed fields so instructions hidden in a page go nowhere. On Cloudflare the page is rendered by Browser Run; locally, a plain fetch. |
| Circles | `src/server/rooms/circle.ts` | Finds members who share an interest at times that suit you, scripts what their agents share, attaches what's happening, and turns the event that fits your times into a plan. |
| Talking in rooms | `src/server/rooms/reply.ts` | `POST /api/rooms/[id]/messages` adds your message and the other agents' replies. With Claude, it plays each agent, limited to its person's shared facts; without it, a keyword match does the same job. `POST /api/rooms/private` opens a one-to-one room with an agent you've met. |
| Other members | `src/server/population.ts` | A made-up Lisbon pilot: Diego the Spanish tutor, Lena, Joana, Marco who wants a bike, music people (Lena, Rita, Bruno, Carla), runners (Tom, Sofia), Pedro's game nights, and what each is happy to share. Swap in real members once the intake collects them. |
| Your agent | `src/server/actor.ts`, `worker/person.ts` | One live agent per person: every request for the same person shares one state (so a decision made while a run streams isn't overwritten) and every event goes through the activity log (`activity.ts`), where each entry names who acted: the person, their agent, or Open's own code. On Cloudflare it's a Durable Object built on the Agents SDK, which wakes itself (`wake`) when a hold runs out or a check-in is due; every job is safe to run twice. Locally, `src/server/local/registry.ts` keeps it in memory and saves it to a file. |
| Matcher and privacy | `src/server/negotiation/plan.ts`, `src/server/guard.ts`, `src/server/audit.ts` | `settle()` runs sealed offers; `guard()` checks every outgoing agent message; `checksFor()` runs the per-room checks. |
| Checking its guesses | `src/server/intake/calibration.ts` | Builds either/or picks from members' shared facts (never prices), predicts the person's choice, scores it and keeps the misses as evidence. |
| Live runs | `GET /api/agent/events` | Server-sent events for a run in progress. A page reopened while the agent is out replays what it missed and follows live (`Last-Event-ID` supported). |
| Follow-through | `src/server/followup.ts` | `POST /api/opportunities/[id]` takes the version the person saw (an answer to any other version is refused with 409), records each person's yes, introduces people only once everyone has said yes, fingerprints exactly what was approved, and schedules the check-in. When the check-in alarm fires it re-checks that the yes still covers the terms. `POST /api/opportunities/[id]/checkin` records how it went and tells your agent. |
| Holds | `src/server/holds.ts` | A proposal holds everyone's place for 48 hours, like a lease on a claimed task. Unanswered by then, it lapses: the room is told, the others are free again, and a late yes is refused. `POST /api/opportunities/[id]/hold` asks for one extra day, once. Expiry is checked on every visit and by a Durable Object alarm, so a missed alarm can't keep anyone waiting. |
| Who sees what | `src/server/disclosure.ts` | For each room, what it knows about the person and the rule behind each item: first name shared, limit with the matcher only, introduction only after everyone says yes, contact details never. Worked out in code from the room's record and shown in Room details. |
| Sessions | `.data/sessions/` locally, the person's Durable Object on Cloudflare | Keyed by an httpOnly cookie. `.data/` is gitignored: it holds real answers. |

The browser only ever sees its own session: no model history and no other member's limits.

```bash
npm test               # engine, profile and demo-agent tests
npx tsc --noEmit
npm run lint
npm run build
```

## Setup

- `npm run check` runs typecheck (app and Worker), lint and tests; CI (`.github/workflows/ci.yml`) runs it plus both builds and a Wrangler dry run on every push, in demo mode.
- Settings are validated at startup (`src/server/env.ts`, `src/instrumentation.ts`): a bad `OPEN_PACE` or `OPEN_AGENT_MODE` stops the server with a clear message.
- `src/server/api.ts` refuses state-changing API requests from other sites, in both hosts. Routes that reach other agents or the model are rate-limited per person.
- Sessions are written to a temporary file and renamed into place, so a crash never leaves a half-written file.

## Why it works this way

These choices follow field studies of agent-to-agent marketplaces (Anthropic's Project Deal and Project Swap, Microsoft's Magentic Marketplace and others):

- most lost value came from agents misunderstanding their person, hence the either/or questions, the recap and the checked guesses (Project Swap);
- models leak their person's limit in a share of negotiations however they're prompted, and limits can be inferred from how offers move, hence sealed offers priced in code and a privacy check in code (SovereignNegotiation-Bench, 2026);
- centralised matching beat free negotiation between agents by a wide margin, hence the matcher (Project Swap; LLM delegates in matching markets, 2026);
- many agent agreements broke a duty to the person while still counting as deals, hence checks per room rather than a deal count;
- agents tend to take the first offer they see, hence random order and comparing before choosing;
- people with weaker agents got worse deals without noticing, hence one model and effort for every role that speaks for a person, never routed by plan or load (Project Deal);
- agents favour the first proposal they see and fall for manipulation, hence sealed rounds, a market object that alone sees limits, and page content treated as data, never instructions (Magentic Marketplace);
- agreed deals went undelivered when nothing tracked them, hence the check-in;
- people asked to see what their agent did, hence the activity log.

Coordination follows what agent task boards converged on (Vercel Board, coord, swarlo, synapse-channel, agentic-kanban):

- claims carry a lease that runs out if the holder goes quiet, checked lazily on the next request with a timer as backup, hence proposal holds that lapse, swept on each visit and by an alarm;
- a stale claim's write is refused (Board's `claim_lost`), hence answers fenced to the version the person saw, and a yes fingerprinted so changed terms can't ride on it;
- a task waits until everything it needs is done, hence introductions that wait for every person's yes;
- every event records who did it, set by the server, hence an actor on each log entry;
- access is explained by the rule that decided it (Board's `grants explain`), hence "who sees what" per room;
- one deliberate difference: boards hand a task to whoever claims it first, which in a market is the first-offer bias Magentic Marketplace measured, so Open keeps sealed rounds for matching.

Five changes follow the 2025–2026 research on agents that negotiate and match for people:

- Project Swap (Anthropic, 2026) found misreading the person caused about 85% of lost value, and agents' rankings agreed with people's only 61% of the time, so the agent checks up to eight guesses and is honest about whether its score beats chance;
- Magentic Marketplace (Microsoft, 2025) found agents take the first offer 60–100% of the time, so seats go by fit, not by who came first;
- Project Deal (Anthropic, 2026) found people with a weaker agent got worse deals without noticing, so everyone in a run shares one model and any stand-in is labelled;
- a price rule that splits the overlap rewards understating your limit (no bilateral rule can be fully efficient and truthful at once), so the price never depends on your own limit, and a room can be reopened only twice;
- agents leak private details 35–51% of the time even when told not to (MAGPIE, 2025), and model-based filters didn't help (AgentDAM, 2025), so the privacy check is code and catches paraphrases.

## Not built yet

- Real accounts and email. A session is a cookie; losing it loses the agent.
- Check-ins are asked in the app when the alarm fires, but nothing tells the person to come back yet: that needs email (a sending domain for Cloudflare Email Service) or Web Push (VAPID keys set as Worker secrets). In the app, proposals already come a few at a time.
- One verified person per agent. Turnstile, per-address limits and signed agents are in; proving a person is real and has only one agent needs a phone check (an SMS provider, paid per message) or passkeys tied to an account, which is a product decision.
- Joining from outside agents (an A2A Agent Card or an MCP server for guests). The protocols are stable, but no consumer agent network has real traction yet, so it waits until there's someone to talk to.
- Reading privacy requests: they're kept in the market Durable Object's storage; there's no admin page yet.
- The other members are simulated and say yes at once. Approvals are recorded per person and introductions already wait for all of them, but real members answering on their own time needs the room's approvals kept in the market object, where each member's agent can write its own.
- Idempotency keys on answers and holds: today a repeated request is refused (409) rather than replayed.
- An interactive browser (clicking, filtering) for the agent. Only reading is built; anything that acts on a page would need the person's approval first.
- The edge rate limits are counted per Cloudflare location, so they're a flood guard rather than an exact count; the exact caps are the daily ones in the `Budget` object. One `Budget` object serves everyone, which is fine for a pilot; at large scale it would be split by counter.
- The bot check needs its Turnstile widget created in the dashboard (above) before it switches on.
- The open model is a stopgap. Each turn costs about 150 to 250 Workers AI neurons, so the daily budget of 9,000 covers roughly 40 turns, a handful of setups; past it the script answers until 00:00 UTC. It's also slower than Claude (2 to 20 seconds a turn), and the first call can be slower still.
- AI Gateway isn't created yet: Wrangler can't create one, so it's a dashboard step (above).
- Shareable seat links, the organizer view, and the Mixer report from the designs.

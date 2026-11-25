# Open web app

The pilot experience from the v3 designs: a landing page, a conversational setup where your agent learns what you'd be open to, and a live view of your agent negotiating with other people's agents, with the reason for every move.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

With no Claude credentials set, the app runs a **demo agent**: a scripted interviewer and scripted negotiation messages. The header shows "DEMO AGENT" so nobody mistakes it for the real thing. To use Claude:

```bash
export ANTHROPIC_API_KEY=...   # then restart npm run dev
```

`OPEN_AGENT_MODE=claude|demo` forces a mode. `OPEN_PACE=0.3` speeds up the live negotiation (0 turns pauses off).

## How it works

| Piece | Where | What it does |
| --- | --- | --- |
| Setup conversation | `src/server/intake/` | Claude (`claude-opus-5-5`) interviews the person and acts through tools: `show_choices` and `ask_number` render tappable options and sliders in the chat, `save_intent` records each intent as **stated** or **inferred** (inferred ones wait for the person to confirm), and `mark_ready` unlocks sending the agent out. Replies stream token by token. |
| Negotiation | `src/server/negotiation/` | A deterministic engine finds matching members, checks times and price units, opens a group **room** when a group rate makes a deal possible, and runs concession bargaining in which each agent only knows its own limit. Claude then writes each message and a one-line **why** for the person. It never decides amounts, so your agent can't cross your limit. |
| Other members | `src/server/population.ts` | A made-up Lisbon pilot (Diego the Spanish tutor, Lena, Joana, Marco who wants a bike, and others). Swap in real members once the intake collects them. |
| Sessions | `.data/sessions/` | One JSON file per person, keyed by an httpOnly cookie. Gitignored: it holds real answers. |

The browser only ever sees its own session: no model history and no other member's limits.

```bash
npm test               # engine, profile and demo-agent tests
npx tsc --noEmit
npm run lint
npm run build
```

## Not built yet

- Real accounts, email and a database. Sessions live on local disk, so this runs locally or on a single server, not on serverless hosting.
- The other members are simulated. Their agents follow the same bargaining rules, but nobody real approves their side.
- Shareable seat links, the organizer view, and the Mixer report from the designs.

# Open Agent Lab

A simulation harness for the one question that decides whether Open is worth building:

> Do dynamic multi-party rooms find **feasible** arrangements that bilateral agent negotiation misses?

It runs three engines against the same population and lets a deterministic checker, not the agents, decide what's feasible.

## Run it

```bash
npm install
npm run lab                          # human-readable report on fixtures/founding-cohort.json
npm run lab -- path/to/population.json
npm run lab -- --json                # full results, including negotiation transcripts
npm test
npm run typecheck
```

## How it works

```
population.json ──► engine ──► proposals ──► feasibility checker ──► ledger ──► report
 (principals,        A/B/C                    (sees every private      (no double-booking
  intents, private                             limit; the only judge)   across proposals)
  limits, mandates)
```

| Engine | What it does |
| --- | --- |
| **A · similarity** | Conventional matching: pairs each seek with the most similar offer text (TF-IDF) at the provider's floor. No negotiation, blind to blockers. |
| **B · bilateral** | Two agents negotiate, as in Index or Yume. A seeker's agent declines anything blocked. |
| **C · rooms** | Opens a room per seek and matching offer. For each blocker, opens a **seat**, pools what members will fund (the provider's incentive budget first, then the seeker's contribution) and negotiates with whoever can fill it. Unfillable seats are reported as invite opportunities. |

Agents only see their own principal's private limit (`reservationPrice`, `maxContribution`, `incentiveBudget`). The negotiation runtime only sees their offers. Today's agents follow a scripted concession strategy, which keeps runs deterministic and free.

The checker (`src/feasibility.ts`) enforces tag fit, matching price basis (one-off, per hour, per month), provider floors, payer entitlement and spending limits, blocker resolution, capacity, weekly hours and mandates. The ledger then rejects proposals that reuse an already-committed seek, capacity, hours or budget.

## Population format

See `fixtures/founding-cohort.json` and the zod schema in `src/domain.ts`. Each intent has a `direction` (seek/offer), a `tag` from a shared vocabulary, a natural-language `summary`, private limits with a `priceBasis`, optional `blockers` (each naming the tag that `resolvedBy` would remove it) and a `mandate`. Set `"synthetic": false` for populations built from real participants. The report labels them.

## Collecting real intents: the intake

The intake is a local web page where Claude interviews a participant about what they'd be open to, what they could offer, their rough limits and what's stopping them. It then turns the conversation into intents. The participant reviews every item, edits or drops it, and only what they confirm is saved.

It needs Claude credentials: either export `ANTHROPIC_API_KEY`, or run `ant auth login` once so the SDK picks up the profile. Neither is set up on this machine yet.

```bash
export ANTHROPIC_API_KEY=...   # or: ant auth login
npm run intake                 # http://127.0.0.1:4319 (PORT to change)
```

Run interviews in person or over a screen share. The server listens on localhost only, so it isn't yet a link you can send people.

Each interview is saved as `data/intake/<id>.json`, with the transcript, Claude's extraction and the confirmed intents. `data/` is gitignored because this repo is public. Don't commit it, and delete it when the pilot ends.

When you have enough confirmed interviews:

```bash
npm run intake:export          # writes data/population.json and prints seek/offer counts per tag
npm run lab -- data/population.json
```

The export flags every tag that someone seeks but nobody offers. That's the first read on whether the group is complementary, before any engine runs. Tags are reused across interviews (Claude sees the confirmed vocabulary and participants can edit them), but check the export for near-duplicates such as `ux-feedback` and `product-feedback` and merge them by hand.

Interviews use `claude-opus-5-5` with server-side refusal fallback enabled (`fallbacks: "default"`), and structured outputs for the extraction.

## Read results with care

The bundled fixture was **written by hand to exercise each mechanism**, including the brief's three-party CRM migration. That rooms beat bilateral on it is a smoke test, not evidence. Real evidence starts when the population comes from real elicited intents (step 2 of the plan). Watch the reverse column too ("met by bilateral but not rooms"), because rooms can crowd out simpler deals.

## Not built yet

- **LLM agents.** Agent policies for negotiation, plus LLM hypothesis generation for rooms that the patterns can't express. They plug in behind `NegotiatingAgent` and `Engine`.
- **Retrieval beyond exact tags,** using embeddings over summaries.
- **Index as Baseline B,** via an adapter that runs the open-source Index stack in place of the built-in bilateral engine.
- **Collective-purchase and composite/team room patterns.**
- **Platform fee, surplus and negotiation-quality metrics,** human approval simulation, and proposal versioning.

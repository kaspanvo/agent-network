# Village Agent Lab

A simulation harness for the one question that decides whether Village is worth building:

> Do dynamic multi-party rooms find **feasible** arrangements that bilateral agent negotiation misses?

It runs three engines against the same population and lets a deterministic checker, not the agents, decide what's feasible.

## Run it

```bash
npm install
npm run lab                          # human-readable report on fixtures/founding-village.json
npm run lab -- path/to/population.json
npm run lab -- --json                # full results, including negotiation transcripts
npm test
npm run typecheck
```

## How it works

```
population.json ──► engine ──► proposals ──► feasibility checker ──► ledger ──► report
 (principals,        A/B/Village              (sees every private      (no double-booking
  intents, private                             limit; the only judge)   across proposals)
  limits, mandates)
```

| Engine | What it does |
| --- | --- |
| **A · similarity** | Conventional matching: pairs each seek with the most similar offer text (TF-IDF) at the provider's floor. No negotiation, blind to blockers. |
| **B · bilateral** | Two agents negotiate, as in Index or Yume. A seeker's agent declines anything blocked. |
| **Village · rooms** | Opens a room per seek and matching offer. For each blocker, opens a **seat**, pools what members will fund (the provider's incentive budget first, then the seeker's contribution) and negotiates with whoever can fill it. Unfillable seats are reported as invite opportunities. |

Agents only see their own principal's private limit (`reservationPrice`, `maxContribution`, `incentiveBudget`). The negotiation runtime only sees their offers. Today's agents follow a scripted concession strategy, which keeps runs deterministic and free.

The checker (`src/feasibility.ts`) enforces tag fit, provider floors, payer entitlement and spending limits, blocker resolution, capacity, weekly hours and mandates. The ledger then rejects proposals that reuse an already-committed seek, capacity, hours or budget.

## Population format

See `fixtures/founding-village.json` and the zod schema in `src/domain.ts`. Each intent has a `direction` (seek/offer), a `tag` from a shared vocabulary, a natural-language `summary`, private limits, optional `blockers` (each naming the tag that `resolvedBy` would remove it) and a `mandate`. Set `"synthetic": false` for populations built from real participants. The report labels them.

## Read results with care

The bundled fixture was **written by hand to exercise each mechanism**, including the brief's three-party CRM migration. That Village beats bilateral on it is a smoke test, not evidence. Real evidence starts when the population comes from real elicited intents (step 2 of the plan). Watch the reverse column too ("met by bilateral but not Village"), because rooms can crowd out simpler deals.

## Not built yet

- **LLM agents.** Agent policies for negotiation, plus LLM hypothesis generation for rooms that the patterns can't express. They plug in behind `NegotiatingAgent` and `Engine`.
- **Retrieval beyond exact tags,** using embeddings over summaries.
- **Index as Baseline B,** via an adapter that runs the open-source Index stack in place of the built-in bilateral engine.
- **Collective-purchase and composite/team room patterns.**
- **Platform fee, surplus and negotiation-quality metrics,** human approval simulation, and proposal versioning.

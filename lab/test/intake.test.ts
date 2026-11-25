import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExperiment, summarize } from "../src/experiment";
import type { IntakeModel } from "../src/intake/claude";
import { buildPopulation, tagCoverage } from "../src/intake/population";
import type { Extraction, Session } from "../src/intake/schema";
import { createIntakeServer } from "../src/intake/server";
import { SessionStore } from "../src/intake/store";
import { indexPopulation } from "../src/population";

const extraction: Extraction = {
  hoursPerWeek: 4,
  intents: [
    {
      direction: "offer",
      status: "conditional",
      summary: "I could do small data migrations on weekends.",
      tag: "data-migration",
      reservationPrice: 90,
      priceBasis: "one-off",
      hours: 4,
      incentiveBudget: null,
      blockers: [],
      evidence: "I could take on a migration over a weekend",
    },
  ],
  openQuestions: [],
};

function stubModel(options: { failReplies?: boolean } = {}) {
  const calls = { replies: 0, vocabularies: [] as string[][] };
  const model: IntakeModel = {
    async reply() {
      if (options.failReplies) throw new Error("model unavailable");
      calls.replies++;
      return `Question ${calls.replies}?`;
    },
    async extract(_participant, _transcript, vocabulary) {
      calls.vocabularies.push(vocabulary);
      return extraction;
    },
  };
  return { model, calls };
}

let dir: string;
let store: SessionStore;
let server: Server | undefined;

async function start(model: IntakeModel): Promise<string> {
  server = createIntakeServer({ model, store });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

const migrationIntent = (overrides: Record<string, unknown> = {}) => ({
  direction: "offer",
  status: "conditional",
  summary: "I could do small data migrations on weekends.",
  tag: "  Data Migration ",
  reservationPrice: 90,
  hours: 4,
  evidence: "I could take on a migration over a weekend",
  ...overrides,
});

async function interviewUntilReview(base: string, name = "Sam"): Promise<Session> {
  const created = await call(base, "POST", "/api/sessions", { name, kind: "person", consent: true });
  const id = created.data.id;
  await call(base, "POST", `/api/sessions/${id}/messages`, { text: "I'm a backend engineer." });
  await call(base, "POST", `/api/sessions/${id}/messages`, { text: "I'd do a weekend migration for about $90." });
  return (await call(base, "POST", `/api/sessions/${id}/extract`)).data;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open-intake-"));
  store = new SessionStore(dir);
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("intake server", () => {
  it("runs an interview from consent through confirmation", async () => {
    const base = await start(stubModel().model);

    const created = await call(base, "POST", "/api/sessions", { name: " Sam ", kind: "person", consent: true });
    expect(created.status).toBe(201);
    expect(created.data.participant).toEqual({ name: "Sam", kind: "person" });
    expect(created.data.transcript).toEqual([
      { role: "participant", text: "Hi, I'm Sam." },
      { role: "interviewer", text: "Question 1?" },
    ]);

    const id = created.data.id;
    const replied = await call(base, "POST", `/api/sessions/${id}/messages`, { text: "I'm a backend engineer." });
    expect(replied.data.transcript.at(-1)).toEqual({ role: "interviewer", text: "Question 2?" });

    const reviewed = await call(base, "POST", `/api/sessions/${id}/extract`);
    expect(reviewed.data.status).toBe("reviewing");
    expect(reviewed.data.extraction).toEqual(extraction);

    const confirmed = await call(base, "POST", `/api/sessions/${id}/confirm`, { hoursPerWeek: 4, intents: [migrationIntent()] });
    expect(confirmed.status).toBe(200);
    expect(confirmed.data.status).toBe("confirmed");
    expect(confirmed.data.confirmed.intents[0]).toMatchObject({ tag: "data-migration", mandate: { mayNegotiate: true } });

    expect((await call(base, "GET", `/api/sessions/${id}`)).data).toEqual(confirmed.data);
    expect((await call(base, "POST", `/api/sessions/${id}/messages`, { text: "One more thing" })).status).toBe(409);
  });

  it("refuses to start without consent", async () => {
    const base = await start(stubModel().model);
    const res = await call(base, "POST", "/api/sessions", { name: "Sam", kind: "person", consent: false });
    expect(res.status).toBe(400);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("returns 404 for unknown or malformed interview ids", async () => {
    const base = await start(stubModel().model);
    for (const id of ["not-an-id", "00000000-0000-4000-8000-000000000000", "..%2F..%2Fpackage"])
      expect((await call(base, "GET", `/api/sessions/${id}`)).status).toBe(404);
  });

  it("saves nothing when the model call fails", async () => {
    const base = await start(stubModel({ failReplies: true }).model);
    const res = await call(base, "POST", "/api/sessions", { name: "Sam", kind: "person", consent: true });
    expect(res.status).toBe(502);
    expect(res.data.error).toBe("model unavailable");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("only confirms after review, and only with a price", async () => {
    const base = await start(stubModel().model);
    const created = await call(base, "POST", "/api/sessions", { name: "Sam", kind: "person", consent: true });
    const early = await call(base, "POST", `/api/sessions/${created.data.id}/confirm`, { hoursPerWeek: 0, intents: [migrationIntent()] });
    expect(early.status).toBe(409);

    await call(base, "POST", `/api/sessions/${created.data.id}/extract`);
    const unpriced = await call(base, "POST", `/api/sessions/${created.data.id}/confirm`, {
      hoursPerWeek: 0,
      intents: [migrationIntent({ reservationPrice: undefined })],
    });
    expect(unpriced.status).toBe(400);
  });

  it("passes confirmed tags to later extractions so participants can match", async () => {
    const { model, calls } = stubModel();
    const base = await start(model);

    const first = await interviewUntilReview(base, "Sam");
    await call(base, "POST", `/api/sessions/${first.id}/confirm`, {
      hoursPerWeek: 4,
      intents: [
        migrationIntent(),
        {
          direction: "seek",
          status: "dormant",
          summary: "A cheaper CRM, if someone moved my data.",
          tag: "crm-software",
          reservationPrice: 50,
          priceBasis: "per-month",
          blockers: [{ description: "Moving the data", resolvedBy: "Data Migration", maxContribution: 0 }],
          evidence: "if someone moved my data",
        },
      ],
    });
    await interviewUntilReview(base, "Priya");

    expect(calls.vocabularies).toEqual([[], ["crm-software", "data-migration"]]);
  });
});

describe("buildPopulation", () => {
  const session = (id: string, name: string, intents: NonNullable<Session["confirmed"]>["intents"] | null): Session => ({
    id,
    createdAt: "2026-11-25T10:00:00.000Z",
    consentedAt: "2026-11-25T10:00:00.000Z",
    participant: { name, kind: "person" },
    status: intents ? "confirmed" : "reviewing",
    transcript: [],
    extraction: null,
    confirmed: intents ? { at: "2026-11-25T10:10:00.000Z", hoursPerWeek: 2, intents } : null,
  });
  const intent = (direction: "seek" | "offer", reservationPrice: number) => ({
    direction,
    status: "conditional" as const,
    summary: `${direction} feedback`,
    tag: "product-feedback",
    reservationPrice,
    priceBasis: "one-off" as const,
    hours: direction === "offer" ? 1 : 0,
    capacity: 1,
    incentiveBudget: 0,
    blockers: [],
    mandate: { mayNegotiate: true, mayJoinMultiParty: true },
    evidence: "a quote",
  });

  it("turns confirmed interviews into a real population the lab can run", () => {
    const population = buildPopulation(
      [
        session("aaaaaaaa-0000-4000-8000-000000000000", "Nova", [intent("seek", 60)]),
        session("bbbbbbbb-0000-4000-8000-000000000000", "Priya", [intent("offer", 40)]),
        session("cccccccc-0000-4000-8000-000000000000", "Unconfirmed", null),
      ],
      "test-intake",
    );

    expect(population.synthetic).toBe(false);
    expect(population.principals.map((p) => p.id)).toEqual(["p-aaaaaaaa", "p-bbbbbbbb"]);
    expect(population.intents.map((i) => i.id)).toEqual(["p-aaaaaaaa-1", "p-bbbbbbbb-1"]);
    expect(population.intents[0]).not.toHaveProperty("evidence");
    expect(tagCoverage(population)).toEqual([{ tag: "product-feedback", seeks: 1, offers: 1 }]);

    const idx = indexPopulation(population);
    const bilateral = runExperiment(idx).find((r) => r.engine === "B · bilateral")!;
    expect(summarize(bilateral, idx).seeksMet).toEqual(["p-aaaaaaaa-1"]);
  });
});

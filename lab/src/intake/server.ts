import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { IntakeModel } from "./claude";
import { openingMessage } from "./prompts";
import { ConfirmBody, MessageBody, normalizeTag, StartBody, type ConfirmedIntent, type Session } from "./schema";
import type { SessionStore } from "./store";

const MAX_BODY_BYTES = 64 * 1024;

const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: string, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
  });
  res.end(body);
}

async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

function cleanIntent(intent: ConfirmedIntent): ConfirmedIntent {
  const tag = normalizeTag(intent.tag);
  if (!tag) throw new HttpError(400, `"${intent.summary}" needs a category.`);
  const blockers =
    intent.direction === "seek"
      ? intent.blockers.map((b) => {
          const resolvedBy = normalizeTag(b.resolvedBy);
          if (!resolvedBy) throw new HttpError(400, `Blocker "${b.description}" needs to say what would solve it.`);
          return { ...b, resolvedBy };
        })
      : [];
  return {
    ...intent,
    tag,
    blockers,
    incentiveBudget: intent.direction === "offer" ? intent.incentiveBudget : 0,
    mandate: { ...intent.mandate, mayNegotiate: true },
  };
}

export function createIntakeServer({ model, store }: { model: IntakeModel; store: SessionStore }): Server {
  const publicDir = new URL("./public/", import.meta.url);
  const assets = Object.fromEntries(
    Object.entries(STATIC).map(([path, { file, type }]) => [path, { body: readFileSync(fileURLToPath(new URL(file, publicDir)), "utf8"), type }]),
  );

  function load(id: string): Session {
    const session = store.get(id);
    if (!session) throw new HttpError(404, "Interview not found.");
    return session;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const asset = assets[pathname];
    if (req.method === "GET" && asset) return send(res, 200, asset.body, asset.type);

    if (req.method === "POST" && pathname === "/api/sessions") {
      const { name, kind } = await readJson(req, StartBody);
      const now = new Date().toISOString();
      const participant = { name, kind };
      const session: Session = {
        id: randomUUID(),
        createdAt: now,
        consentedAt: now,
        participant,
        status: "interviewing",
        transcript: [{ role: "participant", text: openingMessage(participant) }],
        extraction: null,
        confirmed: null,
      };
      // Saved only once the reply arrives, so a failed call leaves nothing half-written.
      session.transcript.push({ role: "interviewer", text: await model.reply(participant, session.transcript) });
      store.save(session);
      return send(res, 201, JSON.stringify(session));
    }

    const match = /^\/api\/sessions\/([^/]+)(?:\/(messages|extract|confirm))?$/.exec(pathname);
    if (!match) throw new HttpError(404, "Not found.");
    const [, id, action] = match;

    if (req.method === "GET" && !action) return send(res, 200, JSON.stringify(load(id!)));
    if (req.method !== "POST" || !action) throw new HttpError(405, "Method not allowed.");

    const session = load(id!);
    if (session.status === "confirmed") throw new HttpError(409, "This interview is already confirmed.");

    if (action === "messages") {
      const { text } = await readJson(req, MessageBody);
      session.status = "interviewing";
      session.transcript.push({ role: "participant", text });
      session.transcript.push({ role: "interviewer", text: await model.reply(session.participant, session.transcript) });
      store.save(session);
      return send(res, 200, JSON.stringify(session));
    }

    if (action === "extract") {
      session.extraction = await model.extract(session.participant, session.transcript, store.vocabulary());
      session.status = "reviewing";
      store.save(session);
      return send(res, 200, JSON.stringify(session));
    }

    if (session.status !== "reviewing") throw new HttpError(409, "Review your answers before confirming.");
    const body = await readJson(req, ConfirmBody);
    session.confirmed = { at: new Date().toISOString(), hoursPerWeek: body.hoursPerWeek, intents: body.intents.map(cleanIntent) };
    session.status = "confirmed";
    store.save(session);
    return send(res, 200, JSON.stringify(session));
  }

  return createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, JSON.stringify({ error: err.message }));
      console.error(err);
      send(res, 502, JSON.stringify({ error: err instanceof Error ? err.message : "Something went wrong." }));
    });
  });
}

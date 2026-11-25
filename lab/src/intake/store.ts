import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Session } from "./schema";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSessionId(id: string): boolean {
  return SESSION_ID.test(id);
}

// One JSON file per session, readable only by the current user. Holds real people's answers: keep it out of git.
export class SessionStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  save(session: Session): void {
    writeFileSync(join(this.dir, `${session.id}.json`), JSON.stringify(session, null, 2), { mode: 0o600 });
  }

  get(id: string): Session | undefined {
    if (!isSessionId(id)) return undefined;
    try {
      return Session.parse(JSON.parse(readFileSync(join(this.dir, `${id}.json`), "utf8")));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  list(): Session[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && isSessionId(f.slice(0, -5)))
      .map((f) => this.get(f.slice(0, -5))!)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Tags participants have already confirmed, so new extractions reuse them and intents can match.
  vocabulary(): string[] {
    const tags = new Set<string>();
    for (const s of this.list())
      for (const i of s.confirmed?.intents ?? []) {
        tags.add(i.tag);
        for (const b of i.blockers) tags.add(b.resolvedBy);
      }
    return [...tags].sort();
  }
}

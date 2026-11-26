import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSessionId, upgradeSession, type Session } from "../store";

// Local development keeps each person's session in a file. Cloudflare keeps it in the person's Durable Object.
const DATA_DIR = join(process.cwd(), ".data", "sessions");

export function loadSession(id: string | undefined): Session | undefined {
  if (!isSessionId(id)) return undefined;
  try {
    return upgradeSession(JSON.parse(readFileSync(join(DATA_DIR, `${id}.json`), "utf8")) as Session);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

// Writes to a temporary file and renames it into place, so a crash mid-write never leaves a half-written session.
export function saveSession(session: Session): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = join(DATA_DIR, `${session.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(session), { mode: 0o600 });
  renameSync(temp, file);
}

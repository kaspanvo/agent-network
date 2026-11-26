import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expired } from "../privacy";
import { isSessionId, upgradeSession, type Session } from "../store";

// Local development keeps each person's session in a file. Cloudflare keeps it in the person's Durable Object.
const DATA_DIR = join(process.cwd(), ".data", "sessions");

export function loadSession(id: string | undefined): Session | undefined {
  if (!isSessionId(id)) return undefined;
  try {
    const session = upgradeSession(JSON.parse(readFileSync(join(DATA_DIR, `${id}.json`), "utf8")) as Session);
    // Past its keep-until date: deleted, as on Cloudflare.
    if (expired(session)) {
      deleteSession(id);
      return undefined;
    }
    return session;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export function deleteSession(id: string): void {
  if (isSessionId(id)) rmSync(join(DATA_DIR, `${id}.json`), { force: true });
}

// Writes to a temporary file and renames it into place, so a crash mid-write never leaves a half-written session.
export function saveSession(session: Session): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = join(DATA_DIR, `${session.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(session), { mode: 0o600 });
  renameSync(temp, file);
}

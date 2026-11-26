import { DurableObject } from "cloudflare:workers";
import { today, type Counter } from "../src/server/limits";

// The service's daily counters (neurons, Claude calls, page reads, new sessions, new sessions per address) in one
// Durable Object, so every person's agent checks the same totals. Requests to it run one at a time, so a take()
// can't be raced past its limit. Everything resets at 00:00 UTC; yesterday's rows are dropped on the first use of a new day.
export class Budget extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, name TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (day, name))");
  }

  private current(name: string, day: string): number {
    const row = this.ctx.storage.sql.exec<{ value: number }>("SELECT value FROM counts WHERE day = ? AND name = ?", day, name).toArray()[0];
    return row?.value ?? 0;
  }

  private write(name: string, day: string, value: number) {
    this.ctx.storage.sql.exec("DELETE FROM counts WHERE day < ?", day);
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO counts (day, name, value) VALUES (?, ?, ?)", day, name, value);
  }

  async take(name: string, limit: number, amount = 1): Promise<boolean> {
    const day = today();
    const next = this.current(name, day) + amount;
    if (next > limit) return false;
    this.write(name, day, next);
    return true;
  }

  async add(name: string, amount: number): Promise<number> {
    const day = today();
    const next = this.current(name, day) + amount;
    this.write(name, day, next);
    return next;
  }

  async used(name: string): Promise<number> {
    return this.current(name, today());
  }
}

// The Counter the shared code uses, backed by the one global Budget object.
export function budgetCounter(namespace: DurableObjectNamespace<Budget>): Counter {
  const stub = namespace.getByName("global");
  return {
    take: (name, limit, amount) => stub.take(name, limit, amount),
    add: (name, amount) => stub.add(name, amount),
    used: (name) => stub.used(name),
  };
}

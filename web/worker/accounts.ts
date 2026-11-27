import { DurableObject } from "cloudflare:workers";

// Which agent an account owns: one small object per account, named by the account's id. It holds nothing else.
export class AccountDirectory extends DurableObject<Env> {
  async get(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("agent")) ?? null;
  }

  async set(agentId: string): Promise<void> {
    await this.ctx.storage.put("agent", agentId);
  }

  // Called when the saved agent is deleted, so the account starts fresh next time.
  async clear(agentId: string): Promise<void> {
    if ((await this.ctx.storage.get<string>("agent")) === agentId) await this.ctx.storage.delete("agent");
  }
}

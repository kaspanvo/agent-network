import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { formatPrice } from "../domain";
import { listWords } from "./plan";
import type { ThreadPlan } from "./types";

export type Line = { text: string; why: string };

export interface Narrator {
  // One line per move: what the agent said, and why, written for the person using the app.
  narrate(thread: ThreadPlan, you: string): Promise<Line[]>;
}

export function scriptedLines(thread: ThreadPlan, you: string): Line[] {
  const { counterpart, unit, limit, direction, moves, room } = thread;
  const them = counterpart.name;
  const word = direction === "seek" ? "limit" : "floor";
  const fmt = (n: number) => formatPrice(n, unit);
  const subject = thread.intentSummary.toLowerCase();
  const roomNames = listWords(room.map((r) => r.name));
  let prevYours: number | null = null;
  let prevTheirs: number | null = null;

  return moves.map((move, i) => {
    const amount = move.amount ?? 0;
    let line: Line;
    if (move.action === "DECLINE") {
      line = { text: `Thanks, but that doesn't work for ${you}.`, why: `No price worked for both sides within your ${fmt(limit)} ${word}, so your agent walks away politely.` };
    } else if (move.action === "ACCEPT") {
      line =
        move.from === "you"
          ? { text: `Agreed at ${fmt(amount)}.`, why: `${fmt(amount)} is within your ${fmt(limit)} ${word}, so your agent accepts. You still have the final say.` }
          : { text: `${fmt(amount)} works for ${them}.`, why: `${them}'s agent accepted your agent's offer, which is within your ${word}.` };
    } else if (move.from === "you") {
      if (i === 0 && thread.kind === "group")
        line = {
          text: `There are three of us who'd like ${subject}: ${you}, ${roomNames}. Would ${fmt(amount)} each work?`,
          why: `One-to-one is above your ${fmt(limit)} ${word}, but ${them} teaches small groups and ${roomNames} want the same, so your agent asks for a group rate.`,
        };
      else if (i === 0)
        line =
          direction === "seek"
            ? { text: `${you} is interested in ${subject}. Would ${fmt(amount)} work?`, why: `Opening below your ${fmt(limit)} ${word} leaves room to meet in the middle.` }
            : { text: `${you} is open to this: ${subject}. Asking ${fmt(amount)}.`, why: `Opening above your ${fmt(limit)} ${word} leaves room to meet in the middle.` };
      else
        line = {
          text: `How about ${fmt(amount)}?`,
          why: `Your agent moves ${fmt(Math.abs(amount - (prevYours ?? amount)))} toward them and stays within your ${fmt(limit)} ${word}.`,
        };
      prevYours = amount;
    } else {
      const moved = prevTheirs === null ? null : Math.abs(amount - prevTheirs);
      line = {
        text: `${them} can do ${fmt(amount)}.`,
        why:
          moved === null
            ? `${them}'s agent's opening position. Your agent keeps going.`
            : `They moved ${fmt(moved)} from their last offer, a sign there's room to agree.`,
      };
      prevTheirs = amount;
    }
    return line;
  });
}

export const scriptedNarrator: Narrator = {
  async narrate(thread, you) {
    return scriptedLines(thread, you);
  },
};

const Lines = z.object({ lines: z.array(z.object({ text: z.string(), why: z.string() })) });

const NARRATOR_PROMPT = `You write the messages of a negotiation between two personal agents on Open, a network where agents find and negotiate opportunities for their people. The moves and amounts are already decided by the negotiation engine; you only put them into words.

For each move, return:
- text: what the speaking agent said to the other agent. Under 25 words, polite and plain. Use the exact amount given. Your agent never reveals its person's limit or floor.
- why: one sentence under 25 words for the person using the app, explaining why this move makes sense from their agent's side. It may mention their limit. For the other side's moves, say what your agent reads into them. Never guess the other side's limit.

Return exactly one line per move, in order. Use only the facts given. No markdown.`;

export function claudeNarrator(client: Anthropic = new Anthropic()): Narrator {
  return {
    async narrate(thread, you) {
      const facts = {
        you,
        your_side: thread.direction === "seek" ? "buyer" : "seller",
        your_private_limit: formatPrice(thread.limit, thread.unit),
        what: thread.intentSummary,
        other_agent_represents: `${thread.counterpart.name}: ${thread.counterpart.blurb}`,
        group_room: thread.kind === "group" ? { members: [you, ...thread.room.map((r) => r.name)], note: `${thread.counterpart.name} offers a lower price per person for a group` } : null,
        moves: thread.moves.map((m) => ({ speaker: m.from === "you" ? `${you}'s agent` : `${thread.counterpart.name}'s agent`, action: m.action, amount: m.amount === null ? null : formatPrice(m.amount, thread.unit) })),
      };
      const response = await client.beta.messages.parse({
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "low", format: betaZodOutputFormat(Lines) },
        system: NARRATOR_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
      });
      const scripted = scriptedLines(thread, you);
      const lines = response.stop_reason === "refusal" ? [] : (response.parsed_output?.lines ?? []);
      // Keep the engine's move count authoritative: any line the model didn't return falls back to the script.
      return thread.moves.map((_, i) => lines[i] ?? scripted[i]!);
    },
  };
}

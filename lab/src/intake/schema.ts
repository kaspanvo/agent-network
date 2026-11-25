import { z } from "zod";
import { Intent } from "../domain";

export const Participant = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["person", "business"]),
});

export const Turn = z.object({
  role: z.enum(["participant", "interviewer"]),
  text: z.string(),
});

// What the model extracts from a transcript. Every field is required (nullable where unknown) to fit structured outputs.
export const ExtractedIntent = z.object({
  direction: z.enum(["seek", "offer"]),
  status: z.enum(["active", "standing", "conditional", "dormant"]),
  summary: z.string(),
  tag: z.string(),
  reservationPrice: z.number().nullable(),
  priceBasis: z.enum(["one-off", "per-hour", "per-month"]),
  hours: z.number().nullable(),
  incentiveBudget: z.number().nullable(),
  blockers: z.array(
    z.object({
      description: z.string(),
      resolvedBy: z.string(),
      maxContribution: z.number().nullable(),
    }),
  ),
  evidence: z.string(),
});

export const Extraction = z.object({
  hoursPerWeek: z.number().nullable(),
  intents: z.array(ExtractedIntent),
  openQuestions: z.array(z.string()),
});

// A lab-ready intent as the participant confirmed it, plus the quote it came from.
export const ConfirmedIntent = Intent.omit({ id: true, principalId: true }).extend({
  evidence: z.string().default(""),
});

export const Session = z.object({
  id: z.string(),
  createdAt: z.string(),
  consentedAt: z.string(),
  participant: Participant,
  status: z.enum(["interviewing", "reviewing", "confirmed"]),
  transcript: z.array(Turn),
  extraction: Extraction.nullable(),
  confirmed: z
    .object({
      at: z.string(),
      hoursPerWeek: z.number().nonnegative(),
      intents: z.array(ConfirmedIntent),
    })
    .nullable(),
});

export const StartBody = Participant.extend({ consent: z.literal(true) });
export const MessageBody = z.object({ text: z.string().trim().min(1).max(4000) });
export const ConfirmBody = z.object({
  hoursPerWeek: z.number().nonnegative(),
  intents: z.array(ConfirmedIntent),
});

export type Participant = z.infer<typeof Participant>;
export type Turn = z.infer<typeof Turn>;
export type Extraction = z.infer<typeof Extraction>;
export type ConfirmedIntent = z.infer<typeof ConfirmedIntent>;
export type Session = z.infer<typeof Session>;

export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

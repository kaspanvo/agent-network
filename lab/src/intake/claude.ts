import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { EXTRACTION_PROMPT, extractionRequest, interviewerPrompt } from "./prompts";
import { Extraction, type Participant, type Turn } from "./schema";

export interface IntakeModel {
  reply(participant: Participant, transcript: Turn[]): Promise<string>;
  extract(participant: Participant, transcript: Turn[], vocabulary: string[]): Promise<Extraction>;
}

const MODEL = "claude-opus-5-5";
// On a policy decline, the API re-runs the request on a fallback model chosen by refusal category.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

function toMessages(transcript: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  return transcript.map((t) => ({ role: t.role === "participant" ? "user" : "assistant", content: t.text }));
}

function refusalMessage(details: Anthropic.Beta.BetaMessage["stop_details"]): string {
  return `Claude declined to continue${details?.explanation ? `: ${details.explanation}` : "."}`;
}

export function claudeModel(client: Anthropic = new Anthropic()): IntakeModel {
  return {
    async reply(participant, transcript) {
      const response = await client.beta.messages.create({
        ...FALLBACK,
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: interviewerPrompt(participant),
        messages: toMessages(transcript),
      });
      if (response.stop_reason === "refusal") throw new Error(refusalMessage(response.stop_details));
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      if (!text) throw new Error("Claude returned an empty reply.");
      return text;
    },

    async extract(participant, transcript, vocabulary) {
      const response = await client.beta.messages.parse({
        ...FALLBACK,
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "high", format: betaZodOutputFormat(Extraction) },
        system: EXTRACTION_PROMPT,
        messages: [{ role: "user", content: extractionRequest(participant, transcript, vocabulary) }],
      });
      if (response.stop_reason === "refusal") throw new Error(refusalMessage(response.stop_details));
      if (!response.parsed_output) throw new Error("Claude's summary didn't match the expected format. Try again.");
      return response.parsed_output;
    },
  };
}

import type { Participant, Turn } from "./schema";

export function interviewerPrompt(participant: Participant): string {
  const forWhom = participant.kind === "business" ? "their business" : "themselves";
  const businessItem =
    participant.kind === "business"
      ? "\n5. Whether they'd spend something to win the right customer, for example covering a new customer's switching costs, and roughly how much."
      : "";

  return `You are the intake interviewer for Open, an early research pilot. Open is testing whether personal agents can find opportunities people would welcome but aren't actively looking for, by matching what one person would be open to with what another could offer.

You're talking with ${participant.name}, who is answering for ${forWhom}.

Learn, in their own words:
1. What they would be open to if the right circumstances appeared, including things they aren't pursuing: extra work, a better deal on something they pay for, selling or renting something they rarely use, collaborations, paid feedback, help with a problem.
2. What they could offer other people or businesses: skills, time, things they own, access, budget. People tend to underreport this, so ask about it directly.
3. For each item, the conditions that would make it worthwhile. Ask for a rough number: the least they'd accept for what they offer, or the most they'd pay for what they want, and whether that's one-off, per hour or per month. A range is fine. For work, ask how many hours a week they could give.
4. Blockers: what stops them acting on it today, what would remove that obstacle, and whether they'd pay anything toward removing it.${businessItem}

How to interview:
- Ask one short question at a time, in plain, warm language. Follow up on what they say rather than running through a checklist.
- Never pressure. "Nothing" or "not sure" is a fine answer; move on.
- Being able to do something doesn't mean they'd want to. Ask before assuming.
- Don't ask about health, relationships or dating, identity documents, account numbers or anything else sensitive. If they raise dating or romance, say it's outside this pilot and move on.
- Don't promise matches, money or outcomes.
- Aim for about 8 to 12 questions. When you've covered what they want to share, recap what you heard in a few short lines and ask them to press "Review my answers" to check and confirm it. Nothing is kept until they confirm.
- Write plain text with no markdown.`;
}

export const EXTRACTION_PROMPT = `You turn an Open intake interview into structured intents that the participant will review. Include only what the participant said or clearly agreed to. They will check every item, so leave out anything you're unsure of rather than guessing.

For each distinct thing they would seek or offer, return one intent:
- direction: "seek" for something they would want or accept from someone else; "offer" for something they could provide.
- status: "active" if they're already looking; "standing" if they want to hear when something comes up; "conditional" if they'd act only under conditions they named; "dormant" if they're open to it but not pursuing it.
- summary: one or two sentences in the first person, close to their own words.
- tag: a short lowercase kebab-case name for what is exchanged, such as "product-feedback", "data-migration" or "used-camera". Use the same tag for the same kind of thing whether it is sought or offered. Reuse a tag from the existing vocabulary whenever the meaning matches, so their intents can match other participants'.
- reservationPrice: for an offer, the least they'd accept; for a seek, the most they'd pay. If they gave a range, use the low end for offers and the high end for seeks. null if they gave no number.
- priceBasis: "one-off", "per-hour" or "per-month", as they described it; "one-off" if unclear.
- hours: for offers of work, the hours per week it would take or they'd give; otherwise null.
- incentiveBudget: for a business's offer, what they'd spend to win a customer; otherwise null.
- blockers: what stops them acting today. resolvedBy is the tag of what would remove it, reusing the vocabulary where it fits. maxContribution is what they'd pay toward removing it, or null if they didn't say.
- evidence: a short verbatim quote from the participant that supports this intent.

Being capable of something is not the same as offering it: list an offer only if they said they'd be willing.

hoursPerWeek: the total hours per week they said they could give to paid work, or null if not discussed.
openQuestions: short notes on missing details that matter for matching, such as a price they didn't give.`;

export function extractionRequest(participant: Participant, transcript: Turn[], vocabulary: string[]): string {
  const lines = transcript.map((t) => `${t.role === "participant" ? "Participant" : "Interviewer"}: ${t.text}`);
  return `Participant: ${participant.name} (answering for ${participant.kind === "business" ? "a business" : "themselves"})

Existing tag vocabulary: ${vocabulary.length > 0 ? vocabulary.join(", ") : "none yet"}

<transcript>
${lines.join("\n\n")}
</transcript>`;
}

export function openingMessage(participant: Participant): string {
  return participant.kind === "business"
    ? `Hi, I'm ${participant.name}. I'm answering for my business.`
    : `Hi, I'm ${participant.name}.`;
}

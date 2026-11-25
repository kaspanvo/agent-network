import { Population } from "./domain";

// Made-up members for the pilot demo. Every agent the user's agent meets comes from here.
export const LISBON_PILOT = Population.parse({
  name: "Lisbon pilot",
  synthetic: true,
  members: [
    { id: "diego", name: "Diego", blurb: "Native Spanish speaker who teaches small groups" },
    { id: "lena", name: "Lena", blurb: "Wants to brush up her Spanish" },
    { id: "joana", name: "Joana", blurb: "Starting Spanish from scratch" },
    { id: "lingo", name: "Lingo School", blurb: "Language school in Arroios" },
    { id: "marco", name: "Marco", blurb: "Looking for a second-hand road bike" },
    { id: "rita", name: "Rita", blurb: "Guitar teacher with free evenings" },
    { id: "tom", name: "Tom", blurb: "Has a mirrorless camera he barely uses" },
    { id: "maya", name: "Maya", blurb: "Wants a camera for a spring trip" },
    { id: "ines", name: "Inês", blurb: "Photographer who runs photo walks" },
    { id: "sofia", name: "Sofia", blurb: "Looks after dogs on weekends" },
    { id: "pedro", name: "Pedro", blurb: "Needs a weekend dog-sitter twice a month" },
    { id: "nuno", name: "Nuno", blurb: "Cook who teaches Portuguese home cooking" },
  ],
  intents: [
    { id: "diego-spanish", memberId: "diego", direction: "offer", tag: "spanish-lessons", summary: "Spanish lessons, any level", price: 25, unit: "hour", conditions: ["evenings", "weekends"], groupPrice: { size: 3, perPerson: 12 } },
    { id: "lena-spanish", memberId: "lena", direction: "seek", tag: "spanish-lessons", summary: "Spanish lessons to brush up", price: 14, unit: "hour", conditions: ["evenings"] },
    { id: "joana-spanish", memberId: "joana", direction: "seek", tag: "spanish-lessons", summary: "Beginner Spanish", price: 13, unit: "hour", conditions: ["evenings", "weekends"] },
    { id: "lingo-spanish", memberId: "lingo", direction: "offer", tag: "spanish-lessons", summary: "Beginner group course", price: 18, unit: "hour", conditions: ["mornings"] },
    { id: "marco-bike", memberId: "marco", direction: "seek", tag: "road-bike", summary: "A road bike, around 54 cm", price: 250, unit: "one-off", conditions: [] },
    { id: "rita-guitar", memberId: "rita", direction: "offer", tag: "guitar-lessons", summary: "Guitar lessons for beginners", price: 20, unit: "hour", conditions: ["evenings"] },
    { id: "tom-camera", memberId: "tom", direction: "offer", tag: "used-camera", summary: "Sony mirrorless camera, barely used", price: 550, unit: "one-off", conditions: [] },
    { id: "maya-camera", memberId: "maya", direction: "seek", tag: "used-camera", summary: "A mirrorless camera for travel", price: 700, unit: "one-off", conditions: [] },
    { id: "ines-photo", memberId: "ines", direction: "offer", tag: "photography-lessons", summary: "Photo walks around Lisbon", price: 30, unit: "hour", conditions: ["weekends"] },
    { id: "sofia-dogs", memberId: "sofia", direction: "offer", tag: "dog-sitting", summary: "Weekend dog-sitting at her flat", price: 25, unit: "one-off", conditions: ["weekends"] },
    { id: "pedro-dogs", memberId: "pedro", direction: "seek", tag: "dog-sitting", summary: "A sitter for a calm labrador", price: 35, unit: "one-off", conditions: ["weekends"] },
    { id: "nuno-cooking", memberId: "nuno", direction: "offer", tag: "cooking-lessons", summary: "Portuguese home cooking, small groups", price: 30, unit: "hour", conditions: ["evenings", "weekends"], groupPrice: { size: 3, perPerson: 15 } },
  ],
});

export function knownTags(): string[] {
  return [...new Set(LISBON_PILOT.intents.map((i) => i.tag))].sort();
}

export function memberName(memberId: string): string {
  return LISBON_PILOT.members.find((m) => m.id === memberId)?.name ?? memberId;
}

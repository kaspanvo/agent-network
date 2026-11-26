import { Population, type Happening, type Member } from "./domain";

// Made-up members for the pilot demo. Every agent the user's agent meets comes from here.
export const LISBON_PILOT = Population.parse({
  name: "Lisbon pilot",
  synthetic: true,
  members: [
    { id: "diego", name: "Diego", blurb: "Native Spanish speaker who teaches small groups" },
    { id: "lena", name: "Lena", blurb: "Wants to brush up her Spanish" },
    { id: "joana", name: "Joana", blurb: "Starting Spanish from scratch" },
    { id: "lingo", name: "Lingo School", blurb: "Language school in Arroios" },
    { id: "lucia", name: "Lucía", blurb: "Spanish conversation tutor who teaches one-to-one" },
    { id: "marco", name: "Marco", blurb: "Looking for a second-hand road bike" },
    { id: "rita", name: "Rita", blurb: "Guitar teacher with free evenings" },
    { id: "tom", name: "Tom", blurb: "Has a mirrorless camera he barely uses" },
    { id: "maya", name: "Maya", blurb: "Wants a camera for a spring trip" },
    { id: "ines", name: "Inês", blurb: "Photographer who runs photo walks" },
    { id: "sofia", name: "Sofia", blurb: "Looks after dogs on weekends" },
    { id: "pedro", name: "Pedro", blurb: "Needs a weekend dog-sitter twice a month" },
    { id: "nuno", name: "Nuno", blurb: "Cook who teaches Portuguese home cooking" },
    { id: "bruno", name: "Bruno", blurb: "Drummer who moved to Lisbon last year" },
    { id: "carla", name: "Carla", blurb: "Goes to more concerts than she can find company for" },
  ],
  interests: [
    { memberId: "lena", tag: "live-music", shares: ["Lena goes to a jazz jam in Bairro Alto most Thursdays and would like company.", "Lena likes jazz and anything with a good horn section."], conditions: ["evenings"] },
    { memberId: "rita", tag: "live-music", shares: ["Rita plays guitar in a small fado group that plays in Alfama on Sunday evenings.", "Rita is happy for newcomers to sit in and listen."], conditions: ["evenings", "weekends"] },
    { memberId: "bruno", tag: "live-music", shares: ["Bruno plays drums and is looking for people to jam with.", "Bruno has a rehearsal room in Marvila he can book on weekday evenings."], conditions: ["evenings"] },
    { memberId: "carla", tag: "live-music", shares: ["Carla has a spare ticket for an indie concert this Saturday.", "Carla goes to two or three gigs a month, mostly indie and electronic."], conditions: ["evenings", "weekends"] },
    { memberId: "tom", tag: "running", shares: ["Tom runs along the river from Cais do Sodré to Belém on Saturday mornings, about 10 km at an easy pace.", "Tom is happy to wait for slower runners."], conditions: ["mornings", "weekends"] },
    { memberId: "sofia", tag: "running", shares: ["Sofia is training for the Lisbon half marathon in March.", "Sofia runs early, before the dogs need walking."], conditions: ["mornings", "weekends"] },
    { memberId: "pedro", tag: "board-games", shares: ["Pedro hosts a board game night at his flat in Arroios every other Friday.", "Pedro has a shelf of games and likes teaching new ones."], conditions: ["evenings"] },
  ],
  happenings: [
    { id: "jazz-jam", tag: "live-music", postedBy: "lena", title: "Jazz jam session", when: "Thursday, 22:00", where: "A jazz bar in Bairro Alto", cost: "€5 at the door", conditions: ["evenings"] },
    { id: "fado-night", tag: "live-music", postedBy: "rita", title: "Fado night with Rita's group", when: "Sunday, 19:30", where: "A small tasca in Alfama", cost: "Free, dinner optional", conditions: ["evenings", "weekends"] },
    { id: "indie-ticket", tag: "live-music", postedBy: "carla", title: "Spare ticket: indie concert", when: "Saturday, 21:00", where: "A venue in Marvila", cost: "€18, face value", conditions: ["evenings", "weekends"] },
    { id: "river-run", tag: "running", postedBy: "tom", title: "Saturday riverside run", when: "Saturday, 08:00", where: "Cais do Sodré to Belém, 10 km", cost: "Free", conditions: ["mornings", "weekends"] },
    { id: "game-night", tag: "board-games", postedBy: "pedro", title: "Board game night", when: "Friday, 20:00, every other week", where: "Pedro's flat in Arroios", cost: "Bring a snack", conditions: ["evenings"] },
  ],
  intents: [
    { id: "diego-spanish", memberId: "diego", direction: "offer", tag: "spanish-lessons", summary: "Spanish lessons, any level", price: 25, unit: "hour", conditions: ["evenings", "weekends"], groupPrice: { size: 3, perPerson: 12 } },
    { id: "lena-spanish", memberId: "lena", direction: "seek", tag: "spanish-lessons", summary: "Spanish lessons to brush up", price: 14, unit: "hour", conditions: ["evenings"] },
    { id: "joana-spanish", memberId: "joana", direction: "seek", tag: "spanish-lessons", summary: "Beginner Spanish", price: 13, unit: "hour", conditions: ["evenings", "weekends"] },
    { id: "lucia-spanish", memberId: "lucia", direction: "offer", tag: "spanish-lessons", summary: "One-to-one Spanish conversation", price: 14, unit: "hour", conditions: ["evenings"] },
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

export function knownInterestTags(): string[] {
  return [...new Set(LISBON_PILOT.interests.map((i) => i.tag))].sort();
}

export function memberName(memberId: string): string {
  return LISBON_PILOT.members.find((m) => m.id === memberId)?.name ?? memberId;
}

export function memberByName(name: string, population: Population = LISBON_PILOT): Member | undefined {
  return population.members.find((m) => m.name === name);
}

export function happeningSentence(h: Happening): string {
  return `${h.title}: ${h.when}, ${h.where.charAt(0).toLowerCase()}${h.where.slice(1)}. ${h.cost}.`;
}

// Everything a member allowed their agent to say to other agents. Never their price limits.
export function publicFacts(memberId: string, population: Population = LISBON_PILOT): string[] {
  const member = population.members.find((m) => m.id === memberId);
  if (!member) return [];
  return [
    member.blurb,
    ...population.intents.filter((i) => i.memberId === memberId).map((i) => `${i.direction === "offer" ? "Offers" : "Looking for"}: ${i.summary}${i.conditions.length ? ` (${i.conditions.join(", ")})` : ""}`),
    ...population.interests.filter((i) => i.memberId === memberId).flatMap((i) => i.shares),
    ...population.happenings.filter((h) => h.postedBy === memberId).map(happeningSentence),
  ];
}

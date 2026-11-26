// Special categories of personal data (GDPR Art. 9): health, sex life or sexual orientation, religious or
// philosophical beliefs, political opinions, racial or ethnic origin, trade union membership. EU courts read this
// broadly: anything a sensitive trait can be inferred from counts ("sober socials", "Pride run", "Friday prayers").
// The prompt asks the agent to leave such things out, but a prompt is a request, not a rule, so this check runs in
// code wherever the agent saves something about the person. It errs towards flagging: a false alarm costs the
// person one tap, a miss shares something sensitive without their say.

export type SensitiveKind = "health" | "sexuality" | "religion" | "politics" | "ethnicity" | "union";

// How each kind is named to the person: "This says something about your health."
export const SENSITIVE_WORDS: Record<SensitiveKind, string> = {
  health: "your health",
  sexuality: "your sexuality or gender",
  religion: "your religion or beliefs",
  politics: "your political views",
  ethnicity: "your ethnic background",
  union: "trade union membership",
};

const PATTERNS: [SensitiveKind, RegExp][] = [
  [
    "health",
    /\b(?:sober|sobriety|alcohol[- ]free|teetotal|recovering|in recovery|rehab|aa meetings?|na meetings?|12[- ]step|therap(?:y|ist)|counsell?(?:ing|or)|psychiatri\w*|mental health|depress(?:ion|ed)|anxiety|panic attacks?|bipolar|adhd|autis(?:m|tic)|ocd|ptsd|eating disorder|anorexi\w*|bulimi\w*|diabet\w*|cancer|chemo\w*|hiv|sexual health|pregnan\w*|ivf|fertility|miscarriage|menopause|disab(?:led|ility)|wheelchair|chronic (?:pain|illness)|long covid|epilep\w*|medication|diagnos\w*|visually impaired|hard of hearing|hearing loss|addict\w*|grief support)\b/i,
  ],
  [
    "sexuality",
    /\b(?:gay|lesbian|queer|lgbt\w*\+?|bisexual|bi (?:women|men|people)|pansexual|asexual|trans(?:gender)?|non[- ]?binary|enby|intersex|pride (?:run|march|parade|event|month)|coming out|drag (?:night|show)|grindr|sexual orientation|kink\w*|polyamor\w*)\b/i,
  ],
  [
    "religion",
    /\b(?:church|mosque|synagogue|temple|gurdwara|parish|bible|quran|koran|torah|talmud|prayers?|praying|worship|mass on sunday|sunday mass|christian|catholic|protestant|evangelical|orthodox (?:jew|church)|muslim|islam\w*|jewish|judaism|hindu\w*|buddhis\w*|sikh\w*|atheis\w*|ramadan|iftar|eid|shabbat|sabbath|kosher|halal|diwali|faith (?:group|community)|religio\w*|spiritual (?:community|group))\b/i,
  ],
  [
    "politics",
    /\b(?:political (?:party|views|group|meeting)|party member\w*|socialis\w*|communis\w*|anarchis\w*|libertarian|conservative party|labour party|green party|far[- ](?:left|right)|protest\w*|political demonstrations?|activis\w*|campaign volunteer|canvass\w*|election campaign|voting for|i vote|my vote)\b/i,
  ],
  [
    "ethnicity",
    /\b(?:(?:black|asian|latin[oaxe]|hispanic|arab|roma|african|caribbean|indigenous|white) (?:women|men|people|folks|community|communities|only)|diaspora|ethnic (?:background|minority|group)|racial\w*)\b/i,
  ],
  ["union", /\b(?:trade union|union (?:member\w*|meeting|rep|dues)|unioni[sz]\w*|shop steward)\b/i],
];

// The first special category the text says something about, or null.
export function sensitiveIn(...texts: (string | undefined | null)[]): SensitiveKind | null {
  const text = texts.filter(Boolean).join(" \n ");
  if (!text) return null;
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

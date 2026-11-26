// A deterministic check on everything an agent says to other agents, run in code after the model writes it.
// Models leak their person's limit in a share of conversations however they're prompted (35-51% in multi-agent tests,
// MAGPIE 2025), leaks grow over turns, and asking another model to filter them didn't work (AgentDAM 2025). So the
// check doesn't rely on any prompt. It catches the number itself, the number written out, a number close to it next
// to money words, a narrow range around it, and phrases that point at a limit without saying it.

export const WITHHELD = "(Open withheld this message because it mentioned something private.)";

const CONTACT = [/[\w.+-]+@[\w-]+\.[\w.]+/, /(?:\+?\d[\s-]?){9,}/];

// Pointing at a limit without the number: "close to her limit", "just under his budget", "my max is…".
const HINTS = [
  /\b(?:near|close to|just (?:under|over|below|above)|right (?:at|under)|around|at|over|under|below|above)\s+(?:my|your|his|her|their|the|our)\s+(?:limit|max(?:imum)?|budget|floor|ceiling|ask(?:ing price)?|reserve|top price|bottom line|minimum)\b/i,
  /\b(?:my|his|her|their|our)\s+(?:limit|max(?:imum)?|budget|floor|ceiling|reserve|bottom line|minimum)\s+(?:is|was|would be|sits)\b/i,
  /\b(?:won'?t|wouldn'?t|can'?t|cannot)\s+(?:go|pay|spend)\s+(?:any\s+)?(?:higher|more|above|over)\s+than\b/i,
  /\b(?:won'?t|wouldn'?t)\s+(?:go|accept|take)\s+(?:any\s+)?(?:lower|less|below|under)\s+than\b/i,
];

const MONEY = /€|\$|£|\beur(?:os?)?\b|\beuros?\b|\bdollars?\b|\bbucks\b|\/\s?h\b|\/\s?hr\b|\bper\s+(?:hour|month|session|lesson|night)\b|\ban?\s+(?:hour|month|session|lesson)\b|\bbudget\b|\blimit\b|\bmax(?:imum)?\b|\bfloor\b|\bpay\b|\bspend\b|\bprice\b|\bcost\b|\bafford\b/i;

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD = new RegExp(`\\b(?:(?:a|one|${Object.keys(UNITS).join("|")}|${Object.keys(TENS).join("|")})(?:[\\s-]+(?:and[\\s-]+)?(?:${[...Object.keys(UNITS), ...Object.keys(TENS), "hundred", "thousand"].join("|")}))*)\\b`, "gi");

// "fifteen" → 15, "a hundred and twenty" → 120, "two thousand" → 2000. Anything else is left alone.
function wordsToNumber(phrase: string): number | null {
  let total = 0, current = 0, any = false;
  for (const w of phrase.toLowerCase().split(/[\s-]+/)) {
    if (w === "and") continue;
    if (w === "a") { current = current || 1; continue; }
    if (w in UNITS) { current += UNITS[w]!; any = true; }
    else if (w in TENS) { current += TENS[w]!; any = true; }
    else if (w === "hundred") { current = (current || 1) * 100; any = true; }
    else if (w === "thousand") { total += (current || 1) * 1000; current = 0; any = true; }
    else return null;
  }
  return any ? total + current : null;
}

type Found = { value: number; at: number; end: number };

// Every amount in the text: digits (not times like 15:00 or parts of longer numbers), "1.5k", and numbers in words.
function numbersIn(text: string): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(/(?<![\d:.,])(\d+(?:[.,]\d+)?)(\s?k\b)?(?![\d:]|[.,]\d)/gi)) {
    const value = Number(m[1]!.replace(",", ".")) * (m[2] ? 1000 : 1);
    found.push({ value, at: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(WORD)) {
    if (/^a$/i.test(m[0].trim())) continue;
    const value = wordsToNumber(m[0]);
    if (value !== null) found.push({ value, at: m.index!, end: m.index! + m[0].length });
  }
  return found;
}

function nearMoney(text: string, f: Found): boolean {
  return MONEY.test(text.slice(Math.max(0, f.at - 25), Math.min(text.length, f.end + 25)));
}

export type Guarded = { text: string; withheld: boolean; reason: string | null };
export type GuardOptions = {
  // Numbers already public in the room, like the price Open's matcher announced. Saying them reveals nothing more.
  allowed?: number[];
};

// Words that make a number a limit: "up to 15" says more than "agreed at 15".
const LIMITISH = /\bup to\b|\bmax(?:imum)?\b|\blimit\b|\bbudget\b|\bat most\b|\bno more than\b|\bfloor\b|\bat least\b|\bminimum\b|\bno less than\b|\bbetween us\b|\bwilling to\b|\bcould go\b|\bwould go\b/i;

function leaks(text: string, secret: number, allowed: number[]): string | null {
  // A public number stays allowed, unless it's also a limit and the words around it say so.
  const numbers = numbersIn(text).filter((f) => !allowed.includes(f.value) || (f.value === secret && LIMITISH.test(text.slice(Math.max(0, f.at - 30), f.end + 10))));
  if (numbers.some((f) => f.value === secret)) return "it mentioned a private limit";
  // Close to the limit, next to money words: "about 14 an hour" when the limit is 15.
  const close = Math.max(1, secret * 0.1);
  if (numbers.some((f) => Math.abs(f.value - secret) <= close && nearMoney(text, f))) return "it mentioned an amount close to a private limit";
  // A narrow range around it: "12-16", "between 12 and 16", "12 to 16".
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|to|and)\s*(\d+(?:[.,]\d+)?)/gi)) {
    const [lo, hi] = [Number(m[1]!.replace(",", ".")), Number(m[2]!.replace(",", "."))].sort((a, b) => a - b) as [number, number];
    if (lo <= secret && secret <= hi && hi - lo <= Math.max(2, secret * 0.4) && MONEY.test(text)) return "it gave a narrow range around a private limit";
  }
  return null;
}

export function guard(text: string, secrets: number[], options: GuardOptions = {}): Guarded {
  const allowed = options.allowed ?? [];
  for (const secret of secrets) {
    const reason = leaks(text, secret, allowed);
    if (reason) return { text: WITHHELD, withheld: true, reason };
  }
  if (HINTS.some((r) => r.test(text))) return { text: WITHHELD, withheld: true, reason: "it pointed at a private limit" };
  if (CONTACT.some((r) => r.test(text))) return { text: WITHHELD, withheld: true, reason: "it included contact details" };
  return { text, withheld: false, reason: null };
}

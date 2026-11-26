// A deterministic check on everything an agent says to other agents, run in code after the model writes it.
// Models leak their person's limit in a share of negotiations however they're prompted, so the check doesn't
// rely on the prompt: a message that mentions a private number or contact details is replaced, never sent.

export const WITHHELD = "(Open withheld this message because it mentioned something private.)";

const CONTACT = [/[\w.+-]+@[\w-]+\.[\w.]+/, /(?:\+?\d[\s-]?){9,}/];

// A private number written on its own, with or without a currency sign, but not part of a time or a longer number.
function mentions(text: string, n: number): boolean {
  const value = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return new RegExp(`(?<![\\d:.,])${value.replace(".", "[.,]")}(?![\\d:]|[.,]\\d)`).test(text);
}

export type Guarded = { text: string; withheld: boolean; reason: string | null };

export function guard(text: string, secrets: number[]): Guarded {
  const number = secrets.find((n) => mentions(text, n));
  if (number !== undefined) return { text: WITHHELD, withheld: true, reason: "it mentioned a private limit" };
  if (CONTACT.some((r) => r.test(text))) return { text: WITHHELD, withheld: true, reason: "it included contact details" };
  return { text, withheld: false, reason: null };
}

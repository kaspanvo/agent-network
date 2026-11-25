export const EPSILON = 0.005;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sum(ns: number[]): number {
  return round2(ns.reduce((a, b) => a + b, 0));
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

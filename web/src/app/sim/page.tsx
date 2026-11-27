import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { SimConsole } from "@/components/sim/SimConsole";

export const metadata: Metadata = { title: "Simulation · Open", robots: { index: false } };

export default function SimPage() {
  return (
    <div className="min-h-full bg-paper text-ink">
      <header className="bg-navy-950 text-cloud">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
          <Brand />
          <span className="hidden font-mono text-xs tracking-wider text-mist sm:inline">SIMULATION</span>
          <Link href="/inbox" className="flex min-h-11 items-center text-sm text-mist hover:text-cloud">
            Your inbox
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="font-display text-[clamp(2rem,4.5vw,2.75rem)] font-normal leading-tight tracking-[-0.02em]">Simulate a crowd</h1>
          <p className="text-slate">
            Invented people, each with their own wants, limits and habits, use Open at the same time. Watch how far each gets and how the platform holds up, then step into anyone&apos;s inbox to see exactly what they saw.
          </p>
        </div>
        <SimConsole />
      </main>
    </div>
  );
}

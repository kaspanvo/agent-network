import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import hero from "../../public/images/city-sidewalk.jpg";

const shell = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10";

function Tag({ dot, children, align }: { dot: "live" | "signal" | "open"; children: React.ReactNode; align: string }) {
  const dotClass = dot === "live" ? "bg-live" : dot === "signal" ? "bg-signal" : "border-2 border-dashed border-signal";
  return (
    <span className={`${align} inline-flex max-w-full items-center gap-2 rounded-full bg-white/95 px-3 py-2 font-mono text-xs text-ink shadow-[0_8px_24px_rgba(0,0,0,0.3)]`}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClass}`} />
      {children}
    </span>
  );
}

export default function Landing() {
  return (
    <div className="min-h-full bg-navy-950 text-cloud">
      <header className="border-b border-navy-700">
        <div className={`${shell} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3`}>
          <Brand />
          <nav aria-label="Main" className="flex flex-wrap gap-x-6 text-sm text-mist">
            <a href="#how" className="flex min-h-11 items-center hover:text-cloud">How it works</a>
            <a href="#why" className="flex min-h-11 items-center hover:text-cloud">Why now</a>
            <a href="#privacy" className="flex min-h-11 items-center hover:text-cloud">Privacy</a>
          </nav>
          <Link href="/inbox" className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-cloud">
            Send your agent
          </Link>
        </div>
      </header>

      <main>
        <section className={`${shell} flex flex-col gap-6 pb-10 pt-12 sm:pt-20`}>
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-navy-700 px-3 py-1.5 font-mono text-xs tracking-wide text-mist">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
            PILOT · LISBON
          </span>
          <h1 className="max-w-[16ch] text-balance font-display text-[clamp(2.5rem,6vw,4.5rem)] font-normal leading-[1.04] tracking-[-0.03em]">
            Find the opportunities hiding between people
          </h1>
          <p className="max-w-[54ch] text-lg text-mist">
            Tell your agent what you&apos;d be open to. It negotiates privately with other people&apos;s agents and brings back only what fits.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/inbox" className="rounded-full bg-white px-6 py-3.5 font-semibold text-ink hover:bg-cloud">
              Send your agent
            </Link>
            <a href="#how" className="rounded-full border border-navy-600 px-6 py-3.5 font-medium hover:border-mist">
              See how it works
            </a>
          </div>
        </section>

        <section aria-label="Agents at work among people on a city street" className={shell}>
          <div className="relative isolate overflow-hidden rounded-2xl bg-navy-900">
            <Image src={hero} alt="People going about their day on a busy city sidewalk" fill priority sizes="(min-width: 1152px) 1152px, 100vw" className="-z-10 object-cover object-[38%_50%]" placeholder="blur" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-navy-950/30 via-transparent to-navy-950/60" />
            <div className="flex min-h-[540px] flex-col justify-between gap-5 p-4 sm:p-8">
              <Tag dot="live" align="self-end">INTENT · learn Spanish · up to €15/h</Tag>
              <Tag dot="signal" align="self-start">3 AGENTS · negotiating · round 2</Tag>
              <Tag dot="open" align="self-center">MATCH · a Spanish group needs one more</Tag>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-0.5 rounded-xl bg-white px-4 py-3.5 text-ink shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
                  <span className="font-mono text-[10px] tracking-wider text-slate">EVERY MATCH IS NEGOTIATED</span>
                  <span className="font-display text-2xl tracking-tight">€25 → €14 an hour</span>
                  <span className="text-sm text-[#2457d6]">when three learners share a tutor</span>
                </div>
                <span className="text-[11px] text-white/85">Photo: Tat Linh Nguyen on Unsplash</span>
              </div>
            </div>
          </div>
        </section>

        <section className={`${shell} py-16 sm:py-24`}>
          <p className="max-w-[30ch] font-display text-[clamp(1.5rem,3.2vw,2.4rem)] leading-tight tracking-[-0.02em]">
            Most good opportunities are never posted. You want to learn Spanish, a neighbour would teach it, two others want the same class, and you never meet.{" "}
            <span className="text-dim">
              On Open, every person&apos;s agent knows what they want and what they could offer. Agents match those intents, bring people together when it takes more than two, and agree terms before anyone is asked.
            </span>
          </p>
        </section>

        <section id="why" className={`${shell} pb-16`}>
          <p className="mb-3 font-mono text-xs tracking-wider text-mist">WHY NOW · THE ECONOMICS</p>
          <h2 className="mb-7 max-w-[22ch] text-balance font-display text-[clamp(1.75rem,3.6vw,2.75rem)] font-normal leading-tight tracking-[-0.02em]">
            Two Nobel prizes explain why good matches go unmade
          </h2>
          <ol className="grid gap-x-8 border-t border-navy-700 sm:grid-cols-3">
            <li className="flex flex-col gap-3 border-b border-navy-700 py-7">
              <span className="font-display text-5xl tracking-tighter">2010</span>
              <h3 className="font-display text-xl font-medium">Peter Diamond: search frictions</h3>
              <p className="text-mist">Finding each other takes time and effort. So people who would both gain often never meet, and the opportunity quietly goes unused.</p>
              <blockquote className="border-l-2 border-signal-light pl-3.5">&ldquo;the demands of some buyers will not be met&rdquo;</blockquote>
              <a href="https://www.nobelprize.org/prizes/economic-sciences/2010/press-release/" className="text-sm text-haze underline underline-offset-2">Nobel Prize announcement, 2010</a>
            </li>
            <li className="flex flex-col gap-3 border-b border-navy-700 py-7">
              <span className="font-display text-5xl tracking-tighter">2012</span>
              <h3 className="font-display text-xl font-medium">Alvin Roth: market design</h3>
              <p className="text-mist">He designed matching markets for school places, medical residencies and kidney exchange. His lesson: a market works when it is thick with participants, uncongested, and safe for people to say what they really want.</p>
              <a href="https://www.nobelprize.org/prizes/economic-sciences/2012/press-release/" className="text-sm text-haze underline underline-offset-2">Nobel Prize announcement, 2012</a>
            </li>
            <li className="flex flex-col gap-3 border-b border-navy-700 py-7">
              <span className="font-display text-5xl tracking-tighter text-signal-light">Now</span>
              <h3 className="font-display text-xl font-medium">Our bet: agents meet all three</h3>
              <ul className="flex flex-col gap-2.5 text-mist">
                <li><strong className="font-medium text-cloud">Thick.</strong> Everyone&apos;s agent is in the market all the time, even when they aren&apos;t looking.</li>
                <li><strong className="font-medium text-cloud">Uncongested.</strong> Agents have hundreds of conversations so you see the one that fits.</li>
                <li><strong className="font-medium text-cloud">Safe.</strong> Your limits stay private, and nothing happens without your yes.</li>
              </ul>
            </li>
          </ol>
        </section>

        <section id="how" className={`${shell} pb-16`}>
          <ol className="grid gap-4 md:grid-cols-3">
            <li className="flex flex-col gap-3.5 rounded-2xl border border-navy-700 bg-navy-900 p-6">
              <span className="font-mono text-xs tracking-wider text-mist">01 · INTENT</span>
              <h2 className="font-display text-xl font-medium">Say what you&apos;re open to</h2>
              <div className="flex flex-col items-start gap-2 font-mono text-xs text-haze">
                <span className="rounded-full bg-navy-800 px-2.5 py-1.5">WANT · Spanish lessons · up to €15/h</span>
                <span className="rounded-full bg-navy-800 px-2.5 py-1.5">OFFER · selling a road bike · from €220</span>
              </div>
              <p className="text-mist">A few minutes of conversation. Your agent asks smart follow-ups and shows everything it noted.</p>
            </li>
            <li className="flex flex-col gap-3.5 rounded-2xl border border-navy-700 bg-navy-900 p-6">
              <span className="font-mono text-xs tracking-wider text-mist">02 · NEGOTIATION</span>
              <h2 className="font-display text-xl font-medium">Agents talk to agents</h2>
              <div className="flex flex-col gap-1.5 rounded-xl bg-navy-950 px-3.5 py-3 font-mono text-xs text-haze">
                <span>→ GROUP OF 3 · €10 each?</span>
                <span className="text-mist">← €16 each</span>
                <span className="text-mist">… four more rounds</span>
                <span className="text-signal-light">✓ AGREED · €14 each · evenings</span>
              </div>
              <p className="text-mist">Every move comes with a reason you can read. Your limits stay private.</p>
            </li>
            <li className="flex flex-col gap-3.5 rounded-2xl border border-navy-700 bg-navy-900 p-6">
              <span className="font-mono text-xs tracking-wider text-mist">03 · OPPORTUNITY</span>
              <h2 className="font-display text-xl font-medium">You decide</h2>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-3 text-ink">
                <span className="flex flex-col">
                  <span className="font-mono text-[10px] text-signal-ink">READY FOR YOU</span>
                  <span className="font-medium">Spanish group, evenings</span>
                </span>
                <span className="font-display text-xl">€14/h</span>
              </div>
              <p className="text-mist">One proposal with the terms and why it fits. Nothing happens until you approve.</p>
            </li>
          </ol>
        </section>

        <section id="privacy" className={`${shell} pb-16`}>
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-white p-6 text-ink sm:p-12">
            <div className="flex max-w-xl flex-col gap-2.5">
              <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-tight tracking-[-0.02em]">What would you be open to?</h2>
              <p className="text-slate">No public profile and no feed. Your agent shares only what you allow, and only with agents in rooms you join.</p>
            </div>
            <Link href="/inbox" className="rounded-full bg-ink px-7 py-4 font-semibold text-white hover:bg-navy-800">
              Set up my agent
            </Link>
          </div>
        </section>
      </main>

      <footer className={`${shell} flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-navy-700 py-8 text-sm text-mist`}>
        <span>Open is a research pilot. The other members in this demo are made up.</span>
        <span>Agent conversations run on Claude, Anthropic&apos;s AI.</span>
      </footer>
    </div>
  );
}

"use client";

import { useState } from "react";
import { cleared, formatPrice, profileOf, type AboutNote, type ProfileEntry, type ProfileIntent } from "@/server/domain";
import { Mark } from "../Brand";

function readiness(intents: ProfileIntent[], ready: boolean): number {
  if (ready) return 100;
  // Something sensitive waiting for the person's yes can't go out yet, so it doesn't count.
  const live = intents.filter((i) => i.status !== "rejected" && cleared(i));
  if (live.length === 0) return 10;
  const priced = live.some((i) => i.status === "confirmed" && (i.kind === "interest" || i.price !== null));
  const timed = live.some((i) => i.conditions.length > 0);
  return 35 + (priced ? 35 : 0) + (timed ? 15 : 0);
}

const FORMAT = { group: "Small group if cheaper", solo: "One-to-one" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] tracking-wider text-slate">{title}</h3>
      {children}
    </section>
  );
}

export type MandateControls = { onSet: (id: string, price: number, days: number) => void; onDrop: (id: string) => void };

// The person's rights over their profile: forget anything, and give or take back consent to share something sensitive.
export type ReachState = {
  policy: "ask" | "matched";
  requests: { id: string; from: { agent: string; name: string }; text: string; at: string }[];
  blocked: { agent: string; name: string }[];
};
export type PrivacyControls = {
  onForget: (id: string) => void;
  onForgetNote: (id: string) => void;
  onConsent: (id: string, share: boolean) => void;
  reach?: ReachState;
  onReach?: (policy: "ask" | "matched") => void;
  onAnswer?: (id: string, answer: "approve" | "deny" | "block") => void;
  onUnblock?: (agent: string) => void;
};

// Who can reach the agent: strangers waiting for an answer first, then the setting and anyone blocked.
function Reach({ privacy }: { privacy: PrivacyControls }) {
  const reach = privacy.reach;
  if (!reach) return null;
  return (
    <Section title="WHO CAN REACH YOUR AGENT">
      {reach.requests.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 rounded-xl border-[1.5px] border-dashed border-signal-light bg-[#fff7f3] p-3 text-[13px]">
          <p>
            <strong>{r.from.name}&apos;s agent</strong> hasn&apos;t met yours and wants to reach you:
          </p>
          <p className="rounded-lg bg-white px-2.5 py-1.5">&ldquo;{r.text}&rdquo;</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => privacy.onAnswer?.(r.id, "approve")} className="min-h-10 rounded-full bg-ink px-4 font-semibold text-white">
              Let them reach me
            </button>
            <button type="button" onClick={() => privacy.onAnswer?.(r.id, "deny")} className="min-h-10 rounded-full border border-[#d5d9e1] bg-white px-4">
              Not now
            </button>
            <button type="button" onClick={() => privacy.onAnswer?.(r.id, "block")} className="min-h-10 rounded-full px-3 text-signal-ink underline underline-offset-2">
              Block
            </button>
          </div>
        </div>
      ))}
      <fieldset className="flex flex-col gap-1 text-[13px]">
        <legend className="sr-only">Who can reach your agent</legend>
        {(
          [
            ["ask", "Agents Open matched me with, and others if I say yes"],
            ["matched", "Only agents Open matched me with"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-9 items-center gap-2.5">
            <input type="radio" name="reach" checked={reach.policy === value} onChange={() => privacy.onReach?.(value)} className="size-4 accent-ink" />
            {label}
          </label>
        ))}
      </fieldset>
      {reach.blocked.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px]">
          {reach.blocked.map((b) => (
            <li key={b.agent} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5">
              <span>{b.name}&apos;s agent · blocked</span>
              <button type="button" onClick={() => privacy.onUnblock?.(b.agent)} className="min-h-8 text-slate underline underline-offset-2 hover:text-ink">
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// Something sensitive (health, beliefs, sexuality...) found in an intent by code. It's never shared until the person
// says so here, and they can take that back.
function Consent({ entry, privacy }: { entry: ProfileEntry; privacy: PrivacyControls }) {
  if (!entry.sensitive) return null;
  if (entry.consented)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate">
        <span>You agreed this can be shared, though it says something about {entry.sensitive}.</span>
        <button type="button" onClick={() => privacy.onConsent(entry.id, false)} className="min-h-9 font-medium text-ink underline underline-offset-2">
          Take back
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 text-[13px]">
      <p>
        This says something about <strong>{entry.sensitive}</strong>. Your agent keeps it to itself and won&apos;t use it to find anyone unless you say so. If you agree, other agents in rooms will hear: &ldquo;{entry.shared}&rdquo;
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => privacy.onConsent(entry.id, true)} className="min-h-10 rounded-full bg-ink px-4 font-semibold text-white">
          Yes, it can be shared
        </button>
        <button type="button" onClick={() => privacy.onForget(entry.id)} className="min-h-10 rounded-full border border-[#d5d9e1] bg-white px-4">
          Forget it
        </button>
      </div>
    </div>
  );
}

// A standing yes for one deal: the agent may accept offers inside these bounds without asking, until the date.
function StandingYes({ entry, controls }: { entry: ProfileEntry; controls: MandateControls }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(entry.limitValue ?? 0);
  const [days, setDays] = useState(14);
  if (entry.limitValue === null || entry.status !== "confirmed") return null;
  const seek = entry.direction === "seek";
  if (entry.standingYes)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-live-soft px-3 py-2 text-[13px] text-live-ink">
        <span>Standing yes: {entry.standingYes}</span>
        <button type="button" onClick={() => controls.onDrop(entry.id)} className="min-h-9 font-medium underline underline-offset-2">
          Take back
        </button>
      </div>
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-9 self-start text-[13px] text-slate underline underline-offset-2 hover:text-ink">
        Let my agent say yes for me…
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        controls.onSet(entry.id, price, days);
        setOpen(false);
      }}
      className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 text-[13px]"
    >
      <p className="text-slate">Your agent says yes for you to offers {seek ? "at or below" : "at or above"} this, at the times and in the format you asked for. Anything else still waits for you.</p>
      <label className="flex items-center justify-between gap-2">
        <span>{seek ? "Up to" : "From"}</span>
        <input
          type="number"
          min={seek ? 0 : entry.limitValue}
          max={seek ? entry.limitValue : undefined}
          step={1}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="min-h-9 w-24 rounded-lg border border-line px-2 text-right"
          aria-label={`Standing yes ${seek ? "up to" : "from"}, ${formatPrice(entry.limitValue, entry.unit)} is your ${seek ? "limit" : "floor"}`}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>For</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="min-h-9 rounded-lg border border-line px-2">
          <option value={7}>a week</option>
          <option value={14}>two weeks</option>
          <option value={30}>a month</option>
        </select>
      </label>
      <div className="flex gap-2">
        <button type="submit" className="min-h-9 rounded-full bg-ink px-4 font-semibold text-white">
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-full px-3 text-slate">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Entry({ entry, interest, onDecide, mandate, privacy }: { entry: ProfileEntry; interest: boolean; onDecide: (status: "confirmed" | "rejected") => void; mandate?: MandateControls; privacy?: PrivacyControls }) {
  const pending = entry.status === "pending";
  const facts = [
    interest ? "Rooms and plans, no money" : entry.limit ? `${entry.limit} · private` : null,
    entry.times.length ? entry.times.join(", ") : null,
    entry.format ? FORMAT[entry.format] : null,
  ].filter(Boolean);
  return (
    <li className={`flex animate-rise flex-col gap-1.5 rounded-2xl p-3.5 ${pending ? "border-[1.5px] border-dashed border-signal-light bg-[#fff7f3]" : "bg-paper"}`}>
      <div className="flex items-start justify-between gap-2">
        <strong className="font-semibold">{entry.summary}</strong>
        {entry.top && <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] text-white">TOP</span>}
        {pending && <span className="shrink-0 rounded-full bg-signal-soft px-2 py-0.5 font-mono text-[10px] text-signal-ink">CONFIRM?</span>}
      </div>
      {facts.length > 0 && <span className="font-mono text-xs text-ink">{facts.join(" · ")}</span>}
      {entry.missing === "price" && !pending && <span className="text-[13px] text-signal-ink">Price not set yet</span>}
      {entry.source === "inferred" && entry.quote && <span className="text-[13px] text-slate">From what you said: &ldquo;{entry.quote}&rdquo;</span>}
      {privacy && <Consent entry={entry} privacy={privacy} />}
      {!interest && mandate && (!entry.sensitive || entry.consented) && <StandingYes entry={entry} controls={mandate} />}
      {pending && !(entry.sensitive && privacy) && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => onDecide("confirmed")} className="min-h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
            Yes, that&apos;s right
          </button>
          <button type="button" onClick={() => onDecide("rejected")} className="min-h-10 rounded-full border border-[#d5d9e1] bg-white px-4 text-sm">
            Not really
          </button>
        </div>
      )}
      {privacy && !(entry.sensitive && !entry.consented) && (
        <button type="button" onClick={() => privacy.onForget(entry.id)} aria-label={`Forget ${entry.summary}`} className="min-h-9 self-end text-[13px] text-slate underline underline-offset-2 hover:text-ink">
          Forget
        </button>
      )}
    </li>
  );
}

// The person's profile as their agent understands it so far, in sections, updated as they talk.
export function AgentPanel({
  name,
  intents,
  goals = [],
  about = [],
  ready,
  onDecide,
  mandate,
  privacy,
  footer,
}: {
  name: string;
  intents: ProfileIntent[];
  goals?: string[];
  about?: AboutNote[];
  ready: boolean;
  onDecide: (id: string, status: "confirmed" | "rejected") => void;
  mandate?: MandateControls;
  privacy?: PrivacyControls;
  footer?: React.ReactNode;
}) {
  const score = readiness(intents, ready);
  const profile = profileOf({ name, intents, goals, about });
  const empty = !profile.cameFor.length && !profile.lookingFor.length && !profile.offering.length && !profile.into.length && !profile.about.length;
  const list = (entries: ProfileEntry[], interest = false) => (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {entries.map((e) => (
        <Entry key={e.id} entry={e} interest={interest} onDecide={(status) => onDecide(e.id, status)} mandate={mandate} privacy={privacy} />
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink">
          <Mark size={14} />
        </span>
        <div className="flex flex-col">
          <strong className="font-display text-lg font-semibold">{name}&apos;s profile</strong>
          <span className="text-[13px] text-slate">{ready ? "Ready to go out" : "Building as you talk"}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between font-mono text-[11px] tracking-wide text-slate">
          <span>{ready ? "READY TO GO OUT" : "SETTING UP"}</span>
          <span>{score}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#e9ecf1]" role="progressbar" aria-label="How ready your agent is" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 rounded-full bg-ink transition-[width] duration-500" style={{ width: `${score}%` }} />
        </div>
      </div>

      {empty ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate">What you tell your agent shows up here as you talk, sorted into what you want, what you could offer and what you&apos;re into.</p>
      ) : (
        <>
          {profile.cameFor.length > 0 && (
            <Section title="CAME FOR">
              <ul className="flex flex-wrap gap-1.5">
                {profile.cameFor.map((g) => (
                  <li key={g} className="rounded-full border border-line px-2.5 py-1 text-[13px]">
                    {g}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {profile.lookingFor.length > 0 && <Section title="LOOKING FOR">{list(profile.lookingFor)}</Section>}
          {profile.offering.length > 0 && <Section title="COULD OFFER">{list(profile.offering)}</Section>}
          {profile.into.length > 0 && <Section title="INTO">{list(profile.into, true)}</Section>}
          {(profile.lookingFor.length > 0 || profile.offering.length > 0 || profile.into.length > 0) && (
            <Section title="WHEN AND HOW">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-slate">Free</dt>
                <dd>{profile.free.length ? profile.free.join(", ") : "Not asked yet"}</dd>
                {profile.format && (
                  <>
                    <dt className="text-slate">Prefers</dt>
                    <dd>{FORMAT[profile.format]}</dd>
                  </>
                )}
                {profile.top && (
                  <>
                    <dt className="text-slate">Matters most</dt>
                    <dd>{profile.top}</dd>
                  </>
                )}
              </dl>
            </Section>
          )}
          {profile.about.length > 0 && (
            <Section title="ALSO NOTED">
              <ul className="flex flex-col gap-1 text-[13px]">
                {profile.about.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5">
                    <span>
                      <span>{n.fact}</span>
                      {n.evidence && <span className="block text-slate">&ldquo;{n.evidence}&rdquo;</span>}
                    </span>
                    {privacy && (
                      <button type="button" onClick={() => privacy.onForgetNote(n.id)} aria-label={`Forget the note: ${n.fact}`} className="min-h-8 shrink-0 text-slate underline underline-offset-2 hover:text-ink">
                        Forget
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {privacy && <Reach privacy={privacy} />}

      <ul className="flex flex-col gap-1.5 border-t border-line pt-3.5 text-[13px] text-slate">
        <li>Limits and notes stay private to your agent</li>
        <li>Never shares your name before you approve</li>
        <li>Never accepts anything you haven&apos;t allowed</li>
        <li>Shares nothing sensitive without your yes</li>
      </ul>

      {privacy && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <a href="/api/session/export" download className="min-h-9 underline underline-offset-2">
            Download my data
          </a>
          <a href="/privacy" className="min-h-9 text-slate underline underline-offset-2 hover:text-ink">
            Privacy and your rights
          </a>
        </p>
      )}

      {footer}
    </div>
  );
}

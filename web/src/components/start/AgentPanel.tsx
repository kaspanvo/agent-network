"use client";

import { profileOf, type AboutNote, type ProfileEntry, type ProfileIntent } from "@/server/domain";
import { Mark } from "../Brand";

function readiness(intents: ProfileIntent[], ready: boolean): number {
  if (ready) return 100;
  const live = intents.filter((i) => i.status !== "rejected");
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

function Entry({ entry, interest, onDecide }: { entry: ProfileEntry; interest: boolean; onDecide: (status: "confirmed" | "rejected") => void }) {
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
      {pending && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => onDecide("confirmed")} className="min-h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
            Yes, that&apos;s right
          </button>
          <button type="button" onClick={() => onDecide("rejected")} className="min-h-10 rounded-full border border-[#d5d9e1] bg-white px-4 text-sm">
            Not really
          </button>
        </div>
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
  footer,
}: {
  name: string;
  intents: ProfileIntent[];
  goals?: string[];
  about?: AboutNote[];
  ready: boolean;
  onDecide: (id: string, status: "confirmed" | "rejected") => void;
  footer?: React.ReactNode;
}) {
  const score = readiness(intents, ready);
  const profile = profileOf({ name, intents, goals, about });
  const empty = !profile.cameFor.length && !profile.lookingFor.length && !profile.offering.length && !profile.into.length && !profile.about.length;
  const list = (entries: ProfileEntry[], interest = false) => (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {entries.map((e) => (
        <Entry key={e.id} entry={e} interest={interest} onDecide={(status) => onDecide(e.id, status)} />
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
                  <li key={n.id} className="rounded-lg border border-line px-2.5 py-1.5">
                    <span>{n.fact}</span>
                    {n.evidence && <span className="block text-slate">&ldquo;{n.evidence}&rdquo;</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <ul className="flex flex-col gap-1.5 border-t border-line pt-3.5 text-[13px] text-slate">
        <li>Limits and notes stay private to your agent</li>
        <li>Never shares your name before you approve</li>
        <li>Never accepts anything on your behalf</li>
      </ul>

      {footer}
    </div>
  );
}

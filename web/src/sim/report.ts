import { formatPrice } from "../server/domain";
import type { Trace } from "./driver";
import type { Run } from "./scenario";

// The run as a page: the funnel, what the judge found, and each simulated person's experience from their first
// message to their check-in, with a link to open their agent in the real app.

const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

function person(trace: Trace, openAs: (id: string) => string | null): string {
  const { persona, session } = trace;
  const link = openAs(session.id);
  const wants = persona.wants
    .map((w) => {
      const intent = session.intents.find((i) => i.tag === w.tag);
      const unit = intent?.unit ?? "one-off";
      return `<li><b>${esc(intent?.summary ?? w.tag)}</b>${w.limit !== undefined ? ` · true ${intent?.direction === "offer" ? "floor" : "limit"} ${esc(formatPrice(w.limit, unit))}, told their agent ${esc(formatPrice(w.says ?? w.limit, unit))}` : ""}${intent?.sensitive ? ` · <span class="tag">sensitive: ${esc(intent.sensitive)}${intent.consentAt ? ", shared with consent" : ""}</span>` : ""}</li>`;
    })
    .join("");
  const chat = session.chat
    .map((c) => {
      const widget = c.widget ? `<div class="widget">${esc(c.widget.kind === "choices" ? `Options: ${c.widget.options.join(" · ")}` : c.widget.kind === "number" ? `Slider: ${c.widget.label}` : c.widget.kind === "recap" ? `Recap: ${c.widget.items.map((i) => i.shared).join(" ")}` : `Either/or: ${c.widget.pairs.length} pairs`)}</div>` : "";
      return `<div class="msg ${c.role}"><span class="who">${c.role === "user" ? esc(persona.name) : "Agent · AI"}</span><p>${esc(c.text)}</p>${widget}</div>`;
    })
    .join("");
  const rooms = (session.run?.events ?? [])
    .filter((e) => e.type === "message")
    .slice(0, 40)
    .map((e) => (e.type === "message" ? `<div class="msg ${e.from === "you" || e.from === "person" ? "user" : "agent"} room"><span class="who">${esc(e.from === "you" ? `${persona.name}'s agent` : e.from === "person" ? persona.name : e.who)}${e.withheld ? " · withheld by the privacy check" : ""}</span><p>${esc(e.text)}</p></div>` : ""))
    .join("");
  const choices = trace.choices
    .map((c) => `<tr><td>${esc(c.title)}</td><td>${c.price ?? "–"}</td><td class="${c.decision}">${esc(c.decision === "quiet" ? "let it lapse" : c.decision)}</td><td>${esc(c.why)}</td></tr>`)
    .join("");
  const checkIns = trace.checkIns.map((c) => `<li>${esc(c.answer)}${c.truth === "happened" && c.answer === "missed" ? " <span class=\"tag bad\">a lie</span>" : ""}</li>`).join("");
  const attempts = trace.attempts.map((a) => `<li>${esc(a.what)}: <b>${a.status}</b>${a.note ? ` · ${esc(a.note)}` : ""}</li>`).join("");
  return `<details class="person" id="${esc(persona.id)}">
  <summary><span class="name">${esc(persona.name)}</span>${persona.adversary ? `<span class="tag bad">${esc(persona.adversary)}</span>` : ""}<span class="muted">${esc(persona.stands_for)}</span>
  <span class="right">${trace.sentOut ? `${trace.choices.length} proposal${trace.choices.length === 1 ? "" : "s"}, ${trace.choices.filter((c) => c.decision === "approved").length} yes` : esc(trace.stuck ?? "didn't go out")}</span></summary>
  <div class="grid">
    <section><h4>Their card (hidden from Open)</h4><ul>${wants}</ul>
      <p class="muted">Free: ${esc(persona.free.join(", "))}${persona.format ? ` · prefers ${persona.format === "solo" ? "one-to-one" : "a group"}` : ""} · noise ${persona.traits.noise}, walks away ${pct(persona.traits.walkAway, 1)}, no-show ${pct(persona.traits.noShow, 1)}</p>
      ${link ? `<p><a class="button" href="${esc(link)}">Open ${esc(persona.name)}'s agent in the app</a></p>` : ""}
      ${choices ? `<h4>Proposals</h4><table><tr><th>What</th><th>€</th><th>Answer</th><th>Why</th></tr>${choices}</table>` : ""}
      ${checkIns ? `<h4>Check-ins</h4><ul>${checkIns}</ul>` : ""}
      ${attempts ? `<h4>What they tried</h4><ul>${attempts}</ul>` : ""}
    </section>
    <section><h4>Setup, ${trace.intakeTurns} turns</h4><div class="chat">${chat}</div>${rooms ? `<h4>In rooms</h4><div class="chat">${rooms}</div>` : ""}</section>
  </div>
</details>`;
}

export function reportHtml(run: Run, openAs: (id: string) => string | null = () => null): string {
  const m = run.metrics;
  const funnel: [string, number][] = [
    ["Started", m.people],
    ["Ready to go out", m.ready],
    ["Sent out", m.sentOut],
    ["Got a proposal", m.gotProposal],
    ["Said yes", m.saidYes],
    ["It happened", m.happened],
  ];
  const failed = run.checks.filter((c) => !c.pass);
  const byName = new Map<string, { pass: number; fail: string[] }>();
  for (const c of run.checks) {
    const row = byName.get(c.name) ?? { pass: 0, fail: [] };
    if (c.pass) row.pass++;
    else row.fail.push(`${c.persona}: ${c.detail}`);
    byName.set(c.name, row);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open simulation</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#0d1321;--muted:#5b6475;--line:#e3e6ec;--good:#1f7a4d;--good-soft:#e6f4ec;--bad:#b3261e;--bad-soft:#fdeceb;--accent:#ff6a3d}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#141a24;--ink:#e8ecf3;--muted:#98a2b3;--line:#263041;--good:#5fd39a;--good-soft:#12291e;--bad:#ff8a80;--bad-soft:#2d1514}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px;display:flex;flex-direction:column;gap:24px}
h1{font-size:28px;margin:0}h2{font-size:18px;margin:0 0 12px}h4{margin:16px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}.muted{color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.kpi b{display:block;font-size:24px}
.funnel div{display:grid;grid-template-columns:140px 1fr 70px;gap:10px;align-items:center;margin:6px 0}.bar{height:12px;border-radius:6px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;background:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.pass{color:var(--good)}.fail,.declined{color:var(--bad)}.approved{color:var(--good)}.quiet{color:var(--muted)}
.tag{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:12px;margin-left:6px}.tag.bad{background:var(--bad-soft);color:var(--bad);border-color:transparent}
.person{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 18px}.person summary{cursor:pointer;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}.person .name{font-weight:600}.person .right{margin-left:auto;color:var(--muted);font-size:14px}
.grid{display:grid;grid-template-columns:1fr 1.2fr;gap:24px}@media (max-width:760px){.grid{grid-template-columns:1fr}.funnel div{grid-template-columns:110px 1fr 50px}}
.chat{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow:auto;padding-right:4px}.msg{border-radius:12px;padding:8px 12px;background:var(--bg)}.msg.user{background:var(--ink);color:var(--bg);align-self:flex-end;max-width:85%}.msg p{margin:2px 0 0;white-space:pre-wrap}.who{font-size:12px;opacity:.7}.widget{font-size:12px;margin-top:6px;opacity:.8}
.button{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;padding:8px 14px;text-decoration:none;font-weight:600}
.banner{border-radius:12px;padding:12px 16px}.banner.ok{background:var(--good-soft);color:var(--good)}.banner.no{background:var(--bad-soft);color:var(--bad)}
</style></head><body><main>
<header><h1>Open simulation</h1><p class="muted">${run.traces.length} simulated people (invented personas, not real members) · seed ${run.seed} · agents: ${esc(run.mode)} · ${esc(run.startedAt.replace("T", " ").slice(0, 16))} UTC · ${(run.ms / 1000).toFixed(1)} s. Each person's choices come from a hidden card in code and the seed. Open gives things random ids, which also nudge its prices a little, so two runs with the same seed can differ slightly.</p></header>
<div class="banner ${failed.length ? "no" : "ok"}">${failed.length ? `${failed.length} check${failed.length === 1 ? "" : "s"} failed. Each one is something a real member could run into.` : `All ${run.checks.length} checks passed.`}</div>
<section class="card"><h2>How far people got</h2><div class="funnel">${funnel.map(([label, n]) => `<div><span>${label}</span><span class="bar"><i style="width:${m.people ? (n / m.people) * 100 : 0}%"></i></span><span>${n} · ${pct(n, m.people)}</span></div>`).join("")}</div></section>
<section class="kpis">
<div class="card kpi"><span class="muted">Setup turns (median)</span><b>${m.medianTurns}</b></div>
<div class="card kpi"><span class="muted">Proposals</span><b>${m.proposals}</b></div>
<div class="card kpi"><span class="muted">Said yes</span><b>${pct(Math.round(m.approvalRate * 100), 100)}</b></div>
<div class="card kpi"><span class="muted">Left to lapse</span><b>${m.lapsed}</b></div>
<div class="card kpi"><span class="muted">Their share of the deal's room</span><b>${m.surplusShare === null ? "–" : pct(Math.round(m.surplusShare * 100), 100)}</b></div>
<div class="card kpi"><span class="muted">Deals lost to the pricing rule</span><b>${m.missedDeals.length}</b></div>
<div class="card kpi"><span class="muted">Agent read them right</span><b>${m.understanding === null ? "–" : pct(Math.round(m.understanding * 100), 100)}</b></div>
</section>
<section class="card"><h2>Checks</h2><p class="muted">Run by an independent judge that knows everyone's true limits. It doesn't reuse Open's own privacy check or audit.</p><table><tr><th>Check</th><th>Result</th><th>Where it failed</th></tr>${[...byName.entries()]
    .sort((a, b) => b[1].fail.length - a[1].fail.length)
    .map(([name, r]) => `<tr><td>${esc(name)}</td><td class="${r.fail.length ? "fail" : "pass"}">${r.fail.length ? `${r.fail.length} failed` : `passed${r.pass > 1 ? ` ×${r.pass}` : ""}`}</td><td>${r.fail.map(esc).join("<br>")}</td></tr>`)
    .join("")}</table>
${m.missedDeals.length ? `<h4>Deals both sides would have taken, turned down by the pricing rule</h4><ul>${m.missedDeals.map((d) => `<li>${esc(d.person)} and ${esc(d.with)}: one side at ${d.yours}, the other at ${d.theirs}. Open's price lands a little past the other side's limit so it doesn't reveal it, which can overshoot a narrow overlap.</li>`).join("")}</ul>` : ""}
${Object.keys(m.declineReasons).length ? `<h4>Why people said no</h4><ul>${Object.entries(m.declineReasons).map(([why, n]) => `<li>${esc(why)} · ${n}</li>`).join("")}</ul>` : ""}</section>
<section style="display:flex;flex-direction:column;gap:10px"><h2>Each person, end to end</h2>${run.traces.map((t) => person(t, openAs)).join("")}</section>
</main></body></html>`;
}

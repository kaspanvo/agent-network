"use client";

import { useEffect, useRef } from "react";

// The landing hero's field of agents. Each starts as a slowly turning sphere of characters; fragments of what someone
// would be open to drift in, and with each one absorbed the sphere takes more of a person's shape. Formed agents are
// joined by dotted lines, and now and then three gather into a room with one seat left open: the invitation.
// It's an illustration, not live data: the names and words are made up, and no amount is ever shown.

const RAMP = ".'`^,:;Il!i~+_-?]}1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const NAMES = ["rowan", "ana", "bea", "lucía", "diego", "inês", "tomás", "kofi", "priya", "joão", "lena", "mia", "sam", "noor"];
const WORDS = [
  "learn spanish", "evenings", "a used camera", "weekends", "jazz", "one-to-one", "sell my bike", "fado nights", "small group",
  "sealed offer", "help with a move", "running", "board games", "a dog-sitter", "guitar", "not before march", "near alfama",
  "quietly", "maybe", "if it fits", "someone patient", "on sundays",
];
const ACCENT = "#ff5a1f";
const FALLBACK_MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ease = (x: number) => x * x * (3 - 2 * x);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const glyph = (shade: number) => RAMP.charAt(Math.floor(clamp(shade, 0, 0.999) * RAMP.length));

// Signed distance to a head-and-shoulders silhouette, in figure units (about 1 tall, centred).
function bust(x: number, y: number): number {
  const head = Math.hypot(x, y + 0.29) - 0.165;
  const neck = Math.max(Math.abs(x) - 0.065, Math.abs(y + 0.105) - 0.06);
  const torso = (Math.hypot(x / 0.39, (y - 0.36) / 0.43) - 1) * 0.39;
  const body = Math.max(Math.min(neck, torso), y - 0.46);
  return Math.min(head, body);
}

type Point = { sx: number; sy: number; sz: number; fx: number; fy: number; fshade: number; delay: number; swirl: number; flick: number; fch: string; phase: number };
type Figure = {
  id: number; x: number; y: number; name: string; born: number; life: number;
  state: "emerge" | "gather" | "formed" | "fade"; alpha: number; progress: number; need: number;
  spin: number; nextMote: number; pulse: number; pts: Point[];
};
type Link = { a: Figure; b: Figure; born: number; life: number; bend: number };
type Room = { members: Figure[]; born: number; life: number; cx: number; cy: number };
type Mote = { fig: Figure; x: number; y: number; word: string | null; born: number; spin: number; done?: boolean };
type Dust = { x: number; y: number; v: number; ch: string; a: number };

function makePoints(n: number): Point[] {
  const pts: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const yy = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - yy * yy);
    const th = golden * i;
    let fx = 0, fy = 0, d = 1;
    for (let k = 0; k < 40 && d > 0; k++) {
      fx = rand(-0.42, 0.42);
      fy = rand(-0.47, 0.46);
      d = bust(fx, fy);
    }
    const edge = 1 - clamp(-d / 0.07, 0, 1);
    const light = clamp(0.5 + (-0.7 * fx - 0.5 * fy), 0, 1);
    pts.push({
      sx: Math.cos(th) * r, sy: yy, sz: Math.sin(th) * r, fx, fy,
      fshade: clamp(0.18 + 0.38 * light + 0.38 * edge + rand(-0.08, 0.12), 0, 1),
      delay: Math.random(), swirl: Math.random() < 0.5 ? -1 : 1, flick: 0, fch: "", phase: rand(0, 6.28),
    });
  }
  return pts;
}

class Field {
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private S = 200;
  private G = 9;
  private narrow = false;
  private t = 0;
  private last = performance.now();
  private figures: Figure[] = [];
  private links: Link[] = [];
  private rooms: Room[] = [];
  private motes: Mote[] = [];
  private dust: Dust[] = [];
  private nextSpawn = 4;
  private nextLink = 3;
  private nextRoom = 9;
  private nameAt = Math.floor(Math.random() * NAMES.length);
  private ids = 0;
  private raf = 0;
  private visible = true;
  pointer: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private reduced: boolean,
    // The app's monospace (JetBrains Mono, loaded by next/font under a generated family name).
    private mono = FALLBACK_MONO,
    private maxFigures = 4,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    for (let i = 0; i < 26; i++) this.dust.push({ x: Math.random(), y: Math.random(), v: rand(0.004, 0.012), ch: glyph(rand(0, 0.3)), a: rand(0.08, 0.22) });
    this.seed();
  }

  start() {
    if (this.reduced) return this.draw();
    if (this.raf || !this.visible) return;
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = 0;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      this.draw();
      if (this.visible) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) this.start();
    else this.stop();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
    this.narrow = w < 820;
    this.S = clamp(Math.min(w * (this.narrow ? 0.42 : 0.18), h * 0.38), 120, 270);
    this.G = clamp(this.S / 25, 7, 11);
    // Keep the agents inside the field after a resize.
    const z = this.zone();
    for (const f of this.figures) {
      f.x = clamp(f.x, z.x0 * w, z.x1 * w);
      f.y = clamp(f.y, z.y0 * h, z.y1 * h);
    }
    if (this.reduced) this.draw();
  }

  private zone() {
    // Wide screens: right of the headline. Phones: above it.
    return this.narrow ? { x0: 0.14, x1: 0.86, y0: 0.12, y1: 0.34 } : { x0: 0.66, x1: 0.92, y0: 0.24, y1: 0.76 };
  }

  private spawn(progress = 0, alpha = 0, state: Figure["state"] = "emerge"): Figure {
    const z = this.zone();
    let best = { x: 0, y: 0 }, bestD = -1;
    for (let k = 0; k < 40; k++) {
      const x = rand(z.x0, z.x1) * this.W, y = rand(z.y0, z.y1) * this.H;
      let near = Infinity;
      for (const f of this.figures) near = Math.min(near, Math.hypot(f.x - x, f.y - y));
      if (near > bestD) {
        bestD = near;
        best = { x, y };
      }
      if (near > this.S * 1.25) break;
    }
    const fig: Figure = {
      id: ++this.ids, x: best.x, y: best.y, name: NAMES[this.nameAt++ % NAMES.length]!,
      born: this.t, life: rand(17, 25), state, alpha, progress, need: Math.round(rand(12, 18)),
      spin: rand(0, 6.28), nextMote: 0, pulse: 0, pts: makePoints(Math.round(clamp(this.S * 1.9, 200, 480))),
    };
    this.figures.push(fig);
    return fig;
  }

  // The first frame already tells the story: one agent formed, one taking shape, one just appearing.
  private seed() {
    const a = this.spawn(1, 1, "formed");
    a.born = -8;
    const b = this.spawn(0.45, 1, "gather");
    b.born = -4;
    const c = this.maxFigures > 2 ? this.spawn() : undefined;
    if (!this.reduced) return;
    // Without motion: one still scene with everything in it.
    b.progress = 1;
    b.state = "formed";
    if (!c) return;
    c.progress = 1;
    c.alpha = 1;
    c.state = "formed";
    this.links.push({ a, b, born: -2, life: 1e9, bend: 0.18 });
    this.rooms.push({ members: [a, b, c], born: -2, life: 1e9, cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3 + this.S * 0.1 });
  }

  private step(dt: number) {
    const S = this.S;
    this.t += dt;
    const t = this.t;
    if (this.figures.filter((f) => f.state !== "fade").length < this.maxFigures && t > this.nextSpawn) {
      this.spawn();
      this.nextSpawn = t + rand(2.5, 5);
    }
    for (const f of this.figures) {
      f.pulse = Math.max(0, f.pulse - dt * 1.6);
      if (f.state === "emerge") {
        f.alpha = Math.min(1, f.alpha + dt / 1.4);
        if (f.alpha >= 1) f.state = "gather";
      } else if (f.state === "gather") {
        if (t > f.nextMote) {
          const ang = rand(0, 6.28), dist = S * rand(1.1, 1.9);
          this.motes.push({
            fig: f, x: f.x + Math.cos(ang) * dist, y: f.y + Math.sin(ang) * dist * 0.7,
            word: Math.random() < 0.45 ? WORDS[Math.floor(Math.random() * WORDS.length)]! : null,
            born: t, spin: Math.random() < 0.5 ? -1 : 1,
          });
          f.nextMote = t + rand(0.28, 0.6);
        }
        if (f.progress >= 1) {
          f.progress = 1;
          f.state = "formed";
          f.pulse = 1;
        }
      } else if (f.state === "formed") {
        if (t - f.born > f.life) f.state = "fade";
      } else {
        f.alpha -= dt / 1.8;
      }
    }
    const gone = new Set(this.figures.filter((f) => f.state === "fade" && f.alpha <= 0));
    if (gone.size) {
      this.figures = this.figures.filter((f) => !gone.has(f));
      this.links = this.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
      this.rooms = this.rooms.filter((r) => !r.members.some((m) => gone.has(m)));
      this.motes = this.motes.filter((m) => !gone.has(m.fig));
    }
    // Fragments of intent spiral in and are absorbed: each moves the sphere further toward a person.
    for (const m of this.motes) {
      const dx = m.fig.x - m.x, dy = m.fig.y - m.y, d = Math.hypot(dx, dy) || 1;
      const sp = (40 + 2600 / (d + 30)) * dt * 1.6;
      m.x += (dx / d) * sp + (-dy / d) * sp * 0.55 * m.spin;
      m.y += (dy / d) * sp + (dx / d) * sp * 0.55 * m.spin;
      if (d < S * 0.2) {
        m.done = true;
        m.fig.progress = Math.min(1, m.fig.progress + 1 / m.fig.need);
        m.fig.pulse = Math.min(1, m.fig.pulse + 0.35);
      }
    }
    this.motes = this.motes.filter((m) => !m.done && t - m.born < 9);
    const formed = this.figures.filter((f) => f.state === "formed");
    if (t > this.nextLink && formed.length >= 2) {
      const pairs: [Figure, Figure][] = [];
      for (let i = 0; i < formed.length; i++)
        for (let j = i + 1; j < formed.length; j++) {
          const A = formed[i]!, B = formed[j]!;
          if (!this.links.some((l) => (l.a === A && l.b === B) || (l.a === B && l.b === A))) pairs.push([A, B]);
        }
      if (pairs.length) {
        const [A, B] = pairs[Math.floor(Math.random() * pairs.length)]!;
        this.links.push({ a: A, b: B, born: t, life: rand(6, 9), bend: rand(-0.3, 0.3) });
        A.pulse = B.pulse = 0.8;
      }
      this.nextLink = t + rand(2.5, 4.5);
    }
    this.links = this.links.filter((l) => t - l.born < l.life);
    // Now and then three agents whose plans fit gather into a room. One seat stays open: that's the invitation.
    if (t > this.nextRoom && formed.length >= 3 && !this.rooms.length) {
      const members = [...formed].sort(() => Math.random() - 0.5).slice(0, 3);
      const cx = members.reduce((s, m) => s + m.x / 3, 0), cy = members.reduce((s, m) => s + m.y / 3, 0);
      this.rooms.push({ members, born: t, life: 9, cx, cy: cy + S * 0.12 });
      this.nextRoom = t + rand(13, 18);
    }
    this.rooms = this.rooms.filter((r) => t - r.born < r.life);
    for (const d of this.dust) {
      d.y -= d.v * dt;
      if (d.y < -0.02) {
        d.y = 1.02;
        d.x = Math.random();
      }
    }
  }

  private env(age: number, life: number, inT: number, outT: number) {
    return this.reduced ? 1 : clamp(Math.min(age / inT, (life - age) / outT), 0, 1);
  }

  private curve(ax: number, ay: number, bx: number, by: number, bend: number) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
    const qx = mx - dy * bend, qy = my + dx * bend;
    this.ctx.beginPath();
    this.ctx.moveTo(ax, ay);
    this.ctx.quadraticCurveTo(qx, qy, bx, by);
    return { qx, qy };
  }

  draw() {
    const { ctx, S, G, t } = this;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = `500 ${G}px ${this.mono}`;
    ctx.fillStyle = "#c9d3e3";
    for (const d of this.dust) {
      ctx.globalAlpha = d.a;
      ctx.fillText(d.ch, d.x * this.W, d.y * this.H);
    }

    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (const l of this.links) {
      const age = t - l.born, e = this.env(age, l.life, 0.9, 1.2) * Math.min(l.a.alpha, l.b.alpha);
      if (e <= 0) continue;
      const ay = l.a.y - S * 0.06, by = l.b.y - S * 0.06;
      ctx.setLineDash([1.5, 6]);
      ctx.lineDashOffset = -t * 22;
      ctx.strokeStyle = `rgba(201,211,227,${0.5 * e})`;
      const q = this.curve(l.a.x, ay, l.b.x, by, l.bend);
      ctx.stroke();
      const u = (age * 0.32) % 1, iu = 1 - u;
      const px = iu * iu * l.a.x + 2 * iu * u * q.qx + u * u * l.b.x;
      const py = iu * iu * ay + 2 * iu * u * q.qy + u * u * by;
      ctx.setLineDash([]);
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = e;
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = e * 0.25;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, 6.283);
      ctx.fill();
    }

    for (const r of this.rooms) {
      const age = t - r.born;
      let e = this.env(age, r.life, 1.4, 1.6);
      for (const m of r.members) e = Math.min(e, m.alpha);
      if (e <= 0) continue;
      const rad = S * 0.2, seats = r.members.length + 1;
      ctx.setLineDash([1.2, 5]);
      ctx.lineDashOffset = t * 10;
      ctx.strokeStyle = `rgba(201,211,227,${0.55 * e})`;
      ctx.beginPath();
      ctx.arc(r.cx, r.cy, rad, 0, 6.283);
      ctx.stroke();
      for (let k = 0; k < seats; k++) {
        const a0 = -Math.PI / 2 + (k / seats) * 6.283 + t * 0.08;
        const sx = r.cx + Math.cos(a0) * rad, sy = r.cy + Math.sin(a0) * rad;
        const member = r.members[k];
        if (member) {
          ctx.setLineDash([1.2, 5]);
          ctx.strokeStyle = `rgba(201,211,227,${0.42 * e})`;
          this.curve(member.x, member.y + S * 0.18, sx, sy, 0.12);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = e * 0.9;
          ctx.fillStyle = "#e8edf5";
          ctx.beginPath();
          ctx.arc(sx, sy, 3.2, 0, 6.283);
          ctx.fill();
        } else {
          const pulse = this.reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 3);
          ctx.setLineDash([]);
          ctx.globalAlpha = e;
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(sx, sy, 4 + pulse * 1.5, 0, 6.283);
          ctx.stroke();
          ctx.globalAlpha = e * 0.18 * pulse;
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(sx, sy, 12 + pulse * 4, 0, 6.283);
          ctx.fill();
          ctx.lineWidth = 1;
        }
      }
      ctx.globalAlpha = e * 0.7;
      ctx.fillStyle = "#93a0b8";
      ctx.font = `500 10px ${this.mono}`;
      ctx.fillText(age < r.life * 0.45 && !this.reduced ? "room forming" : "a seat opens", r.cx, r.cy + rad + 16);
    }
    ctx.setLineDash([]);

    ctx.font = `500 ${G}px ${this.mono}`;
    const ptr = this.pointer, reach = S * 0.45;
    for (const f of this.figures) {
      if (f.alpha <= 0) continue;
      const rot = f.spin + t * 0.35, cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(0.3), st = Math.sin(0.3);
      const glow = 1 + f.pulse * 0.35;
      for (const p of f.pts) {
        const lp = ease(clamp((f.progress - p.delay * 0.4) / 0.6, 0, 1));
        const x1 = p.sx * cr + p.sz * sr, z1 = -p.sx * sr + p.sz * cr;
        const y1 = p.sy * ct - z1 * st, z2 = p.sy * st + z1 * ct;
        const bx = x1 * 0.34, by = y1 * 0.34 - 0.04;
        const sw = Math.sin(lp * Math.PI) * 0.14 * p.swirl;
        const ux = bx + (p.fx - bx) * lp - (p.fy - by) * sw;
        let uy = by + (p.fy - by) * lp + (p.fx - bx) * sw;
        if (lp >= 1 && !this.reduced) uy += Math.sin(t * 1.2 + p.phase) * 0.004;
        let X = f.x + ux * S, Y = f.y + uy * S;
        const shade = lp < 0.5 ? 0.08 + 0.8 * ((z2 + 1) / 2) : p.fshade;
        let boost = 0;
        if (ptr) {
          const ddx = X - ptr.x, ddy = Y - ptr.y, dd = Math.hypot(ddx, ddy);
          if (dd < reach) {
            const k2 = 1 - dd / reach;
            X += (ddx / (dd || 1)) * k2 * k2 * 16;
            Y += (ddy / (dd || 1)) * k2 * k2 * 16;
            boost = k2 * 0.5;
          }
        }
        let ch: string;
        if (p.flick > t) ch = p.fch;
        else {
          if (!this.reduced && Math.random() < 0.0025) {
            p.flick = t + rand(0.08, 0.3);
            p.fch = glyph(Math.random());
          }
          ch = glyph(shade);
        }
        let a = f.alpha * clamp((0.12 + 0.88 * shade) * glow + boost, 0, 1);
        if (lp < 0.5) a *= 0.35 + 0.65 * ((z2 + 1) / 2);
        if (a < 0.03) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = boost > 0.25 ? "#ffffff" : "#e8edf5";
        ctx.fillText(ch, X, Y);
      }
    }

    for (const m of this.motes) {
      const ma = clamp((t - m.born) / 0.6, 0, 1) * m.fig.alpha;
      const near = clamp((Math.hypot(m.fig.x - m.x, m.fig.y - m.y) - S * 0.2) / (S * 0.5), 0, 1);
      ctx.globalAlpha = ma * (0.4 + 0.6 * near);
      ctx.fillStyle = ACCENT;
      ctx.font = `500 ${G + 1}px ${this.mono}`;
      ctx.fillText("+", m.x, m.y);
      if (m.word) {
        ctx.globalAlpha = ma * 0.55 * near;
        ctx.fillStyle = "#93a0b8";
        ctx.font = `500 10px ${this.mono}`;
        ctx.fillText(m.word, m.x, m.y - 12);
      }
    }

    ctx.font = `500 11px ${this.mono}`;
    for (const f of this.figures) {
      if (f.alpha <= 0.05) continue;
      const ly = f.y + S * 0.56;
      const formed = f.progress >= 1 && (f.state === "formed" || f.state === "fade");
      const label = formed ? `${f.name}'s agent` : f.state === "gather" ? `listening${".".repeat(1 + (Math.floor(t * 2) % 3))}` : "";
      if (!label) continue;
      ctx.globalAlpha = f.alpha * (formed ? 0.85 : 0.5);
      ctx.fillStyle = formed ? "#c9d3e3" : "#7d8aa3";
      ctx.fillText(label, f.x + (formed ? 6 : 0), ly);
      if (formed) {
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "#22c55e";
        ctx.globalAlpha = f.alpha * (this.reduced ? 1 : 0.5 + 0.5 * Math.sin(t * 2.4 + f.id));
        ctx.beginPath();
        ctx.arc(f.x + 6 - tw / 2 - 8, ly, 2.5, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

export function AgentField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-jetbrains").trim();
    const field = new Field(canvas, reduced, family ? `${family}, ${FALLBACK_MONO}` : FALLBACK_MONO);
    field.start();
    const resized = new ResizeObserver(() => field.resize());
    resized.observe(canvas);
    // Only animate while it's on screen.
    const seen = new IntersectionObserver(([entry]) => field.setVisible(!!entry?.isIntersecting));
    seen.observe(canvas);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      field.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => (field.pointer = null);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      field.stop();
      resized.disconnect();
      seen.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Abstract figures made of drifting characters. Each starts as a sphere and takes the shape of a person as fragments of what they would be open to drift in; dotted lines then connect them and gather into rooms with one seat left open."
      className={className}
    />
  );
}

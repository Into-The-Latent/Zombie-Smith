// Reusable crafting mechanics. Three verbs cover every station:
//
//   TimingBar  -- an oscillating pointer you stop inside a band (hammer, press)
//   TracePath  -- a moving dot you follow with the mouse (grinding, honing)
//   TorqueDial -- a spinning needle you lock inside a sector (assembly)
//
// Every one takes a `forgiveness` value (0..1-ish) assembled from the stock
// material's workability and the crafter's skill, so a Gunsmith working good
// steel genuinely has an easier time than a Heavy hammering rebar.

import { clamp } from '../core/util.js';
import { Theme } from '../ui/theme.js';
import { roundRect } from '../ui/widgets.js';

export const PERFECT = 0.92;

/** Oscillating pointer. `strike()` scores it. */
export class TimingBar {
  constructor(opts = {}) {
    this.width = opts.width ?? 1; // normalised 0..1 travel
    this.zoneHalf = opts.zoneHalf ?? 0.12;
    this.speed = opts.speed ?? 0.9; // full sweeps per second
    this.pos = 0;
    this.dir = 1;
    this.zoneCenter = opts.zoneCenter ?? 0.5;
    this.wander = opts.wander ?? 0; // how far the band drifts between strikes
    this.lastAccuracy = 0;
    this.flash = 0;
  }

  update(dt) {
    this.pos += this.dir * this.speed * dt;
    if (this.pos > 1) {
      this.pos = 1;
      this.dir = -1;
    } else if (this.pos < 0) {
      this.pos = 0;
      this.dir = 1;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
  }

  /** @returns {number} 0 on a miss, up to 1 dead centre */
  strike() {
    const d = Math.abs(this.pos - this.zoneCenter);
    const acc = d > this.zoneHalf ? 0 : 1 - d / this.zoneHalf;
    this.lastAccuracy = acc;
    this.flash = 1;
    return acc;
  }

  /** Move and shrink the band for the next strike. */
  advance(rand, { shrink = 0.94, speedUp = 1.09 } = {}) {
    if (this.wander > 0) {
      this.zoneCenter = clamp(
        0.5 + (rand.next() * 2 - 1) * this.wander,
        this.zoneHalf + 0.04,
        1 - this.zoneHalf - 0.04,
      );
    }
    this.zoneHalf = Math.max(0.035, this.zoneHalf * shrink);
    this.speed *= speedUp;
  }

  render(ctx, x, y, w, h, opts = {}) {
    ctx.fillStyle = '#0d1219';
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = Theme.border;
    ctx.stroke();

    // Sweet spot, with a brighter core for the perfect window.
    const zx = x + (this.zoneCenter - this.zoneHalf) * w;
    const zw = this.zoneHalf * 2 * w;
    ctx.fillStyle = opts.zoneColor || 'rgba(79,180,119,0.32)';
    roundRect(ctx, zx, y + 2, zw, h - 4, 3);
    ctx.fill();
    const cw = zw * 0.22;
    ctx.fillStyle = opts.coreColor || 'rgba(232,163,61,0.55)';
    roundRect(ctx, x + this.zoneCenter * w - cw / 2, y + 2, cw, h - 4, 3);
    ctx.fill();

    // Pointer.
    const px = x + this.pos * w;
    ctx.fillStyle = this.flash > 0
      ? (this.lastAccuracy > 0 ? '#ffe9b0' : '#ff8a80')
      : '#e6edf5';
    ctx.fillRect(px - 2, y - 4, 4, h + 8);

    ctx.strokeStyle = Theme.borderHi;
    roundRect(ctx, x, y, w, h, 4);
    ctx.stroke();
  }
}

/** A dot travelling a polyline that the player tracks with the cursor. */
export class TracePath {
  constructor(points, opts = {}) {
    this.points = points;
    this.speed = opts.speed ?? 0.36; // path fractions per second
    this.tolerance = opts.tolerance ?? 34;
    this.t = 0;
    this.onTarget = 0;
    this.total = 0;
    this.sparks = [];
    this.lengths = [];
    this.totalLength = 0;
    for (let i = 1; i < points.length; i++) {
      const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      this.lengths.push(l);
      this.totalLength += l;
    }
  }

  /** Position along the path at fraction f (0..1). */
  at(f) {
    const target = clamp(f, 0, 1) * this.totalLength;
    let acc = 0;
    for (let i = 0; i < this.lengths.length; i++) {
      if (acc + this.lengths[i] >= target) {
        const local = this.lengths[i] === 0 ? 0 : (target - acc) / this.lengths[i];
        const a = this.points[i];
        const b = this.points[i + 1];
        return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
      }
      acc += this.lengths[i];
    }
    return this.points[this.points.length - 1];
  }

  update(dt, mx, my) {
    // Score against where the dot is *now*, then advance it. Measuring after
    // the step would charge the player for a frame of lag they cannot avoid,
    // and would make the score depend on frame rate.
    const p = this.at(this.t);
    const d = Math.hypot(mx - p.x, my - p.y);
    const hit = d <= this.tolerance;
    this.total += dt;
    if (hit) {
      // Closer to the dot counts for more, so tracking beats hovering nearby.
      this.onTarget += dt * (1 - (d / this.tolerance) * 0.45);
      if (Math.random() < 0.55) {
        this.sparks.push({
          x: p.x, y: p.y,
          vx: (Math.random() * 2 - 1) * 90,
          vy: -Math.random() * 110 - 25,
          life: 0.35 + Math.random() * 0.3, t: 0,
        });
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 420 * dt;
      if (s.t >= s.life) this.sparks.splice(i, 1);
    }
    this.t = Math.min(1, this.t + this.speed * dt);
    return hit;
  }

  get done() {
    return this.t >= 1;
  }

  get score() {
    return this.total > 0 ? clamp(this.onTarget / this.total, 0, 1) : 0;
  }

  render(ctx, opts = {}) {
    // Path.
    ctx.strokeStyle = opts.pathColor || 'rgba(150,170,200,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();

    // Completed portion.
    ctx.strokeStyle = opts.doneColor || Theme.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const f = (i / steps) * this.t;
      const p = this.at(f);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Tolerance ring + head.
    const head = this.at(this.t);
    ctx.strokeStyle = 'rgba(232,163,61,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(head.x, head.y, this.tolerance, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
    ctx.fill();

    for (const s of this.sparks) {
      const a = 1 - s.t / s.life;
      ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * a)},120,${a})`;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
  }
}

/** Spinning needle you stop inside a sector. */
export class TorqueDial {
  constructor(opts = {}) {
    this.angle = 0;
    this.speed = opts.speed ?? 2.4; // radians per second
    this.sector = opts.sector ?? 0.55; // radians, total width
    this.target = opts.target ?? -Math.PI / 2;
    this.lastAccuracy = 0;
    this.flash = 0;
  }

  update(dt) {
    this.angle = (this.angle + this.speed * dt) % (Math.PI * 2);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
  }

  lock() {
    let d = Math.abs(normalizeAngle(this.angle - this.target));
    const half = this.sector / 2;
    const acc = d > half ? 0 : 1 - d / half;
    this.lastAccuracy = acc;
    this.flash = 1;
    return acc;
  }

  advance(rand, { shrink = 0.86, speedUp = 1.16 } = {}) {
    this.target = rand.range(-Math.PI, Math.PI);
    this.sector = Math.max(0.16, this.sector * shrink);
    this.speed *= speedUp;
    if (rand.chance(0.35)) this.speed *= -1; // sometimes it spins the other way
  }

  render(ctx, cx, cy, r) {
    ctx.strokeStyle = Theme.border;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(79,180,119,0.55)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, this.target - this.sector / 2, this.target + this.sector / 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(232,163,61,0.9)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, this.target - this.sector * 0.12, this.target + this.sector * 0.12);
    ctx.stroke();

    ctx.strokeStyle = this.flash > 0
      ? (this.lastAccuracy > 0 ? '#ffe9b0' : '#ff8a80')
      : '#e6edf5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.angle) * (r + 8), cy + Math.sin(this.angle) * (r + 8));
    ctx.stroke();

    ctx.fillStyle = Theme.panelHi;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = Theme.borderHi;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * How much slack a craft gets. Good stock and a skilled crafter widen every
 * window; hard stock narrows it.
 *
 * The floor was raised from 0.62 to 0.85 after play testing: the windows were
 * tight enough that a first-time player mostly produced Crude gear, which made
 * the whole crafting half feel like a punishment rather than a skill.
 */
export function forgiveness(stockWorkability, crafterBonus) {
  return clamp(0.85 + stockWorkability * 0.4 + crafterBonus, 0.8, 1.9);
}

/** Grade text shown after each stage. */
export function gradeFor(score) {
  if (score >= PERFECT) return { text: 'PERFECT', color: Theme.accent };
  if (score >= 0.75) return { text: 'CLEAN', color: Theme.good };
  if (score >= 0.5) return { text: 'PASSABLE', color: Theme.text };
  if (score >= 0.25) return { text: 'ROUGH', color: Theme.warn };
  return { text: 'BOTCHED', color: Theme.bad };
}

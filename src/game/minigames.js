// What is left of the generic crafting widgets.
//
// There were three: an oscillating pointer, a dot to follow, and a spinning
// needle to stop in a sector. The forge used all three and none of them were
// forging -- they were widgets standing next to a picture of an anvil, and they
// have been replaced by simulations of the actual tools in `game/smith.js`.
//
// `TimingBar` survives because the ammo press is genuinely a press: a stroke
// that lands or does not, six times, with no material to shape. Fitting it with
// a simulation would be dressing up a button.
//
// `forgiveness` stays here because every station shares it: a value assembled
// from the stock material's workability and the crafter's skill, so a Gunsmith
// working good steel genuinely has an easier time than a Heavy hammering rebar.

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

// Chem bench mechanics: chop, pour, cook.
//
// Three deliberately different verbs, none of them a timing bar:
//   ChopBoard  -- spatial precision: land the blade on a mark
//   PourBeaker -- analog metering: a tilting vessel with a fixed supply
//   CookPot    -- sustained regulation: hold a temperature without scorching
//
// All of it is pure state plus an `update`, so the physics can be tested
// without a canvas and the scene only has to draw it.

import { clamp } from '../core/util.js';

// ---------------------------------------------------------------------------
// Chopping
// ---------------------------------------------------------------------------

/**
 * A strip of ingredients with guide marks to cut on. The blade tracks the
 * mouse along one axis, so this is aim rather than timing.
 */
export class ChopBoard {
  /**
   * @param {number[]} marks normalised 0..1 positions to cut at
   * @param {object} [opts] `tolerance` in the same normalised units
   */
  constructor(marks, opts = {}) {
    this.marks = marks.map((x) => ({ x, cut: false, acc: 0 }));
    this.tolerance = opts.tolerance ?? 0.055;
    this.lastCut = null;
  }

  /** Nearest mark still waiting for the blade. */
  nextMark(x) {
    let best = null;
    for (const m of this.marks) {
      if (m.cut) continue;
      const d = Math.abs(m.x - x);
      if (!best || d < best.d) best = { m, d };
    }
    return best;
  }

  /**
   * Bring the blade down at `x`.
   * @returns {null|{acc:number, mark:object, wild:boolean}}
   */
  cut(x) {
    const found = this.nextMark(x);
    if (!found) return null;
    const acc = clamp(1 - found.d / this.tolerance, 0, 1);
    found.m.cut = true;
    found.m.acc = acc;
    // A cut nowhere near a mark still ruins that piece -- you cannot re-cut.
    this.lastCut = { acc, mark: found.m, wild: acc === 0, x };
    return this.lastCut;
  }

  get done() {
    return this.marks.every((m) => m.cut);
  }

  /** Final score, once every mark has been dealt with. */
  get score() {
    if (!this.marks.length) return 0;
    return this.marks.reduce((a, m) => a + m.acc, 0) / this.marks.length;
  }

  /**
   * Score over the cuts actually made. Averaging in marks that have not been
   * touched yet makes a flawless board read as a failing one mid-stage.
   */
  get partialScore() {
    const cuts = this.marks.filter((m) => m.cut);
    if (!cuts.length) return 0;
    return cuts.reduce((a, m) => a + m.acc, 0) / cuts.length;
  }
}

/** Evenly spaced marks with a little jitter, so the board is never identical. */
export function chopMarks(rand, count = 5) {
  const marks = [];
  const span = 0.82;
  const start = (1 - span) / 2;
  for (let i = 0; i < count; i++) {
    const base = start + (span * (i + 0.5)) / count;
    marks.push(clamp(base + rand.range(-0.022, 0.022), 0.06, 0.94));
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Pouring
// ---------------------------------------------------------------------------

/** Below this tilt the vessel does not pour at all. */
export const POUR_TILT_THRESHOLD = 0.22;

/**
 * A hand-held vessel with a fixed supply.
 *
 * Holding the button pivots it; the pivot ramps rather than snapping, so the
 * flow has momentum and the player has to anticipate the stop instead of
 * reacting to it. The supply is finite and larger than the mark, so both
 * over-pouring and stopping short are real failures.
 */
export class PourBeaker {
  /**
   * @param {object} opts
   * @param {number} opts.target   how much the recipe wants (same units)
   * @param {number} [opts.capacity] what the vessel holds; defaults to 1.6x
   * @param {number} [opts.tolerance] miss distance worth zero
   */
  constructor(opts = {}) {
    this.target = opts.target ?? 0.55;
    this.capacity = opts.capacity ?? this.target * 1.6;
    this.tolerance = opts.tolerance ?? Math.max(0.15, this.target * 0.44);
    this.remaining = this.capacity;
    this.poured = 0;
    this.spilled = 0;
    this.tilt = 0;
    this.tiltRate = opts.tiltRate ?? 2.1; // how fast the wrist turns
    this.maxFlow = opts.maxFlow ?? 0.38; // units per second at full tilt
    this.settled = false;
  }

  /**
   * @param {number} dt
   * @param {boolean} pouring   button held
   * @param {boolean} overTarget spout is above the receiving vessel
   * @returns {number} how much left the vessel this step
   */
  update(dt, pouring, overTarget) {
    const want = pouring ? 1 : 0;
    // Pivot eases toward the wanted angle; releasing does not stop it dead.
    this.tilt += (want - this.tilt) * clamp(this.tiltRate * dt, 0, 1);
    if (this.tilt < 0.001) this.tilt = 0;

    if (this.tilt <= POUR_TILT_THRESHOLD || this.remaining <= 0) return 0;

    // Flow scales with how far past the lip the liquid is.
    const over = (this.tilt - POUR_TILT_THRESHOLD) / (1 - POUR_TILT_THRESHOLD);
    const amount = Math.min(this.remaining, this.maxFlow * over * over * dt);
    this.remaining -= amount;
    if (overTarget) this.poured += amount;
    else this.spilled += amount;
    return amount;
  }

  /** True once the vessel is upright again and nothing more can come out. */
  get stopped() {
    return this.tilt <= POUR_TILT_THRESHOLD || this.remaining <= 0;
  }

  get score() {
    const d = Math.abs(this.poured - this.target);
    const acc = clamp(1 - d / this.tolerance, 0, 1);
    // Slopping it over the bench is its own penalty, on top of being short.
    const wasteRatio = this.capacity > 0 ? this.spilled / this.capacity : 0;
    return clamp(acc * (1 - wasteRatio * 0.5), 0, 1);
  }

  get fillFraction() {
    return this.capacity > 0 ? clamp(this.remaining / this.capacity, 0, 1) : 0;
  }
}

// ---------------------------------------------------------------------------
// Cooking
// ---------------------------------------------------------------------------

/**
 * A pot over a burner. Heat while the button is held, coast while it is not.
 * Progress only accrues inside the band; above it the mixture scorches. The
 * result is a pumping rhythm rather than a single input.
 */
export class CookPot {
  constructor(opts = {}) {
    this.bandLo = opts.bandLo ?? 0.54;
    this.bandHi = opts.bandHi ?? 0.78;
    this.temp = opts.temp ?? 0;
    this.progress = 0;
    this.scorch = 0;
    this.heatRate = opts.heatRate ?? 0.5;
    this.coolRate = opts.coolRate ?? 0.36;
    this.cookRate = opts.cookRate ?? 0.4;
    this.scorchRate = opts.scorchRate ?? 0.75;
  }

  update(dt, heating) {
    this.temp = clamp(this.temp + (heating ? this.heatRate : -this.coolRate) * dt, 0, 1);

    if (this.temp >= this.bandLo && this.temp <= this.bandHi) {
      this.progress = clamp(this.progress + this.cookRate * dt, 0, 1);
    }
    if (this.temp > this.bandHi) {
      const over = (this.temp - this.bandHi) / Math.max(0.001, 1 - this.bandHi);
      this.scorch = clamp(this.scorch + this.scorchRate * over * dt, 0, 1);
    }
  }

  get inBand() {
    return this.temp >= this.bandLo && this.temp <= this.bandHi;
  }

  get tooHot() {
    return this.temp > this.bandHi;
  }

  get ruined() {
    return this.scorch >= 1;
  }

  get done() {
    return this.progress >= 1 || this.ruined;
  }

  get score() {
    if (this.ruined) return 0;
    return clamp(this.progress * (1 - this.scorch * 0.7), 0, 1);
  }
}

// ---------------------------------------------------------------------------
// Yield
// ---------------------------------------------------------------------------

export const CHEM_STAGE_WEIGHTS = { chop: 0.25, pour: 0.4, cook: 0.35 };

/** Blend the three stage scores into one batch quality. */
export function batchQuality({ chop = 0, pour = 0, cook = 0 }) {
  const w = CHEM_STAGE_WEIGHTS;
  return clamp(chop * w.chop + pour * w.pour + cook * w.cook, 0, 1);
}

/**
 * Medipacks from a finished batch. A scorched batch yields nothing however
 * good the earlier stages were -- burning it is the one unrecoverable mistake.
 */
export function chemYield(quality, ruined = false) {
  if (ruined) return 0;
  if (quality >= 0.85) return 4;
  if (quality >= 0.62) return 3;
  if (quality >= 0.38) return 2;
  if (quality >= 0.14) return 1;
  return 0;
}

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

/** Fraction of the tolerance that reads as a clean cut, not a near miss. */
export const CHOP_CORE_FRACTION = 0.3;
/**
 * Multiples of the tolerance at which a cut is worth nothing at all.
 *
 * A cut just outside the tolerance used to score a flat zero, which made one
 * slip cost a whole piece. Credit now decays past the tolerance instead of
 * falling off a cliff, so only a genuinely wild swing writes a piece off.
 */
export const CHOP_WILD_FACTOR = 2.6;
/** What a cut exactly on the tolerance edge is worth. */
const CHOP_EDGE_CREDIT = 0.35;

/** How good a cut `d` away from its mark is, on a 0..1 scale. */
export function chopAccuracy(d, tolerance) {
  const core = tolerance * CHOP_CORE_FRACTION;
  const dist = Math.abs(d);
  if (dist <= core) return 1;
  if (dist <= tolerance) {
    const t = (dist - core) / Math.max(1e-9, tolerance - core);
    return 1 - (1 - CHOP_EDGE_CREDIT) * t;
  }
  const wild = tolerance * CHOP_WILD_FACTOR;
  if (dist >= wild) return 0;
  const t = (dist - tolerance) / Math.max(1e-9, wild - tolerance);
  return CHOP_EDGE_CREDIT * (1 - t);
}

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
    // `at` is where the blade actually came down, which is what the board has
    // to be drawn from. Splitting the strip at the guide marks instead made a
    // mangled cut produce exactly the same pieces as a perfect one.
    this.marks = marks.map((x) => ({ x, cut: false, acc: 0, at: null }));
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
    const acc = chopAccuracy(found.d, this.tolerance);
    found.m.cut = true;
    found.m.acc = acc;
    found.m.at = x;
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
 * Seconds the stream keeps running after the button comes up, from full tilt.
 *
 * The vessel rights itself at whatever rate makes that true, and the flow tapers
 * with the square of the tilt, so the stream fades out over the second rather
 * than stopping. This is the whole difficulty of the stage: a full second of
 * liquid is committed the moment you decide to stop.
 */
export const POUR_RUN_ON = 1;
const SETTLE_RATE = -Math.log(POUR_TILT_THRESHOLD) / POUR_RUN_ON;

/**
 * The inner slice of the tolerance that counts as a clean measure.
 *
 * Without a plateau the stage cannot actually be won. Matching an analog value
 * to the exact unit means releasing inside a three-millisecond window, so a
 * flawless pour read 97% and the player was being marked down for physics
 * rather than for a mistake. Inside this band the measure is simply right.
 */
export const POUR_SWEET_FRACTION = 0.24;

/**
 * What a measure would score, given how much went in and how much went on the
 * bench. Split out from the class so the bench can ask "what do I get if I
 * stop right now" without mutating anything.
 */
export function pourScore(beaker, poured, spilled = beaker.spilled) {
  const sweet = beaker.tolerance * POUR_SWEET_FRACTION;
  const d = Math.abs(poured - beaker.target);
  const acc = d <= sweet
    ? 1
    : clamp(1 - (d - sweet) / Math.max(1e-6, beaker.tolerance - sweet), 0, 1);
  // Slopping it over the bench is its own penalty, on top of being short.
  const wasteRatio = beaker.capacity > 0 ? spilled / beaker.capacity : 0;
  return clamp(acc * (1 - wasteRatio * 0.5), 0, 1);
}

/**
 * How much more will leave the vessel if the button comes up this instant.
 *
 * The pivot decays rather than snapping upright, so every release dribbles.
 * Shown to the player as a projected mark, this turns the stage from reacting
 * to a number into anticipating one; hidden, it is guesswork.
 */
export function pourProjection(beaker, step = 1 / 60) {
  let tilt = beaker.tilt;
  let remaining = beaker.remaining;
  let extra = 0;
  for (let i = 0; i < 600 && tilt > POUR_TILT_THRESHOLD && remaining > 0; i++) {
    tilt += (0 - tilt) * clamp(beaker.settleRate * step, 0, 1);
    if (tilt <= POUR_TILT_THRESHOLD) break;
    const over = (tilt - POUR_TILT_THRESHOLD) / (1 - POUR_TILT_THRESHOLD);
    const amount = Math.min(remaining, beaker.maxFlow * over * over * step);
    remaining -= amount;
    extra += amount;
  }
  return extra;
}

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
    // Tightened from 0.44: with the old band a 350ms spread of hold times all
    // scored a flat 100%, which is not a measurement, it is a shrug.
    this.tolerance = opts.tolerance ?? Math.max(0.12, this.target * 0.34);
    this.remaining = this.capacity;
    this.poured = 0;
    this.spilled = 0;
    this.tilt = 0;
    this.tiltRate = opts.tiltRate ?? 2.1; // how fast the wrist turns
    /** How fast it rights itself, set so the stream runs on for POUR_RUN_ON. */
    this.settleRate = opts.settleRate ?? SETTLE_RATE;
    this.maxFlow = opts.maxFlow ?? 0.44; // units per second at full tilt
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
    // Pivot eases toward the wanted angle, and rights itself more slowly than
    // it tips: releasing does not stop it dead, it commits a second of liquid.
    const rate = pouring ? this.tiltRate : this.settleRate;
    this.tilt += (want - this.tilt) * clamp(rate * dt, 0, 1);
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
    return pourScore(this, this.poured);
  }

  /** Half-width of the band around the mark that reads as a clean measure. */
  get sweet() {
    return this.tolerance * POUR_SWEET_FRACTION;
  }

  get fillFraction() {
    return this.capacity > 0 ? clamp(this.remaining / this.capacity, 0, 1) : 0;
  }
}

/** Puddles closer together than this run into one instead of stacking up. */
export const SPILL_MERGE = 26;

/**
 * Record liquid hitting the bench.
 *
 * The mess accumulates and it stays put: a spill that vanished the moment you
 * stopped pouring was not a consequence, it was an animation. Puddles that
 * touch merge, and the centre drifts towards whichever side has more in it.
 *
 * @param {Array<{x:number, amount:number, color:string}>} spills mutated in place
 */
export function addSpill(spills, x, amount, color) {
  const near = spills.find((s) => Math.abs(s.x - x) < SPILL_MERGE && s.color === color);
  if (near) {
    const total = near.amount + amount;
    near.x = (near.x * near.amount + x * amount) / total;
    near.amount = total;
    return near;
  }
  const made = { x, amount, color };
  spills.push(made);
  return made;
}

// ---------------------------------------------------------------------------
// Cooking
// ---------------------------------------------------------------------------

/**
 * A pot over a burner. Heat while the button is held, coast while it is not.
 *
 * Progress only accrues inside the band. Above it the mixture scorches; below
 * it -- once it has been up to temperature at least once -- it goes dull. That
 * second rule is what makes the stage a hold rather than a climb: reaching the
 * simmer is not the achievement, staying there is.
 */
export class CookPot {
  constructor(opts = {}) {
    // Centred on 0.66. Deliberately narrow: at 0.54-0.78 the band was wide
    // enough that a single push of the burner sat inside it for free.
    this.bandLo = opts.bandLo ?? 0.552;
    this.bandHi = opts.bandHi ?? 0.768;
    this.temp = opts.temp ?? 0;
    this.progress = 0;
    this.scorch = 0;
    this.dull = 0;
    /** Set the first time it reaches temperature; nothing dulls before that. */
    this.started = false;
    this.heatRate = opts.heatRate ?? 0.5;
    this.coolRate = opts.coolRate ?? 0.36;
    this.cookRate = opts.cookRate ?? 0.4;
    this.scorchRate = opts.scorchRate ?? 0.75;
    this.dullRate = opts.dullRate ?? 0.55;
  }

  update(dt, heating) {
    this.temp = clamp(this.temp + (heating ? this.heatRate : -this.coolRate) * dt, 0, 1);

    if (this.inBand) {
      this.started = true;
      this.progress = clamp(this.progress + this.cookRate * dt, 0, 1);
    } else if (this.temp > this.bandHi) {
      const over = (this.temp - this.bandHi) / Math.max(0.001, 1 - this.bandHi);
      this.scorch = clamp(this.scorch + this.scorchRate * over * dt, 0, 1);
    } else if (this.started) {
      // Letting it fall away after it has simmered leaves the mix flat. The
      // further below temperature it drops, the faster that happens.
      const under = (this.bandLo - this.temp) / Math.max(0.001, this.bandLo);
      this.dull = clamp(this.dull + this.dullRate * under * dt, 0, 1);
    }
  }

  get inBand() {
    return this.temp >= this.bandLo && this.temp <= this.bandHi;
  }

  get tooHot() {
    return this.temp > this.bandHi;
  }

  /** Below temperature after having reached it -- actively going dull. */
  get tooCold() {
    return this.started && this.temp < this.bandLo;
  }

  get ruined() {
    return this.scorch >= 1;
  }

  get done() {
    return this.progress >= 1 || this.ruined;
  }

  get score() {
    if (this.ruined) return 0;
    // Scorching is the harsher of the two: a dull batch is weak, a burnt one is
    // waste. Dull alone can never take the whole batch.
    return clamp(this.progress * (1 - this.scorch * 0.7) * (1 - this.dull * 0.55), 0, 1);
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

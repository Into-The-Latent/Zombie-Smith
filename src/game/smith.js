// The forge, as mechanics.
//
// The three stages used to be a bar, a dot and a dial: generic minigame
// widgets standing next to a picture of an anvil. Nothing about stopping an
// oscillating pointer is hammering, and none of them left a mark on the thing
// being made -- you could not tell a botched blank from a perfect one by
// looking at it, only by reading the grade afterwards.
//
// They are simulations now, built on the same three rules that made the chem
// bench work:
//
//   The tool is the cursor. You hold the hammer, the blade, the wrench. There
//   is no widget between your hand and the work.
//
//   The material carries the result. A blank that was hammered badly is a
//   visibly bad shape; a burnt edge is blue; a stripped bolt spins. The score
//   is a reading of the object, never a separate number kept alongside it.
//
//   You can add but rarely take away. Metal moved is metal moved, stock ground
//   off is gone, a thread once stripped stays stripped. That is what makes a
//   decision cost something.
//
// Rendering lives in scenes/forge.js. Nothing here draws.

import { clamp } from '../core/util.js';

// ---------------------------------------------------------------------------
// Shape -- drawing a blank down to a profile
// ---------------------------------------------------------------------------

/**
 * Samples along the bar.
 *
 * Short on purpose, and it is the number the whole stage turns on. Metal only
 * leaves the piece off the ends -- that is how a bar gets drawn down in reality,
 * by growing longer until the ends are trimmed -- so a bar that is long compared
 * to how far a blow throws metal can never lose volume in the middle. Measured
 * against a spread that reaches fourteen cells: at 60 cells ideal play stalls at
 * an error of 0.137 and the target is unreachable; at 24 it settles at 0.012.
 */
export const BLANK_CELLS = 24;

/** Starting thickness, in the same arbitrary units the targets use. */
export const BLANK_THICKNESS = 1;

/**
 * The hammer face, and how far the metal it displaces travels.
 *
 * Two overlapping bells rather than a face and a separate ring. The first
 * version took metal from under the face and put it back in a band five to nine
 * cells out, which is not how steel behaves and produced exactly what you would
 * expect from a source and a distant sink: standing waves. Measured, a hundred
 * blows of ideal play left towers of 1.75 thickness against a target of 0.88,
 * spaced fifteen cells apart, and the error climbed the longer you worked.
 *
 * Removing over a narrow bell and depositing over a wide one that covers it
 * means every blow leaves a smooth dip with a gentle swell around it -- the
 * shape a hammer actually leaves -- and repeated blows blend instead of
 * interfering.
 */
/** How deep the face bites. Set from a sweep: a good play should take about
 * thirty blows, and a bigger bite buys fewer blows at the cost of a coarser
 * floor, because it starts overshooting the shape it is chasing. */
export const HAMMER_BITE = 0.18;
export const HAMMER_FACE = 2.2;
export const HAMMER_SPREAD = 5.6;
/** Where the deposit bell is truncated, in cells. */
const SPREAD_REACH = 14;

/** Error at or under which a blank is as true as hand work gets. */
export const SHAPE_PERFECT = 0.032;

/** Below this the steel is too cold to move and starts to crack instead. */
export const COLD = 0.32;
/** Above this it is soft enough that a blow overshoots badly. */
export const HOT = 0.82;

/**
 * How readily the metal moves at a given heat.
 *
 * Deliberately not monotonic. Too cold and nothing happens; too hot and it
 * moves so far you cannot place it. The controllable band is in the middle,
 * which is the whole reason the heat gauge is a resource worth managing rather
 * than a bar to keep topped up.
 */
export function plasticity(heat) {
  const h = clamp(heat, 0, 1);
  if (h < COLD) return 0.12 + (h / COLD) * 0.5;
  if (h > HOT) return 1.35 + (h - HOT) * 1.6;
  return 0.62 + ((h - COLD) / (HOT - COLD)) * 0.5;
}

/** Chance a blow on metal this cold opens a crack. */
export function crackRisk(heat) {
  const h = clamp(heat, 0, 1);
  return h >= COLD ? 0 : (1 - h / COLD) ** 1.6 * 0.55;
}

/**
 * The shape a given weapon wants, as thickness per cell along the bar.
 *
 * Read left to right as haft, core, edge. A blade tapers hard to one end; a gun
 * part is mostly a straight run with a block at the breech. The target is drawn
 * behind the blank, so "am I finished" is a question about a picture rather
 * than about a percentage.
 */
export function targetProfile(kind, cells = BLANK_CELLS) {
  const out = new Float64Array(cells);
  for (let i = 0; i < cells; i++) {
    const f = i / (cells - 1);
    // Smooth and monotonic, starting at exactly the bar's own thickness.
    //
    // Both properties are load-bearing. A step in the target -- a heavy tang
    // that stops dead where the body begins -- is a shape a hammer with a
    // four-cell face physically cannot produce, and measured, it left an error
    // floor above the tolerance so a perfect play still scored zero. Monotonic
    // means every blow's surplus travels the same way, toward the thin end and
    // off it, instead of being chased back and forth.
    out[i] = kind === 'gun'
      ? BLANK_THICKNESS - 0.3 * f ** 2.1
      : BLANK_THICKNESS - 0.55 * f ** 1.7;
  }
  return out;
}

/**
 * A bar of hot steel on the anvil.
 *
 * The one physical rule is that metal is conserved: a blow does not delete
 * thickness, it pushes it sideways. That is what turns the stage into a
 * problem -- you cannot thin everything, you can only decide where the metal
 * ends up, and a blow in the wrong place has to be fixed by moving the metal
 * back, which costs heat you do not have.
 */
export class Blank {
  constructor({ kind = 'melee', cells = BLANK_CELLS, forgiveness = 1 } = {}) {
    this.cells = cells;
    this.kind = kind;
    this.forgiveness = forgiveness;
    this.thickness = new Float64Array(cells).fill(BLANK_THICKNESS);
    this.heat = new Float64Array(cells).fill(0.92);
    this.target = targetProfile(kind, cells);
    /** Cell indices that cracked. Permanent. */
    this.cracks = [];
    /** Work done per cell, which is where the edge/core/haft split comes from. */
    this.work = new Float64Array(cells);
    this.blows = 0;
    this.lastBlow = null;
    /** Metal driven off the ends. Gone, and worth showing. */
    this.flash = 0;
  }

  /** Mean heat, for the gauge. */
  get heatAvg() {
    let t = 0;
    for (let i = 0; i < this.cells; i++) t += this.heat[i];
    return t / this.cells;
  }

  /**
   * Cooling, plus the detail that makes the bar interesting to work: thin
   * sections lose heat faster, so the parts you have already drawn down are the
   * parts that go cold on you first.
   */
  tick(dt, rate = 0.075) {
    for (let i = 0; i < this.cells; i++) {
      const thin = clamp(1.55 - this.thickness[i], 0.7, 1.7);
      this.heat[i] = Math.max(0, this.heat[i] - dt * rate * thin);
    }
    // Conduction, so the bar does not end up with a striped heat pattern that
    // reads as a bug rather than as metal.
    const next = Float64Array.from(this.heat);
    for (let i = 0; i < this.cells; i++) {
      const l = this.heat[Math.max(0, i - 1)];
      const r = this.heat[Math.min(this.cells - 1, i + 1)];
      next[i] += (l + r - 2 * this.heat[i]) * Math.min(0.5, dt * 2.2);
    }
    this.heat = next;
  }

  /** Back into the coals: the whole bar comes up, and the fire pays for it. */
  reheat() {
    for (let i = 0; i < this.cells; i++) this.heat[i] = 0.92;
  }

  /**
   * One blow, centred on `cell`.
   *
   * @returns {{moved:number, cracked:boolean, heat:number, cell:number}}
   */
  strike(cell, power = 1, rand = null) {
    const c = clamp(Math.round(cell), 0, this.cells - 1);
    const heat = this.heat[c];
    const plast = plasticity(heat);

    this.blows += 1;
    this.lastBlow = { cell: c, heat, at: 0 };

    // Cold steel cracks instead of moving. A crack is permanent and it is the
    // stage's one outright failure, so it is announced rather than quietly
    // subtracted.
    const risk = crackRisk(heat);
    const roll = rand ? rand.next() : Math.random();
    if (risk > 0 && roll < risk) {
      if (!this.cracks.includes(c)) this.cracks.push(c);
      this.lastBlow.cracked = true;
      return { moved: 0, cracked: true, heat, cell: c };
    }

    // Bite: a narrow bell under the face. Thicker metal moves more, which is
    // why a bar flattens toward its target instead of digging a pit wherever
    // you happen to keep hitting.
    const depth = HAMMER_BITE * power * plast;
    let total = 0;
    for (let d = -8; d <= 8; d++) {
      const i = c + d;
      if (i < 0 || i >= this.cells) continue;
      const k = Math.exp(-((d / HAMMER_FACE) ** 2));
      const take = Math.min(this.thickness[i] - 0.08, depth * k * this.thickness[i]);
      if (take > 0) {
        this.thickness[i] -= take;
        this.work[i] += take;
        total += take;
      }
    }

    // Flow: a wider bell covering the face, so the displaced metal swells the
    // shoulders of the dip rather than appearing in a ring away from it.
    // Whatever share of that bell falls off the end of the bar leaves as flash
    // and is gone -- the one place volume is lost, and what makes a target
    // holding less steel than the bar reachable at all.
    let share = 0;
    const weights = [];
    for (let d = -SPREAD_REACH; d <= SPREAD_REACH; d++) {
      const w = Math.exp(-((d / HAMMER_SPREAD) ** 2));
      weights.push([c + d, w]);
      share += w;
    }
    for (const [i, w] of weights) {
      const give = total * (w / share);
      if (i < 0 || i >= this.cells) this.flash += give;
      else this.thickness[i] += give;
    }

    // Working steel bleeds heat into the anvil and the hammer.
    for (let d = -4; d <= 4; d++) {
      const i = c + d;
      if (i >= 0 && i < this.cells) this.heat[i] = Math.max(0, this.heat[i] - 0.045);
    }

    return { moved: total, cracked: false, heat, cell: c };
  }

  /** Mean absolute distance from the target shape. Lower is better. */
  get error() {
    let e = 0;
    for (let i = 0; i < this.cells; i++) e += Math.abs(this.thickness[i] - this.target[i]);
    return e / this.cells;
  }

  /**
   * How close the bar is to the shape asked for, 0..1.
   *
   * A plateau first, then a slope. Below `SHAPE_PERFECT` of error the blank is
   * as good as hand work gets and scores full marks -- without that band even
   * flawless play tops out around 0.84, because a hammer cannot land a bar
   * exactly on a curve, and a stage whose best possible result is a B is a
   * stage that feels broken. The pour needed the same fix for the same reason.
   *
   * The tolerance below the band is what `forgiveness` widens, so good stock
   * and a skilled smith are easier to shape true -- the same lever every other
   * stage uses.
   */
  get score() {
    const tol = 0.16 * this.forgiveness;
    const over = Math.max(0, this.error - SHAPE_PERFECT);
    const shaped = clamp(1 - over / tol, 0, 1);
    // Each crack costs a fixed slice. Three of them ruin a blank, which is
    // roughly what it takes to be hammering cold metal on purpose.
    return clamp(shaped * (1 - this.cracks.length * 0.22), 0, 1);
  }

  /**
   * Where the work went, as edge/core/haft weights.
   *
   * Emergent now rather than chosen from a menu: it is a reading of which third
   * of the bar you actually spent your blows on. Left is the haft.
   */
  get profile() {
    const third = Math.floor(this.cells / 3);
    let haft = 0;
    let core = 0;
    let edge = 0;
    for (let i = 0; i < this.cells; i++) {
      if (i < third) haft += this.work[i];
      else if (i < third * 2) core += this.work[i];
      else edge += this.work[i];
    }
    const total = haft + core + edge;
    if (total <= 0) return { edge: 1, core: 1, haft: 1 };
    return { edge, core, haft };
  }

  /** Named reason the blank is poor, for the report. */
  get fault() {
    if (this.cracks.length >= 3) return 'cracked through';
    if (this.cracks.length) return `${this.cracks.length} crack${this.cracks.length > 1 ? 's' : ''}`;
    if (this.error > 0.3) return 'never came to shape';
    return '';
  }
}

// ---------------------------------------------------------------------------
// Grind -- taking an edge down against the wheel
// ---------------------------------------------------------------------------

export const EDGE_CELLS = 60;
/** Stock that has to come off before a cell is sharp. */
export const EDGE_TARGET = 1;
/** Past this the cell is ground through -- thin, weak, and not recoverable. */
export const EDGE_RUIN = 1.55;
/** Temper heat past this burns the steel blue. Permanent. */
export const BURN = 1;
/** Mean deviation at or under which the bevel is as even as hand work gets. */
export const EDGE_PERFECT = 0.075;

/**
 * The edge, held against a spinning wheel.
 *
 * Pressure removes stock and makes heat in the same place at the same time,
 * which is the whole tension of the stage: the fastest way to grind is also the
 * way to burn the temper out of what you are grinding.
 */
export class Edge {
  constructor({ cells = EDGE_CELLS, forgiveness = 1 } = {}) {
    this.cells = cells;
    this.forgiveness = forgiveness;
    /** Stock removed per cell. */
    this.ground = new Float64Array(cells);
    /** Working heat per cell. */
    this.temper = new Float64Array(cells);
    /** Cells whose temper is gone. Permanent. */
    this.burnt = new Uint8Array(cells);
    this.sparks = 0;
    this.contact = 0;
  }

  /**
   * Hold the edge against the wheel at `cell` with `pressure` (0..1).
   *
   * @returns {{removed:number, burning:boolean, ruined:boolean}}
   */
  press(cell, pressure, dt) {
    const c = clamp(Math.round(cell), 0, this.cells - 1);
    const p = clamp(pressure, 0, 1);
    this.contact += dt;
    let removed = 0;
    let ruined = false;

    // The wheel touches a short span, not a point.
    for (let d = -2; d <= 2; d++) {
      const i = c + d;
      if (i < 0 || i >= this.cells) continue;
      const k = 1 - Math.abs(d) / 3;
      const cut = p * 1.4 * k * dt;
      this.ground[i] += cut;
      removed += cut;
      // Friction heat, and it climbs with the square of pressure so leaning on
      // the wheel is self-defeating: measured, at full pressure the steel goes
      // blue at 0.55s and does not come sharp until 0.72s, so the fastest-looking
      // way to grind burns the edge before it ever cuts it. Three-quarter
      // pressure is the honest ceiling and it has to be found, not read.
      this.temper[i] += p * p * 2.6 * k * dt;
      if (this.temper[i] >= BURN) this.burnt[i] = 1;
      if (this.ground[i] > EDGE_RUIN) ruined = true;
    }
    this.sparks = p;
    return { removed, burning: this.temper[c] > BURN * 0.72, ruined };
  }

  /** Off the wheel: heat bleeds away, along the edge and into the air. */
  tick(dt, touching = false) {
    if (!touching) this.sparks = Math.max(0, this.sparks - dt * 4);
    const cool = touching ? 0.28 : 0.85;
    const next = Float64Array.from(this.temper);
    for (let i = 0; i < this.cells; i++) {
      next[i] = Math.max(0, next[i] - dt * cool);
      const l = this.temper[Math.max(0, i - 1)];
      const r = this.temper[Math.min(this.cells - 1, i + 1)];
      next[i] += (l + r - 2 * this.temper[i]) * Math.min(0.5, dt * 1.8);
    }
    this.temper = next;
  }

  /** 0 = untouched, 1 = a clean even bevel all the way along. */
  get score() {
    const tol = 0.42 * this.forgiveness;
    let err = 0;
    let burnt = 0;
    for (let i = 0; i < this.cells; i++) {
      // Over-grinding is worse than under-grinding: a dull edge can go back on
      // the wheel, a thin one is already ruined.
      const d = this.ground[i] - EDGE_TARGET;
      err += d > 0 ? d * 1.6 : -d;
      burnt += this.burnt[i];
    }
    // The same plateau the shape stage has, and for the same reason: an edge
    // ground by hand is never mathematically even, and a stage whose best
    // possible result is a B reads as broken rather than as hard.
    const over = Math.max(0, err / this.cells - EDGE_PERFECT);
    const even = clamp(1 - over / tol, 0, 1);
    return clamp(even * (1 - (burnt / this.cells) * 0.8), 0, 1);
  }

  get burntCells() {
    let n = 0;
    for (let i = 0; i < this.cells; i++) n += this.burnt[i];
    return n;
  }

  /** Fraction of the edge still needing work, for the readout. */
  get remaining() {
    let n = 0;
    for (let i = 0; i < this.cells; i++) if (this.ground[i] < EDGE_TARGET * 0.85) n += 1;
    return n / this.cells;
  }

  get fault() {
    const b = this.burntCells;
    if (b > this.cells * 0.25) return 'temper burnt out';
    if (b) return 'a burnt patch';
    if (this.remaining > 0.3) return 'left half dull';
    return '';
  }
}

// ---------------------------------------------------------------------------
// Fit -- torquing the fasteners
// ---------------------------------------------------------------------------

/** Where the thread starts to bite. Below this you are just spinning it in. */
export const BOLT_SEAT = 0.55;
/** Correct tension sits here. */
export const BOLT_TARGET = 0.78;
/** Past this the thread strips. Permanent, and the bolt is worthless. */
export const BOLT_STRIP = 1;

/**
 * One fastener.
 *
 * The dial it replaces spun on its own and asked you to react. This does the
 * opposite: nothing happens until you turn it, and everything that happens is
 * something you did. Torque climbs slowly while the bolt is still winding in
 * and then steeply once the head seats, so the last quarter turn is the whole
 * decision -- exactly the shape of the pour, and for the same reason: you can
 * always tighten more, and you can never back it off.
 */
export class Bolt {
  constructor({ forgiveness = 1, seat = BOLT_SEAT } = {}) {
    this.torque = 0;
    this.seat = seat;
    this.forgiveness = forgiveness;
    this.stripped = false;
    this.done = false;
    this.turning = false;
    /** Total rotation, for drawing the head turning. */
    this.turned = 0;
  }

  /** Half-width of the band that counts as correct. */
  get band() {
    return 0.09 * this.forgiveness;
  }

  /**
   * How fast torque is climbing right now: quick while the bolt winds in, then
   * slow and stiffening once the head seats.
   *
   * The first curve made the whole decision 0.15 seconds wide, with 0.05
   * seconds between correct and stripped. That is a reflex test, not a
   * judgement -- and the point of replacing the spinning dial was to stop
   * asking for reflexes. Measured now: about 0.6s inside the band and a third
   * of a second of overshoot before the thread goes.
   */
  rate() {
    return this.torque < this.seat ? 0.6 : 0.16 + (this.torque - this.seat) * 0.55;
  }

  update(dt, turning) {
    this.turning = turning && !this.done;
    if (!this.turning) return;
    this.torque += this.rate() * dt;
    // The head keeps turning while it winds in and barely moves once it seats,
    // so the picture and the gauge say the same thing.
    this.turned += dt * (this.torque < this.seat ? 5.5 : 1.2);
    if (this.torque >= BOLT_STRIP) {
      this.stripped = true;
      this.done = true;
      this.torque = BOLT_STRIP;
    }
  }

  /** Let go. Whatever tension is on it is the tension it keeps. */
  release() {
    if (this.done) return this.score;
    this.done = true;
    return this.score;
  }

  get score() {
    if (this.stripped) return 0;
    const d = Math.abs(this.torque - BOLT_TARGET);
    if (d <= this.band) return 1;
    // Loose is recoverable in principle and tight is not, so slack is judged
    // gently and overshoot is judged hard.
    const over = this.torque > BOLT_TARGET;
    const falloff = over ? 0.16 : 0.42;
    return clamp(1 - (d - this.band) / falloff, 0, 1);
  }

  get state() {
    if (this.stripped) return 'stripped';
    if (!this.done) return 'turning';
    if (this.torque < BOLT_TARGET - this.band) return 'loose';
    if (this.torque > BOLT_TARGET + this.band) return 'overtight';
    return 'seated';
  }
}

/** The whole assembly: the mean of its bolts, with a stripped one hurting most. */
export function fitScore(bolts) {
  if (!bolts.length) return 0;
  const mean = bolts.reduce((a, b) => a + b.score, 0) / bolts.length;
  const stripped = bolts.filter((b) => b.stripped).length;
  return clamp(mean * (1 - stripped * 0.15), 0, 1);
}

export function fitFault(bolts) {
  const stripped = bolts.filter((b) => b.stripped).length;
  if (stripped) return `${stripped} stripped thread${stripped > 1 ? 's' : ''}`;
  if (bolts.some((b) => b.state === 'loose')) return 'left rattling';
  return '';
}

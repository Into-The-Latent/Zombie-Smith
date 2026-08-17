// Chem bench mechanics. The physics matters more than the numbers here: a
// pour has momentum and a cook has lag, so each stage is simulated at a real
// frame rate to prove it is winnable by a human and losable by a careless one.

import { describe, test, assert, equal, close, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  ChopBoard, chopMarks, PourBeaker, CookPot,
  batchQuality, chemYield, pourScore, pourProjection, addSpill, SPILL_MERGE,
  chopAccuracy, CHOP_CORE_FRACTION, CHOP_WILD_FACTOR,
  VESSEL, VESSEL_HEADROOM, headAt, surfaceAt, lipAt, toMl, mlLabel, ML_PER_UNIT,
} from '../src/game/chem.js';
import { SITE_PALETTE, sitePalette, LIGHT_DIR, FACE_SHADE } from '../src/ui/palette.js';

const FRAME = 1 / 60;

describe('chopping', () => {
  test('landing on a mark scores 1 and a wild swing scores 0', () => {
    const b = new ChopBoard([0.2, 0.5, 0.8], { tolerance: 0.05 });
    equal(b.cut(0.5).acc, 1, 'dead on the mark');
    equal(b.cut(0.8 + 0.05 * CHOP_WILD_FACTOR).acc, 0, 'nowhere near it');
    assert(b.cut(0.2 + 0.05).acc > 0, 'but the tolerance edge is not a write-off');
  });

  test('credit decays past the tolerance instead of falling off a cliff', () => {
    // The reported problem: one slip cost a whole piece, because anything
    // outside the tolerance scored a flat zero.
    const tol = 0.05;
    equal(chopAccuracy(0, tol), 1);
    equal(chopAccuracy(tol * CHOP_CORE_FRACTION, tol), 1, 'the core reads as clean');
    assert(chopAccuracy(tol * 0.6, tol) < 1, 'and outside the core it starts costing');
    assert(chopAccuracy(tol, tol) > 0.2, 'the tolerance edge still earns something');
    assert(chopAccuracy(tol * 1.5, tol) > 0, 'so does a near miss beyond it');
    equal(chopAccuracy(tol * CHOP_WILD_FACTOR, tol), 0, 'only a wild swing earns nothing');
    equal(chopAccuracy(tol * 8, tol), 0);
    equal(chopAccuracy(-tol * 0.2, tol), 1, 'which side of the mark makes no difference');

    // Monotone all the way out, so there is never a reason to aim worse.
    let prev = Infinity;
    for (let d = 0; d <= tol * 3; d += tol / 40) {
      const a = chopAccuracy(d, tol);
      assert(a <= prev + 1e-9, `accuracy rose again at ${(d / tol).toFixed(2)} tolerances`);
      prev = a;
    }
  });

  test('one bad cut costs one piece, not the board', () => {
    // The cascade the player hit: a miss consumes the nearest mark, so the next
    // click is judged against a mark they were not aiming at. The bench now
    // shows which mark is next, so the honest test is that a player who misses
    // once and then keeps aiming at the marks still standing is not ruined.
    const marks = [0.16, 0.32, 0.5, 0.66, 0.83];
    const b = new ChopBoard(marks, { tolerance: 0.055 });
    b.cut(0.24); // a real miss, halfway between the first two marks
    for (const m of marks.slice(1)) b.cut(m);
    assert(b.marks.every((m) => m.cut));
    assert(b.score > 0.8, `one miss out of five left the board at ${(b.score * 100).toFixed(0)}%`);
  });

  test('even a full cascade is survivable rather than a zero', () => {
    // Every cut landing between two marks -- the worst realistic case.
    const marks = [0.16, 0.32, 0.5, 0.66, 0.83];
    const b = new ChopBoard(marks, { tolerance: 0.055 });
    for (const m of marks) b.cut(m + 0.08);
    assert(b.score > 0.15, `a wholly mistimed board scored ${(b.score * 100).toFixed(0)}%`);
    assert(b.score < 0.5, 'but it is still clearly a bad board');
  });

  test('it always resolves against the nearest uncut mark', () => {
    const b = new ChopBoard([0.2, 0.8], { tolerance: 0.1 });
    equal(b.cut(0.21).mark.x, 0.2);
    // 0.2 is used up, so a cut near it now resolves against 0.8 and misses.
    const second = b.cut(0.21);
    equal(second.mark.x, 0.8);
    equal(second.acc, 0);
  });

  test('a mark cannot be cut twice and the board finishes', () => {
    const b = new ChopBoard([0.3, 0.6], { tolerance: 0.1 });
    b.cut(0.3);
    b.cut(0.6);
    assert(b.done);
    equal(b.cut(0.3), null, 'a finished board should refuse further cuts');
  });

  test('score is the mean of every cut', () => {
    const b = new ChopBoard([0.2, 0.5], { tolerance: 0.1 });
    const first = b.cut(0.2);
    const second = b.cut(0.55);
    equal(first.acc, 1);
    assert(second.acc > 0 && second.acc < 1, 'a half-tolerance miss is a partial cut');
    close(b.score, (first.acc + second.acc) / 2, 1e-9);
  });

  test('the live score reflects the cuts made, not the ones still to come', () => {
    const b = new ChopBoard([0.2, 0.5, 0.8], { tolerance: 0.1 });
    equal(b.partialScore, 0, 'nothing cut yet');
    b.cut(0.2);
    equal(b.partialScore, 1, 'one perfect cut should read as perfect, not as a third of one');
    close(b.score, 1 / 3, 1e-9, 'while the final score still accounts for the whole board');
    b.cut(0.5);
    equal(b.partialScore, 1);
    b.cut(0.8);
    close(b.partialScore, b.score, 1e-9, 'and the two agree once the board is done');
  });

  test('the board remembers where the blade actually landed', () => {
    // The board is drawn from these, so a sloppy cut has to produce visibly
    // uneven pieces. Splitting the strip at the guide marks instead made a
    // mangled board look identical to a flawless one.
    const b = new ChopBoard([0.3, 0.7], { tolerance: 0.1 });
    b.cut(0.34);
    b.cut(0.7);
    equal(b.marks[0].at, 0.34, 'the miss has to be recorded where it happened');
    equal(b.marks[0].x, 0.3, 'and the mark it was aiming at kept alongside it');
    equal(b.marks[1].at, 0.7);
    assert(b.marks.every((m) => m.at !== null), 'every cut mark carries a position');
  });

  test('an uncut mark has no blade position at all', () => {
    const b = new ChopBoard([0.3, 0.7], { tolerance: 0.1 });
    equal(b.marks[0].at, null, 'nothing to draw until it is cut');
    equal(b.marks[1].at, null);
  });

  test('generated marks are spread out and stay on the board', () => {
    const rand = makeRng(7);
    for (let i = 0; i < 40; i++) {
      const marks = chopMarks(rand, 5);
      equal(marks.length, 5);
      for (const m of marks) between(m, 0.05, 0.95);
      // No two marks so close that one cut could plausibly serve both.
      const sorted = [...marks].sort((a, b) => a - b);
      for (let k = 1; k < sorted.length; k++) {
        assert(sorted[k] - sorted[k - 1] > 0.08,
          `marks ${sorted[k - 1].toFixed(3)} and ${sorted[k].toFixed(3)} are too close together`);
      }
    }
  });
});

describe('the pouring lip', () => {
  const deg = (rad) => (rad * 180) / Math.PI;
  /** The angle at which a vessel this full first pours. */
  const tipAngle = (fill) => {
    for (let a = 0; a <= VESSEL.maxAngle; a += 0.0005) {
      if (headAt(a, fill) > 0) return a;
    }
    return Infinity;
  };

  test('nothing pours from a vessel standing upright', () => {
    // The reported bug: liquid came out at a fixed tilt, at angles where the
    // drawn liquid was visibly nowhere near the lip.
    for (const ff of [1, 0.75, 0.5, 0.25]) {
      assert(headAt(0, ff * VESSEL_HEADROOM) < 0, `${ff * 100}% full poured at rest`);
    }
  });

  test('a fuller vessel pours at a shallower angle', () => {
    const angles = [1, 0.8, 0.6, 0.45].map((ff) => tipAngle(ff * VESSEL_HEADROOM));
    for (let i = 1; i < angles.length; i++) {
      assert(angles[i] > angles[i - 1],
        `emptier should need more tilt (${deg(angles[i - 1]).toFixed(0)} then ${deg(angles[i]).toFixed(0)})`);
    }
    between(deg(angles[0]), 8, 25, `a brim-full vessel tips out at ${deg(angles[0]).toFixed(0)} degrees`);
    assert(deg(angles[angles.length - 1]) > 55,
      'and a half-empty one has to be turned right over');
  });

  test('every angle the vessel can reach is still usable', () => {
    // If the mark sat beyond the wrist's range the stage would be unwinnable, and
    // if a full vessel poured at the very first degree there would be no control.
    const b = new PourBeaker({ target: 0.5 });
    const atMark = 1 - b.target / b.capacity;
    assert(tipAngle(atMark * VESSEL_HEADROOM) < VESSEL.maxAngle,
      'the vessel must still pour once enough has come out to reach the mark');
    assert(tipAngle(VESSEL_HEADROOM) > 0.1, 'and a full one must not pour at a nudge');
  });

  test('the surface sits inside the vessel at every angle', () => {
    // The renderer draws from these, so a surface outside the glass would show.
    for (let a = 0; a <= VESSEL.maxAngle; a += 0.05) {
      for (const fill of [0, 0.4, VESSEL_HEADROOM]) {
        const half = (VESSEL.h * Math.abs(Math.cos(a)) + VESSEL.w * Math.abs(Math.sin(a))) / 2;
        between(surfaceAt(a, fill), -half - 1e-9, half + 1e-9);
      }
    }
  });

  test('the lip swings from the top of the vessel to its lowest point', () => {
    assert(lipAt(0) < 0, 'upright, the lip is the highest part of the glass');
    assert(lipAt(VESSEL.maxAngle) > 0, 'upended, it is the lowest -- so it all runs out');
    for (let a = 0.05; a <= VESSEL.maxAngle; a += 0.05) {
      assert(lipAt(a) > lipAt(a - 0.05), 'and it only ever drops as the wrist turns');
    }
  });

  test('the beaker reports the tilt it needs to start pouring', () => {
    const b = new PourBeaker({ target: 0.5 });
    assert(!b.pouring, 'upright and full, nothing comes out');
    b.tilt = b.tiltToPour * 0.98;
    assert(!b.pouring, `just short of ${b.tiltToPour.toFixed(3)} it still holds`);
    b.tilt = Math.min(1, b.tiltToPour * 1.05);
    assert(b.pouring, 'just past it, it goes');
  });

  test('the tilt needed climbs as the vessel empties', () => {
    const b = new PourBeaker({ target: 0.5 });
    const needed = [];
    for (let i = 0; i < 4; i++) {
      needed.push(b.tiltToPour);
      b.remaining -= b.capacity * 0.15;
    }
    for (let i = 1; i < needed.length; i++) {
      assert(needed[i] > needed[i - 1],
        `keeping it running means tilting further (${needed[i - 1].toFixed(2)} then ${needed[i].toFixed(2)})`);
    }
  });
});

describe('millilitres', () => {
  test('internal units convert to whole millilitres', () => {
    equal(ML_PER_UNIT, 100);
    equal(toMl(0.5), 50);
    equal(toMl(0.624), 62);
    equal(toMl(0), 0);
    equal(mlLabel(0.44), '44 ml');
  });

  test('a beaker holds and measures sensible amounts for a medipack', () => {
    const b = new PourBeaker({ target: 0.5 });
    equal(toMl(b.target), 50, 'a 50 ml measure');
    between(toMl(b.capacity), 90, 200, 'out of a beaker that holds a plausible amount');
    between(toMl(b.sweet), 2, 8, 'and a clean measure is a few ml either way');
  });
});

describe('pouring', () => {
  /** The hold time that lands nearest the mark, the way a player learns it. */
  function bestHold(target) {
    let best = null;
    for (let hold = 0.1; hold <= 4; hold += 0.01) {
      const b = pourFor(new PourBeaker({ target }), hold, { settleFor: 3 });
      if (!best || b.score > best.score) best = { score: b.score, hold };
    }
    return best.hold;
  }

  /** Hold the button for `seconds`, then let it settle upright. */
  function pourFor(beaker, seconds, { overTarget = true, settleFor = 1.5 } = {}) {
    for (let t = 0; t < seconds; t += FRAME) beaker.update(FRAME, true, overTarget);
    for (let t = 0; t < settleFor; t += FRAME) beaker.update(FRAME, false, overTarget);
    return beaker;
  }

  test('the vessel does not pour until it is actually tipped', () => {
    const b = new PourBeaker({ target: 0.5 });
    // One frame of holding cannot have tipped it past the lip yet.
    b.update(FRAME, true, true);
    equal(b.poured, 0);
    assert(b.tilt > 0, 'but it should have started to pivot');
  });

  test('the pivot ramps rather than snapping, so flow has momentum', () => {
    const b = new PourBeaker({ target: 0.5 });
    const tilts = [];
    for (let i = 0; i < 12; i++) {
      b.update(FRAME, true, true);
      tilts.push(b.tilt);
    }
    for (let i = 1; i < tilts.length; i++) {
      assert(tilts[i] > tilts[i - 1], 'tilt should increase smoothly while held');
    }
    assert(tilts[tilts.length - 1] < 1, 'and should not reach full tilt instantly');
  });

  test('liquid keeps coming for a moment after release', () => {
    const b = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 1.2; t += FRAME) b.update(FRAME, true, true);
    const atRelease = b.poured;
    for (let t = 0; t < 0.4; t += FRAME) b.update(FRAME, false, true);
    assert(b.poured > atRelease,
      'releasing should not stop the stream dead -- that is what makes it a skill');
  });

  test('the stream trails after release and fades out rather than stopping', () => {
    const b = new PourBeaker({ target: 0.5 });
    // Pour until the mark, which is where a release actually happens.
    while (b.poured < b.target) b.update(FRAME, true, true);

    const flows = [];
    let ran = 0;
    while (ran < 4) {
      const f = b.update(FRAME, false, true);
      if (f <= 0 && ran > 0.02) break;
      flows.push(f);
      ran += FRAME;
    }
    between(ran, 0.4, 1.2, `the trail ran for ${ran.toFixed(3)}s`);
    // Never rising. It holds flat out while the head over the lip is deep, then
    // tapers as the surface drops back towards the lip.
    for (let i = 1; i < flows.length; i++) {
      assert(flows[i] <= flows[i - 1] + 1e-12, `flow rose again at sample ${i}`);
    }
    assert(flows[flows.length - 1] < flows[0] * 0.2, 'it has to taper away, not cut off');
  });

  test('a fuller vessel trails for longer than a nearly-empty one', () => {
    // Because the trail ends when the surface drops back below the lip, not on a
    // timer -- which is the whole reason the lip drives this.
    const trail = (startFill) => {
      const b = new PourBeaker({ target: 0.5 });
      b.remaining = b.capacity * startFill;
      b.tilt = 1;
      let ran = 0;
      while (ran < 6) {
        const f = b.update(FRAME, false, true);
        if (f <= 0 && ran > 0.02) break;
        ran += FRAME;
      }
      return ran;
    };
    assert(trail(1) > trail(0.5) + 0.05,
      `full ${trail(1).toFixed(2)}s should trail longer than half ${trail(0.5).toFixed(2)}s`);
  });

  test('the run-on commits more than the clean band is wide', () => {
    // This is the whole difficulty of the stage. If the dribble fitted inside
    // the band you could watch the flask and release on the number.
    const b = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 1.5; t += FRAME) b.update(FRAME, true, true);
    const at = b.poured;
    while (!b.stopped) b.update(FRAME, false, true);
    assert(b.poured - at > b.sweet,
      `dribble ${(b.poured - at).toFixed(3)} must exceed the clean band ${b.sweet.toFixed(3)}`);
  });

  test('a well-judged pour can actually score a full hundred percent', () => {
    // The reported bug: no hold time reached 100%, because matching an analog
    // value to the unit means releasing inside a three-millisecond window. A
    // stage a human cannot top out is a stage that reads as broken.
    const target = 0.5;
    let best = null;
    for (let hold = 0.4; hold <= 4; hold += 0.05) {
      const b = pourFor(new PourBeaker({ target }), hold);
      if (!best || b.score > best.score) best = { score: b.score, hold, poured: b.poured };
    }
    equal(best.score, 1,
      `best achievable pour only scored ${best.score.toFixed(3)} (held ${best.hold.toFixed(2)}s)`);
  });

  test('the clean band is a slice of the tolerance, not the whole of it', () => {
    const b = new PourBeaker({ target: 0.5 });
    assert(b.sweet > 0 && b.sweet < b.tolerance,
      'a plateau that swallowed the tolerance would make the stage unloseable');
    equal(pourScore(b, b.target + b.sweet * 0.99, 0), 1, 'inside the band is a clean measure');
    assert(pourScore(b, b.target + b.sweet * 1.5, 0) < 1, 'and outside it starts costing');
    close(pourScore(b, b.target + b.tolerance, 0), 0, 1e-9,
      'the tolerance edge is still worth nothing');
  });

  test('the projection says how much more will come out after release', () => {
    const b = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 0.8; t += FRAME) b.update(FRAME, true, true);

    const predicted = pourProjection(b);
    assert(predicted > 0.01, 'a tipped vessel must be predicted to keep running');

    const at = b.poured;
    for (let t = 0; t < 3; t += FRAME) b.update(FRAME, false, true);
    close(b.poured - at, predicted, 0.005,
      'the projection has to match what actually comes out, or it is a lie');
  });

  test('an upright or spent vessel is projected to give nothing more', () => {
    equal(pourProjection(new PourBeaker({ target: 0.5 })), 0, 'upright and untouched');

    // Emptying is asymptotic: as the last of it goes, the surface converges on
    // the lip and the flow dies with it, so a hair is always left behind.
    const spent = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 20; t += FRAME) spent.update(FRAME, true, true);
    assert(toMl(spent.remaining) < 1, `${mlLabel(spent.remaining)} still in it`);
    assert(toMl(pourProjection(spent)) < 1, 'and nothing meaningful left to come out');
  });

  test('the projection is what makes anticipating the release possible', () => {
    // Play it the way the bench now shows it: release the moment the projected
    // landing is inside the clean band, rather than when the flask is.
    const b = new PourBeaker({ target: 0.5 });
    let released = false;
    for (let t = 0; t < 6; t += FRAME) {
      if (!released && b.poured + pourProjection(b) >= b.target) released = true;
      b.update(FRAME, !released, true);
    }
    equal(b.score, 1, `aiming with the projection landed at ${b.poured.toFixed(3)} of ${b.target}`);
  });

  test('the perfect window is narrow but real', () => {
    // Pinned from both ends. Too wide and the measurement is a shrug; too
    // narrow and the stage is the unwinnable one it started out as.
    let perfect = 0;
    for (let hold = 0.1; hold <= 5; hold += 0.01) {
      if (pourFor(new PourBeaker({ target: 0.5 }), hold, { settleFor: 2.5 }).score >= 0.999) {
        perfect += 1;
      }
    }
    const ms = perfect * 10;
    between(ms, 90, 260, `${ms}ms of hold times score a clean measure`);
  });

  test('the usable window is wide enough to aim for', () => {
    const target = 0.5;
    let good = 0;
    for (let hold = 0.4; hold <= 4; hold += 0.05) {
      if (pourFor(new PourBeaker({ target }), hold).score >= 0.5) good += 1;
    }
    const seconds = good * 0.05;
    assert(seconds >= 0.35,
      `only ${(seconds * 1000).toFixed(0)}ms of hold times score half credit or better`);
  });

  test('holding on too long floods the flask and scores nothing', () => {
    const b = pourFor(new PourBeaker({ target: 0.5 }), 20);
    assert(b.poured > b.target * 1.5, `only poured ${b.poured.toFixed(3)} of ${b.target}`);
    equal(b.score, 0);
    // Upended, the lip becomes the lowest point of the vessel, so it does all
    // come out in the end -- there is no residue to hide behind.
    assert(b.remaining < b.capacity * 0.02, `${b.remaining.toFixed(4)} left in it`);
  });

  test('stopping short scores nothing either', () => {
    const b = pourFor(new PourBeaker({ target: 0.5 }), 0.35);
    assert(b.poured < b.target, 'should be under the mark');
    assert(b.score < 0.5, `stopping that short should not score ${b.score.toFixed(2)}`);
  });

  test('the supply is finite and larger than the mark', () => {
    const b = new PourBeaker({ target: 0.5 });
    assert(b.capacity > b.target, 'there must be enough to reach the mark');
    assert(b.capacity < b.target * 3, 'but not so much that overshooting is impossible');
    // And enough of it has to be pourable, given the vessel cannot be tipped dry.
    const pourable = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 30; t += FRAME) pourable.update(FRAME, true, true);
    assert(pourable.poured > pourable.target * 1.4,
      `only ${pourable.poured.toFixed(3)} of ${pourable.target} is reachable`);
  });

  test('pouring away from the flask wastes it and is penalised', () => {
    // Held for the same time, aimed well versus aimed badly. The hold has to be
    // one that actually lands near the mark, or both simply score zero.
    const hold = bestHold(0.5);
    const onTarget = pourFor(new PourBeaker({ target: 0.5 }), hold, { overTarget: true });
    const missed = pourFor(new PourBeaker({ target: 0.5 }), hold, { overTarget: false });
    equal(missed.poured, 0);
    assert(missed.spilled > 0, 'the liquid has to go somewhere');
    assert(onTarget.score > 0.9, `the control pour should be good, scored ${onTarget.score.toFixed(2)}`);
    assert(missed.score < onTarget.score);
  });

  test('waste costs quality even when the mark is hit exactly', () => {
    // Compared at an identical amount in the flask, so the only difference is
    // how much ended up on the bench.
    const clean = new PourBeaker({ target: 0.5 });
    clean.poured = 0.5;

    const sloppy = new PourBeaker({ target: 0.5 });
    sloppy.poured = 0.5;
    sloppy.spilled = 0.2;

    equal(clean.score, 1);
    assert(sloppy.score < clean.score, 'slopping it about should cost something');
    assert(sloppy.score > 0.5, 'but a hit mark should still be mostly rewarded');
  });

  test('liquid is conserved: what left plus what is left is what it held', () => {
    const b = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 30; t += FRAME) b.update(FRAME, true, true);
    close(b.poured + b.spilled + b.remaining, b.capacity, 1e-9);
    assert(b.remaining >= 0);
  });

  test('a vessel not tipped far enough pours nothing at all', () => {
    // The dead zone is no longer a fixed angle: it is wherever the surface still
    // sits below the lip, which depends on how much is in there.
    const b = new PourBeaker({ target: 0.5 });
    b.tilt = b.tiltToPour * 0.5;
    equal(b.update(FRAME, false, true), 0);
    assert(b.head < 0, 'the surface is below the lip');
  });
});

describe('spilled liquid', () => {
  test('a puddle grows where the liquid keeps landing', () => {
    const spills = [];
    addSpill(spills, 300, 0.02, '#f00');
    addSpill(spills, 304, 0.02, '#f00');
    equal(spills.length, 1, 'liquid landing in the same place is one puddle');
    close(spills[0].amount, 0.04, 1e-9);
    close(spills[0].x, 302, 1e-9, 'and the centre sits between the two');
  });

  test('the centre drifts towards whichever side has more in it', () => {
    const spills = [];
    addSpill(spills, 300, 0.09, '#f00');
    addSpill(spills, 320, 0.01, '#f00');
    close(spills[0].x, 302, 1e-9, 'a small addition should barely move a big puddle');
  });

  test('liquid landing well away makes its own puddle', () => {
    const spills = [];
    addSpill(spills, 300, 0.02, '#f00');
    addSpill(spills, 300 + SPILL_MERGE + 1, 0.02, '#f00');
    equal(spills.length, 2);
  });

  test('different ingredients never merge into each other', () => {
    const spills = [];
    addSpill(spills, 300, 0.02, '#f00');
    addSpill(spills, 302, 0.02, '#0f0');
    equal(spills.length, 2, 'two colours in the same place are two puddles');
  });

  test('the mess only ever accumulates', () => {
    const spills = [];
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const amount = 0.001;
      addSpill(spills, 200 + (i % 5) * 60, amount, '#f00');
      total += amount;
    }
    close(spills.reduce((a, s) => a + s.amount, 0), total, 1e-9,
      'nothing may evaporate: the bench keeps what you dropped on it');
  });
});

describe('cooking', () => {
  /** Hold the burner in a band by pumping, the way a player would. */
  function regulate(pot, seconds) {
    for (let t = 0; t < seconds && !pot.done; t += FRAME) {
      pot.update(FRAME, pot.temp < (pot.bandLo + pot.bandHi) / 2);
    }
    return pot;
  }

  test('heat climbs while held and falls when released', () => {
    const pot = new CookPot();
    for (let i = 0; i < 30; i++) pot.update(FRAME, true);
    const hot = pot.temp;
    assert(hot > 0);
    for (let i = 0; i < 30; i++) pot.update(FRAME, false);
    assert(pot.temp < hot, 'it should coast back down');
  });

  test('progress only accrues inside the band', () => {
    const pot = new CookPot();
    // Well below the band.
    for (let i = 0; i < 20; i++) pot.update(FRAME, false);
    equal(pot.progress, 0);
    // Climb to the middle of the band, not its very edge: entering at the
    // bottom edge and then cooling for a frame drops straight back out.
    const mid = (pot.bandLo + pot.bandHi) / 2;
    while (pot.temp < mid) pot.update(FRAME, true);
    assert(pot.inBand);
    const before = pot.progress;
    pot.update(FRAME, false);
    assert(pot.progress > before, 'in band it should cook');
  });

  test('a player who pumps the burner finishes the batch cleanly', () => {
    const pot = regulate(new CookPot(), 20);
    assert(pot.done, 'regulating should finish the cook');
    assert(!pot.ruined, 'and should not scorch it');
    assert(pot.score > 0.85, `score was only ${pot.score.toFixed(2)}`);
  });

  test('holding the burner down the whole time ruins it', () => {
    const pot = new CookPot();
    for (let t = 0; t < 30 && !pot.done; t += FRAME) pot.update(FRAME, true);
    assert(pot.ruined, 'never letting go should scorch the batch');
    equal(pot.score, 0);
  });

  test('never applying heat never finishes', () => {
    const pot = new CookPot();
    for (let t = 0; t < 30; t += FRAME) pot.update(FRAME, false);
    equal(pot.progress, 0);
    assert(!pot.done);
  });

  test('there is time to react before a scorch becomes fatal', () => {
    const pot = new CookPot();
    while (!pot.tooHot) pot.update(FRAME, true);
    let seconds = 0;
    while (!pot.ruined && seconds < 10) {
      pot.update(FRAME, true);
      seconds += FRAME;
    }
    assert(seconds > 0.8, `only ${(seconds * 1000).toFixed(0)}ms from too hot to ruined`);
  });

  test('a brief overshoot costs quality without ending the batch', () => {
    const pot = new CookPot();
    while (!pot.tooHot) pot.update(FRAME, true);
    for (let i = 0; i < 12; i++) pot.update(FRAME, true); // a short scorch
    assert(!pot.ruined);
    regulate(pot, 20);
    assert(pot.done);
    between(pot.score, 0.3, 0.95, 'a scorched-then-saved batch should be middling');
  });

  test('temperature stays inside its bounds', () => {
    const pot = new CookPot();
    for (let i = 0; i < 600; i++) {
      pot.update(FRAME, i % 7 < 4);
      between(pot.temp, 0, 1);
      between(pot.progress, 0, 1);
      between(pot.scorch, 0, 1);
      between(pot.dull, 0, 1);
    }
  });

  test('the simmer band is a tenth narrower than it was', () => {
    // It used to run 0.54-0.78, wide enough that one push of the burner sat
    // inside it for free.
    const pot = new CookPot();
    close(pot.bandHi - pot.bandLo, 0.24 * 0.9, 1e-9);
    close((pot.bandLo + pot.bandHi) / 2, 0.66, 1e-9, 'and still centred where it was');
  });

  test('nothing goes dull before it has ever simmered', () => {
    // Coming up to temperature is not a mistake.
    const pot = new CookPot();
    for (let t = 0; t < 5; t += FRAME) pot.update(FRAME, false);
    equal(pot.dull, 0);
    assert(!pot.started);
    assert(!pot.tooCold, 'cold on the way up is not the same as gone cold');
  });

  test('once it has simmered, letting it fall costs quality', () => {
    const pot = new CookPot();
    const mid = (pot.bandLo + pot.bandHi) / 2;
    while (pot.temp < mid) pot.update(FRAME, true);
    assert(pot.started, 'it has been up to temperature');
    equal(pot.dull, 0, 'and nothing is wrong yet');

    for (let t = 0; t < 1.5; t += FRAME) pot.update(FRAME, false);
    assert(pot.tooCold, 'it has dropped out of the band');
    assert(pot.dull > 0.1, `dull only reached ${pot.dull.toFixed(3)}`);
  });

  test('the further below temperature it falls, the faster it dulls', () => {
    const drift = (seconds) => {
      const pot = new CookPot();
      const mid = (pot.bandLo + pot.bandHi) / 2;
      while (pot.temp < mid) pot.update(FRAME, true);
      for (let t = 0; t < seconds; t += FRAME) pot.update(FRAME, false);
      return pot;
    };
    const brief = drift(0.6);
    const long = drift(1.6);
    assert(long.dull > brief.dull * 2,
      `letting it go cold should be much worse than a dip (${brief.dull.toFixed(3)} vs ${long.dull.toFixed(3)})`);
  });

  test('a dulled batch is weak but never a total loss', () => {
    const pot = new CookPot();
    const mid = (pot.bandLo + pot.bandHi) / 2;
    // Cook it through, but keep dropping out of the band on the way.
    for (let cycle = 0; cycle < 40 && !pot.done; cycle++) {
      while (!pot.done && pot.temp < mid) pot.update(FRAME, true);
      for (let t = 0; t < 1.2 && !pot.done; t += FRAME) pot.update(FRAME, false);
    }
    assert(pot.done, 'it still finishes');
    assert(!pot.ruined, 'dull is not the unrecoverable mistake -- scorch is');
    assert(pot.dull > 0.2, `should have gone dull, only reached ${pot.dull.toFixed(3)}`);
    between(pot.score, 0.05, 0.85, `a dull batch scored ${pot.score.toFixed(2)}`);
  });

  test('a fully dulled batch still beats a scorched one', () => {
    const dull = new CookPot();
    dull.progress = 1;
    dull.dull = 1;
    const burnt = new CookPot();
    burnt.progress = 1;
    burnt.scorch = 1;
    equal(burnt.score, 0, 'scorching is total');
    assert(dull.score > 0.3, `a dull batch is worth something (${dull.score.toFixed(2)})`);
    assert(dull.score < 0.6, 'but not much');
  });

  test('holding it steady in the band still scores full marks', () => {
    // The new rule must not tax the player who is doing it right.
    const pot = regulate(new CookPot(), 20);
    assert(pot.done && !pot.ruined);
    equal(pot.dull, 0, 'a steady hand never dulls it');
    assert(pot.score > 0.95, `steady cooking scored ${pot.score.toFixed(3)}`);
  });
});

describe('batch yield', () => {
  test('quality weights the pour heaviest', () => {
    const pourOnly = batchQuality({ chop: 0, pour: 1, cook: 0 });
    const chopOnly = batchQuality({ chop: 1, pour: 0, cook: 0 });
    const cookOnly = batchQuality({ chop: 0, pour: 0, cook: 1 });
    assert(pourOnly > cookOnly && cookOnly > chopOnly);
    close(batchQuality({ chop: 1, pour: 1, cook: 1 }), 1, 1e-9);
    equal(batchQuality({}), 0);
  });

  test('scorching overrides everything else', () => {
    equal(chemYield(1, true), 0, 'a burnt batch is worthless however well it was mixed');
    equal(chemYield(1, false), 4);
  });

  test('yield rewards a good batch and still pays a rough one', () => {
    equal(chemYield(0.9), 4);
    equal(chemYield(0.7), 3);
    equal(chemYield(0.5), 2);
    equal(chemYield(0.2), 1);
    equal(chemYield(0.05), 0);
  });

  test('a competent all-round batch is worth at least three packs', () => {
    // What a player who is decent but not perfect should expect.
    equal(chemYield(batchQuality({ chop: 0.7, pour: 0.7, cook: 0.8 })), 3);
  });
});

describe('art direction', () => {
  test('every site floor is visibly its own colour', () => {
    // Five locations are only worth having if they look like five places. At
    // the first attempt all of them measured within 6 RGB units of each other
    // because a shared steel base swamped every hue bias.
    const keys = Object.keys(SITE_PALETTE);
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const floors = keys.map((k) => ({ k, c: rgb(sitePalette(k).floor) }));

    for (let i = 0; i < floors.length; i++) {
      for (let j = i + 1; j < floors.length; j++) {
        const [a, b] = [floors[i], floors[j]];
        const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]);
        assert(d >= 18,
          `${a.k} and ${b.k} floors are only ${d.toFixed(1)} apart -- they will read as the same place`);
      }
    }
  });

  test('floors stay dark enough to keep the tone', () => {
    for (const k of Object.keys(SITE_PALETTE)) {
      const pal = sitePalette(k);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(pal.floor.slice(i, i + 2), 16));
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      between(luma, 30, 95, `${k} floor luma ${luma.toFixed(0)} -- too bright or too black`);
    }
  });

  test('walls read lighter than the floor they stand on', () => {
    for (const k of Object.keys(SITE_PALETTE)) {
      const pal = sitePalette(k);
      const luma = (h) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      assert(luma(pal.wallTop) > luma(pal.floor) + 20,
        `${k}: wall tops must separate from the floor or geometry disappears`);
    }
  });

  test('the light direction is a single committed choice', () => {
    // Shadows and wall shading both derive from this; if it were zero, or if
    // the two visible faces shaded equally, the scene would have no direction.
    assert(LIGHT_DIR.x !== 0 || LIGHT_DIR.y !== 0, 'light must come from somewhere');
    assert(FACE_SHADE.right < FACE_SHADE.left,
      'the face turned away from the light must be the darker one');
    assert(FACE_SHADE.left < FACE_SHADE.top, 'and the top must be the brightest');
  });
});

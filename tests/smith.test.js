// The forge.
//
// These three stages used to be a bar, a dot and a dial -- generic widgets that
// could not tell you anything about smithing. What is tested here is what makes
// them simulations instead: that the metal behaves like metal, that the target
// is reachable at all, and above all that every stage can be *over*-done. That
// last property is the whole design. A stage you can only improve by continuing
// is a stage with no decision in it.

import { describe, test, assert, equal, close, between } from './harness.js';
import {
  Blank, Edge, Bolt, fitScore, fitFault,
  targetProfile, plasticity, crackRisk,
  BLANK_CELLS, BLANK_THICKNESS, COLD, HOT, SHAPE_PERFECT,
  EDGE_TARGET, EDGE_PERFECT, BOLT_SEAT, BOLT_TARGET, BOLT_STRIP,
} from '../src/game/smith.js';
import { makeRng } from '../src/core/rng.js';

const FRAME = 1 / 60;

/** Hit wherever the bar stands proudest of the pattern, as a smith would. */
function proudest(b, floor = 0.004) {
  let cell = -1;
  let worst = floor;
  for (let i = 0; i < b.cells; i++) {
    const over = b.thickness[i] - b.target[i];
    if (over > worst) { worst = over; cell = i; }
  }
  return cell;
}

function work(b, blows, { reheat = true } = {}) {
  for (let n = 0; n < blows; n++) {
    const c = proudest(b);
    if (c < 0) return n;
    b.strike(c, 1);
    if (reheat) b.reheat();
  }
  return blows;
}

describe('the pattern the bar is drawn to', () => {
  test('never asks for more steel than the bar has, anywhere', () => {
    // The reachability rule. Hammering only moves metal sideways and off the
    // ends, so a pattern thicker than the bar at any point is a shape no
    // sequence of blows can produce -- and the stage would be unwinnable
    // without ever saying so.
    for (const kind of ['melee', 'gun']) {
      const t = targetProfile(kind);
      for (let i = 0; i < t.length; i++) {
        assert(t[i] <= BLANK_THICKNESS + 1e-9,
          `${kind} pattern asks for ${t[i].toFixed(2)} at cell ${i}, more than the bar's ${BLANK_THICKNESS}`);
      }
    }
  });

  test('is monotonic, so every blow drives surplus the same way', () => {
    // A pattern that thickens again after thinning would need metal carried
    // back against the direction everything else is moving.
    for (const kind of ['melee', 'gun']) {
      const t = targetProfile(kind);
      for (let i = 1; i < t.length; i++) {
        assert(t[i] <= t[i - 1] + 1e-9, `${kind} pattern thickens again at cell ${i}`);
      }
    }
  });

  test('asks for less metal than the bar holds, so there is work to do', () => {
    for (const kind of ['melee', 'gun']) {
      const t = targetProfile(kind);
      const want = t.reduce((a, b) => a + b, 0);
      assert(want < BLANK_CELLS * BLANK_THICKNESS * 0.95,
        `${kind} pattern is barely different from the blank`);
    }
  });
});

describe('hot steel', () => {
  test('moves least when cold, most when it is running', () => {
    assert(plasticity(0) < plasticity(COLD), 'cold steel barely moves');
    assert(plasticity(COLD) < plasticity(0.6), 'and warms into a working range');
    assert(plasticity(1) > plasticity(HOT), 'above the top of the band it runs away');
    // The controllable band is genuinely flatter than the runaway above it,
    // which is what makes heat a resource to manage rather than to maximise.
    const inBand = plasticity(HOT) - plasticity(COLD);
    const above = plasticity(1) - plasticity(HOT);
    assert(above > inBand * 0.6, 'too hot has to be meaningfully worse than warm');
  });

  test('only cracks when it is below working heat', () => {
    equal(crackRisk(1), 0);
    equal(crackRisk(COLD), 0);
    assert(crackRisk(COLD - 0.01) > 0, 'just under, it starts to go');
    assert(crackRisk(0) > crackRisk(COLD / 2), 'and stone cold is worst');
  });

  test('a blow moves metal without inventing or destroying any', () => {
    // Everything that leaves the cells has to be accounted for as flash. This
    // is the rule the whole stage rests on, so it is checked at both ends of
    // the bar and in the middle.
    for (const cell of [0, 1, 6, 12, 18, 22, 23]) {
      const b = new Blank({ kind: 'melee' });
      const before = b.thickness.reduce((a, x) => a + x, 0);
      b.strike(cell, 1);
      const after = b.thickness.reduce((a, x) => a + x, 0) + b.flash;
      close(after, before, 1e-9, `a blow at cell ${cell} did not conserve steel`);
    }
  });

  test('metal only leaves the bar near its ends', () => {
    const mid = new Blank({ kind: 'melee' });
    mid.strike(Math.floor(mid.cells / 2), 1);
    const end = new Blank({ kind: 'melee' });
    end.strike(0, 1);
    assert(end.flash > mid.flash * 3,
      `working the end should throw metal off it (end ${end.flash.toFixed(3)}, middle ${mid.flash.toFixed(3)})`);
  });

  test('a blow leaves a smooth dip, not a ridge at a distance', () => {
    // The first model took metal from under the face and put it back in a ring
    // five to nine cells out, which built standing waves: ideal play ended up
    // with towers twice the target thickness. The deposit has to cover the
    // bite, so the change per cell is single-signed on each side of the blow.
    const b = new Blank({ kind: 'melee' });
    const before = Float64Array.from(b.thickness);
    b.strike(12, 1);
    const delta = [...b.thickness].map((t, i) => t - before[i]);
    // Walking outward from the blow, the change must cross zero exactly once.
    let crossings = 0;
    for (let i = 13; i < b.cells - 1; i++) {
      if (Math.sign(delta[i]) !== Math.sign(delta[i + 1]) && delta[i + 1] !== 0) crossings += 1;
    }
    assert(crossings <= 1, `the profile of one blow oscillates (${crossings} sign changes)`);
    assert(delta[12] < 0, 'under the hammer the bar thins');
  });

  test('the bar cools, and thin sections cool first', () => {
    const b = new Blank({ kind: 'melee' });
    b.thickness[4] = 0.35;
    const hot = b.heat[4];
    for (let t = 0; t < 3; t += FRAME) b.tick(FRAME);
    assert(b.heat[4] < hot, 'it has to cool at all');
    assert(b.heat[4] < b.heat[20], 'and the drawn-down part goes first');
  });
});

describe('shaping the blank', () => {
  test('sensible work brings it to the pattern', () => {
    // Sixty blows is where measured ideal play lands: the error bottoms out at
    // 0.03 and the score reaches full marks. Stopping is part of the stage, so
    // the test stops too.
    const b = new Blank({ kind: 'melee' });
    work(b, 60);
    assert(b.error < SHAPE_PERFECT + 0.005,
      `ideal play should land on the pattern, got ${b.error.toFixed(3)}`);
    assert(b.score > 0.95, `and score for it, got ${b.score.toFixed(2)}`);
  });

  test('a flawless blank can actually reach full marks', () => {
    // Without the plateau the best possible result was about 0.84, because a
    // hammer cannot land a bar exactly on a curve. The pour needed the same
    // fix, and a stage whose ceiling is a B reads as broken rather than hard.
    const b = new Blank({ kind: 'melee' });
    let best = 0;
    for (let n = 0; n < 140; n++) {
      const c = proudest(b);
      if (c < 0) break;
      b.strike(c, 1);
      b.reheat();
      best = Math.max(best, b.score);
    }
    equal(best, 1, `the ceiling should be reachable, best was ${best.toFixed(2)}`);
  });

  test('and going on past that ruins it', () => {
    // The property the whole stage exists for. If the score only ever climbed,
    // there would be no decision in the stage at all -- you would hold the
    // button until it stopped.
    const b = new Blank({ kind: 'melee' });
    let peak = 0;
    let peakAt = 0;
    for (let n = 1; n <= 200; n++) {
      let c = proudest(b);
      if (c < 0) {
        c = 0;
        let thickest = -1;
        for (let i = 0; i < b.cells; i++) if (b.thickness[i] > thickest) { thickest = b.thickness[i]; c = i; }
      }
      b.strike(c, 1);
      b.reheat();
      if (b.score > peak) { peak = b.score; peakAt = n; }
    }
    between(peakAt, 20, 90, `the peak should sit inside a playable number of blows (was ${peakAt})`);
    assert(b.score < peak * 0.3,
      `over-working must cost: peak ${peak.toFixed(2)}, ended ${b.score.toFixed(2)}`);
  });

  test('hammering cold cracks it, and cracks never heal', () => {
    const b = new Blank({ kind: 'melee' });
    const rand = makeRng(4);
    for (let i = 0; i < b.cells; i++) b.heat[i] = 0.02;
    for (let n = 0; n < 40 && !b.cracks.length; n++) b.strike(12, 1, rand);
    assert(b.cracks.length > 0, 'cold steel has to crack eventually');
    const had = b.cracks.length;
    b.reheat();
    work(b, 30);
    assert(b.cracks.length >= had, 'a crack cannot be hammered out');
    assert(b.fault.includes('crack'), `the report should name it, got "${b.fault}"`);
  });

  test('where the work went is read off the bar, not chosen from a menu', () => {
    const b = new Blank({ kind: 'melee' });
    for (let n = 0; n < 30; n++) { b.strike(b.cells - 3, 1); b.reheat(); }
    const p = b.profile;
    assert(p.edge > p.haft * 2, `work at the tip should read as edge work (${JSON.stringify(p)})`);
  });
});

describe('grinding the edge', () => {
  test('leaning on the wheel burns the steel before it cuts it', () => {
    // Full pressure looks like the fast way and is a trap; the optimum has to
    // be found by feel rather than read off a number.
    const at = (p) => {
      const e = new Edge();
      let t = 0;
      let sharp = null;
      let burnt = null;
      while (t < 12) {
        e.press(30, p, FRAME);
        e.tick(FRAME, true);
        t += FRAME;
        if (sharp === null && e.ground[30] >= EDGE_TARGET) sharp = t;
        if (burnt === null && e.burnt[30]) burnt = t;
      }
      return { sharp, burnt };
    };
    const hard = at(1);
    assert(hard.burnt !== null && hard.burnt < hard.sharp,
      `at full pressure the temper should go first (sharp ${hard.sharp}, burnt ${hard.burnt})`);
    const easy = at(0.6);
    assert(easy.sharp !== null, 'a light touch still cuts');
    assert(easy.burnt === null || easy.burnt > easy.sharp,
      'and does not burn before it does');
  });

  test('a burnt patch is permanent and named', () => {
    const e = new Edge();
    for (let t = 0; t < 4; t += FRAME) { e.press(20, 1, FRAME); e.tick(FRAME, true); }
    assert(e.burntCells > 0);
    const had = e.burntCells;
    for (let t = 0; t < 6; t += FRAME) e.tick(FRAME, false);
    equal(e.burntCells, had, 'cooling does not put the temper back');
    assert(e.fault.length > 0, 'and the report names it');
  });

  test('an even bevel scores full marks, and over-grinding takes them back', () => {
    const sweep = (passes, p) => {
      const e = new Edge();
      for (let n = 0; n < passes; n++) {
        for (let i = 0; i < e.cells; i++) {
          for (let k = 0; k < 5; k++) { e.press(i, p, FRAME); e.tick(FRAME, true); }
        }
      }
      return e;
    };
    let best = 0;
    let bestPass = 0;
    for (let n = 1; n <= 8; n++) {
      const sc = sweep(n, 0.7).score;
      if (sc > best) { best = sc; bestPass = n; }
    }
    equal(best, 1, `an even edge should be able to score full marks (best ${best.toFixed(2)})`);
    assert(sweep(bestPass + 4, 0.7).score < best * 0.6,
      'and grinding on past it has to cost');
  });

  test('under-grinding leaves it dull rather than silently passing', () => {
    // A steady light pass over the first half only, at a pressure that cannot
    // burn -- the fault being tested is neglect, not heat.
    const e = new Edge();
    for (let i = 0; i < e.cells / 2; i++) {
      for (let k = 0; k < 18; k++) { e.press(i, 0.5, FRAME); e.tick(FRAME, true); }
    }
    equal(e.burntCells, 0, 'this pass must not burn, or it is testing the wrong fault');
    assert(e.remaining > 0.3, 'half an edge left is half an edge left');
    assert(e.fault.includes('dull'), `the report should say so, got "${e.fault}"`);
    assert(e.score < 0.7);
  });

  test('a perfect bevel is reachable, since hand grinding is never exact', () => {
    assert(EDGE_PERFECT > 0, 'there has to be a plateau at all');
  });
});

describe('torquing a fastener', () => {
  const hold = (b, seconds) => {
    for (let t = 0; t < seconds; t += FRAME) b.update(FRAME, true);
  };

  test('the decision is wide enough to be a judgement, not a reflex', () => {
    // The first curve gave 0.15s inside the band and 0.05s before the thread
    // went, which is a reaction test -- exactly what replacing the spinning
    // dial was meant to get rid of.
    const b = new Bolt();
    let t = 0;
    let into = null;
    let outOf = null;
    while (t < 10 && !b.stripped) {
      b.update(FRAME, true);
      t += FRAME;
      if (into === null && b.torque >= BOLT_TARGET - b.band) into = t;
      if (outOf === null && b.torque > BOLT_TARGET + b.band) outOf = t;
    }
    assert(outOf - into > 0.4, `the band lasts ${(outOf - into).toFixed(2)}s, too quick to aim at`);
    assert(t - outOf > 0.2, `only ${(t - outOf).toFixed(2)}s of overshoot before it strips`);
  });

  test('it winds in quickly and stiffens once the head seats', () => {
    const b = new Bolt();
    hold(b, 0.5);
    const early = b.rate();
    while (b.torque < BOLT_SEAT + 0.1) b.update(FRAME, true);
    assert(b.rate() < early, 'the thread has to bite');
  });

  test('letting go on the mark seats it', () => {
    const b = new Bolt();
    while (b.torque < BOLT_TARGET) b.update(FRAME, true);
    equal(b.release(), 1);
    equal(b.state, 'seated');
  });

  test('slack is forgiven more than overshoot', () => {
    const loose = new Bolt();
    while (loose.torque < BOLT_TARGET - loose.band - 0.05) loose.update(FRAME, true);
    loose.release();
    const tight = new Bolt();
    while (tight.torque < BOLT_TARGET + tight.band + 0.05) tight.update(FRAME, true);
    tight.release();
    assert(loose.score > tight.score,
      `a loose bolt can be nipped up later; an overtight one cannot (${loose.score.toFixed(2)} vs ${tight.score.toFixed(2)})`);
  });

  test('past the limit the thread strips, and stays stripped', () => {
    const b = new Bolt();
    hold(b, 20);
    assert(b.stripped);
    equal(b.score, 0);
    equal(b.torque, BOLT_STRIP);
    b.update(FRAME, true);
    assert(b.done, 'a stripped bolt cannot be turned any further');
  });

  test('the assembly is judged on all four, and a stripped one hurts most', () => {
    const seated = () => {
      const b = new Bolt();
      while (b.torque < BOLT_TARGET) b.update(FRAME, true);
      b.release();
      return b;
    };
    const clean = [seated(), seated(), seated(), seated()];
    equal(fitScore(clean), 1);
    equal(fitFault(clean), '');

    const one = new Bolt();
    hold(one, 20);
    const spoilt = [seated(), seated(), seated(), one];
    assert(fitScore(spoilt) < 0.65,
      `one stripped thread out of four should hurt (got ${fitScore(spoilt).toFixed(2)})`);
    assert(fitFault(spoilt).includes('stripped'));
  });
});

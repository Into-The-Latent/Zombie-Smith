// Chem bench mechanics. The physics matters more than the numbers here: a
// pour has momentum and a cook has lag, so each stage is simulated at a real
// frame rate to prove it is winnable by a human and losable by a careless one.

import { describe, test, assert, equal, close, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  ChopBoard, chopMarks, PourBeaker, CookPot,
  batchQuality, chemYield, POUR_TILT_THRESHOLD,
} from '../src/game/chem.js';
import { SITE_PALETTE, sitePalette, LIGHT_DIR, FACE_SHADE } from '../src/ui/palette.js';

const FRAME = 1 / 60;

describe('chopping', () => {
  test('landing on a mark scores 1 and drifting off scores 0', () => {
    const b = new ChopBoard([0.25, 0.5, 0.75], { tolerance: 0.05 });
    equal(b.cut(0.5).acc, 1);
    close(b.cut(0.25 + 0.05).acc, 0, 1e-9);
    close(b.cut(0.75 + 0.025).acc, 0.5, 1e-9);
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
    b.cut(0.2); // 1
    b.cut(0.55); // 0.5
    close(b.score, 0.75, 1e-9);
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

describe('pouring', () => {
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

  test('a well-judged pour scores highly', () => {
    // Find the hold time that lands on the mark, the way a player learns it.
    const target = 0.5;
    let best = null;
    for (let hold = 0.4; hold <= 4; hold += 0.05) {
      const b = pourFor(new PourBeaker({ target }), hold);
      if (!best || b.score > best.score) best = { score: b.score, hold, poured: b.poured };
    }
    assert(best.score > 0.9,
      `best achievable pour only scored ${best.score.toFixed(2)} (held ${best.hold.toFixed(2)}s)`);
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

  test('holding on too long empties the vessel and scores nothing', () => {
    const b = pourFor(new PourBeaker({ target: 0.5 }), 20);
    equal(b.remaining, 0);
    assert(b.poured > b.target, 'it should have gone well over the mark');
    equal(b.score, 0);
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
  });

  test('pouring away from the flask wastes it and is penalised', () => {
    const onTarget = pourFor(new PourBeaker({ target: 0.5 }), 1.6, { overTarget: true });
    const missed = pourFor(new PourBeaker({ target: 0.5 }), 1.6, { overTarget: false });
    equal(missed.poured, 0);
    assert(missed.spilled > 0, 'the liquid has to go somewhere');
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

  test('it never pours more than it holds', () => {
    const b = new PourBeaker({ target: 0.5 });
    for (let t = 0; t < 30; t += FRAME) b.update(FRAME, true, true);
    close(b.poured + b.spilled, b.capacity, 1e-6);
    assert(b.remaining >= 0);
  });

  test('tilt threshold is a real dead zone', () => {
    const b = new PourBeaker({ target: 0.5 });
    b.tilt = POUR_TILT_THRESHOLD - 0.01;
    equal(b.update(FRAME, false, true), 0);
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
    }
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

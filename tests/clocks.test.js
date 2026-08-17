// The daylight clock. One five-minute budget for the whole preparation phase,
// so the interesting properties are that it is genuinely shared, that it never
// runs past its ends, and that what is left survives into the run for the
// bonus that will hang off it.

import { describe, test, assert, equal, close, between } from './harness.js';
import { newGame, advanceDay, rehydrate } from '../src/core/state.js';
import {
  PREP_SECONDS, NIGHT_SECONDS, DAYLIGHT_RAMP, tickDaylight, daylightLeft,
  daylightFraction, daylightColor, formatClock, bankDaylight, resetDaylight,
  startNight, spendNight, nightLeft, nightFraction, nightSpan, nightTotal,
  nightBonus, nightBonusMark, NIGHT_PER_SURVIVOR, nightPerRound, nightRoundsLeft,
} from '../src/game/clocks.js';

const FRAME = 1 / 60;

const luma = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { r, g, b };
};

describe('the daylight clock', () => {
  test('a new day starts with the full five minutes', () => {
    const s = newGame(11);
    equal(s.prepLeft, PREP_SECONDS);
    equal(PREP_SECONDS, 300, 'five minutes, as designed');
    equal(daylightFraction(s), 1);
  });

  test('it drains in real time', () => {
    const s = newGame(11);
    for (let t = 0; t < 30; t += FRAME) tickDaylight(s, FRAME);
    close(daylightLeft(s), PREP_SECONDS - 30, 0.05,
      'thirty seconds of frames should cost thirty seconds of light');
  });

  test('it stops at dusk instead of going negative', () => {
    const s = newGame(11);
    tickDaylight(s, PREP_SECONDS + 60);
    equal(daylightLeft(s), 0);
    equal(daylightFraction(s), 0);
    // And keeps stopping, however long the player stands there.
    tickDaylight(s, 30);
    equal(daylightLeft(s), 0);
  });

  test('every day gets its own fresh light', () => {
    const s = newGame(11);
    tickDaylight(s, 200);
    assert(daylightLeft(s) < PREP_SECONDS);
    advanceDay(s);
    equal(daylightLeft(s), PREP_SECONDS, 'a new day has to reset it');
    resetDaylight(s);
    equal(daylightLeft(s), PREP_SECONDS);
  });

  test('what is left is banked when the squad heads out', () => {
    const s = newGame(11);
    tickDaylight(s, 120);
    const banked = bankDaylight(s);
    close(banked, PREP_SECONDS - 120, 0.001);
    equal(s.daylightBanked, banked);
    // Banking is a snapshot: the clock carrying on must not rewrite it.
    tickDaylight(s, 60);
    equal(s.daylightBanked, banked, 'the bank is what you had at the door');
  });

  test('a save written before the clock existed still loads', () => {
    const s = newGame(11);
    delete s.prepLeft;
    delete s.daylightBanked;
    const loaded = rehydrate(JSON.parse(JSON.stringify(s)));
    equal(loaded.prepLeft, PREP_SECONDS);
    equal(loaded.daylightBanked, PREP_SECONDS);
  });
});

describe('the nightfall clock', () => {
  /** Spend `used` seconds preparing, then head out. */
  const headOut = (used) => {
    const s = newGame(11);
    tickDaylight(s, used);
    bankDaylight(s);
    startNight(s);
    return s;
  };

  test('the night is five minutes plus the daylight you saved', () => {
    equal(NIGHT_SECONDS, 300, 'five minutes of base night');
    const quick = headOut(60); // 240 left over
    close(nightTotal(quick), NIGHT_SECONDS + 240, 0.001);
    close(nightLeft(quick), nightTotal(quick), 0.001, 'and it starts full');
    equal(nightFraction(quick), 1);
  });

  test('dawdling costs you the bonus but never the base night', () => {
    const slow = headOut(PREP_SECONDS + 30); // ran the clock out entirely
    equal(nightBonus(slow), 0);
    close(nightTotal(slow), NIGHT_SECONDS, 0.001, 'the base night is not clawed back');
  });

  test('being quick is worth strictly more night', () => {
    const spans = [30, 120, 240, 300].map((used) => nightTotal(headOut(used)));
    for (let i = 1; i < spans.length; i++) {
      assert(spans[i] < spans[i - 1],
        `spending longer preparing has to buy less night (${spans[i - 1]} -> ${spans[i]})`);
    }
    close(spans[0] - spans[spans.length - 1], PREP_SECONDS - 30, 0.001,
      'the whole preparation budget is transferable');
  });

  test('the night covers a real run, and a banked one covers the longest', () => {
    // Measured against the soak suite: a run takes 13-25 rounds, median 21, and
    // is capped at 40. The base night has to cover a normal run and a fully
    // banked one the longest possible.
    const squad = 3;
    const slow = headOut(PREP_SECONDS); // dawdled: no bonus at all
    between(nightRoundsLeft(slow, squad), 18, 22,
      `a bare night pays for ${nightRoundsLeft(slow, squad)} rounds`);

    const quick = headOut(0); // straight out of the door with the lot banked
    equal(nightRoundsLeft(quick, squad), 40,
      'and banking the whole preparation buys exactly the longest run there is');
  });

  test('it is spent by the round, not by the wall clock', () => {
    // The run is turn-based, so deliberating has to be free. Night is a deposit
    // drawn against by acting: every survivor still with the squad costs.
    const s = headOut(240); // 60 banked, so a 360s night
    const before = nightLeft(s);
    equal(spendNight(s, 3), 3 * NIGHT_PER_SURVIVOR);
    close(nightLeft(s), before - 3 * NIGHT_PER_SURVIVOR, 1e-9);
    equal(nightPerRound(3), 3 * NIGHT_PER_SURVIVOR);
  });

  test('a smaller squad burns the night more slowly', () => {
    const three = headOut(0);
    const two = headOut(0);
    spendNight(three, 3);
    spendNight(two, 2);
    assert(nightLeft(two) > nightLeft(three), 'two guns should last longer than three');
    assert(nightRoundsLeft(two, 2) > nightRoundsLeft(three, 3),
      'which is the decision at the door: firepower against time');
  });

  test('the deposit cannot go overdrawn', () => {
    const s = headOut(PREP_SECONDS); // no bonus, so a bare 300s night
    let rounds = 0;
    while (nightLeft(s) > 0 && rounds < 500) {
      spendNight(s, 3);
      rounds += 1;
    }
    equal(nightLeft(s), 0);
    equal(spendNight(s, 3), 0, 'and a round charged against nothing costs nothing');
    equal(nightFraction(s), 0);
  });

  test('a nobody-left squad cannot burn night, and is not divided by zero', () => {
    const s = headOut(0);
    const before = nightLeft(s);
    equal(spendNight(s, 0), 0);
    equal(nightLeft(s), before);
    equal(nightPerRound(0), 0);
    equal(nightRoundsLeft(s, 0), Infinity, 'no cost means no limit, not a crash');
  });

  test('the span is fixed when the run starts, not read live off the bank', () => {
    // Otherwise a bar mid-run would rescale the moment anything touched the
    // campaign state.
    const s = headOut(100);
    const total = nightTotal(s);
    spendNight(s, 3);
    s.daylightBanked = 0;
    close(nightTotal(s), total, 0.001);
    close(nightSpan(s), NIGHT_SECONDS, 0.001, 'the live figure did change, though');
  });

  test('the bonus mark sits where the earned time runs out', () => {
    const s = headOut(150); // 150 banked -> a 450s night
    close(nightBonusMark(s), NIGHT_SECONDS / 450, 1e-9);
    // The bonus is spent first, so the fill crosses the mark exactly then. Ten
    // rounds of three survivors is 150 seconds, which is the bonus exactly.
    const bonus = nightBonus(s);
    let spent = 0;
    while (spent < bonus - 1e-9) spent += spendNight(s, 3);
    close(spent, bonus, 1e-9);
    close(nightFraction(s), nightBonusMark(s), 0.001);

    const none = headOut(PREP_SECONDS);
    equal(nightBonus(none), 0);
    equal(nightBonusMark(none), 1, 'with no bonus the mark is the whole bar');
  });

  test('a run that never called startNight still reads sanely', () => {
    const s = newGame(11);
    delete s.nightSpan;
    delete s.nightLeft;
    assert(nightTotal(s) > 0);
    close(nightLeft(s), nightTotal(s), 0.001);
    between(nightFraction(s), 0, 1);
  });
});

describe('the daylight bar', () => {
  test('the ramp runs green, yellow, orange, red', () => {
    equal(DAYLIGHT_RAMP.length, 4);
    const [green, yellow, orange, red] = DAYLIGHT_RAMP.map(luma);
    assert(green.g > green.r * 1.3, 'first light has to read green');
    assert(yellow.r > yellow.b * 2 && yellow.g > yellow.b * 2, 'then yellow');
    assert(orange.r > orange.g * 1.5 && orange.g > orange.b, 'then orange');
    assert(red.r > red.g * 2 && red.r > red.b * 2, 'and dusk has to read red');
  });

  test('the colour warms steadily as the light goes', () => {
    // Red minus green is the thing that only ever moves one way: green climbs
    // on its own from the green stop into the yellow one, so it is not the
    // measure of warmth here.
    const warmth = (f) => {
      const c = luma(daylightColor(f));
      return c.r - c.g;
    };
    for (let frac = 1; frac > 0; frac -= 0.02) {
      assert(warmth(frac - 0.02) >= warmth(frac) - 1,
        `it cooled off again between ${frac.toFixed(2)} and ${(frac - 0.02).toFixed(2)}`);
    }
    assert(warmth(1) < 0 && warmth(0) > 100, 'and it has to travel a long way');
    equal(daylightColor(1), DAYLIGHT_RAMP[0], 'a full bar is the first stop exactly');
    equal(daylightColor(0), DAYLIGHT_RAMP[3], 'an empty one is the last');
  });

  test('the colour is interpolated, not stepped through four states', () => {
    // A bar that snaps between flat colours reads as broken rather than as a
    // day going by.
    let worst = 0;
    for (let frac = 1; frac > 0; frac -= 0.01) {
      const a = luma(daylightColor(frac));
      const b = luma(daylightColor(frac - 0.01));
      worst = Math.max(worst, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
    }
    between(worst, 1, 12, `biggest one-percent colour jump was ${worst}`);
  });

  test('the colour is defined across the whole range and beyond it', () => {
    for (const f of [-1, 0, 0.001, 0.5, 0.999, 1, 2]) {
      const c = daylightColor(f);
      assert(/^#[0-9a-f]{6}$/.test(c), `daylightColor(${f}) produced ${c}`);
      between(luma(c).r, 40, 255);
    }
  });

  test('the clock reads m:ss and rounds up', () => {
    equal(formatClock(300), '5:00');
    equal(formatClock(125), '2:05');
    equal(formatClock(59.4), '1:00', 'rounding up keeps it off 0:00 while time remains');
    equal(formatClock(0.2), '0:01');
    equal(formatClock(0), '0:00');
    equal(formatClock(-5), '0:00');
  });
});

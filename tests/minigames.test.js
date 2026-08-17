import { describe, test, assert, equal, close, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  TimingBar, TracePath, TorqueDial, forgiveness, gradeFor,
} from '../src/game/minigames.js';

describe('timing bar', () => {
  test('the pointer bounces inside its track', () => {
    const b = new TimingBar({ speed: 3 });
    for (let i = 0; i < 400; i++) {
      b.update(1 / 60);
      between(b.pos, 0, 1, 'pointer escaped the bar');
    }
  });

  test('dead centre scores 1 and outside the band scores 0', () => {
    const b = new TimingBar({ zoneHalf: 0.1, zoneCenter: 0.5 });
    b.pos = 0.5;
    equal(b.strike(), 1);
    b.pos = 0.5 + 0.1001;
    equal(b.strike(), 0);
    b.pos = 0.55;
    close(b.strike(), 0.5, 1e-9);
  });

  test('advancing makes the next strike harder but never impossible', () => {
    const rand = makeRng(1);
    const b = new TimingBar({ zoneHalf: 0.14, speed: 0.8, wander: 0.2 });
    for (let i = 0; i < 40; i++) b.advance(rand);
    assert(b.zoneHalf >= 0.035, 'the band must not collapse to nothing');
    between(b.zoneCenter, 0, 1, 'the band must stay on the bar');
  });

  test('a wandering band always leaves room to hit it', () => {
    const rand = makeRng(77);
    const b = new TimingBar({ zoneHalf: 0.14, speed: 0.8, wander: 0.3 });
    for (let i = 0; i < 200; i++) {
      b.advance(rand);
      assert(b.zoneCenter - b.zoneHalf >= -1e-9, 'band ran off the left edge');
      assert(b.zoneCenter + b.zoneHalf <= 1 + 1e-9, 'band ran off the right edge');
    }
  });
});

describe('trace path', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  test('following the dot perfectly scores 1', () => {
    const t = new TracePath(line, { speed: 1, tolerance: 20 });
    for (let i = 0; i < 60 && !t.done; i++) {
      const p = t.at(t.t);
      t.update(1 / 60, p.x, p.y);
    }
    assert(t.done);
    close(t.score, 1, 0.02);
  });

  test('ignoring the dot scores 0', () => {
    const t = new TracePath(line, { speed: 1, tolerance: 20 });
    for (let i = 0; i < 60 && !t.done; i++) t.update(1 / 60, 9999, 9999);
    equal(t.score, 0);
  });

  test('tracking loosely lands in between', () => {
    const t = new TracePath(line, { speed: 1, tolerance: 20 });
    for (let i = 0; i < 60 && !t.done; i++) {
      const p = t.at(t.t);
      // Drift in and out of tolerance.
      const off = i % 2 === 0 ? 5 : 40;
      t.update(1 / 60, p.x, p.y + off);
    }
    between(t.score, 0.05, 0.95);
  });

  test('at() walks the polyline in order', () => {
    const t = new TracePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { speed: 1 });
    const start = t.at(0);
    const end = t.at(1);
    equal(start.x, 0);
    equal(end.x, 10);
    equal(end.y, 10);
    const mid = t.at(0.5);
    close(mid.x, 10, 1e-6);
    close(mid.y, 0, 1e-6);
  });
});

describe('torque dial', () => {
  test('locking on target scores 1 and off target scores 0', () => {
    const d = new TorqueDial({ sector: 0.6, target: 0 });
    d.angle = 0;
    equal(d.lock(), 1);
    d.angle = 2;
    equal(d.lock(), 0);
  });

  test('the sector shrinks but stays lockable', () => {
    const rand = makeRng(5);
    const d = new TorqueDial({ sector: 0.6 });
    for (let i = 0; i < 50; i++) d.advance(rand);
    assert(d.sector >= 0.16);
    assert(Math.abs(d.speed) > 0, 'the needle must keep moving');
  });

  test('angle wrapping does not create a blind spot at the seam', () => {
    const d = new TorqueDial({ sector: 0.6, target: Math.PI - 0.05 });
    // Just past the seam, which is well inside a 0.6 wide sector.
    d.angle = -Math.PI + 0.05;
    assert(d.lock() > 0, 'the sector should wrap across +/-pi');
  });
});

describe('difficulty tuning', () => {
  test('good stock and a skilled crafter widen the windows', () => {
    const hard = forgiveness(0.7, 0);
    const easy = forgiveness(1.0, 0.3);
    assert(easy > hard);
    between(hard, 0.8, 1.9);
    between(easy, 0.8, 1.9);
  });

  test('forgiveness stays inside its clamp for absurd inputs', () => {
    between(forgiveness(0, 0), 0.8, 1.9);
    between(forgiveness(5, 5), 0.8, 1.9);
  });

  test('even the worst stock is workable enough to be worth attempting', () => {
    // The original floor of 0.62 made hard stock feel like a punishment.
    assert(forgiveness(0.7, 0) >= 1.0, 'rebar should still be shapeable by an unskilled crafter');
  });

  test('grades cover the whole range', () => {
    const names = [0, 0.3, 0.6, 0.8, 1].map((v) => gradeFor(v).text);
    equal(new Set(names).size, 5, 'every score band should read differently');
  });
});

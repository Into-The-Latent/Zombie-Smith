// The people.
//
// The bug this file exists to prevent is the one that shipped: the draw call
// passed no shape at all, so every survivor class was the same silhouette and
// nobody noticed for months, because a renderer has no assertions. Figures are
// now assembled by a pure function, and the assembly can be measured.

import { describe, test, assert, equal, close } from './harness.js';
import {
  BASE_BUILD, CLASS_BUILD, ZOMBIE_BUILD, figureParts, weaponLen,
} from '../src/run/figure.js';
import { CLASSES } from '../src/data/progression.js';
import { ENEMIES } from '../src/data/enemies.js';
import { WEAPON_TEMPLATES } from '../src/data/weapons.js';

const ALL = { ...CLASS_BUILD, ...ZOMBIE_BUILD };
const topOf = (parts) => Math.max(...parts.map((p) => p.z + p.h));
const widthOf = (parts) => Math.max(...parts.map((p) => Math.abs(p.lat) + p.d / 2)) * 2;

describe('builds', () => {
  test('every class and archetype has one', () => {
    for (const key of Object.keys(CLASSES)) assert(CLASS_BUILD[key], `no build for ${key}`);
    for (const key of Object.keys(ENEMIES)) assert(ZOMBIE_BUILD[key], `no build for ${key}`);
  });

  test('no two builds are the same silhouette', () => {
    // The actual defect. Four classes, one shape, because the shape argument
    // was never passed -- a Heavy was exactly as broad as a Scout.
    const shapes = new Map();
    for (const [key, b] of Object.entries(ALL)) {
      const parts = figureParts(b);
      const sig = `${(topOf(parts) * (b.scale || 1)).toFixed(2)}|${(widthOf(parts) * (b.scale || 1)).toFixed(3)}`;
      assert(!shapes.has(sig), `${key} and ${shapes.get(sig)} are the same size and shape`);
      shapes.set(sig, key);
    }
  });

  test('the four classes differ in the way their descriptions say', () => {
    const size = (key) => {
      const b = CLASS_BUILD[key];
      const parts = figureParts(b);
      return { w: widthOf(parts) * b.scale, h: topOf(parts) * b.scale };
    };
    const heavy = size('heavy');
    const scout = size('scout');
    assert(heavy.w > scout.w * 1.25, `a Heavy (${heavy.w.toFixed(2)}) must be visibly broader than a Scout (${scout.w.toFixed(2)})`);
    assert(scout.h > size('medic').h * 0.98, 'and a Scout is not stunted by being slim');
  });

  test('a brute is built differently from a runner, not just bigger', () => {
    // Scale alone would make the Brute a Runner seen from closer up. What
    // names it is the ratio: it is far wider for its height than anything
    // else on the map.
    const squat = (k) => {
      const parts = figureParts(ZOMBIE_BUILD[k]);
      return widthOf(parts) / (topOf(parts) / 26);
    };
    assert(squat('brute') > squat('runner') * 1.7,
      `the Brute (${squat('brute').toFixed(2)}) must be far broader for its height than the Runner (${squat('runner').toFixed(2)})`);
    assert(squat('brute') === Math.max(...Object.keys(ZOMBIE_BUILD).map(squat)),
      'and broader than everything else too');
  });

  test('a figure is about forty pixels tall, whatever it is', () => {
    // Everything else on screen is scaled against this: WALL_H is 26, so a
    // wall comes up to a survivor's chest. If a build drifts, the whole world
    // changes size around it.
    for (const [key, b] of Object.entries(ALL)) {
      const h = topOf(figureParts(b)) * (b.scale || 1);
      assert(h > 33 && h < 52, `${key} stands ${h.toFixed(1)} tall`);
    }
  });
});

describe('assembling one', () => {
  test('every part is a real box, standing on or above the floor', () => {
    for (const [key, b] of Object.entries(ALL)) {
      for (const p of figureParts(b, { weapon: { kind: 'gun', len: 0.2 } })) {
        assert(p.w > 0 && p.d > 0 && p.h > 0, `${key} has a part with no size`);
        assert(p.z >= -1, `${key} has a part below the floor at z=${p.z}`);
        assert(Math.abs(p.lat) < 0.4 && Math.abs(p.fwd) < 0.62,
          `${key} has a part ${p.fwd},${p.lat} away from its own tile`);
      }
    }
  });

  test('walking swings the legs in opposition', () => {
    // Standing still they are simply apart; the gait is what says "moving",
    // and legs that swing together read as a hop.
    const still = figureParts(BASE_BUILD, { walk: 0 });
    equal(still[0].fwd, still[1].fwd, 'standing still, both legs are level');

    const mid = figureParts(BASE_BUILD, { walk: Math.PI / 2 });
    assert(Math.abs(mid[0].fwd) > 0.02, 'a leg should actually swing');
    close(mid[0].fwd, -mid[1].fwd, 1e-9, 'and the other leg swings the opposite way');
  });

  test('an attack lifts the weapon arm and only the weapon arm', () => {
    const rest = figureParts(BASE_BUILD, { swing: 0 });
    const mid = figureParts(BASE_BUILD, { swing: 1 });
    // Arms are the two parts at shoulder height on either side.
    const arms = (parts) => parts.filter((p) => Math.abs(p.lat) > 0.15 && p.h > 8);
    const [restL, restR] = arms(rest);
    const [swungL, swungR] = arms(mid);
    equal(swungL.z, restL.z, 'the off hand stays where it is');
    assert(swungR.z > restR.z + 3, 'the weapon arm comes up');
    assert(swungR.fwd > restR.fwd + 0.05, 'and forward');
  });

  test('the archetypes keep the one feature that names them', () => {
    // Eyes on every zombie, plus its own detail. These are boxes standing
    // proud of the head, so a figure looking away hides its own face by
    // depth sorting rather than by anyone asking which way it faces.
    for (const key of Object.keys(ZOMBIE_BUILD)) {
      const parts = figureParts(ZOMBIE_BUILD[key], { t: 0.5 });
      const eyes = parts.filter((p) => p.m === 'eye');
      equal(eyes.length, 2, `${key} has the wrong number of eyes`);
      // In front of the head, which for a figure tipped back -- the Spitter
      // lobbing, the Screamer howling -- is still behind the middle of its
      // own tile. The comparison has to be against the skull, not the tile.
      const head = parts.find((p) => p.m === 'skin' && p.h > 5);
      for (const p of eyes) {
        assert(p.fwd > head.fwd, `${key}'s eyes are in the back of its head`);
        assert(p.z > head.z && p.z < head.z + head.h, `${key}'s eyes are off its head`);
      }
    }
    assert(figureParts(ZOMBIE_BUILD.spitter).some((p) => p.m === 'sac'), 'the Spitter carries its sac');
    assert(figureParts(ZOMBIE_BUILD.screamer, { t: 0 }).some((p) => p.m === 'maw'), 'the Screamer has its jaw');
  });

  test('each survivor class carries its own kit', () => {
    const kits = new Set();
    for (const key of Object.keys(CLASS_BUILD)) {
      const parts = figureParts(CLASS_BUILD[key]).filter((p) => p.m === 'kit');
      assert(parts.length > 0, `${key} carries nothing that names it`);
      kits.add(CLASS_BUILD[key].kit);
    }
    equal(kits.size, Object.keys(CLASS_BUILD).length, 'two classes carry the same kit');
  });
});

describe('what they are holding', () => {
  test('a rifle is longer than a pistol, and both are longer than nothing', () => {
    const len = (key) => weaponLen({
      kind: WEAPON_TEMPLATES[key].kind, baseStats: WEAPON_TEMPLATES[key].base,
    });
    assert(len('hunting_rifle') > len('makeshift_pistol') * 1.4,
      `a rifle (${len('hunting_rifle')}) should dwarf a pistol (${len('makeshift_pistol')})`);
    assert(len('pipe_shotgun') > len('makeshift_pistol'), 'and a shotgun is a long gun too');
    assert(len('fire_axe') > len('pipe_club'), 'a fire axe is a bigger thing than a pipe');
  });

  test('every template comes out a sane size', () => {
    for (const [key, tpl] of Object.entries(WEAPON_TEMPLATES)) {
      const l = weaponLen({ kind: tpl.kind, baseStats: tpl.base });
      assert(l >= 0.15 && l <= 0.34, `${key} is ${l} of a tile long`);
    }
  });

  test('a weapon is held out in front, not through the chest', () => {
    const parts = figureParts(BASE_BUILD, { weapon: { kind: 'gun', len: 0.3 } });
    const gun = parts.find((p) => p.m === 'steel');
    assert(gun, 'the weapon was not built');
    assert(gun.fwd > BASE_BUILD.bodyD / 2, 'it must clear the body');
    assert(gun.lat > 0, 'and it is in a hand, not in the middle');
  });
});

describe('falling over', () => {
  test('a toppled figure is on the floor and lying along its facing', () => {
    // The topple is a quarter turn about the feet, done part by part rather
    // than by rotating the canvas -- boxes stay boxes, so a body on the floor
    // is lit by the same sun as the floor.
    const b = CLASS_BUILD.gunsmith;
    const parts = figureParts(b);
    const standing = { top: topOf(parts), reach: Math.max(...parts.map((p) => p.fwd)) };
    // The same maths drawFigure uses.
    const FALL = 1 / 26;
    const laid = parts.map((p) => ({
      fwd: p.fwd + (p.z + p.h / 2) * FALL, z: 0, h: p.w / FALL,
    }));
    const top = Math.max(...laid.map((p) => p.z + p.h));
    assert(top < standing.top * 0.5, `a body lying down is ${top.toFixed(1)} tall, not ${standing.top}`);
    assert(Math.max(...laid.map((p) => p.fwd)) > standing.reach + 0.7,
      'and it reaches out along the ground the way it fell');
  });
});

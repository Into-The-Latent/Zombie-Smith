import { describe, test, assert, equal, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  buildWeapon, weaponStats, tierFor, foundWeapon, repairCost, isBroken,
} from '../src/game/craft.js';
import { WEAPON_TEMPLATES } from '../src/data/weapons.js';

describe('rng', () => {
  test('is deterministic for a given seed', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    for (let i = 0; i < 50; i++) equal(a.next(), b.next());
  });

  test('int stays within the inclusive range', () => {
    const r = makeRng(7);
    for (let i = 0; i < 500; i++) between(r.int(3, 6), 3, 6);
  });

  test('weighted never returns undefined', () => {
    const r = makeRng(99);
    const table = [{ key: 'a', w: 1 }, { key: 'b', w: 5 }];
    for (let i = 0; i < 200; i++) assert(r.weighted(table).key !== undefined);
  });

  test('state can be captured and restored', () => {
    const r = makeRng(42);
    r.next();
    const snapshot = r.getState();
    const a = [r.next(), r.next()];
    r.setState(snapshot);
    const b = [r.next(), r.next()];
    equal(a[0], b[0]);
    equal(a[1], b[1]);
  });
});

describe('crafting', () => {
  test('better minigame scores make a strictly better weapon', () => {
    const bad = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.1, grind: 0.1, fit: 0.1 } });
    const good = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.9, grind: 0.9, fit: 0.9 } });
    const b = weaponStats(bad);
    const g = weaponStats(good);
    assert(g.dmg > b.dmg, 'damage should rise with the shape score');
    assert(g.acc > b.acc, 'accuracy should rise with the grind score');
    assert(g.crit > b.crit, 'crit should rise with the grind score');
    assert(good.durMax > bad.durMax, 'durability should rise with the shape score');
  });

  test('only the stages a template runs count toward quality', () => {
    // pipe_club has no grind stage, so a terrible grind score is ignored.
    const w = buildWeapon({ tpl: 'pipe_club', stock: 'scrap_steel', scores: { shape: 1, grind: 0, fit: 1 } });
    equal(w.quality, 1);
  });

  test('quality maps onto the expected tier', () => {
    equal(tierFor(0.0).key, 'crude');
    equal(tierFor(0.5).key, 'sturdy');
    equal(tierFor(0.7).key, 'fine');
    equal(tierFor(0.85).key, 'superior');
    equal(tierFor(1).key, 'masterwork');
  });

  test('a flawless assembly saves an action point and a botched one costs one', () => {
    const base = WEAPON_TEMPLATES.machete.base.ap;
    const great = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 1 } });
    const awful = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0 } });
    equal(weaponStats(great).ap, base - 1);
    equal(weaponStats(awful).ap, base + 1);
  });

  test('stock material shifts stats in the documented direction', () => {
    const steel = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.6, grind: 0.6, fit: 0.6 } });
    const rebar = buildWeapon({ tpl: 'machete', stock: 'rebar', scores: { shape: 0.6, grind: 0.6, fit: 0.6 } });
    assert(weaponStats(rebar).dmg > weaponStats(steel).dmg, 'rebar hits harder');
    assert(weaponStats(rebar).acc < weaponStats(steel).acc, 'rebar is clumsier');
  });

  test('mods apply additively and can be previewed without fitting them', () => {
    const gun = buildWeapon({ tpl: 'makeshift_pistol', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0.5 } });
    const before = weaponStats(gun);
    const preview = weaponStats(gun, ['suppressor']);
    equal(preview.noise, before.noise - 7);
    equal(preview.dmg, before.dmg - 2);
    // Previewing must not mutate the weapon.
    equal(weaponStats(gun).noise, before.noise);

    gun.mods.push('suppressor');
    equal(weaponStats(gun).noise, before.noise - 7);
  });

  test('a weapon that has seen use gains a capped veteran bonus', () => {
    const w = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0.5 } });
    const base = weaponStats(w).dmg;
    w.kills = 12;
    equal(weaponStats(w).dmg, base + 1);
    w.kills = 1000;
    equal(weaponStats(w).dmg, base + 4, 'veteran damage is capped at +4');
  });

  test('stats stay inside their clamps at both extremes', () => {
    for (const key of Object.keys(WEAPON_TEMPLATES)) {
      for (const s of [0, 1]) {
        const w = buildWeapon({ tpl: key, stock: 'gun_alloy', scores: { shape: s, grind: s, fit: s } });
        const st = weaponStats(w);
        between(st.acc, 20, 99, `${key} accuracy out of range`);
        between(st.crit, 0, 0.85, `${key} crit out of range`);
        assert(st.dmg >= 1, `${key} damage must stay positive`);
        assert(st.ap >= 1, `${key} must cost at least 1 AP`);
      }
    }
  });

  test('salvaged weapons are worn but never broken on pickup', () => {
    const rand = makeRng(5);
    for (let i = 0; i < 40; i++) {
      const w = foundWeapon('machete', rand, 6);
      assert(w.found === true);
      assert(w.dur > 0 && w.dur <= w.durMax, 'found condition must be inside its range');
      assert(!isBroken(w));
    }
  });

  test('repair cost is null at full condition and scales with wear', () => {
    const w = buildWeapon({ tpl: 'machete', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0.5 } });
    equal(repairCost(w), null);
    w.dur = Math.max(0, w.durMax - 20);
    const cost = repairCost(w);
    assert(cost && cost.scrap >= 2, 'a badly worn weapon should cost real scrap');
  });
});

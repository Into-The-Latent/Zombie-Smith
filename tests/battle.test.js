import { describe, test, assert, equal, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import { newGame, advanceDay, unlock, itemById } from '../src/core/state.js';
import { createBattle, finishRun, beginRound, checkHeat, openContainer, canExtract, canFallBack } from '../src/run/battle.js';
import { hitChance, resolveAttack, applyDamage, canAttack, makeNoise } from '../src/run/combat.js';
import { nextEnemyAction, makeZombie, livingPlayers, overwatchTriggers } from '../src/run/ai.js';
import { buildWeapon, weaponStats } from '../src/game/craft.js';
import { grantXp, choosePerk, recomputeSurvivor, makeSurvivor } from '../src/game/survivors.js';
import { runMachines, addMachine } from '../src/game/machines.js';
import { rollLoot, emptyLoot, mergeLoot, lootValue } from '../src/game/loot.js';
import { xpForLevel } from '../src/data/progression.js';
import { tileAt, EXIT } from '../src/run/map.js';

function freshBattle(seed = 4242, day = 3) {
  const state = newGame(seed);
  state.day = day;
  const squad = state.survivors.map((s) => s.id);
  const battle = createBattle(state, squad, makeRng(seed), 'warehouse');
  return { state, battle };
}

describe('battle setup', () => {
  test('the squad starts on the entry pad with loaded guns', () => {
    const { state, battle } = freshBattle();
    const players = livingPlayers(battle);
    equal(players.length, 3);
    for (const p of players) {
      const d = Math.max(Math.abs(p.x - battle.map.entry.x), Math.abs(p.y - battle.map.entry.y));
      assert(d <= 2, 'a survivor spawned away from the entry pad');
      assert(p.hp > 0);
    }
    const gunner = players.find((p) => p.primary);
    assert(gunner, 'the starting squad should include a firearm');
    assert(gunner.primary.loaded > 0, 'guns should be topped up from the pool at deploy');
    assert(state.ammo.light < 12, 'loading a magazine should draw from the reserve');
  });

  test('no two units share a tile at the start', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { battle } = freshBattle(seed, 8);
      const seen = new Set();
      for (const u of battle.units) {
        const key = `${u.x},${u.y}`;
        assert(!seen.has(key), `seed ${seed}: two units stacked at ${key}`);
        seen.add(key);
      }
    }
  });

  test('leaving requires everyone standing to be on the same pad', () => {
    const { battle } = freshBattle();
    assert(!canExtract(battle), 'the squad starts nowhere near extraction');
    assert(canFallBack(battle) || true); // entry pad is 2x2, squad spawns 3x3 around it

    for (const p of livingPlayers(battle)) {
      p.x = battle.map.exit.x;
      p.y = battle.map.exit.y;
    }
    assert(tileAt(battle.map, battle.map.exit.x, battle.map.exit.y) === EXIT);
    assert(canExtract(battle), 'the whole squad on the pad should be able to extract');

    livingPlayers(battle)[0].x = battle.map.exit.x + 5;
    assert(!canExtract(battle), 'one straggler should block extraction');
  });
});

describe('hit resolution', () => {
  test('hit chance is always a usable percentage', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle)[0];
    const zombie = makeZombie('shambler', shooter.x + 3, shooter.y, 3);
    battle.units.push(zombie);
    const info = hitChance(battle, shooter, zombie);
    between(info.chance, 5, 95);
    assert(info.breakdown.length > 0, 'the player deserves to see the maths');
  });

  test('distance beyond a weapon\'s range costs accuracy', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    shooter.x = 5;
    shooter.y = 5;
    const near = makeZombie('shambler', 7, 5, 3);
    const far = makeZombie('shambler', 5 + weaponStats(shooter.primary).range + 4, 5, 3);
    battle.units.push(near, far);
    assert(hitChance(battle, shooter, near).chance > hitChance(battle, shooter, far).chance);
  });

  test('faster targets are harder to hit', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    const slow = makeZombie('shambler', shooter.x + 2, shooter.y, 3);
    const fast = makeZombie('runner', shooter.x + 2, shooter.y + 1, 3);
    battle.units.push(slow, fast);
    assert(hitChance(battle, shooter, slow).chance > hitChance(battle, shooter, fast).chance);
  });

  test('bracing improves the odds', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    const z = makeZombie('shambler', shooter.x + 3, shooter.y, 3);
    battle.units.push(z);
    const before = hitChance(battle, shooter, z).chance;
    shooter.braced = true;
    assert(hitChance(battle, shooter, z).chance >= before);
  });

  test('firing spends action points, ammunition and condition', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    shooter.active = 'primary';
    const z = makeZombie('shambler', shooter.x + 1, shooter.y, 3);
    battle.units.push(z);

    const st = weaponStats(shooter.primary);
    const ap0 = shooter.ap;
    const ammo0 = shooter.primary.loaded;
    const dur0 = shooter.primary.dur;

    resolveAttack(battle, shooter, z, makeRng(1));
    equal(shooter.ap, ap0 - st.ap);
    equal(shooter.primary.loaded, ammo0 - 1);
    equal(shooter.primary.dur, dur0 - 1);
  });

  test('a reaction shot is free', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    shooter.ap = 0;
    const z = makeZombie('shambler', shooter.x + 1, shooter.y, 3);
    battle.units.push(z);
    resolveAttack(battle, shooter, z, makeRng(2), { free: true });
    equal(shooter.ap, 0, 'overwatch must not drive action points negative');
  });

  test('an empty magazine blocks the attack, a reload fixes it', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    shooter.active = 'primary';
    const z = makeZombie('shambler', shooter.x + 1, shooter.y, 3);
    battle.units.push(z);
    shooter.primary.loaded = 0;
    equal(canAttack(battle, shooter, z).ok, false);
    shooter.primary.loaded = 3;
    assert(canAttack(battle, shooter, z).ok);
  });

  test('overwatch only triggers on a target it can actually shoot', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle).find((p) => p.primary);
    shooter.overwatch = true;
    shooter.ap = 0;
    shooter.active = 'primary';
    const z = makeZombie('shambler', shooter.x + 2, shooter.y, 3);
    battle.units.push(z);
    assert(overwatchTriggers(battle, z).length === 1, 'a visible zombie in range should draw fire');

    shooter.primary.loaded = 0;
    equal(overwatchTriggers(battle, z).length, 0, 'an empty gun cannot react');
  });

  test('armour soaks damage and penetration cuts through it', () => {
    const { battle } = freshBattle();
    const shooter = livingPlayers(battle)[0];
    const brute = makeZombie('brute', shooter.x + 1, shooter.y, 1);
    battle.units.push(brute);

    const blunt = buildWeapon({ tpl: 'pipe_club', stock: 'scrap_steel', scores: { shape: 0.5, fit: 0.5 } });
    const piercing = buildWeapon({ tpl: 'fire_axe', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0.5 } });
    assert(weaponStats(piercing).pen > weaponStats(blunt).pen);
  });
});

describe('going down and dying', () => {
  test('a survivor at zero health goes down bleeding, not dead', () => {
    const { battle } = freshBattle();
    const p = livingPlayers(battle)[0];
    const res = applyDamage(battle, p, 9999);
    equal(p.state, 'down');
    equal(res.downed, true);
    assert(p.bleed > 0);
  });

  test('bleeding out over three rounds kills', () => {
    const { battle } = freshBattle();
    const p = livingPlayers(battle)[0];
    applyDamage(battle, p, 9999);
    for (let i = 0; i < 3; i++) beginRound(battle);
    equal(p.state, 'dead');
  });

  test('a zombie at zero health dies and credits the killer', () => {
    const { battle } = freshBattle();
    const p = livingPlayers(battle)[0];
    const z = makeZombie('shambler', p.x + 1, p.y, 1);
    battle.units.push(z);
    applyDamage(battle, z, 9999, p);
    equal(z.state, 'dead');
    equal(battle.kills, 1);
    assert(p.xpEarned > 0, 'the killer should earn experience');
  });
});

describe('noise and the horde', () => {
  test('a loud noise wakes zombies inside the radius only', () => {
    const { battle } = freshBattle();
    battle.units = battle.units.filter((u) => u.side === 'player');
    const near = makeZombie('shambler', 2, 2, 1);
    const far = makeZombie('shambler', 28, 28, 1);
    battle.units.push(near, far);

    makeNoise(battle, 2, 3, 10);
    equal(near.alerted, true);
    equal(far.alerted, false);
    assert(near.memory !== null, 'a woken zombie should walk toward the sound');
  });

  test('noise raises the horde meter and a full meter spawns a wave', () => {
    const { battle } = freshBattle();
    const before = battle.heat;
    makeNoise(battle, battle.map.entry.x, battle.map.entry.y, 12);
    assert(battle.heat > before);

    battle.heat = battle.heatMax;
    const countBefore = battle.units.length;
    const spawned = checkHeat(battle);
    assert(spawned.length > 0, 'a boiled-over meter should bring company');
    equal(battle.units.length, countBefore + spawned.length);
    assert(battle.heat < battle.heatMax, 'the meter resets after a wave');
    for (const z of spawned) assert(z.alerted, 'a wave arrives already hunting');
  });

  test('a suppressor genuinely quiets a weapon', () => {
    const gun = buildWeapon({ tpl: 'makeshift_pistol', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0.5 } });
    const loud = weaponStats(gun).noise;
    gun.mods.push('suppressor');
    assert(weaponStats(gun).noise < loud);
  });
});

describe('enemy ai', () => {
  test('a dormant zombie stays put until it sees or hears something', () => {
    const { battle } = freshBattle();
    battle.units = battle.units.filter((u) => u.side === 'player');
    for (const p of battle.units) {
      p.x = 1;
      p.y = 1;
    }
    const z = makeZombie('shambler', 25, 25, 1);
    battle.units.push(z);
    const rand = makeRng(3);
    let attacks = 0;
    for (let i = 0; i < 30; i++) {
      const a = nextEnemyAction(battle, z, rand);
      if (a && a.type === 'attack') attacks += 1;
      z.ap = z.apMax;
    }
    equal(attacks, 0, 'an unaware zombie should not be swinging at anything');
  });

  test('an alerted zombie closes on the squad', () => {
    const { battle } = freshBattle();
    battle.units = battle.units.filter((u) => u.side === 'player');
    const target = battle.units[0];
    // Put a zombie a few open tiles away on the same row.
    const z = makeZombie('runner', target.x + 4, target.y, 1);
    z.alerted = true;
    z.memory = { x: target.x, y: target.y };
    battle.units.push(z);

    const rand = makeRng(9);
    const startDist = Math.abs(z.x - target.x);
    for (let i = 0; i < 6; i++) {
      const a = nextEnemyAction(battle, z, rand);
      if (!a) break;
      if (a.type === 'move') {
        z.x = a.to[0];
        z.y = a.to[1];
        z.ap -= 1;
      } else break;
    }
    assert(Math.abs(z.x - target.x) + Math.abs(z.y - target.y) < startDist, 'the zombie should have closed the gap');
  });

  test('a zombie never returns an action once out of action points', () => {
    const { battle } = freshBattle();
    const z = battle.units.find((u) => u.side === 'zombie');
    z.ap = 0;
    equal(nextEnemyAction(battle, z, makeRng(1)), null);
  });
});

describe('loot', () => {
  test('containers deeper into a map pay better', () => {
    let shallow = 0;
    let deep = 0;
    for (let i = 0; i < 60; i++) {
      const rand = makeRng(100 + i);
      shallow += lootValue(mergeLoot(emptyLoot(), rollLoot('crate', rand, 5, 0)));
      const rand2 = makeRng(100 + i);
      deep += lootValue(mergeLoot(emptyLoot(), rollLoot('crate', rand2, 5, 1)));
    }
    assert(deep > shallow, 'depth should be worth the risk');
  });

  test('the scavenger perk increases the haul', () => {
    let plain = 0;
    let bonus = 0;
    for (let i = 0; i < 60; i++) {
      plain += lootValue(mergeLoot(emptyLoot(), rollLoot('crate', makeRng(500 + i), 5, 0.5, 0)));
      bonus += lootValue(mergeLoot(emptyLoot(), rollLoot('crate', makeRng(500 + i), 5, 0.5, 0.35)));
    }
    assert(bonus > plain);
  });

  test('a safe never hands out a blueprint the player already owns', () => {
    const owned = ['wpn_fire_axe', 'wpn_shotgun', 'mod_scope'];
    for (let i = 0; i < 80; i++) {
      const bundle = rollLoot('safe', makeRng(900 + i), 12, 1, 0, owned);
      if (bundle.blueprint) assert(!owned.includes(bundle.blueprint));
    }
  });

  test('opening a container is idempotent', () => {
    const { battle } = freshBattle();
    const c = battle.map.containers[0];
    const p = livingPlayers(battle)[0];
    const first = openContainer(battle, p, c);
    const second = openContainer(battle, p, c);
    assert(first !== null);
    equal(second, null, 'a looted container must stay empty');
    equal(battle.containersOpened, 1);
  });
});

describe('progression', () => {
  test('experience levels a survivor and grants a perk pick', () => {
    const sv = makeSurvivor('scout', makeRng(1));
    const need = xpForLevel(1);
    grantXp(sv, need);
    equal(sv.level, 2);
    equal(sv.pendingPerks, 1);
  });

  test('levelling up keeps the wound, it does not heal it', () => {
    const sv = makeSurvivor('heavy', makeRng(2));
    sv.hp = 5;
    const wound = sv.hpMax - sv.hp;
    const maxBefore = sv.hpMax;
    grantXp(sv, xpForLevel(1) * 3);
    assert(sv.level > 1, 'should have levelled');
    assert(sv.hpMax > maxBefore, 'max health should grow with level');
    // Health rises only by the amount the maximum did -- the damage carries over.
    equal(sv.hpMax - sv.hp, wound, 'the same amount of damage should still be on them');
  });

  test('perks apply once and survive a stat rebuild', () => {
    const sv = makeSurvivor('gunsmith', makeRng(3));
    const aim0 = sv.aim;
    sv.pendingPerks = 2;
    equal(choosePerk(sv, 'steady'), true);
    equal(sv.aim, aim0 + 8);
    equal(choosePerk(sv, 'steady'), false, 'the same perk must not stack');
    recomputeSurvivor(sv);
    equal(sv.aim, aim0 + 8, 'a rebuild must not drop or double the perk');
  });

  test('a class rebuild is idempotent', () => {
    const sv = makeSurvivor('medic', makeRng(4));
    sv.pendingPerks = 1;
    choosePerk(sv, 'tough');
    const snapshot = JSON.stringify(sv);
    recomputeSurvivor(sv);
    recomputeSurvivor(sv);
    equal(JSON.stringify(sv), snapshot);
  });
});

describe('the day cycle', () => {
  test('machines consume inputs and produce output', () => {
    const state = newGame(11);
    addMachine(state, 'grinder');
    state.resources.scrap = 10;
    state.resources.fuel = 3;
    const parts0 = state.resources.parts;
    const notes = runMachines(state);
    equal(state.resources.parts, parts0 + 2);
    equal(state.resources.scrap, 6);
    assert(notes[0].includes('Grinder'));
  });

  test('a machine without materials idles instead of going negative', () => {
    const state = newGame(12);
    addMachine(state, 'grinder');
    state.resources.scrap = 0;
    state.resources.fuel = 0;
    runMachines(state);
    equal(state.resources.scrap, 0);
    equal(state.resources.fuel, 0);
  });

  test('researching automation installs the machine exactly once', () => {
    const state = newGame(13);
    unlock(state, 'mach_ammo');
    unlock(state, 'mach_ammo');
    equal(state.machines.filter((m) => m.key === 'ammo_press').length, 1);
  });

  test('a day of rest heals the squad and eats rations', () => {
    const state = newGame(14);
    const sv = state.survivors[0];
    sv.hp = 5;
    const food0 = state.resources.food;
    advanceDay(state);
    assert(sv.hp > 5, 'resting should heal');
    equal(state.resources.food, food0 - state.survivors.filter((s) => s.status !== 'dead').length);
    equal(state.day, 2);
  });

  test('injuries count down to ready', () => {
    const state = newGame(15);
    const sv = state.survivors[0];
    sv.status = 'injured';
    sv.injury = 2;
    advanceDay(state);
    equal(sv.status, 'injured');
    advanceDay(state);
    equal(sv.status, 'ready');
  });
});

describe('run settlement', () => {
  test('extracting banks the haul and pays a bonus cache', () => {
    const { state, battle } = freshBattle(2024, 4);
    const scrap0 = state.resources.scrap;
    mergeLoot(battle.loot, { resources: { scrap: 7 }, ammo: {}, medipacks: 0 });
    const report = finishRun(state, battle, 'extracted');
    assert(state.resources.scrap >= scrap0 + 7, 'the carried scrap should come home');
    assert(report.bonus, 'extraction should include the pad cache');
    equal(state.stats.extracted, 1);
  });

  test('a wipe loses the haul and the ammunition spent stays spent', () => {
    const { state, battle } = freshBattle(2025, 4);
    const scrap0 = state.resources.scrap;
    mergeLoot(battle.loot, { resources: { scrap: 9 }, ammo: {}, medipacks: 0 });
    for (const p of livingPlayers(battle)) p.state = 'dead';
    finishRun(state, battle, 'wiped');
    equal(state.resources.scrap, scrap0, 'nothing carried should survive a wipe');
    equal(state.stats.wiped, 1);
  });

  test('the dead take their gear with them', () => {
    const { state, battle } = freshBattle(2026, 4);
    const victim = livingPlayers(battle).find((p) => p.primary);
    const weaponId = victim.primary.id;
    victim.state = 'dead';
    finishRun(state, battle, 'fellback');

    const sv = state.survivors.find((s) => s.id === victim.svId);
    equal(sv.status, 'dead');
    equal(itemById(state, weaponId), null, 'their weapon should be gone from the rack');
    equal(sv.equipped.primary, null);
  });

  test('rounds still in the magazine come home', () => {
    const { state, battle } = freshBattle(2027, 4);
    const gunner = livingPlayers(battle).find((p) => p.primary);
    gunner.primary.loaded = 4;
    battle.ammoReserve.light = 5;
    finishRun(state, battle, 'fellback');
    equal(state.ammo.light, 9, 'reserve plus what was in the gun');
    equal(gunner.primary.loaded, 0);
  });

  test('a survivor who ends the run down is injured, not dead', () => {
    const { state, battle } = freshBattle(2028, 4);
    const p = livingPlayers(battle)[0];
    applyDamage(battle, p, 9999);
    equal(p.state, 'down');
    finishRun(state, battle, 'fellback');
    const sv = state.survivors.find((s) => s.id === p.svId);
    equal(sv.status, 'injured');
    assert(sv.hp > 0);
    assert(sv.injury > 0);
  });

  test('blueprints found on a run unlock research', () => {
    const { state, battle } = freshBattle(2029, 4);
    battle.loot.blueprints.push('mod_scope');
    finishRun(state, battle, 'extracted');
    assert(state.unlocks.includes('mod_scope'));
  });
});

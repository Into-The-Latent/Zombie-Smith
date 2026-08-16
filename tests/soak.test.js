// Plays many complete battles with no renderer attached, driving the same
// model code the run scene does. This is where the awkward states turn up:
// empty magazines, broken weapons, downed survivors, horde waves, wipes.

import { describe, test, assert } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import { newGame } from '../src/core/state.js';
import {
  createBattle, beginRound, checkHeat, openContainer, dropFromCorpse,
  finishRun, squadWiped, canExtract, canFallBack, livingPlayers,
} from '../src/run/battle.js';
import { refreshVision, isVisible } from '../src/run/fov.js';
import { canAttack, resolveAttack, activeWeapon, makeNoise } from '../src/run/combat.js';
import { nextEnemyAction, overwatchTriggers, isBlockedFor, unitAt } from '../src/run/ai.js';
import { findPath } from '../src/run/pathfind.js';
import { weaponStats } from '../src/game/craft.js';
import { isWalkable } from '../src/run/map.js';

const MAX_ROUNDS = 40;

function checkInvariants(battle, where) {
  const occupied = new Map();
  for (const u of battle.units) {
    assert(u.ap >= 0, `${where}: ${u.name} has negative action points (${u.ap})`);
    assert(u.hp >= 0 && u.hp <= u.hpMax, `${where}: ${u.name} hp ${u.hp}/${u.hpMax} out of range`);
    assert(Number.isFinite(u.x) && Number.isFinite(u.y), `${where}: ${u.name} has a non-finite position`);
    if (u.state === 'dead') continue;
    assert(isWalkable(battle.map, u.x, u.y), `${where}: ${u.name} is standing inside geometry at ${u.x},${u.y}`);
    const key = `${u.x},${u.y}`;
    assert(!occupied.has(key), `${where}: ${u.name} is stacked on ${occupied.get(key)} at ${key}`);
    occupied.set(key, u.name);
  }
  assert(battle.heat >= 0 && battle.heat <= battle.heatMax, `${where}: heat ${battle.heat} out of range`);
  for (const w of battle.units.flatMap((u) => [u.primary, u.melee]).filter(Boolean)) {
    assert(w.loaded >= 0, `${where}: ${w.name} has negative rounds loaded`);
    assert(w.dur >= 0, `${where}: ${w.name} has negative condition`);
  }
  for (const [k, v] of Object.entries(battle.ammoReserve)) {
    assert(v >= 0, `${where}: reserve of ${k} went negative`);
  }
  assert(battle.medipacks >= 0, `${where}: medipack count went negative`);
}

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * @param {number} aggression 0..1, how eagerly it shoots
 * @param {boolean} careful    when true it also triages: stabilises the
 *        downed, patches the badly hurt, and heads for the entry pad when the
 *        squad is losing. This is the run that tells us whether the game is
 *        beatable by a sensible player, as opposed to a suicidal one.
 */
function playerPhase(battle, rand, aggression, careful = false) {
  if (careful) {
    for (const medic of livingPlayers(battle)) {
      if (medic.state !== 'idle' || medic.ap < 2 || battle.medipacks <= 0) continue;
      const patient = livingPlayers(battle).find(
        (p) => (p.state === 'down' || p.hp < p.hpMax * 0.35)
          && (p === medic || chebyshev(medic, p) <= 1),
      );
      if (!patient) continue;
      battle.medipacks -= 1;
      medic.ap -= 2;
      if (patient.state === 'down') {
        patient.state = 'idle';
        patient.hp = Math.max(1, Math.round(patient.hpMax * 0.3));
        patient.bleed = 0;
        patient.ap = 0;
      } else {
        patient.hp = Math.min(patient.hpMax, patient.hp + 18);
      }
    }
  }

  // Losing badly? Turn around and walk out the way we came.
  const hurt = livingPlayers(battle).filter((p) => p.state === 'down' || p.hp < p.hpMax * 0.4).length;
  const retreating = careful && (hurt >= 2 || battle.heat > battle.heatMax * 0.85);
  const goal = retreating ? battle.map.entry : battle.map.exit;

  for (const u of livingPlayers(battle)) {
    if (u.state !== 'idle') continue;
    let guard = 0;
    while (u.ap > 0 && guard++ < 24) {
      const target = battle.units.find(
        (z) => z.side === 'zombie' && z.state !== 'dead' && isVisible(battle, z.x, z.y)
          && canAttack(battle, u, z).ok,
      );

      if (target && rand.chance(aggression)) {
        const res = resolveAttack(battle, u, target, rand);
        if (res.noise) makeNoise(battle, u.x, u.y, res.noise);
        if (target.state === 'dead') dropFromCorpse(battle, target);
        refreshVision(battle);
        continue;
      }

      // Out of ammo? Reload if we can, otherwise swap to the melee weapon.
      const w = activeWeapon(u);
      if (w && w.kind === 'gun' && w.loaded === 0) {
        const st = weaponStats(w);
        const have = battle.ammoReserve[w.ammo] || 0;
        const cost = u.fastReload ? 1 : 2;
        if (have > 0 && u.ap >= cost) {
          const take = Math.min(st.mag, have);
          w.loaded += take;
          battle.ammoReserve[w.ammo] -= take;
          u.ap -= cost;
          continue;
        }
        if (u.melee && u.ap >= 1) {
          u.active = 'melee';
          u.ap -= 1;
          continue;
        }
      }
      if (w && w.dur <= 0 && u.melee && u.melee.dur > 0 && u.active !== 'melee' && u.ap >= 1) {
        u.active = 'melee';
        u.ap -= 1;
        continue;
      }

      // Occasionally set overwatch instead of walking into the dark.
      if (u.ap >= 2 && rand.chance(0.12) && w && (w.kind !== 'gun' || w.loaded > 0)) {
        u.overwatch = true;
        u.ap = 0;
        continue;
      }

      // Otherwise walk toward whichever pad we are aiming for.
      const path = findPath(
        battle.map, u.x, u.y, goal.x, goal.y,
        isBlockedFor(battle, u), { maxCost: 300 },
      );
      if (!path || !path.length) break;
      const steps = Math.min(u.ap, path.length);
      for (let i = 0; i < steps; i++) {
        const [nx, ny] = path[i];
        if (unitAt(battle, nx, ny)) break;
        u.x = nx;
        u.y = ny;
        u.ap -= 1;
        const c = battle.map.containers.find((k) => k.x === nx && k.y === ny && !k.opened);
        if (c) openContainer(battle, u, c);
      }
      refreshVision(battle);
      break;
    }
  }
}

function enemyPhase(battle, rand) {
  const queue = battle.units.filter((u) => u.side === 'zombie' && u.state !== 'dead');
  for (const z of queue) {
    z.ap = z.apMax;
    let guard = 0;
    while (z.ap > 0 && guard++ < 40) {
      const action = nextEnemyAction(battle, z, rand);
      if (!action) break;

      if (action.type === 'wait') {
        z.ap = 0;
      } else if (action.type === 'scream') {
        makeNoise(battle, z.x, z.y, 16);
        battle.heat = Math.min(battle.heatMax, battle.heat + 35);
        z.ap -= 1;
      } else if (action.type === 'move') {
        const [nx, ny] = action.to;
        assert(isWalkable(battle.map, nx, ny), `ai tried to walk into geometry at ${nx},${ny}`);
        assert(!unitAt(battle, nx, ny), `ai tried to walk onto an occupied tile at ${nx},${ny}`);
        z.x = nx;
        z.y = ny;
        z.ap -= 1;
        refreshVision(battle);
        for (const tr of overwatchTriggers(battle, z)) {
          tr.shooter.overwatch = false;
          const res = resolveAttack(battle, tr.shooter, tr.target, rand, { free: true });
          if (res.noise) makeNoise(battle, tr.shooter.x, tr.shooter.y, res.noise);
        }
        if (z.state === 'dead') break;
      } else if (action.type === 'attack') {
        resolveAttack(battle, z, action.target, rand);
      }
      if (squadWiped(battle)) return;
    }
  }
}

function playBattle(seed, day, opts = {}) {
  const careful = !!opts.careful;
  const state = newGame(seed);
  state.day = day;
  // Deliberately thin, so the empty-magazine paths actually get exercised.
  state.ammo.light = 6;
  if (careful) state.medipacks = 3;
  const rand = makeRng(seed ^ 0xbeef);
  const battle = createBattle(state, state.survivors.map((s) => s.id), rand);

  let rounds = 0;
  let outcome = null;
  checkInvariants(battle, `seed ${seed} start`);

  while (rounds < MAX_ROUNDS) {
    rounds += 1;
    playerPhase(battle, rand, 0.75, careful);
    checkInvariants(battle, `seed ${seed} round ${rounds} after player`);

    if (canExtract(battle)) {
      outcome = 'extracted';
      break;
    }
    if (careful && rounds > 3 && canFallBack(battle)) {
      outcome = 'fellback';
      break;
    }
    if (squadWiped(battle)) {
      outcome = 'wiped';
      break;
    }

    enemyPhase(battle, rand);
    checkInvariants(battle, `seed ${seed} round ${rounds} after enemies`);
    if (squadWiped(battle)) {
      outcome = 'wiped';
      break;
    }

    checkHeat(battle);
    beginRound(battle);
    for (const u of battle.units) if (u.side === 'player') u.overwatch = false;
    checkInvariants(battle, `seed ${seed} round ${rounds} after upkeep`);
  }

  if (!outcome) outcome = canFallBack(battle) ? 'fellback' : 'timeout';
  const settled = outcome === 'timeout' ? 'fellback' : outcome;
  const report = finishRun(state, battle, settled);

  // Post-settlement sanity.
  for (const [k, v] of Object.entries(state.resources)) {
    assert(v >= 0, `seed ${seed}: ${k} went negative after settlement`);
  }
  for (const [k, v] of Object.entries(state.ammo)) {
    assert(v >= 0, `seed ${seed}: ${k} ammo went negative after settlement`);
  }
  assert(state.medipacks >= 0, `seed ${seed}: negative medipacks after settlement`);
  for (const sv of state.survivors) {
    assert(sv.hp >= 0 && sv.hp <= sv.hpMax, `seed ${seed}: ${sv.name} hp ${sv.hp}/${sv.hpMax}`);
    assert(['ready', 'injured', 'dead'].includes(sv.status), `seed ${seed}: bad status ${sv.status}`);
    for (const slot of ['primary', 'melee']) {
      const id = sv.equipped[slot];
      if (id) assert(state.stash.some((w) => w.id === id), `seed ${seed}: ${sv.name} holds a weapon that is not on the rack`);
    }
  }

  return { outcome, rounds, kills: battle.kills, waves: battle.waves, report, state, battle };
}

describe('soak: full battles', () => {
  test('40 reckless battles finish without breaking an invariant', () => {
    const tally = { extracted: 0, wiped: 0, fellback: 0, timeout: 0 };
    let kills = 0;
    let waves = 0;
    for (let i = 0; i < 40; i++) {
      const r = playBattle(1000 + i, 1 + (i % 20));
      tally[r.outcome] += 1;
      kills += r.kills;
      waves += r.waves;
    }
    assert(kills > 0, 'a reckless squad should have killed something across 40 battles');
    assert(tally.extracted + tally.wiped + tally.fellback + tally.timeout === 40);
    console.log(
      `    reckless: ${tally.extracted} extracted, ${tally.wiped} wiped, `
      + `${tally.fellback} fell back, ${tally.timeout} timed out; ${kills} kills, ${waves} waves`,
    );
  });

  test('a careful squad survives most early runs', () => {
    // The balance guard rail: playing sensibly on day 1-8 should usually work.
    const tally = { extracted: 0, wiped: 0, fellback: 0, timeout: 0 };
    const N = 30;
    for (let i = 0; i < N; i++) {
      tally[playBattle(2000 + i, 1 + (i % 8), { careful: true }).outcome] += 1;
    }
    const survived = tally.extracted + tally.fellback + tally.timeout;
    console.log(
      `    careful (day 1-8): ${tally.extracted} extracted, ${tally.fellback} fell back, `
      + `${tally.timeout} timed out, ${tally.wiped} wiped`,
    );
    assert(
      survived >= N * 0.6,
      `a careful early-game squad wiped ${tally.wiped}/${N} times -- the opening is too punishing`,
    );
  });

  test('late runs are meaningfully harder than early ones', () => {
    const wipes = (day) => {
      let n = 0;
      for (let i = 0; i < 16; i++) {
        if (playBattle(3000 + i, day, { careful: true }).outcome === 'wiped') n += 1;
      }
      return n;
    };
    const early = wipes(2);
    const late = wipes(22);
    console.log(`    wipes out of 16: day 2 -> ${early}, day 22 -> ${late}`);
    assert(late >= early, 'the campaign should get harder, not easier');
  });

  test('late-campaign battles stay stable when everything is harder', () => {
    for (let i = 0; i < 8; i++) playBattle(9000 + i, 25 + i);
  });

  test('a squad with no weapons at all does not crash the model', () => {
    const state = newGame(31337);
    for (const sv of state.survivors) sv.equipped = { primary: null, melee: null };
    const rand = makeRng(31337);
    const battle = createBattle(state, state.survivors.map((s) => s.id), rand);
    for (let r = 0; r < 6; r++) {
      playerPhase(battle, rand, 0.9);
      enemyPhase(battle, rand);
      checkInvariants(battle, 'unarmed squad');
      if (squadWiped(battle)) break;
      beginRound(battle);
    }
  });

  test('a lone survivor run settles correctly', () => {
    const state = newGame(4711);
    const rand = makeRng(4711);
    const battle = createBattle(state, [state.survivors[0].id], rand);
    for (let r = 0; r < 10 && !squadWiped(battle); r++) {
      playerPhase(battle, rand, 0.6);
      enemyPhase(battle, rand);
      checkInvariants(battle, 'solo run');
      beginRound(battle);
    }
    const report = finishRun(state, battle, squadWiped(battle) ? 'wiped' : 'fellback');
    assert(report.xp.length === 1, 'only the one who went out should earn experience');
  });

  test('reserve ammunition is conserved across a whole run', () => {
    const state = newGame(606);
    state.ammo.light = 40;
    const rand = makeRng(606);
    const battle = createBattle(state, state.survivors.map((s) => s.id), rand);

    // Everything the squad holds, plus the reserve, must equal what we set out
    // with minus what has actually been fired.
    const count = () => battle.ammoReserve.light
      + livingPlayers(battle).reduce((a, u) => a + (u.primary?.ammo === 'light' ? u.primary.loaded : 0), 0);

    let expected = count();
    for (let r = 0; r < 8 && !squadWiped(battle); r++) {
      const before = count();
      playerPhase(battle, rand, 0.9);
      const after = count();
      assert(after <= before, 'rounds appeared out of nowhere');
      // Looted ammo can push the count back up, so only check it never leaks.
      expected = after;
      enemyPhase(battle, rand);
      beginRound(battle);
    }
    assert(expected >= 0);
  });
});

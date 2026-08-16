// Semi-auto scavenging. The important properties are that it makes progress,
// that its assignments do not flicker (or the squad paces on the spot), and
// that it refuses to run whenever the player would want a say.

import { describe, test, assert, equal } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import { newGame } from '../src/core/state.js';
import { createBattle, openContainer, beginRound } from '../src/run/battle.js';
import { livingPlayers, makeZombie, unitAt } from '../src/run/ai.js';
import { refreshVision } from '../src/run/fov.js';
import { applyDamage } from '../src/run/combat.js';
import {
  nextAutoAction, haltReason, completionReason, snapshotHp, progressSignature, HALT,
} from '../src/run/autopilot.js';
import { isWalkable } from '../src/run/map.js';

function freshBattle(seed = 777, day = 2) {
  const state = newGame(seed);
  state.day = day;
  const battle = createBattle(state, state.survivors.map((s) => s.id), makeRng(seed), 'warehouse');
  // Push the zombies far away so the autopilot is free to run.
  for (const z of battle.units.filter((u) => u.side === 'zombie')) z.state = 'dead';
  refreshVision(battle);
  return { state, battle };
}

/** Play the autopilot the way the run scene does, one action at a time. */
function runAutopilot(battle, maxSteps = 900) {
  let steps = 0;
  let looted = 0;
  let endedTurns = 0;
  let lastSignature = null;
  let stalls = 0;
  while (steps++ < maxSteps) {
    if (haltReason(battle)) return { steps, looted, endedTurns, halted: true };
    if (completionReason(battle) === HALT.ARRIVED) return { steps, looted, endedTurns, done: true };

    const action = nextAutoAction(battle);
    if (!action) return { steps, looted, endedTurns, stuck: true };

    if (action.type === 'endTurn') {
      endedTurns += 1;
      const sig = progressSignature(battle);
      if (sig === lastSignature) stalls += 1;
      else stalls = 0;
      lastSignature = sig;
      if (stalls >= 2) return { steps, looted, endedTurns, stuck: true };
      beginRound(battle);
      continue;
    }
    if (action.type === 'reload') {
      action.unit.ap = Math.max(0, action.unit.ap - 2);
      continue;
    }
    for (const [nx, ny] of action.path) {
      if (unitAt(battle, nx, ny)) break;
      assert(isWalkable(battle.map, nx, ny), `autopilot walked into geometry at ${nx},${ny}`);
      action.unit.x = nx;
      action.unit.y = ny;
      action.unit.ap -= 1;
      const c = battle.map.containers.find((k) => k.x === nx && k.y === ny && !k.opened);
      if (c) {
        openContainer(battle, action.unit, c);
        looted += 1;
      }
    }
    refreshVision(battle);
  }
  return { steps, looted, endedTurns, timeout: true };
}

describe('autopilot', () => {
  test('it clears a quiet map and parks on the extraction pad', () => {
    let arrived = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { battle } = freshBattle(seed * 31, 2);
      const total = battle.map.containers.length;
      const r = runAutopilot(battle);
      assert(!r.timeout, `seed ${seed}: autopilot never finished`);
      if (r.done) arrived += 1;
      const opened = battle.map.containers.filter((c) => c.opened).length;
      assert(opened >= total * 0.6,
        `seed ${seed}: only looted ${opened} of ${total} containers before giving up`);
    }
    assert(arrived >= 8, `only ${arrived}/10 runs reached the pad on their own`);
  });

  test('assignments are stable, so the squad does not pace on the spot', () => {
    const { battle } = freshBattle(4242, 3);
    // Same board, repeated decisions -- the same survivor must be told to do
    // the same thing every time, or movement oscillates between frames.
    const first = nextAutoAction(battle);
    for (let i = 0; i < 8; i++) {
      const again = nextAutoAction(battle);
      equal(again.type, first.type);
      if (first.type === 'move') {
        equal(again.unit.id, first.unit.id, 'a different survivor was chosen for the same board');
        equal(JSON.stringify(again.path), JSON.stringify(first.path), 'the route changed without the board changing');
      }
    }
  });

  test('it refuses to start when a zombie is in view', () => {
    const { battle } = freshBattle(99, 2);
    const p = livingPlayers(battle)[0];
    const z = makeZombie('shambler', p.x + 2, p.y, 2);
    battle.units.push(z);
    refreshVision(battle);
    equal(haltReason(battle), HALT.CONTACT);
  });

  test('it refuses to run while someone is hurt or down', () => {
    const { battle } = freshBattle(100, 2);
    const p = livingPlayers(battle)[0];
    p.hp = Math.floor(p.hpMax * 0.3);
    equal(haltReason(battle), HALT.HURT);

    p.hp = p.hpMax;
    applyDamage(battle, livingPlayers(battle)[1], 9999);
    equal(haltReason(battle), HALT.DOWNED);
  });

  test('it hands back control the moment anyone takes a hit', () => {
    const { battle } = freshBattle(101, 2);
    const snapshot = snapshotHp(battle);
    equal(haltReason(battle, { hpSnapshot: snapshot }), null);
    livingPlayers(battle)[0].hp -= 1;
    equal(haltReason(battle, { hpSnapshot: snapshot }), HALT.HURT);
  });

  test('it stands down when the horde meter is nearly full', () => {
    const { battle } = freshBattle(102, 2);
    battle.heat = battle.heatMax * 0.95;
    equal(haltReason(battle), HALT.WAVE);
  });

  test('it never spends action points it does not have', () => {
    const { battle } = freshBattle(103, 4);
    for (let i = 0; i < 200; i++) {
      if (haltReason(battle)) break;
      const action = nextAutoAction(battle);
      if (!action) break;
      if (action.type === 'endTurn') {
        beginRound(battle);
        continue;
      }
      if (action.type === 'reload') {
        action.unit.ap = Math.max(0, action.unit.ap - 2);
        continue;
      }
      assert(action.path.length <= action.unit.ap,
        `ordered a ${action.path.length}-tile walk with ${action.unit.ap} AP`);
      for (const [nx, ny] of action.path) {
        action.unit.x = nx;
        action.unit.y = ny;
        action.unit.ap -= 1;
      }
      assert(action.unit.ap >= 0, 'autopilot drove action points negative');
      refreshVision(battle);
    }
  });

  test('two survivors are never sent to the same container', () => {
    const { battle } = freshBattle(104, 5);
    const seen = new Map();
    for (let i = 0; i < 40; i++) {
      if (haltReason(battle)) break;
      const action = nextAutoAction(battle);
      if (!action || action.type !== 'move') break;
      const dest = action.path[action.path.length - 1];
      const key = `${dest[0]},${dest[1]}`;
      const owner = seen.get(key);
      assert(owner === undefined || owner === action.unit.id,
        `${key} was assigned to two different survivors`);
      seen.set(key, action.unit.id);
      for (const [nx, ny] of action.path) {
        action.unit.x = nx;
        action.unit.y = ny;
        action.unit.ap -= 1;
        const c = battle.map.containers.find((k) => k.x === nx && k.y === ny && !k.opened);
        if (c) openContainer(battle, action.unit, c);
      }
      if (livingPlayers(battle).every((u) => u.ap <= 0)) beginRound(battle);
      refreshVision(battle);
    }
  });

  test('with nothing left to loot it reports arriving, not being stuck', () => {
    const { battle } = freshBattle(105, 2);
    for (const c of battle.map.containers) c.opened = true;
    equal(completionReason(battle), HALT.SWEPT);
    for (const u of livingPlayers(battle)) {
      u.x = battle.map.exit.x;
      u.y = battle.map.exit.y;
    }
    equal(completionReason(battle), HALT.ARRIVED);
  });
});

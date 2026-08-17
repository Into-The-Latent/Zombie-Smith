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
  assignContainers, normalizeTactics, TACTICS, DEFAULT_TACTICS,
} from '../src/run/autopilot.js';
import { isWalkable } from '../src/run/map.js';
import { weaponStats } from '../src/game/craft.js';

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
function runAutopilot(battle, { tactics = DEFAULT_TACTICS, maxSteps = 900 } = {}) {
  let steps = 0;
  let looted = 0;
  let endedTurns = 0;
  let lastSignature = null;
  let stalls = 0;
  const spreads = [];
  /** Widest gap between any two survivors: how strung out the squad is. */
  const spread = () => {
    const alive = livingPlayers(battle);
    let worst = 0;
    for (const a of alive) {
      for (const b of alive) {
        worst = Math.max(worst, Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
      }
    }
    return worst;
  };
  const result = (extra) => ({
    steps, looted, endedTurns, ...extra,
    meanSpread: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0,
    maxSpread: spreads.length ? Math.max(...spreads) : 0,
  });
  while (steps++ < maxSteps) {
    spreads.push(spread());
    if (haltReason(battle)) return result({ halted: true });
    if (completionReason(battle) === HALT.ARRIVED) return result({ done: true });

    const action = nextAutoAction(battle, tactics);
    if (!action) return result({ stuck: true });

    if (action.type === 'endTurn') {
      endedTurns += 1;
      const sig = progressSignature(battle);
      if (sig === lastSignature) stalls += 1;
      else stalls = 0;
      lastSignature = sig;
      if (stalls >= 2) return result({ stuck: true });
      beginRound(battle);
      continue;
    }
    if (action.type === 'reload') {
      const w = action.weapon || action.unit.primary;
      if (w) w.loaded = weaponStats(w).mag;
      action.unit.ap = Math.max(0, action.unit.ap - 2);
      continue;
    }
    if (action.type === 'swap') {
      action.unit.active = action.unit.active === 'melee' ? 'primary' : 'melee';
      action.unit.ap -= 1;
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
  return result({ timeout: true });
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

describe('autopilot tactics', () => {
  test('unknown or missing orders fall back to the defaults', () => {
    equal(normalizeTactics(undefined).formation, DEFAULT_TACTICS.formation);
    equal(normalizeTactics({}).engage, DEFAULT_TACTICS.engage);
    equal(normalizeTactics({ formation: 'sideways', engage: 'harsh words' }).formation,
      DEFAULT_TACTICS.formation, 'junk from a hand-edited save must not wedge the squad');
    equal(normalizeTactics({ formation: 'together', engage: 'melee' }).formation, 'together');
    // Every option the UI can offer has to have copy for it.
    for (const field of Object.keys(TACTICS)) {
      for (const key of Object.keys(TACTICS[field])) {
        assert(TACTICS[field][key].label && TACTICS[field][key].blurb,
          `${field}.${key} needs a label and a blurb`);
      }
    }
  });

  test('spread out gives everyone their own container', () => {
    const { battle } = freshBattle(880, 3);
    const squad = livingPlayers(battle);
    const spread = assignContainers(battle, squad, 'spread');
    const targets = new Set([...spread.values()].map((c) => `${c.x},${c.y}`));
    equal(targets.size, spread.size, 'no two survivors may be sent to the same crate');
    assert(spread.size > 1, 'and more than one of them should have somewhere to go');
  });

  test('stay together sends the whole squad to one container', () => {
    const { battle } = freshBattle(880, 3);
    const squad = livingPlayers(battle);
    const together = assignContainers(battle, squad, 'together');
    equal(together.size, squad.length, 'everybody gets an assignment');
    const targets = new Set([...together.values()].map((c) => `${c.x},${c.y}`));
    equal(targets.size, 1, 'and it is the same one');
  });

  test('the shared objective is the one nearest the squad as a body', () => {
    // Not nearest to whoever happens to be closest, or the group gets dragged
    // apart by one outlier.
    const { battle } = freshBattle(881, 3);
    const squad = livingPlayers(battle);
    const chosen = [...assignContainers(battle, squad, 'together').values()][0];
    const cost = (c) => squad.reduce(
      (a, u) => a + Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y)), 0,
    );
    for (const c of battle.map.containers.filter((k) => !k.opened)) {
      assert(cost(chosen) <= cost(c) + 1e-9,
        `a closer shared objective existed at ${c.x},${c.y}`);
    }
  });

  test('the two formations really do trade ground for cohesion', () => {
    // The whole reason to offer a choice. Measured over several maps, because a
    // single layout can favour either by accident.
    let tighter = 0;
    let broader = 0;
    for (let i = 0; i < 8; i++) {
      const a = runAutopilot(freshBattle(900 + i, 3).battle,
        { tactics: { formation: 'spread', engage: 'guns' } });
      const b = runAutopilot(freshBattle(900 + i, 3).battle,
        { tactics: { formation: 'together', engage: 'guns' } });
      if (b.meanSpread < a.meanSpread) tighter += 1;
      if (a.looted >= b.looted) broader += 1;
    }
    assert(tighter >= 6, `staying together was tighter on only ${tighter}/8 maps`);
    assert(broader >= 6, `spreading out looted at least as much on only ${broader}/8 maps`);
  });

  test('both formations still get the map cleared', () => {
    // A tactic that cannot make progress is not a tactic, it is a bug. Handing
    // control back once there is nothing left to reach is a legitimate ending,
    // so what matters is that both loot the place and neither runs away with
    // itself for hundreds of steps.
    for (const formation of ['spread', 'together']) {
      for (let i = 0; i < 6; i++) {
        const { battle } = freshBattle(920 + i, 2);
        const total = battle.map.containers.length;
        const r = runAutopilot(battle, { tactics: { formation, engage: 'guns' } });
        assert(!r.timeout, `${formation} never resolved on seed ${920 + i}`);
        assert(r.looted >= total * 0.5,
          `${formation} on seed ${920 + i} only opened ${r.looted} of ${total} containers`);
      }
    }
  });

  test('guns up and blades up each ready the weapon they name', () => {
    const { battle } = freshBattle(940, 2);
    // Only a survivor carrying both has a choice to make.
    const u = livingPlayers(battle).find((p) => p.primary && p.melee);
    assert(u, 'the starting squad should include somebody with a gun and a club');

    for (const [engage, want] of [['melee', 'melee'], ['guns', 'primary']]) {
      u.active = want === 'melee' ? 'primary' : 'melee';
      u.primary.loaded = weaponStats(u.primary).mag; // nothing to reload first
      u.ap = u.apMax;
      const action = nextAutoAction(battle, { formation: 'spread', engage });
      equal(action.type, 'swap', `${engage} should draw the other weapon`);
      equal(action.unit.id, u.id);
    }
  });

  test('nobody swaps when they are already holding the right thing', () => {
    const { battle } = freshBattle(940, 2);
    for (const u of livingPlayers(battle)) {
      u.active = 'melee';
      if (u.primary) u.primary.loaded = weaponStats(u.primary).mag;
    }
    const action = nextAutoAction(battle, { formation: 'spread', engage: 'melee' });
    assert(action.type !== 'swap', 'a settled squad must not fidget with its weapons');
  });

  test('a holstered firearm still gets topped up with blades drawn', () => {
    // Judging the reload on whatever is in hand meant a blades-up squad reached
    // contact with an empty gun.
    const { battle } = freshBattle(941, 2);
    const u = livingPlayers(battle).find((p) => p.primary && p.primary.kind === 'gun');
    assert(u, 'somebody has to be carrying a gun');
    u.active = 'melee';
    u.primary.loaded = 0;
    battle.ammoReserve[u.primary.ammo] = 12;
    u.ap = u.apMax;

    const action = nextAutoAction(battle, { formation: 'spread', engage: 'melee' });
    equal(action.type, 'reload');
    equal(action.unit.id, u.id);
    equal(action.weapon.id, u.primary.id, 'and it is the holstered gun being filled');
  });
});

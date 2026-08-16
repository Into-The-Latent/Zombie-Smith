// Zombie behaviour.
//
// The AI hands back one atomic action at a time so the run scene can animate
// each step and interleave overwatch reactions, rather than teleporting a
// whole turn's worth of movement.

import { ENEMIES } from '../data/enemies.js';
import { hasLineOfSight } from './fov.js';
import { findPath } from './pathfind.js';
import { canAttack } from './combat.js';
import { findFreeTile, isWalkable } from './map.js';

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function livingPlayers(battle) {
  return battle.units.filter((u) => u.side === 'player' && u.state !== 'dead');
}

export function livingZombies(battle) {
  return battle.units.filter((u) => u.side === 'zombie' && u.state !== 'dead');
}

export function unitAt(battle, x, y) {
  return battle.units.find((u) => u.state !== 'dead' && u.x === x && u.y === y) || null;
}

export function isBlockedFor(battle, unit) {
  return (x, y) => {
    const other = unitAt(battle, x, y);
    return !!other && other !== unit;
  };
}

/** Nearest player this zombie can actually see right now. */
function spotTarget(battle, z) {
  const def = ENEMIES[z.key];
  let best = null;
  let bestD = Infinity;
  for (const p of livingPlayers(battle)) {
    const d = chebyshev(z, p);
    if (d > def.sight) continue;
    if (!hasLineOfSight(battle.map, z.x, z.y, p.x, p.y)) continue;
    // A downed survivor is quiet and low; harder to notice at distance.
    if (p.state === 'down' && d > 3) continue;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * Produce the next action for `z`, or null when its turn is over.
 * @returns {null | {type:'attack'|'move'|'scream'|'wait', ...}}
 */
export function nextEnemyAction(battle, z, rand) {
  if (z.state === 'dead' || z.ap <= 0) return null;
  const def = ENEMIES[z.key];
  const seen = spotTarget(battle, z);

  if (seen) {
    if (!z.alerted) {
      z.alerted = true;
      if (def.screams && !z.hasScreamed) {
        z.hasScreamed = true;
        return { type: 'scream', target: seen };
      }
    }
    z.memory = { x: seen.x, y: seen.y };
    z.patience = 4;

    if (z.ap >= def.atkAp && canAttack(battle, z, seen).ok) {
      return { type: 'attack', target: seen };
    }
    const step = stepToward(battle, z, seen.x, seen.y, def.range > 1);
    if (step) return { type: 'move', to: step };
    return null;
  }

  // Nothing in sight: head for the last thing it heard.
  if (z.alerted && z.memory) {
    if (z.x === z.memory.x && z.y === z.memory.y) {
      z.patience = (z.patience ?? 3) - 1;
      if (z.patience <= 0) {
        z.alerted = false;
        z.memory = null;
      }
      return { type: 'wait' };
    }
    const step = stepToward(battle, z, z.memory.x, z.memory.y, false);
    if (step) return { type: 'move', to: step };
    z.memory = null;
    z.alerted = false;
    return { type: 'wait' };
  }

  // Dormant: mostly stand still, occasionally shuffle a tile.
  if (rand.chance(0.18)) {
    const dirs = rand.shuffle([
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
    ]);
    for (const [dx, dy] of dirs) {
      const nx = z.x + dx;
      const ny = z.y + dy;
      if (isWalkable(battle.map, nx, ny) && !unitAt(battle, nx, ny)) {
        return { type: 'move', to: [nx, ny], idle: true };
      }
    }
  }
  return { type: 'wait' };
}

function stepToward(battle, z, tx, ty, keepDistance) {
  const blocked = isBlockedFor(battle, z);
  const path = findPath(battle.map, z.x, z.y, tx, ty, blocked, {
    adjacent: !keepDistance,
    maxCost: 60,
  });
  if (!path || !path.length) return null;
  return path[0];
}

/**
 * Overwatching survivors fire on a zombie that just moved into their view.
 * @returns {Array<{shooter:object, target:object}>}
 */
export function overwatchTriggers(battle, mover) {
  const out = [];
  if (mover.side !== 'zombie' || mover.state === 'dead') return out;
  for (const p of battle.units) {
    if (p.side !== 'player' || !p.overwatch || p.state !== 'idle') continue;
    // A reaction shot is free -- the AP was paid when overwatch was set.
    const chk = canAttack(battle, p, mover, { ignoreAp: true });
    if (chk.ok) out.push({ shooter: p, target: mover });
  }
  return out;
}

/** A fresh pack shoved in at the edge of the map when the heat maxes out. */
export function spawnWave(battle, rand, count) {
  const players = livingPlayers(battle);
  if (!players.length) return [];
  const anchor = rand.pick(players);
  const spawned = [];
  const table = battle.spawnTable;

  for (let i = 0; i < count; i++) {
    // Come from off in some direction, at the edge of hearing, then close in.
    const angle = rand.range(0, Math.PI * 2);
    const dist = rand.range(11, 16);
    const tx = Math.round(anchor.x + Math.cos(angle) * dist);
    const ty = Math.round(anchor.y + Math.sin(angle) * dist);
    const spot = findFreeTile(
      battle.map,
      Math.max(1, Math.min(battle.map.w - 2, tx)),
      Math.max(1, Math.min(battle.map.h - 2, ty)),
      (x, y) => !!unitAt(battle, x, y),
      9,
    );
    if (!spot) continue;
    const key = rand.weighted(table).key;
    const z = makeZombie(key, spot.x, spot.y, battle.day);
    z.alerted = true;
    z.memory = { x: anchor.x, y: anchor.y };
    battle.units.push(z);
    spawned.push(z);
  }
  return spawned;
}

let zid = 0;
export function makeZombie(key, x, y, day = 1) {
  const def = ENEMIES[key];
  // Zombies toughen slowly across the campaign so day 20 still bites.
  const hpScale = 1 + Math.max(0, day - 1) * 0.03;
  const hpMax = Math.round(def.hp * hpScale);
  return {
    id: `z${zid++}`,
    side: 'zombie',
    key,
    name: def.name,
    x,
    y,
    hp: hpMax,
    hpMax,
    ap: def.ap,
    apMax: def.ap,
    armor: def.armor,
    sight: def.sight,
    state: 'idle',
    alerted: false,
    memory: null,
    patience: 3,
    flash: 0,
    anim: null,
    bob: Math.random() * Math.PI * 2,
  };
}

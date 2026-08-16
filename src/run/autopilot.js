// Semi-automatic scavenging.
//
// While nothing is in sight the squad handles itself: it walks, opens what it
// finds, and heads for the extraction pad. The moment anything happens that a
// player would want a say in, it stops dead and hands control back.
//
// This module only *decides*; the run scene animates the result, so autopilot
// movement looks exactly like movement the player ordered.

import { findPath } from './pathfind.js';
import { unitAt, livingPlayers } from './ai.js';
import { isVisible } from './fov.js';
import { activeWeapon } from './combat.js';
import { weaponStats } from '../game/craft.js';

/** Why the autopilot gave control back. Shown to the player verbatim. */
export const HALT = {
  CONTACT: 'Contact -- taking over.',
  HURT: 'Someone is hurt -- taking over.',
  DOWNED: 'A survivor is down.',
  WAVE: 'A wave is coming in.',
  ARRIVED: 'Standing on the extraction pad.',
  SWEPT: 'Nothing left to loot here.',
  STUCK: 'No route to anything useful.',
  MANUAL: 'Stopped.',
};

/** Any zombie the squad can currently see. */
export function anyVisibleZombie(battle) {
  return battle.units.some(
    (u) => u.side === 'zombie' && u.state !== 'dead' && isVisible(battle, u.x, u.y),
  );
}

/**
 * Reasons the autopilot must not start or continue. Checked before every
 * decision, so a single call is enough to know whether it is safe to run.
 * @returns {string|null} a HALT reason, or null when it is safe to continue
 */
export function haltReason(battle, opts = {}) {
  if (anyVisibleZombie(battle)) return HALT.CONTACT;
  const alive = livingPlayers(battle);
  if (alive.some((u) => u.state === 'down')) return HALT.DOWNED;
  if (alive.some((u) => u.hp < u.hpMax * 0.5)) return HALT.HURT;
  if (battle.heat >= battle.heatMax * 0.9) return HALT.WAVE;
  if (opts.hpSnapshot) {
    for (const u of alive) {
      if ((opts.hpSnapshot.get(u.id) ?? u.hp) > u.hp) return HALT.HURT;
    }
  }
  return null;
}

export function snapshotHp(battle) {
  const m = new Map();
  for (const u of livingPlayers(battle)) m.set(u.id, u.hp);
  return m;
}

/** Containers nobody has opened yet, nearest first. */
function openContainers(battle) {
  return battle.map.containers.filter((c) => !c.opened);
}

const chebyshev = (a, bx, by) => Math.max(Math.abs(a.x - bx), Math.abs(a.y - by));

/**
 * Assign each survivor a container, deterministically.
 *
 * Determinism matters more than optimality here: the autopilot re-decides
 * every step, so an assignment that flickers between frames would make the
 * squad pace on the spot instead of walking anywhere. A survivor keeps a
 * container unless another survivor is strictly closer to it.
 *
 * @returns {Map<string, {x:number,y:number}>} unit id -> container
 */
function assignContainers(battle, squad) {
  const open = openContainers(battle).filter((c) => !unitAt(battle, c.x, c.y));
  const out = new Map();
  const taken = new Set();

  // Stable order so ties always break the same way.
  const ordered = [...squad].sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const u of ordered) {
    let best = null;
    for (const c of open) {
      const key = `${c.x},${c.y}`;
      if (taken.has(key)) continue;
      const d = chebyshev(u, c.x, c.y);
      // Someone else unassigned is closer -- leave it for them.
      const contested = ordered.some(
        (o) => o !== u && !out.has(o.id) && chebyshev(o, c.x, c.y) < d,
      );
      if (contested) continue;
      if (!best || d < best.d) best = { c, d, key };
    }
    if (best) {
      out.set(u.id, best.c);
      taken.add(best.key);
    }
  }
  return out;
}

/**
 * Where a given survivor should head next: its container, else extraction.
 *
 * Routes are planned as though squadmates are not there. In a corridor one
 * tile wide, treating a friend as a wall means the squad deadlocks the moment
 * anyone stops in a doorway -- and with the denser cover, corridors are most
 * of the map. The caller truncates the walk at whoever is actually in the way,
 * so the front of the line moves first and the rest follow next action.
 */
function goalFor(battle, unit, assignment) {
  const target = assignment.get(unit.id);
  if (target) {
    const path = findPath(battle.map, unit.x, unit.y, target.x, target.y, null, { maxCost: 200 });
    if (path && path.length) return { path, kind: 'loot' };
  }

  // The pad is 2x2; take whichever corner is free.
  const exit = battle.map.exit;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const tx = exit.x + dx;
      const ty = exit.y + dy;
      if (unit.x === tx && unit.y === ty) return null; // already parked
      if (unitAt(battle, tx, ty)) continue;
      const path = findPath(battle.map, unit.x, unit.y, tx, ty, null, { maxCost: 300 });
      if (path && path.length) return { path, kind: 'exit' };
    }
  }
  return null;
}

/** Cut a planned route short at the first tile somebody is standing on. */
export function walkableSlice(battle, unit, path, ap) {
  const out = [];
  for (const [x, y] of path.slice(0, ap)) {
    if (unitAt(battle, x, y)) break;
    out.push([x, y]);
  }
  return out;
}

/**
 * The next thing the autopilot wants to do, or null when the turn is spent.
 *
 * Returns one action at a time so the scene can animate it and re-check for
 * contact between every single step.
 *
 * @returns {null | {type:'move', unit, path} | {type:'reload', unit} | {type:'endTurn'}}
 */
export function nextAutoAction(battle) {
  const squad = livingPlayers(battle).filter((u) => u.state === 'idle');

  // Topping up magazines is free value while nothing is watching.
  for (const u of squad) {
    const w = activeWeapon(u);
    if (!w || w.kind !== 'gun') continue;
    const st = weaponStats(w);
    const cost = u.fastReload ? 1 : 2;
    const have = battle.ammoReserve[w.ammo] || 0;
    if (w.loaded < st.mag && have > 0 && u.ap >= cost) {
      return { type: 'reload', unit: u };
    }
  }

  // Only survivors who can still act compete for targets, or someone who has
  // already spent their turn would reserve a container nobody can reach.
  const movers = squad.filter((u) => u.ap > 0);
  const assignment = assignContainers(battle, movers);

  for (const u of movers) {
    const goal = goalFor(battle, u, assignment);
    if (!goal) continue;
    const path = walkableSlice(battle, u, goal.path, u.ap);
    if (!path.length) continue; // blocked by a squadmate; let them go first
    return { type: 'move', unit: u, path, goal: goal.kind };
  }

  // Nobody can make progress this turn. Ending it resets action points and
  // gives whoever was in the way a chance to shift.
  return { type: 'endTurn' };
}

/**
 * A cheap fingerprint of "has anything changed". The scene compares this
 * across turns so a squad wedged in a doorway stops instead of ending turns
 * forever.
 */
export function progressSignature(battle) {
  const pos = livingPlayers(battle)
    .map((u) => `${u.id}:${u.x},${u.y}`)
    .sort()
    .join('|');
  const opened = battle.map.containers.filter((c) => c.opened).length;
  return `${pos}#${opened}`;
}

/**
 * True when the squad has done everything the autopilot knows how to do.
 * @returns {string|null} a HALT reason when finished
 */
export function completionReason(battle) {
  if (openContainers(battle).length > 0) return null;
  const exit = battle.map.exit;
  const parked = livingPlayers(battle).every(
    (u) => Math.abs(u.x - exit.x) <= 1 && Math.abs(u.y - exit.y) <= 1,
  );
  return parked ? HALT.ARRIVED : HALT.SWEPT;
}

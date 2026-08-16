// Attack resolution. Kept free of rendering so it can be unit tested.
//
// Every modifier that goes into a hit chance is returned as a labelled
// breakdown, because a turn-based game that hides its maths is just a slot
// machine.

import { clamp } from '../core/util.js';
import { coverAt } from './map.js';
import { hasLineOfSight } from './fov.js';
import { weaponStats } from '../game/craft.js';
import { ENEMIES } from '../data/enemies.js';

export const COVER_NONE = 0;
export const COVER_HALF = 1;
export const COVER_FULL = 2;

const COVER_PENALTY = [0, 20, 40];
export const COVER_LABEL = ['Exposed', 'Half cover', 'Full cover'];

/** Faster things are harder to hit; derived so it never needs its own table. */
export function evasionOf(unit) {
  if (unit.side !== 'zombie') return 0;
  const def = ENEMIES[unit.key];
  return Math.max(0, (def.ap - 3) * 3);
}

/**
 * Chance for `attacker` to hit `target` with the currently active weapon.
 * @returns {{chance:number, breakdown:Array<{label:string,value:number}>, cover:number, dist:number, los:boolean, inRange:boolean}}
 */
export function hitChance(battle, attacker, target) {
  const map = battle.map;
  const dist = Math.max(Math.abs(attacker.x - target.x), Math.abs(attacker.y - target.y));
  const los = hasLineOfSight(map, attacker.x, attacker.y, target.x, target.y);
  const breakdown = [];

  let base;
  let range;
  let isMelee;
  if (attacker.side === 'player') {
    const w = activeWeapon(attacker);
    if (!w) {
      return { chance: 0, breakdown: [{ label: 'No weapon', value: 0 }], cover: 0, dist, los, inRange: false };
    }
    const st = weaponStats(w);
    base = st.acc;
    range = st.range;
    isMelee = w.kind === 'melee';
    breakdown.push({ label: 'Weapon', value: st.acc });
    if (attacker.aim) breakdown.push({ label: 'Aim', value: attacker.aim });
    base += attacker.aim;
  } else {
    const def = ENEMIES[attacker.key];
    base = def.acc;
    range = def.range;
    isMelee = def.range <= 1;
    breakdown.push({ label: 'Instinct', value: def.acc });
  }

  const inRange = dist <= range || (isMelee && dist <= 1);

  // Distance falloff past the weapon's comfortable range.
  if (!isMelee && dist > range) {
    const pen = (dist - range) * 7;
    base -= pen;
    breakdown.push({ label: `Over range (${dist - range})`, value: -pen });
  }
  // Long guns are clumsy with something in your face.
  if (!isMelee && range >= 8 && dist <= 2) {
    base -= 12;
    breakdown.push({ label: 'Too close', value: -12 });
  }

  // Cover only matters for shots that travel.
  let cover = 0;
  if (!isMelee) {
    cover = coverAt(map, target.x, target.y, attacker.x, attacker.y);
    let pen = COVER_PENALTY[cover];
    const ignore = attacker.side === 'zombie' ? ENEMIES[attacker.key].ignoresCoverPct || 0 : 0;
    pen = Math.round(pen * (1 - ignore));
    if (pen) {
      base -= pen;
      breakdown.push({ label: COVER_LABEL[cover], value: -pen });
    }
  }

  const evade = evasionOf(target);
  if (evade) {
    base -= evade;
    breakdown.push({ label: 'Target speed', value: -evade });
  }

  // A survivor who braced this turn shoots straighter.
  if (attacker.braced) {
    base += 15;
    breakdown.push({ label: 'Braced', value: 15 });
  }

  const chance = clamp(Math.round(base), 5, 95);
  return { chance, breakdown, cover, dist, los, inRange };
}

export function activeWeapon(unit) {
  if (unit.side !== 'player') return null;
  return unit.active === 'melee' ? unit.melee : unit.primary || unit.melee;
}

/**
 * @param {object} [opts] `ignoreAp` skips the action-point check, which is
 *        what a free reaction shot (overwatch) needs.
 */
export function canAttack(battle, attacker, target, opts = {}) {
  if (!target || target.state === 'dead') return { ok: false, why: 'No target' };
  const w = attacker.side === 'player' ? activeWeapon(attacker) : null;
  if (attacker.side === 'player') {
    if (!w) return { ok: false, why: 'No weapon equipped' };
    if (w.dur <= 0) return { ok: false, why: 'Weapon is broken' };
    const st = weaponStats(w);
    if (!opts.ignoreAp && attacker.ap < st.ap) return { ok: false, why: `Needs ${st.ap} AP` };
    if (w.kind === 'gun' && w.loaded <= 0) return { ok: false, why: 'Empty magazine' };
  } else if (!opts.ignoreAp && attacker.ap < ENEMIES[attacker.key].atkAp) {
    return { ok: false, why: 'No action points' };
  }
  const info = hitChance(battle, attacker, target);
  if (!info.los) return { ok: false, why: 'No line of sight' };
  if (!info.inRange) {
    const isMelee = attacker.side === 'player' ? activeWeapon(attacker).kind === 'melee' : ENEMIES[attacker.key].range <= 1;
    if (isMelee) return { ok: false, why: 'Out of reach' };
  }
  return { ok: true, info };
}

/** Damage a unit; handles going down, dying and returns what happened. */
export function applyDamage(battle, unit, amount, source = null) {
  const before = unit.hp;
  unit.hp = Math.max(0, unit.hp - amount);
  unit.flash = 0.35;
  const out = { dealt: before - unit.hp, killed: false, downed: false };

  if (unit.hp > 0) return out;

  if (unit.side === 'player' && unit.state !== 'down') {
    // Survivors go down bleeding rather than dying outright -- the squad gets
    // a chance to save them, which is where most of the drama lives.
    unit.state = 'down';
    unit.bleed = 3;
    unit.ap = 0;
    out.downed = true;
    battle.log.unshift({ text: `${unit.name} is down! ${unit.bleed} turns to stabilise.`, tone: 'bad' });
  } else {
    unit.state = 'dead';
    out.killed = true;
    if (unit.side === 'zombie') {
      battle.kills += 1;
      if (source && source.side === 'player') {
        source.xpEarned = (source.xpEarned || 0) + ENEMIES[unit.key].xp;
        const w = activeWeapon(source);
        if (w) w.kills += 1;
      }
    } else {
      battle.log.unshift({ text: `${unit.name} has died.`, tone: 'bad' });
    }
  }
  return out;
}

/**
 * Full attack, including bursts. Mutates battle state.
 * @returns {{shots:Array, totalDamage:number, killed:boolean, noise:number}}
 */
export function resolveAttack(battle, attacker, target, rand, opts = {}) {
  const shots = [];
  let totalDamage = 0;
  let noise = 0;
  const free = !!opts.free;

  if (attacker.side === 'player') {
    const w = activeWeapon(attacker);
    const st = weaponStats(w);
    const bursts = w.kind === 'gun' ? Math.min(w.burst || 1, w.loaded) : 1;

    if (!free) attacker.ap = Math.max(0, attacker.ap - st.ap);
    if (w.kind === 'gun') w.loaded -= bursts;
    w.dur = Math.max(0, w.dur - 1);

    for (let i = 0; i < bursts; i++) {
      if (target.state === 'dead') break;
      const info = hitChance(battle, attacker, target);
      const roll = rand.range(0, 100);
      const hit = roll < info.chance;
      if (!hit) {
        shots.push({ hit: false, chance: info.chance });
        continue;
      }
      const crit = rand.chance(st.crit + (attacker.critBonus || 0));
      let dmg = st.dmg * rand.range(0.85, 1.15);
      if (w.kind === 'melee') dmg += attacker.meleeBonus || 0;
      if (crit) dmg *= 2;
      const armor = Math.max(0, (ENEMIES[target.key]?.armor || 0) - st.pen);
      dmg = Math.max(1, Math.round(dmg - armor));
      const res = applyDamage(battle, target, dmg, attacker);
      totalDamage += res.dealt;
      shots.push({ hit: true, crit, damage: res.dealt, killed: res.killed, chance: info.chance });
    }

    noise = Math.round((w.kind === 'gun' ? st.noise : 3) * (attacker.noiseMult || 1));
  } else {
    const def = ENEMIES[attacker.key];
    if (!free) attacker.ap = Math.max(0, attacker.ap - def.atkAp);
    const info = hitChance(battle, attacker, target);
    const hit = rand.range(0, 100) < info.chance;
    if (hit) {
      let dmg = def.dmg * rand.range(0.85, 1.15);
      dmg = Math.max(1, Math.round(dmg - (target.armor || 0)));
      const res = applyDamage(battle, target, dmg, attacker);
      totalDamage += res.dealt;
      shots.push({ hit: true, crit: false, damage: res.dealt, killed: res.killed, downed: res.downed, chance: info.chance });
    } else {
      shots.push({ hit: false, chance: info.chance });
    }
    noise = def.range > 1 ? 5 : 3;
  }

  return { shots, totalDamage, killed: target.state === 'dead', noise };
}

/**
 * Broadcast a noise event: wakes nearby sleepers and heats up the map.
 * @returns {number} how many zombies were woken
 */
export function makeNoise(battle, x, y, radius) {
  let woke = 0;
  for (const u of battle.units) {
    if (u.side !== 'zombie' || u.state === 'dead') continue;
    const d = Math.hypot(u.x - x, u.y - y);
    const hearing = Math.min(radius, ENEMIES[u.key].hearing);
    if (d <= hearing) {
      if (!u.alerted) woke += 1;
      u.alerted = true;
      u.memory = { x, y };
    }
  }
  battle.heat = Math.min(battle.heatMax, battle.heat + radius * 0.8);
  battle.noisePings.push({ x, y, r: radius, t: 0 });
  return woke;
}

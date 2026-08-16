// Container loot tables. Containers deeper into a map roll richer, which is
// what makes "one more room" a real decision.

import { foundWeapon } from './craft.js';
import { RESEARCH_ORDER, RESEARCH } from '../data/progression.js';

export const CONTAINERS = {
  crate: {
    key: 'crate', name: 'Supply Crate', color: '#8a6a42', w: 100,
    res: { scrap: [2, 5], wood: [1, 4], cloth: [0, 3] },
  },
  toolbox: {
    key: 'toolbox', name: 'Toolbox', color: '#c9762f', w: 60,
    res: { scrap: [1, 4], parts: [1, 3] },
  },
  locker: {
    key: 'locker', name: 'Locker', color: '#5f7387', w: 55,
    res: { cloth: [1, 4], scrap: [0, 3], food: [0, 2] }, weaponChance: 0.22,
  },
  medcab: {
    key: 'medcab', name: 'Medicine Cabinet', color: '#4fb477', w: 45,
    res: { chem: [1, 4], cloth: [0, 2] }, medChance: 0.45,
  },
  ammobox: {
    key: 'ammobox', name: 'Ammo Box', color: '#d8b45a', w: 40,
    res: { powder: [1, 4] }, ammo: true,
  },
  cartrunk: {
    key: 'cartrunk', name: 'Car Trunk', color: '#7a8899', w: 40,
    res: { fuel: [1, 3], parts: [0, 2], scrap: [1, 3] },
  },
  safe: {
    key: 'safe', name: 'Wall Safe', color: '#d0973c', w: 12,
    res: { parts: [2, 5], chem: [1, 3], food: [1, 3] },
    weaponChance: 0.35, blueprintChance: 0.5,
  },
};

const CONTAINER_KEYS = Object.keys(CONTAINERS);

export function pickContainerKind(rand) {
  return rand.weighted(CONTAINER_KEYS.map((k) => ({ key: k, w: CONTAINERS[k].w }))).key;
}

const FOUNDABLE = ['pipe_club', 'machete', 'makeshift_pistol', 'fire_axe', 'pipe_shotgun'];

/**
 * @param {string} kind      container key
 * @param {object} rand      seeded rng
 * @param {number} day       campaign day (scales quantity)
 * @param {number} depth     0..1, how far into the map the container sits
 * @param {number} lootBonus multiplier from perks, e.g. 0.35 for +35%
 * @param {string[]} unlocks already-owned research, so blueprints aren't dupes
 */
export function rollLoot(kind, rand, day, depth, lootBonus = 0, unlocks = []) {
  const c = CONTAINERS[kind];
  const scale = (1 + day * 0.06) * (1 + depth * 0.6) * (1 + lootBonus);
  const out = { resources: {}, ammo: {}, medipacks: 0, weapon: null, blueprint: null, kind };

  for (const [res, [lo, hi]] of Object.entries(c.res || {})) {
    const n = Math.round(rand.int(lo, hi) * scale);
    if (n > 0) out.resources[res] = (out.resources[res] || 0) + n;
  }

  if (c.ammo) {
    const type = rand.weighted([
      { key: 'light', w: 60 },
      { key: 'shell', w: 25 },
      { key: 'rifle', w: 20 },
    ]).key;
    out.ammo[type] = Math.max(1, Math.round(rand.int(2, 6) * scale));
  }

  if (c.medChance && rand.chance(c.medChance * (1 + depth * 0.5))) {
    out.medipacks += 1;
  }

  if (c.weaponChance && rand.chance(c.weaponChance * (1 + depth * 0.4))) {
    out.weapon = foundWeapon(rand.pick(FOUNDABLE), rand, day);
  }

  if (c.blueprintChance && rand.chance(c.blueprintChance)) {
    const locked = RESEARCH_ORDER.filter(
      (k) => !unlocks.includes(k) && RESEARCH[k].req.every((r) => unlocks.includes(r)),
    );
    if (locked.length) out.blueprint = rand.pick(locked);
  }

  return out;
}

/** Small drop when a zombie dies -- keeps melee builds fed. */
export function rollCorpse(rand, day) {
  const out = { resources: {}, ammo: {}, medipacks: 0, weapon: null, blueprint: null, kind: 'corpse' };
  if (rand.chance(0.35)) out.resources.scrap = rand.int(1, 2);
  if (rand.chance(0.18)) out.resources.cloth = 1;
  if (rand.chance(0.12)) out.ammo.light = rand.int(1, 3);
  if (rand.chance(0.06 + day * 0.004)) out.resources.parts = 1;
  return out;
}

/** Merge loot bundles into a single carried total. */
export function mergeLoot(target, add) {
  for (const [k, v] of Object.entries(add.resources || {})) {
    target.resources[k] = (target.resources[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(add.ammo || {})) {
    target.ammo[k] = (target.ammo[k] || 0) + v;
  }
  target.medipacks += add.medipacks || 0;
  if (add.weapon) target.weapons.push(add.weapon);
  if (add.blueprint && !target.blueprints.includes(add.blueprint)) {
    target.blueprints.push(add.blueprint);
  }
  return target;
}

export function emptyLoot() {
  return { resources: {}, ammo: {}, medipacks: 0, weapons: [], blueprints: [] };
}

/** Rough "how good was that haul" number, for the debrief screen. */
export function lootValue(bundle) {
  const weights = { scrap: 1, wood: 1, cloth: 1.2, powder: 1.6, chem: 2, parts: 3, fuel: 2, food: 1.5 };
  let v = 0;
  for (const [k, n] of Object.entries(bundle.resources)) v += (weights[k] || 1) * n;
  for (const n of Object.values(bundle.ammo)) v += n * 1.2;
  v += bundle.medipacks * 6;
  v += bundle.weapons.length * 12;
  v += bundle.blueprints.length * 25;
  return Math.round(v);
}

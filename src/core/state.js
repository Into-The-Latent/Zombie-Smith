// The campaign-level game state: everything that survives between runs.

import { makeRng } from './rng.js';
import { clamp } from './util.js';
import { makeSurvivor, recomputeSurvivor } from '../game/survivors.js';
import { buildWeapon } from '../game/craft.js';
import { runMachines, addMachine, MACHINE_TYPES } from '../game/machines.js';
import { PREP_SECONDS, resetDaylight, startNight } from '../game/clocks.js';
import { RESEARCH } from '../data/progression.js';

export const SAVE_VERSION = 1;

/** Mutable singleton -- scenes import this directly. */
export let State = null;

export function setState(s) {
  State = s;
  return State;
}

export function newGame(seed = Math.floor(Math.random() * 1e9)) {
  const rand = makeRng(seed);

  const s = {
    version: SAVE_VERSION,
    seed,
    day: 1,
    resources: { scrap: 14, wood: 8, cloth: 6, powder: 6, chem: 3, parts: 3, fuel: 4, food: 6 },
    ammo: { light: 12, shell: 0, rifle: 0 },
    medipacks: 1,
    survivors: [],
    stash: [],
    machines: [],
    unlocks: [],
    difficulty: 1,
    stats: { runs: 0, kills: 0, deaths: 0, extracted: 0, wiped: 0, crafted: 0, bestHaul: 0 },
    log: [],
    tutorialSeen: false,
    /** Seconds of daylight left for this day's preparation. */
    prepLeft: PREP_SECONDS,
    /** What was left when the squad last headed out. */
    daylightBanked: PREP_SECONDS,
  };

  // A starting trio: one of each of the three "cheap" archetypes.
  const starters = ['gunsmith', 'scout', 'heavy'];
  for (const cls of starters) s.survivors.push(makeSurvivor(cls, rand));

  // Everyone starts armed with something honest -- the first run has to be
  // playable before the player has touched the forge.
  const pistol = buildWeapon({ tpl: 'makeshift_pistol', stock: 'scrap_steel', scores: { shape: 0.5, grind: 0.5, fit: 0.5 }, crafter: 'Workshop' });
  const clubs = [0.5, 0.45, 0.5].map((q) =>
    buildWeapon({ tpl: 'pipe_club', stock: 'scrap_steel', scores: { shape: q, fit: 0.5 }, crafter: 'Workshop' }));
  s.stash.push(pistol, ...clubs);

  s.survivors[0].equipped.primary = pistol.id;
  s.survivors.forEach((sv, i) => {
    sv.equipped.melee = clubs[i]?.id ?? null;
  });

  logLine(s, `Day 1. Three of you, one workshop, and a city full of them.`);
  return setState(s);
}

export function logLine(s, text) {
  s.log.unshift({ day: s.day, text });
  if (s.log.length > 60) s.log.length = 60;
}

export function itemById(s, id) {
  return s.stash.find((w) => w.id === id) || null;
}

export function equippedWeapons(s, sv) {
  return {
    primary: sv.equipped.primary ? itemById(s, sv.equipped.primary) : null,
    melee: sv.equipped.melee ? itemById(s, sv.equipped.melee) : null,
  };
}

export function canAfford(s, cost) {
  return Object.entries(cost || {}).every(([k, v]) => (s.resources[k] || 0) >= v);
}

export function pay(s, cost) {
  for (const [k, v] of Object.entries(cost || {})) s.resources[k] = (s.resources[k] || 0) - v;
}

export function addResources(s, res) {
  for (const [k, v] of Object.entries(res || {})) s.resources[k] = (s.resources[k] || 0) + v;
}

export function unlock(s, key) {
  if (s.unlocks.includes(key)) return false;
  s.unlocks.push(key);
  const r = RESEARCH[key];
  // Automation research physically installs the machine.
  const machine = Object.values(MACHINE_TYPES).find((m) => m.unlock === key);
  if (machine) addMachine(s, machine.key);
  if (r) logLine(s, `Unlocked: ${r.name}.`);
  return true;
}

/**
 * One day passes. Machines tick, the wounded mend, injuries count down and
 * the world gets a little worse.
 */
export function advanceDay(s) {
  s.day += 1;
  // A new day is a fresh five minutes of light.
  resetDaylight(s);
  const notes = runMachines(s);

  const restBonus = s.unlocks.includes('ws_racks') ? 1 : 0;
  for (const sv of s.survivors) {
    if (sv.status === 'dead') continue;
    if (sv.status === 'injured') {
      sv.injury -= 1;
      if (sv.injury <= 0) {
        sv.status = 'ready';
        sv.injury = 0;
        notes.push(`${sv.name} is back on their feet.`);
      }
    }
    // Rations speed recovery; without them you heal at a crawl.
    let heal = 2 + restBonus;
    if (s.resources.food > 0) {
      s.resources.food -= 1;
      heal += 3;
    } else {
      heal = 1;
    }
    sv.hp = clamp(sv.hp + heal, 0, sv.hpMax);
  }

  if (s.resources.food <= 0) notes.push('No rations left. Recovery has slowed to a crawl.');
  s.difficulty = 1 + (s.day - 1) * 0.14;
  return notes;
}

/** Rebuild anything derived after loading a save. */
export function rehydrate(s) {
  // A save written before the phase clocks existed carries none of these.
  if (!Number.isFinite(s.prepLeft)) s.prepLeft = PREP_SECONDS;
  if (!Number.isFinite(s.daylightBanked)) s.daylightBanked = PREP_SECONDS;
  if (!Number.isFinite(s.nightSpan)) startNight(s);
  for (const sv of s.survivors) {
    const missing = (sv.hpMax || 0) - (sv.hp || 0);
    recomputeSurvivor(sv);
    if (Number.isFinite(missing) && missing > 0) sv.hp = clamp(sv.hpMax - missing, 0, sv.hpMax);
  }
  return setState(s);
}

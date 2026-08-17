// Builds and drives a single scavenging run.

import { generateMap, tileAt, EXIT, ENTRY } from './map.js';
import { makeZombie, livingPlayers, livingZombies, unitAt, spawnWave } from './ai.js';
import { refreshVision } from './fov.js';
import { weaponStats } from '../game/craft.js';
import { emptyLoot, mergeLoot, rollLoot, rollCorpse, lootValue } from '../game/loot.js';
import { spawnTable } from '../data/enemies.js';
import { equippedWeapons, logLine } from '../core/state.js';
import { grantXp } from '../game/survivors.js';
import { clamp } from '../core/util.js';

export const HEAT_MAX = 100;

export function createBattle(state, squadIds, rand, siteKey = null) {
  const day = state.day;
  const map = generateMap(rand, day, siteKey);

  const battle = {
    rand,
    day,
    map,
    units: [],
    round: 1,
    phase: 'player', // player | enemy | over
    heat: 0,
    heatMax: HEAT_MAX,
    waves: 0,
    kills: 0,
    containersOpened: 0,
    loot: emptyLoot(),
    log: [],
    visible: new Uint8Array(map.w * map.h),
    seen: new Uint8Array(map.w * map.h),
    noisePings: [],
    floaters: [],
    outcome: null,
    spawnTable: spawnTable(day),
    startAmmo: { ...state.ammo },
    squadIds: [...squadIds],
    unlocks: [...state.unlocks],
  };

  // --- squad --------------------------------------------------------------
  const pad = [];
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) pad.push([map.entry.x + dx - 1, map.entry.y + dy - 1]);
  let slot = 0;
  for (const id of squadIds) {
    const sv = state.survivors.find((s) => s.id === id);
    if (!sv) continue;
    const { primary, melee } = equippedWeapons(state, sv);
    let pos = null;
    while (slot < pad.length && !pos) {
      const [px, py] = pad[slot++];
      if (tileAt(map, px, py) !== 0 && !unitAt(battle, px, py)) pos = { x: px, y: py };
    }
    if (!pos) pos = { x: map.entry.x, y: map.entry.y };

    // Top up magazines from the shared pool before we set off.
    if (primary && primary.kind === 'gun') {
      const st = weaponStats(primary);
      const want = Math.max(0, st.mag - primary.loaded);
      const have = state.ammo[primary.ammo] || 0;
      const take = Math.min(want, have);
      primary.loaded += take;
      state.ammo[primary.ammo] -= take;
    }

    battle.units.push({
      id: `p_${sv.id}`,
      side: 'player',
      svId: sv.id,
      name: sv.name,
      cls: sv.cls,
      portrait: sv.portrait,
      x: pos.x,
      y: pos.y,
      hp: sv.hp,
      hpMax: sv.hpMax,
      ap: sv.apMax,
      apMax: sv.apMax,
      aim: sv.aim,
      armor: sv.armor,
      sight: sv.sight,
      meleeBonus: sv.meleeBonus,
      critBonus: sv.critBonus,
      healBonus: sv.healBonus,
      lootBonus: sv.lootBonus,
      noiseMult: sv.noiseMult,
      fastReload: sv.fastReload,
      primary,
      melee,
      active: primary ? 'primary' : 'melee',
      state: 'idle', // idle | down | dead
      bleed: 0,
      overwatch: false,
      braced: false,
      flash: 0,
      xpEarned: 0,
      bob: Math.random() * Math.PI * 2,
    });
  }

  // --- zombies ------------------------------------------------------------
  for (const s of map.spawns) {
    battle.units.push(makeZombie(s.key, s.x, s.y, day));
  }

  battle.medipacks = state.medipacks;
  battle.ammoReserve = { ...state.ammo };

  refreshVision(battle);
  battle.log.unshift({ text: `${map.site.name}. ${map.site.blurb}`, tone: 'info' });
  return battle;
}

export function playerUnits(battle) {
  return battle.units.filter((u) => u.side === 'player');
}

export function activeSquad(battle) {
  return battle.units.filter((u) => u.side === 'player' && u.state === 'idle');
}

/** Every living survivor is standing on the given pad type. */
export function allOnPad(battle, padTile) {
  const alive = livingPlayers(battle);
  if (!alive.length) return false;
  return alive.every((u) => tileAt(battle.map, u.x, u.y) === padTile);
}

export const canExtract = (b) => allOnPad(b, EXIT);
export const canFallBack = (b) => allOnPad(b, ENTRY);

export function beginRound(battle) {
  battle.round += 1;
  for (const u of battle.units) {
    if (u.state === 'dead') continue;
    if (u.side === 'player') {
      if (u.state === 'down') {
        u.bleed -= 1;
        u.ap = 0;
        if (u.bleed <= 0) {
          u.state = 'dead';
          battle.log.unshift({ text: `${u.name} bled out.`, tone: 'bad' });
        }
        continue;
      }
      u.ap = u.apMax;
      u.braced = false;
    } else {
      u.ap = u.apMax;
    }
  }
  // Standing around in a dead city is not free.
  battle.heat = Math.min(battle.heatMax, battle.heat + 3);
  refreshVision(battle);
}

/** @returns {Array} newly spawned zombies, if the heat boiled over */
export function checkHeat(battle) {
  if (battle.heat < battle.heatMax) return [];
  battle.waves += 1;
  const count = 2 + Math.floor(battle.day / 5) + Math.floor(battle.waves / 2);
  const spawned = spawnWave(battle, battle.rand, count);
  battle.heat = battle.heatMax * 0.2;
  battle.log.unshift({
    text: `They heard you. ${spawned.length} more coming in.`,
    tone: 'bad',
  });
  return spawned;
}

export function openContainer(battle, unit, container) {
  if (container.opened) return null;
  container.opened = true;
  battle.containersOpened += 1;
  const bundle = rollLoot(
    container.kind,
    battle.rand,
    battle.day,
    container.depth,
    unit.lootBonus || 0,
    battle.unlocks || [],
  );
  mergeLoot(battle.loot, bundle);
  if (bundle.medipacks) battle.medipacks += bundle.medipacks;
  for (const [k, v] of Object.entries(bundle.ammo)) {
    battle.ammoReserve[k] = (battle.ammoReserve[k] || 0) + v;
  }
  return bundle;
}

export function dropFromCorpse(battle, z) {
  const bundle = rollCorpse(battle.rand, battle.day);
  mergeLoot(battle.loot, bundle);
  for (const [k, v] of Object.entries(bundle.ammo)) {
    battle.ammoReserve[k] = (battle.ammoReserve[k] || 0) + v;
  }
  return bundle;
}

export function squadWiped(battle) {
  return livingPlayers(battle).length === 0;
}

/**
 * Fold the run's results back into the campaign.
 * @param {'extracted'|'fellback'|'wiped'} outcome
 */
export function finishRun(state, battle, outcome) {
  const report = {
    outcome,
    day: state.day,
    site: battle.map.site.name,
    kills: battle.kills,
    rounds: battle.round,
    containers: battle.containersOpened,
    loot: battle.loot,
    value: 0,
    xp: [],
    casualties: [],
    injuries: [],
    levelUps: [],
    machineNotes: [],
    bonus: null,
  };

  const kept = outcome !== 'wiped';

  if (kept) {
    // Extraction pays a bonus cache on top of what you carried out.
    if (outcome === 'extracted') {
      const bonus = { scrap: 4 + battle.day, parts: 1 + Math.floor(battle.day / 4), food: 2 };
      mergeLoot(battle.loot, { resources: bonus, ammo: {}, medipacks: 0 });
      report.bonus = bonus;
    }
    for (const [k, v] of Object.entries(battle.loot.resources)) {
      state.resources[k] = (state.resources[k] || 0) + v;
    }
    state.ammo = { ...battle.ammoReserve };
    state.medipacks = battle.medipacks;
    for (const w of battle.loot.weapons) state.stash.push(w);
    for (const bp of battle.loot.blueprints) {
      if (!state.unlocks.includes(bp)) state.unlocks.push(bp);
    }
  } else {
    // A wipe costs you the haul and anything the dead were carrying.
    state.ammo = { ...battle.startAmmo };
  }
  report.value = lootValue(battle.loot);

  for (const u of playerUnits(battle)) {
    const sv = state.survivors.find((s) => s.id === u.svId);
    if (!sv) continue;
    sv.runs += 1;

    if (u.state === 'dead') {
      sv.status = 'dead';
      sv.hp = 0;
      state.stats.deaths += 1;
      report.casualties.push(sv.name);
      // Their gear is gone with them.
      for (const slot of ['primary', 'melee']) {
        const id = sv.equipped[slot];
        if (id) {
          state.stash = state.stash.filter((w) => w.id !== id);
          sv.equipped[slot] = null;
        }
      }
      continue;
    }

    sv.hp = clamp(u.state === 'down' ? Math.max(1, Math.round(sv.hpMax * 0.15)) : u.hp, 1, sv.hpMax);

    if (u.state === 'down' || sv.hp < sv.hpMax * 0.3) {
      sv.status = 'injured';
      sv.injury = u.state === 'down' ? 3 : 1;
      report.injuries.push(sv.name);
    }

    const mult = outcome === 'extracted' ? 1.25 : 1;
    const xp = Math.round((u.xpEarned || 0) * mult) + (outcome === 'extracted' ? 12 : 4);
    const levels = grantXp(sv, xp);
    report.xp.push({ name: sv.name, xp, levels });
    if (levels) report.levelUps.push(sv.name);
  }

  // Guns come home loaded; the rounds inside them rejoin the pool.
  if (kept) {
    for (const u of playerUnits(battle)) {
      for (const w of [u.primary, u.melee]) {
        if (w && w.kind === 'gun' && w.loaded > 0 && state.stash.includes(w)) {
          state.ammo[w.ammo] = (state.ammo[w.ammo] || 0) + w.loaded;
          w.loaded = 0;
        }
      }
    }
  }

  state.stats.runs += 1;
  state.stats.kills += battle.kills;
  if (outcome === 'extracted') state.stats.extracted += 1;
  if (outcome === 'wiped') state.stats.wiped += 1;
  state.stats.bestHaul = Math.max(state.stats.bestHaul, report.value);

  const verb = outcome === 'extracted' ? 'Extracted from' : outcome === 'fellback' ? 'Fell back from' : 'Lost at';
  logLine(state, `${verb} ${battle.map.site.name}. ${battle.kills} down, ${report.value} salvage.`);

  return report;
}

export { livingPlayers, livingZombies, unitAt, lootValue };

// Automation. Machines run one cycle per day (a day passes when a run ends),
// consuming inputs from the stash and producing output without any player
// skill involved -- deliberately worse per-material than hand-crafting, so
// hand work stays the power fantasy and machines are the floor.

import { AMMO } from '../data/materials.js';

export const MACHINE_TYPES = {
  ammo_press: {
    key: 'ammo_press',
    name: 'Ammo Press',
    unlock: 'mach_ammo',
    desc: 'Presses one batch of the selected calibre each day.',
    configurable: 'ammo',
    color: '#d8b45a',
    /** Machine output is 60% of a good hand-press batch. */
    run(state, m) {
      const type = m.config || 'light';
      const a = AMMO[type];
      if (!a) return null;
      if (!canAfford(state, a.cost)) return null;
      pay(state, a.cost);
      const n = Math.max(1, Math.round(a.perCraft * 0.6));
      state.ammo[type] = (state.ammo[type] || 0) + n;
      return `Ammo Press: +${n} ${a.short}`;
    },
  },
  grinder: {
    key: 'grinder',
    name: 'Powered Grinder',
    unlock: 'mach_grinder',
    desc: 'Grinds 4 scrap and 1 fuel into 2 machine parts each day.',
    color: '#9aa5b1',
    run(state) {
      const cost = { scrap: 4, fuel: 1 };
      if (!canAfford(state, cost)) return null;
      pay(state, cost);
      state.resources.parts += 2;
      return 'Grinder: +2 Parts';
    },
  },
  chem_bench: {
    key: 'chem_bench',
    name: 'Chem Bench',
    unlock: 'mach_chem',
    desc: 'Cooks one medipack from 3 chem and 2 cloth each day.',
    color: '#4fb477',
    run(state) {
      const cost = { chem: 3, cloth: 2 };
      if (!canAfford(state, cost)) return null;
      pay(state, cost);
      state.medipacks += 1;
      return 'Chem Bench: +1 Medipack';
    },
  },
};

export const MACHINE_ORDER = ['ammo_press', 'grinder', 'chem_bench'];

export function canAfford(state, cost) {
  return Object.entries(cost).every(([k, v]) => (state.resources[k] || 0) >= v);
}

export function pay(state, cost) {
  for (const [k, v] of Object.entries(cost)) state.resources[k] -= v;
}

/** Called once per day-advance. Returns log lines for the debrief. */
export function runMachines(state) {
  const lines = [];
  for (const m of state.machines) {
    if (!m.active) continue;
    const type = MACHINE_TYPES[m.key];
    if (!type) continue;
    const msg = type.run(state, m);
    lines.push(msg || `${type.name}: idle (missing materials)`);
  }
  return lines;
}

export function ownedMachines(state) {
  return state.machines.map((m) => ({ ...m, type: MACHINE_TYPES[m.key] }));
}

export function addMachine(state, key) {
  if (state.machines.some((m) => m.key === key)) return false;
  state.machines.push({ key, active: true, config: key === 'ammo_press' ? 'light' : null });
  return true;
}

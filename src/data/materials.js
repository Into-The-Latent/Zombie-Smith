// Raw resources. `key` is what the rest of the game stores in
// `state.resources[key]`.

export const MATERIALS = {
  scrap: { key: 'scrap', name: 'Scrap Steel', short: 'Scrap', color: '#9aa5b1', icon: 'bar' },
  wood: { key: 'wood', name: 'Hardwood', short: 'Wood', color: '#a4783f', icon: 'plank' },
  cloth: { key: 'cloth', name: 'Cloth', short: 'Cloth', color: '#c8b39a', icon: 'roll' },
  powder: { key: 'powder', name: 'Gunpowder', short: 'Powder', color: '#6f7b8c', icon: 'grain' },
  chem: { key: 'chem', name: 'Chemicals', short: 'Chem', color: '#69c98d', icon: 'flask' },
  parts: { key: 'parts', name: 'Machine Parts', short: 'Parts', color: '#d0973c', icon: 'gear' },
  fuel: { key: 'fuel', name: 'Fuel', short: 'Fuel', color: '#d2603a', icon: 'can' },
  food: { key: 'food', name: 'Rations', short: 'Food', color: '#c9d17a', icon: 'tin' },
};

export const MATERIAL_ORDER = ['scrap', 'wood', 'cloth', 'powder', 'chem', 'parts', 'fuel', 'food'];

/**
 * Stock alloys the player can shape a weapon's primary component from.
 * These multiply the finished weapon's stats, so material choice is a real
 * decision and not just a cost difference.
 */
export const STOCK = {
  scrap_steel: {
    key: 'scrap_steel',
    name: 'Scrap Steel',
    desc: 'Salvaged plate. Reliable, unremarkable.',
    color: '#8f9aa6',
    edge: '#c3ccd6',
    cost: { scrap: 3 },
    mult: { dmg: 1.0, acc: 1.0, dur: 1.0 },
    // How forgiving the shaping minigame is (wider strike window).
    workability: 1.0,
    unlock: null,
  },
  rebar: {
    key: 'rebar',
    name: 'Rebar',
    desc: 'Heavy and brutal. Hard to shape true.',
    color: '#7a6a58',
    edge: '#a89279',
    cost: { scrap: 4 },
    mult: { dmg: 1.22, acc: 0.9, dur: 1.15 },
    workability: 0.8,
    unlock: null,
  },
  spring_steel: {
    key: 'spring_steel',
    name: 'Spring Steel',
    desc: 'Salvaged from car suspension. Holds an edge.',
    color: '#98a7bd',
    edge: '#d6e2f0',
    cost: { scrap: 5, parts: 1 },
    mult: { dmg: 1.1, acc: 1.12, dur: 1.25 },
    workability: 0.9,
    unlock: 'stock_spring',
  },
  gun_alloy: {
    key: 'gun_alloy',
    name: 'Gun Alloy',
    desc: 'Machined billet. Everything a barrel wants to be.',
    color: '#5f6b7d',
    edge: '#9fb4cf',
    cost: { scrap: 4, parts: 3 },
    mult: { dmg: 1.3, acc: 1.2, dur: 1.3 },
    workability: 0.7,
    unlock: 'stock_alloy',
  },
};

export function stockList(unlocks) {
  return Object.values(STOCK).filter((s) => !s.unlock || unlocks.includes(s.unlock));
}

/** Ammo calibres. One crafted casing yields `perCraft` rounds. */
export const AMMO = {
  light: {
    key: 'light',
    name: 'Light Rounds',
    short: '9mm',
    color: '#d8b45a',
    cost: { scrap: 1, powder: 2 },
    perCraft: 6,
  },
  shell: {
    key: 'shell',
    name: 'Shotgun Shells',
    short: '12ga',
    color: '#d2603a',
    cost: { scrap: 1, powder: 3, cloth: 1 },
    perCraft: 4,
  },
  rifle: {
    key: 'rifle',
    name: 'Rifle Rounds',
    short: '.308',
    color: '#8fb46a',
    cost: { scrap: 2, powder: 3 },
    perCraft: 4,
  },
};

// Survivor classes, level perks, and the workshop research tree.

export const CLASSES = {
  gunsmith: {
    key: 'gunsmith',
    name: 'Gunsmith',
    color: '#e8a33d',
    desc: 'Steadier hands at the bench and behind a sight.',
    hp: 34,
    ap: 5,
    aim: 10,
    melee: 0,
    // Widens every crafting minigame's success window.
    craftBonus: 0.18,
    sight: 7,
    blurb: 'Ran a gun shop before. Still does, technically.',
  },
  medic: {
    key: 'medic',
    name: 'Medic',
    color: '#4fb477',
    desc: 'Medipacks go further; stabilises the downed faster.',
    hp: 32,
    ap: 5,
    aim: 2,
    melee: -2,
    craftBonus: 0.06,
    sight: 7,
    healBonus: 0.5,
    blurb: 'Two years of med school and a very bad year of practice.',
  },
  scout: {
    key: 'scout',
    name: 'Scout',
    color: '#4a9fd8',
    desc: 'More action points, better eyes, lighter feet.',
    hp: 28,
    ap: 7,
    aim: 4,
    melee: 0,
    craftBonus: 0.0,
    sight: 9,
    noiseMult: 0.7,
    blurb: 'Knows every back alley in the district.',
  },
  heavy: {
    key: 'heavy',
    name: 'Heavy',
    color: '#d7443e',
    desc: 'Soaks hits and swings hard. Not subtle.',
    hp: 46,
    ap: 4,
    aim: -4,
    melee: 6,
    craftBonus: 0.0,
    sight: 6,
    armor: 2,
    blurb: 'Moved fridges for a living. Moves zombies now.',
  },
};

export const CLASS_ORDER = ['gunsmith', 'medic', 'scout', 'heavy'];

/** Chosen one at a time on level-up. */
export const PERKS = {
  steady: { key: 'steady', name: 'Steady Hands', desc: '+8 accuracy with all weapons.', apply: (s) => (s.aim += 8) },
  deadeye: { key: 'deadeye', name: 'Deadeye', desc: '+10% critical hit chance.', apply: (s) => (s.critBonus += 0.1) },
  tough: { key: 'tough', name: 'Tough', desc: '+10 max health.', apply: (s) => (s.hpMax += 10) },
  fleet: { key: 'fleet', name: 'Fleet Footed', desc: '+1 action point per turn.', apply: (s) => (s.apMax += 1) },
  brawler: { key: 'brawler', name: 'Brawler', desc: '+5 melee damage.', apply: (s) => (s.meleeBonus += 5) },
  scavenger: { key: 'scavenger', name: 'Scavenger', desc: '+35% loot from containers.', apply: (s) => (s.lootBonus += 0.35) },
  quiet: { key: 'quiet', name: 'Light Step', desc: 'Your gunfire carries 30% less far.', apply: (s) => (s.noiseMult *= 0.7) },
  armored: { key: 'armored', name: 'Scrap Plate', desc: '+2 armour.', apply: (s) => (s.armor += 2) },
  artisan: { key: 'artisan', name: 'Artisan', desc: 'Wider timing windows when crafting.', apply: (s) => (s.craftBonus += 0.12) },
  medico: { key: 'medico', name: 'Field Medic', desc: 'Medipacks heal 50% more.', apply: (s) => (s.healBonus += 0.5) },
  eagle: { key: 'eagle', name: 'Eagle Eye', desc: '+2 sight range.', apply: (s) => (s.sight += 2) },
  gunner: { key: 'gunner', name: 'Gunner', desc: 'Reloading costs 1 AP instead of 2.', apply: (s) => (s.fastReload = true) },
};

export const PERK_KEYS = Object.keys(PERKS);

/** XP needed to reach the next level, indexed by current level. */
export function xpForLevel(level) {
  return Math.round(40 * Math.pow(1.45, level - 1));
}

/**
 * Workshop research. Buying one permanently unlocks recipes, stock materials
 * or machines. `req` lists other unlock keys that must come first.
 */
export const RESEARCH = {
  wpn_fire_axe: {
    key: 'wpn_fire_axe', name: 'Fire Axe', cat: 'Weapons',
    desc: 'Unlocks the Fire Axe template.', cost: { scrap: 8, wood: 6 }, req: [],
  },
  wpn_shotgun: {
    key: 'wpn_shotgun', name: 'Pipe Shotgun', cat: 'Weapons',
    desc: 'Unlocks the Pipe Shotgun and 12ga shells.', cost: { scrap: 12, parts: 4 }, req: [],
  },
  wpn_rifle: {
    key: 'wpn_rifle', name: 'Hunting Rifle', cat: 'Weapons',
    desc: 'Unlocks the Hunting Rifle and .308 rounds.', cost: { scrap: 14, parts: 8, wood: 6 }, req: ['wpn_shotgun'],
  },
  wpn_smg: {
    key: 'wpn_smg', name: 'Scrap SMG', cat: 'Weapons',
    desc: 'Unlocks the two-round-burst Scrap SMG.', cost: { scrap: 16, parts: 12 }, req: ['wpn_rifle'],
  },
  stock_spring: {
    key: 'stock_spring', name: 'Spring Steel Stock', cat: 'Materials',
    desc: 'Shape weapons from salvaged suspension steel.', cost: { scrap: 10, parts: 3 }, req: [],
  },
  stock_alloy: {
    key: 'stock_alloy', name: 'Gun Alloy Stock', cat: 'Materials',
    desc: 'The best billet you can get. Expensive.', cost: { scrap: 14, parts: 10, chem: 4 }, req: ['stock_spring'],
  },
  mod_suppressor: {
    key: 'mod_suppressor', name: 'Suppressors', cat: 'Mods',
    desc: 'Attach suppressors to firearms.', cost: { scrap: 6, cloth: 6, parts: 3 }, req: [],
  },
  mod_ext_mag: {
    key: 'mod_ext_mag', name: 'Extended Mags', cat: 'Mods',
    desc: 'Attach extended magazines.', cost: { scrap: 6, parts: 4 }, req: [],
  },
  mod_scope: {
    key: 'mod_scope', name: 'Optics', cat: 'Mods',
    desc: 'Attach salvaged scopes.', cost: { scrap: 4, parts: 6, chem: 2 }, req: [],
  },
  mod_serrated: {
    key: 'mod_serrated', name: 'Serration', cat: 'Mods',
    desc: 'File teeth into melee edges.', cost: { scrap: 5 }, req: [],
  },
  mod_weighted: {
    key: 'mod_weighted', name: 'Weighted Heads', cat: 'Mods',
    desc: 'Pour lead into melee heads.', cost: { scrap: 7 }, req: [],
  },
  mach_ammo: {
    key: 'mach_ammo', name: 'Ammo Press', cat: 'Automation',
    desc: 'A machine that presses rounds between runs.', cost: { scrap: 12, parts: 8 }, req: [],
  },
  mach_grinder: {
    key: 'mach_grinder', name: 'Powered Grinder', cat: 'Automation',
    desc: 'Turns scrap into finished parts while you are out.', cost: { scrap: 14, parts: 10, fuel: 4 }, req: ['mach_ammo'],
  },
  mach_chem: {
    key: 'mach_chem', name: 'Chem Bench', cat: 'Automation',
    desc: 'Cooks medipacks automatically. Slowly.', cost: { scrap: 10, parts: 8, chem: 6 }, req: ['mach_ammo'],
  },
  ws_racks: {
    key: 'ws_racks', name: 'Storage Racks', cat: 'Workshop',
    desc: 'Survivors recover one extra health per day at base.', cost: { scrap: 8, wood: 8 }, req: [],
  },
  ws_forge: {
    key: 'ws_forge', name: 'Better Forge', cat: 'Workshop',
    desc: 'The metal cools more slowly while you shape it.', cost: { scrap: 12, fuel: 6 }, req: [],
  },
};

export const RESEARCH_ORDER = Object.keys(RESEARCH);

export function researchAvailable(key, unlocks) {
  const r = RESEARCH[key];
  if (!r) return false;
  return r.req.every((q) => unlocks.includes(q));
}

const FIRST = ['Mara', 'Dane', 'Iris', 'Cole', 'Nadia', 'Bo', 'Elena', 'Teo', 'Ruth', 'Marcus',
  'Yuki', 'Ash', 'Priya', 'Gus', 'Lena', 'Otto', 'Sam', 'Vera', 'Nils', 'June'];
const LAST = ['Vance', 'Okoro', 'Reyes', 'Halloway', 'Petrov', 'Kaur', 'Bright', 'Nakamura',
  'Whitlock', 'Adeyemi', 'Sorensen', 'Cruz', 'Mbeki', 'Fontaine', 'Doyle', 'Ferreira'];

export function randomName(rand) {
  return `${rand.pick(FIRST)} ${rand.pick(LAST)}`;
}

// Weapon templates + attachable mods.
//
// A template describes the *shape* of a weapon. Crafting it runs three
// minigame stages whose scores feed different stat groups:
//
//   shape  -> damage / durability   (the head, blade or barrel blank)
//   grind  -> accuracy / crit       (the edge or the rifling)
//   fit    -> ap cost / magazine    (how well it goes together in the hand)
//
// Base stats below are what a perfectly-average (0.5 score everywhere,
// Scrap Steel) build produces.

export const WEAPON_TEMPLATES = {
  pipe_club: {
    key: 'pipe_club',
    name: 'Pipe Club',
    kind: 'melee',
    ammo: null,
    desc: 'A length of pipe with tape for grip. Everyone starts here.',
    cost: { scrap: 2, cloth: 1 },
    base: { dmg: 11, acc: 82, crit: 0.05, ap: 2, range: 1, mag: 0, noise: 3, pen: 0, dur: 40 },
    stages: ['shape', 'fit'],
    unlock: null,
    tier: 1,
  },
  machete: {
    key: 'machete',
    name: 'Machete',
    kind: 'melee',
    ammo: null,
    desc: 'Quiet, fast, and it never asks for ammunition.',
    cost: { scrap: 3, cloth: 1 },
    base: { dmg: 15, acc: 85, crit: 0.14, ap: 2, range: 1, mag: 0, noise: 2, pen: 1, dur: 45 },
    stages: ['shape', 'grind', 'fit'],
    unlock: null,
    tier: 1,
  },
  fire_axe: {
    key: 'fire_axe',
    name: 'Fire Axe',
    kind: 'melee',
    ammo: null,
    desc: 'Slow, heavy, and it goes through a skull like wet card.',
    cost: { scrap: 4, wood: 3 },
    base: { dmg: 26, acc: 74, crit: 0.10, ap: 3, range: 1, mag: 0, noise: 3, pen: 3, dur: 55 },
    stages: ['shape', 'grind', 'fit'],
    unlock: 'wpn_fire_axe',
    tier: 2,
  },
  makeshift_pistol: {
    key: 'makeshift_pistol',
    name: 'Makeshift Pistol',
    kind: 'gun',
    ammo: 'light',
    desc: 'Zip-gun with delusions of grandeur. Cheap to feed.',
    cost: { scrap: 4, parts: 1 },
    base: { dmg: 14, acc: 68, crit: 0.10, ap: 2, range: 6, mag: 6, noise: 9, pen: 1, dur: 60 },
    stages: ['shape', 'grind', 'fit'],
    unlock: null,
    tier: 1,
  },
  pipe_shotgun: {
    key: 'pipe_shotgun',
    name: 'Pipe Shotgun',
    kind: 'gun',
    ammo: 'shell',
    desc: 'Devastating up close. Announces you to the whole street.',
    cost: { scrap: 6, wood: 2, parts: 2 },
    base: { dmg: 32, acc: 72, crit: 0.06, ap: 3, range: 3, mag: 2, noise: 13, pen: 2, dur: 55 },
    stages: ['shape', 'grind', 'fit'],
    unlock: 'wpn_shotgun',
    tier: 2,
  },
  hunting_rifle: {
    key: 'hunting_rifle',
    name: 'Hunting Rifle',
    kind: 'gun',
    ammo: 'rifle',
    desc: 'Reach out and touch something. One shot, one problem solved.',
    cost: { scrap: 6, wood: 3, parts: 3 },
    base: { dmg: 30, acc: 74, crit: 0.22, ap: 3, range: 12, mag: 4, noise: 12, pen: 4, dur: 60 },
    stages: ['shape', 'grind', 'fit'],
    unlock: 'wpn_rifle',
    tier: 3,
  },
  scrap_smg: {
    key: 'scrap_smg',
    name: 'Scrap SMG',
    kind: 'gun',
    ammo: 'light',
    desc: 'Two shots per pull of the trigger. Hungry thing.',
    cost: { scrap: 7, parts: 4 },
    base: { dmg: 11, acc: 62, crit: 0.08, ap: 2, range: 5, mag: 12, noise: 10, pen: 1, dur: 50 },
    stages: ['shape', 'grind', 'fit'],
    unlock: 'wpn_smg',
    tier: 3,
    burst: 2, // fires twice per attack, each shot rolls separately
  },
};

export const TEMPLATE_ORDER = [
  'pipe_club',
  'machete',
  'fire_axe',
  'makeshift_pistol',
  'pipe_shotgun',
  'hunting_rifle',
  'scrap_smg',
];

/** Attachments. `fits` filters by weapon kind; null = anything. */
export const MODS = {
  suppressor: {
    key: 'suppressor',
    name: 'Suppressor',
    desc: 'Cuts the report. Far fewer heads turn.',
    fits: 'gun',
    cost: { scrap: 2, cloth: 3, parts: 1 },
    add: { noise: -7, dmg: -2 },
    unlock: 'mod_suppressor',
  },
  ext_mag: {
    key: 'ext_mag',
    name: 'Extended Mag',
    desc: 'More rounds between reloads.',
    fits: 'gun',
    cost: { scrap: 3, parts: 2 },
    add: { mag: 4 },
    unlock: 'mod_ext_mag',
  },
  scope: {
    key: 'scope',
    name: 'Salvaged Scope',
    desc: 'Glass off a pair of binoculars. Steadies the long shot.',
    fits: 'gun',
    cost: { scrap: 1, parts: 2, chem: 1 },
    add: { range: 4, acc: 6, ap: 0 },
    unlock: 'mod_scope',
  },
  serrated: {
    key: 'serrated',
    name: 'Serrated Edge',
    desc: 'Nasty teeth filed into the blade.',
    fits: 'melee',
    cost: { scrap: 2 },
    add: { dmg: 4, crit: 0.06, dur: -8 },
    unlock: 'mod_serrated',
  },
  weighted: {
    key: 'weighted',
    name: 'Weighted Head',
    desc: 'Lead in the head. Hits harder, swings uglier.',
    fits: 'melee',
    cost: { scrap: 3 },
    add: { dmg: 6, acc: -7, pen: 2 },
    unlock: 'mod_weighted',
  },
  grip_tape: {
    key: 'grip_tape',
    name: 'Wrapped Grip',
    desc: 'Cloth and tape. Cheap, and it just feels right.',
    fits: null,
    cost: { cloth: 2 },
    add: { acc: 4, crit: 0.03 },
    unlock: null,
  },
};

export const MOD_ORDER = ['grip_tape', 'suppressor', 'ext_mag', 'scope', 'serrated', 'weighted'];

export function modsFor(weapon, unlocks) {
  return MOD_ORDER.map((k) => MODS[k]).filter(
    (m) =>
      (!m.unlock || unlocks.includes(m.unlock)) &&
      (m.fits === null || m.fits === WEAPON_TEMPLATES[weapon.tpl].kind),
  );
}

export function templatesFor(unlocks) {
  return TEMPLATE_ORDER.map((k) => WEAPON_TEMPLATES[k]).filter(
    (t) => !t.unlock || unlocks.includes(t.unlock),
  );
}

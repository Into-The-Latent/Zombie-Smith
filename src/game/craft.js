// Turns minigame performance into a finished weapon.
//
// The three stages each own a different slice of the stat block, so a player
// who is good at the hammer but sloppy on the grinder gets a hard-hitting,
// inaccurate weapon rather than a uniformly mediocre one.

import { WEAPON_TEMPLATES, MODS } from '../data/weapons.js';
import { STOCK } from '../data/materials.js';
import { uid, clamp, round2 } from '../core/util.js';

export const TIERS = [
  { key: 'crude', name: 'Crude', min: 0.0, color: '#8b95a5' },
  { key: 'sturdy', name: 'Sturdy', min: 0.4, color: '#d8dee9' },
  { key: 'fine', name: 'Fine', min: 0.64, color: '#4a9fd8' },
  { key: 'superior', name: 'Superior', min: 0.82, color: '#a97fae' },
  { key: 'masterwork', name: 'Masterwork', min: 0.93, color: '#e8a33d' },
];

export function tierFor(quality) {
  let out = TIERS[0];
  for (const t of TIERS) if (quality >= t.min) out = t;
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.tpl    template key
 * @param {string} opts.stock  stock material key
 * @param {object} opts.scores { shape, grind, fit } each 0..1 (missing = 0.5)
 * @param {string} [opts.crafter] survivor name, for the maker's mark
 */
export function buildWeapon({ tpl, stock, scores, crafter = 'Unknown' }) {
  const t = WEAPON_TEMPLATES[tpl];
  const st = STOCK[stock] || STOCK.scrap_steel;
  const shape = clamp(scores.shape ?? 0.5, 0, 1);
  const grind = clamp(scores.grind ?? 0.5, 0, 1);
  const fit = clamp(scores.fit ?? 0.5, 0, 1);

  // Only stages the template actually runs count toward overall quality.
  const used = t.stages;
  const sum = used.reduce((a, k) => a + ({ shape, grind, fit })[k], 0);
  const quality = clamp(sum / used.length, 0, 1);

  const b = t.base;
  const stats = {
    dmg: b.dmg * (0.72 + 0.58 * shape) * st.mult.dmg,
    acc: b.acc + (-10 + 22 * grind) + (st.mult.acc - 1) * 40,
    crit: b.crit * (0.5 + 1.3 * grind),
    ap: b.ap,
    range: b.range,
    mag: b.mag ? Math.max(1, Math.round(b.mag * (0.75 + 0.5 * fit))) : 0,
    noise: b.noise,
    pen: b.pen,
    dur: Math.round(b.dur * (0.7 + 0.65 * shape) * st.mult.dur),
  };

  // A really clean assembly shaves an action point off; a botched one adds it.
  if (fit >= 0.88) stats.ap = Math.max(1, b.ap - 1);
  else if (fit < 0.25) stats.ap = b.ap + 1;

  stats.dmg = Math.max(1, Math.round(stats.dmg));
  stats.acc = Math.round(clamp(stats.acc, 25, 98));
  stats.crit = round2(clamp(stats.crit, 0, 0.75));

  const tier = tierFor(quality);
  return {
    id: uid('w'),
    tpl,
    kind: t.kind,
    ammo: t.ammo,
    burst: t.burst || 1,
    stock,
    quality: round2(quality),
    scores: { shape: round2(shape), grind: round2(grind), fit: round2(fit) },
    tier: tier.key,
    name: `${tier.name} ${t.name}`,
    customName: null,
    baseStats: stats,
    mods: [],
    dur: stats.dur,
    durMax: stats.dur,
    loaded: 0,
    kills: 0,
    crafter,
    found: false,
  };
}

/** A weapon pulled off a corpse or out of a locker -- no maker's mark. */
export function foundWeapon(tplKey, rand, day = 1) {
  const roll = clamp(rand.range(0.15, 0.55) + day * 0.012, 0, 0.8);
  const w = buildWeapon({
    tpl: tplKey,
    stock: 'scrap_steel',
    scores: { shape: roll, grind: roll * rand.range(0.7, 1.2), fit: roll * rand.range(0.7, 1.2) },
    crafter: 'Salvaged',
  });
  w.found = true;
  w.dur = Math.max(4, Math.round(w.durMax * rand.range(0.35, 0.9)));
  return w;
}

/**
 * Final stats = base + mods + a small bonus earned through use.
 * Kept as a pure function so the UI can preview a mod before it is fitted.
 */
export function weaponStats(w, extraMods = []) {
  const s = { ...w.baseStats };
  const all = [...w.mods, ...extraMods];
  for (const key of all) {
    const m = MODS[key];
    if (!m) continue;
    for (const [k, v] of Object.entries(m.add)) s[k] = (s[k] || 0) + v;
  }
  // "Weapon identity": a blade that has seen work bites a little deeper.
  const veteran = Math.min(4, Math.floor(w.kills / 12));
  s.dmg += veteran;
  s.veteran = veteran;

  s.dmg = Math.max(1, Math.round(s.dmg));
  s.acc = Math.round(clamp(s.acc, 20, 99));
  s.crit = round2(clamp(s.crit, 0, 0.85));
  s.ap = Math.max(1, Math.round(s.ap));
  s.mag = Math.max(0, Math.round(s.mag));
  s.noise = Math.max(1, Math.round(s.noise));
  s.range = Math.max(1, Math.round(s.range));
  return s;
}

export function weaponLabel(w) {
  return w.customName || w.name;
}

/** True when a weapon is too broken to swing. */
export const isBroken = (w) => w.dur <= 0;

export function repairCost(w) {
  const missing = w.durMax - w.dur;
  if (missing <= 0) return null;
  return { scrap: Math.max(1, Math.ceil(missing / 8)) };
}

/** Blend of stage scores -> the star rating shown after a craft. */
export function qualityStars(q) {
  return clamp(Math.round(q * 5), 0, 5);
}

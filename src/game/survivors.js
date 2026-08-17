import { CLASSES, PERKS, xpForLevel, randomName } from '../data/progression.js';
import { uid, clamp } from '../core/util.js';
import { pickPortrait } from '../data/portraits.js';

/**
 * Derived survivor stats are always rebuilt from (class + level + perks) so
 * that adding a perk twice, or loading an old save, can never drift.
 */
export function recomputeSurvivor(s) {
  const c = CLASSES[s.cls];
  const lv = s.level - 1;

  s.hpMax = c.hp + lv * 3;
  s.apMax = c.ap;
  s.aim = c.aim + lv * 1;
  s.meleeBonus = c.melee;
  s.critBonus = 0;
  s.armor = c.armor || 0;
  s.sight = c.sight;
  s.craftBonus = c.craftBonus || 0;
  s.healBonus = c.healBonus || 0;
  s.lootBonus = 0;
  s.noiseMult = c.noiseMult || 1;
  s.fastReload = false;

  for (const p of s.perks) {
    const perk = PERKS[p];
    if (perk) perk.apply(s);
  }

  s.hp = clamp(s.hp, 0, s.hpMax);
  return s;
}

/**
 * @param {object[]} [roster] the survivors already at the workshop.
 *
 * Used to keep a new arrival distinct from them in both name and face. Two
 * people wearing the same face is the sort of thing a player spots instantly on
 * a roster of three -- and so is two people called the same thing, which was
 * possible until now: 20 first names and 16 surnames give 320 combinations, so
 * a starting trio collided about once in a hundred campaigns.
 */
export function makeSurvivor(clsKey, rand, name = null, roster = []) {
  const taken = roster.map((o) => o.name);
  let picked = name;
  // Bounded, because the pool can genuinely run out on a large roster and a
  // duplicate name is far better than a hang.
  for (let i = 0; !picked && i < 12; i++) {
    const candidate = randomName(rand);
    if (!taken.includes(candidate)) picked = candidate;
  }

  const s = {
    id: uid('sv'),
    name: picked || randomName(rand),
    portrait: pickPortrait(rand, roster.map((o) => o.portrait)),
    cls: clsKey,
    level: 1,
    xp: 0,
    hp: 1,
    perks: [],
    equipped: { primary: null, melee: null },
    status: 'ready', // ready | injured | dead
    injury: 0,
    kills: 0,
    runs: 0,
    pendingPerks: 0,
  };
  recomputeSurvivor(s);
  s.hp = s.hpMax;
  return s;
}

/** Returns the number of levels gained. */
export function grantXp(s, amount) {
  if (s.status === 'dead') return 0;
  s.xp += amount;
  let gained = 0;
  while (s.xp >= xpForLevel(s.level)) {
    s.xp -= xpForLevel(s.level);
    s.level += 1;
    s.pendingPerks += 1;
    gained += 1;
  }
  if (gained) {
    const missing = s.hpMax - s.hp;
    recomputeSurvivor(s);
    s.hp = clamp(s.hpMax - missing, 1, s.hpMax); // level-ups don't heal
  }
  return gained;
}

export function choosePerk(s, perkKey) {
  if (s.pendingPerks <= 0 || s.perks.includes(perkKey)) return false;
  s.perks.push(perkKey);
  s.pendingPerks -= 1;
  const missing = s.hpMax - s.hp;
  recomputeSurvivor(s);
  s.hp = clamp(s.hpMax - missing, 1, s.hpMax);
  return true;
}

/** Three offered perks, deterministic per (survivor, perk count). */
export function perkChoices(s, rand) {
  const pool = Object.keys(PERKS).filter((k) => !s.perks.includes(k));
  rand.shuffle(pool);
  return pool.slice(0, 3);
}

export function xpProgress(s) {
  return { cur: s.xp, need: xpForLevel(s.level) };
}

export const isDeployable = (s) => s.status === 'ready' && s.hp > 0;

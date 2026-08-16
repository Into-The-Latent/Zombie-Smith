// Seeded RNG so runs and maps are reproducible (and testable).

/** mulberry32 -- tiny, fast, good enough for a game. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9;

  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    /** float in [0,1) */
    next,
    /** float in [lo,hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo,hi] inclusive */
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    /** true with probability p */
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** Fisher-Yates, in place, returns the same array. */
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    /** Pick from [{w, ...}] by weight. */
    weighted: (entries) => {
      let total = 0;
      for (const e of entries) total += e.w;
      let r = next() * total;
      for (const e of entries) {
        r -= e.w;
        if (r <= 0) return e;
      }
      return entries[entries.length - 1];
    },
    /** Current seed state, so a run can be resumed/serialized. */
    getState: () => a >>> 0,
    setState: (s) => {
      a = s >>> 0;
    },
  };
}

/** Shared, unseeded-ish RNG for cosmetic things (particles, flavour). */
export const rng = makeRng((Date.now() ^ 0x5f3759df) >>> 0);

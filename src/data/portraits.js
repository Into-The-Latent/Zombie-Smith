// The cast.
//
// Ten painted upper-body shots, and the only files the game loads besides the
// splash. Listed explicitly rather than discovered, because a static server has
// no directory listing and the single-file build has no directory at all.
//
// The `_f` / `_m` suffix is the artist's, and it is recorded here because it is
// information about the file. Nothing branches on it: the game has never
// gendered a survivor -- there are no pronouns anywhere in its text -- and a
// face is assigned from the whole set, so a name and a portrait carry no
// implications about each other.

export const PORTRAIT_DIR = 'assets/portraits';

export const PORTRAITS = [
  { key: 'ch1_f', sex: 'f' },
  { key: 'ch2_f', sex: 'f' },
  { key: 'ch3_f', sex: 'f' },
  { key: 'ch4_m', sex: 'm' },
  { key: 'ch5_f', sex: 'f' },
  { key: 'ch6_f', sex: 'f' },
  { key: 'ch7_m', sex: 'm' },
  { key: 'ch8_f', sex: 'f' },
  { key: 'ch9_m', sex: 'm' },
  { key: 'ch10_m', sex: 'm' },
];

export const PORTRAIT_KEYS = PORTRAITS.map((p) => p.key);

/**
 * Where a portrait's pixels are.
 *
 * A path when the game is served as files, and a data URI when the single-file
 * build has inlined it -- same arrangement as the splash, and for the same
 * reason: that build is one file with nowhere to keep siblings.
 */
export function portraitSrc(key) {
  const inlined = globalThis.__PORTRAIT_URLS__;
  return (inlined && inlined[key]) || `${PORTRAIT_DIR}/${key}.jpg`;
}

/**
 * A face for a new survivor, avoiding the ones already in use.
 *
 * Falls back to the whole set once every face is taken, because a roster can
 * outgrow ten and a duplicate face is much better than no face.
 */
export function pickPortrait(rand, taken = []) {
  const free = PORTRAITS.filter((p) => !taken.includes(p.key));
  return rand.pick(free.length ? free : PORTRAITS).key;
}

/** Tolerate a save written before portraits existed, or a renamed file. */
export function validPortrait(key) {
  return PORTRAIT_KEYS.includes(key);
}

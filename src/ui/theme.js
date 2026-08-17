// One place for colours and type, so every screen looks like the same game.
//
// The interface is carved and printed, not extruded: stained wood, aged paper,
// brass fittings and heavy ink contours, lit by one candle from the upper left.
// It is deliberately the opposite of the world view, which is cold sodium and
// steel (`ui/palette.js`) -- the workshop is the warm half of the game and the
// street is the cold half, so the two halves are told apart by temperature
// before the player has read a single word.
//
// Nothing here is a plain rectangle by accident. Every surface is a material,
// and `ui/ornament.js` is what knows how to draw them.

/**
 * Contour ink. Brown-black rather than pure black, because a true #000 line
 * over warm wood reads as a hole in the screen rather than as drawn ink.
 */
export const Ink = {
  line: '#0a0806',
  soft: '#1b130c',
  /** Cast shadow under anything raised off the backdrop. */
  shadow: 'rgba(6,4,2,0.55)',
};

/** Stained oak: the default material for anything structural. */
export const Wood = {
  deep: '#1d140d',
  base: '#2b1e14',
  mid: '#3a2818',
  light: '#4c3622',
  seam: '#130d08',
};

/** Aged paper: documents, tooltips, anything the player is meant to read as written. */
export const Parch = {
  base: '#c8ae82',
  light: '#ddc79b',
  dark: '#a4895d',
  stain: '#87693f',
  /** Text on parchment. Iron-gall brown, never black. */
  ink: '#2a1d10',
  inkDim: '#5c452c',
};

/** Brass fittings: brackets, rivets, rules, and the frame of anything important. */
export const Brass = {
  base: '#a37b34',
  hi: '#e6c079',
  dark: '#63481a',
};

export const Theme = {
  bg: '#120d09',
  bgDeep: '#090605',
  panel: Wood.base,
  panelLight: Wood.mid,
  panelHi: Wood.light,
  border: Ink.line,
  borderHi: Brass.base,

  /** Bone and candle-light, for text on wood. */
  text: '#ece0c6',
  textDim: '#a8916f',
  textFaint: '#6f5c44',

  accent: '#e0b055',
  accentDark: '#8a6321',
  /** The status colours, pulled down into the same dirty range as everything else. */
  good: '#7d9a4a',
  bad: '#a8302a',
  info: '#5f8298',
  warn: '#c99a37',
  purple: '#7b5a86',

  blood: '#8f2a24',
  rot: '#6f8f5f',

  /**
   * Body text is a serif, because the interface is printed matter.
   *
   * Serif metrics run a little wider than the sans this replaced, so anything
   * measured rather than guessed survives the change and anything hard-coded to
   * a pixel width does not -- which is why every screen was re-shot after this
   * landed.
   */
  font: (size, weight = 400) =>
    `${weight} ${size}px Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif`,

  /**
   * Display type: headings, plaques, station names.
   *
   * Uppercased and letterspaced by the caller rather than set in `small-caps`,
   * because a canvas font string the browser cannot parse is silently ignored --
   * leaving the *previous* font in place, which is a size bug rather than a
   * styling one. `ornament.tracked()` does the spacing.
   */
  display: (size, weight = 700) =>
    `${weight} ${size}px Luminari, "Trajan Pro", Copperplate, "Baskerville Old Face", Georgia, serif`,

  /** Kept monospaced: stat blocks and clocks are read as figures, not as prose. */
  mono: (size, weight = 400) =>
    `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
};

export const W = 1280;
export const H = 720;

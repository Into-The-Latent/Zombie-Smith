// The prop catalogue.
//
// Everything standing on a floor that is not a wall, a survivor or a corpse
// is a row in here. A row is data: a gameplay class, a list of boxes, and the
// sites it belongs to. Adding a bus stop or a filing cabinet later is an edit
// to this file and nothing else -- the renderer already knows how to draw any
// pile of boxes, and the map generator already knows how to weigh a site's
// list.
//
// Two rules keep the catalogue honest:
//
//   * A row names a *gameplay class*, not a tile id. `half` is waist-high
//     cover you can see and shoot over; `full` is tall enough to stop both.
//     The classes are the ones the pathfinder, the FOV and `coverAt` already
//     understand, so a new prop can never invent a rule nobody enforces.
//   * A row carries no colours of its own, only material names. Colour comes
//     from ui/palette.js, and `isoBox` derives every face from one light.
//
// Box geometry, all relative to the tile the prop stands on:
//   x, y   offset from the tile centre in grid units (+x is down-right on
//          screen, +y down-left), so a prop rotates with the world for free
//   w, d   footprint, in grid units: 1 is the whole tile
//   z      height of the box's underside above the floor, in pixels
//   h      height, in pixels -- a wall is 26 and a survivor about 38
//   m      material name from `Material`, or 'paint' for the car's own set

export const HALF = 'half';
export const FULL = 'full';

/**
 * Waist-high props are capped here. The cap is the car -- roof height, the
 * tallest thing a survivor can still shoot across -- and it exists so that a
 * later catalogue row cannot quietly claim half cover at shelf height.
 */
export const HALF_MAX_H = 24;

export const PROPS = {
  crate: {
    key: 'crate', name: 'crate', cover: HALF,
    sites: { transit: 2, clinic: 2, warehouse: 4, suburb: 2, garage: 2 },
    boxes: [
      { w: 0.62, d: 0.62, h: 20, m: 'crate' },
    ],
  },

  pallets: {
    key: 'pallets', name: 'stack of pallets', cover: HALF,
    sites: { warehouse: 4, garage: 2, transit: 1 },
    // Three slabs, each a little smaller and nudged off the one below, so the
    // stack reads as stacked rather than as one tall box.
    boxes: [
      { w: 0.82, d: 0.82, h: 5, m: 'wood' },
      { x: 0.03, y: -0.02, z: 5, w: 0.78, d: 0.78, h: 5, m: 'wood' },
      { x: -0.02, y: 0.04, z: 10, w: 0.74, d: 0.74, h: 4.5, m: 'wood' },
    ],
  },

  barrels: {
    key: 'barrels', name: 'barrels', cover: HALF,
    sites: { garage: 4, warehouse: 3, transit: 1 },
    boxes: [
      { x: -0.15, y: -0.13, w: 0.3, d: 0.3, h: 21, m: 'rust' },
      { x: 0.16, y: 0.14, w: 0.3, d: 0.3, h: 18, m: 'paintedSteel' },
      // A lid ring on the taller one, so a barrel is not just a post.
      { x: -0.15, y: -0.13, z: 21, w: 0.34, d: 0.34, h: 1.5, m: 'steel' },
    ],
  },

  bench: {
    key: 'bench', name: 'bench', cover: HALF,
    sites: { transit: 4, clinic: 3, suburb: 3 },
    boxes: [
      { x: -0.26, w: 0.09, d: 0.26, h: 8, m: 'steel' },
      { x: 0.26, w: 0.09, d: 0.26, h: 8, m: 'steel' },
      { z: 8, w: 0.74, d: 0.3, h: 3.5, m: 'wood' },
      { y: -0.14, z: 11, w: 0.74, d: 0.08, h: 8, m: 'wood' },
    ],
  },

  railing: {
    key: 'railing', name: 'railing', cover: HALF,
    sites: { transit: 4, garage: 2, warehouse: 2 },
    boxes: [
      { x: -0.4, w: 0.08, d: 0.08, h: 17, m: 'steel' },
      { w: 0.08, d: 0.08, h: 17, m: 'steel' },
      { x: 0.4, w: 0.08, d: 0.08, h: 17, m: 'steel' },
      { z: 15, w: 0.94, d: 0.1, h: 2.5, m: 'steel' },
      { z: 8, w: 0.94, d: 0.07, h: 2, m: 'steel' },
    ],
  },

  fence: {
    key: 'fence', name: 'fence', cover: HALF,
    sites: { suburb: 5, warehouse: 2, transit: 1 },
    // Slats with gaps between them: five thin uprights on two rails.
    boxes: [
      { x: -0.4, w: 0.1, d: 0.1, h: 21, m: 'wood' },
      { x: -0.2, w: 0.1, d: 0.1, h: 20, m: 'wood' },
      { x: 0, w: 0.1, d: 0.1, h: 21, m: 'wood' },
      { x: 0.2, w: 0.1, d: 0.1, h: 19.5, m: 'wood' },
      { x: 0.4, w: 0.1, d: 0.1, h: 20.5, m: 'wood' },
      { z: 13, w: 0.92, d: 0.06, h: 2.5, m: 'wood' },
      { z: 5, w: 0.92, d: 0.06, h: 2.5, m: 'wood' },
    ],
  },

  counter: {
    key: 'counter', name: 'counter', cover: HALF,
    sites: { clinic: 4, suburb: 2, garage: 2 },
    boxes: [
      { w: 0.86, d: 0.4, h: 14, m: 'fabric' },
      // A lip that overhangs on the near side, which is the whole silhouette
      // of a counter -- flush with the carcass it was a brown box.
      { y: 0.06, z: 14, w: 0.96, d: 0.56, h: 3, m: 'steel', rim: 0.18 },
    ],
  },

  car: {
    key: 'car', name: 'car', cover: HALF,
    sites: { transit: 3, garage: 4, suburb: 3 },
    boxes: [
      { w: 0.92, d: 0.92, h: 15, m: 'paint' },
      { z: 15, w: 0.48, d: 0.48, h: 9, m: 'glass', rim: 0.14 },
    ],
  },

  shelving: {
    key: 'shelving', name: 'shelving', cover: FULL,
    sites: { warehouse: 4, clinic: 3, garage: 2 },
    boxes: [
      { x: -0.4, w: 0.08, d: 0.56, h: 30, m: 'steel' },
      { x: 0.4, w: 0.08, d: 0.56, h: 30, m: 'steel' },
      { z: 8, w: 0.9, d: 0.56, h: 2.5, m: 'steel' },
      { z: 19, w: 0.9, d: 0.56, h: 2.5, m: 'steel' },
      { z: 29, w: 0.9, d: 0.56, h: 2.5, m: 'steel' },
      // Something actually on the shelves, or it reads as scaffolding.
      { x: -0.22, z: 10.5, w: 0.28, d: 0.4, h: 8, m: 'crate' },
      { x: 0.24, z: 21.5, w: 0.24, d: 0.36, h: 6.5, m: 'wood' },
    ],
  },

  lockers: {
    key: 'lockers', name: 'lockers', cover: FULL,
    sites: { clinic: 3, transit: 2, warehouse: 2, suburb: 2 },
    boxes: [
      { w: 0.8, d: 0.4, h: 30, m: 'paintedSteel' },
      // Doors stand proud of the carcass and are toned up from it. Flush and
      // untoned they vanished: three doors the same colour as the box behind
      // them is just the box.
      { x: -0.25, y: 0.06, w: 0.22, d: 0.44, h: 27, m: 'paintedSteel', tone: 10 },
      { y: 0.06, w: 0.22, d: 0.44, h: 27, m: 'paintedSteel', tone: 10 },
      { x: 0.25, y: 0.06, w: 0.22, d: 0.44, h: 27, m: 'paintedSteel', tone: 10 },
      { z: 30, w: 0.84, d: 0.44, h: 1.5, m: 'steel', rim: 0.2 },
    ],
  },
};

export const PROP_KEYS = Object.keys(PROPS);

/** The rows a site can draw from, as a weighted table for `rand.weighted`. */
export function propTable(siteKey) {
  const out = [];
  for (const key of PROP_KEYS) {
    const w = PROPS[key].sites[siteKey];
    if (w) out.push({ key, w });
  }
  return out;
}

/** Total height of a prop, for shadows and for the half-cover cap. */
export function propHeight(key) {
  const p = PROPS[key];
  return p.boxes.reduce((m, b) => Math.max(m, (b.z || 0) + b.h), 0);
}

/** Widest footprint a prop reaches, in grid units. */
export function propSpan(key) {
  const p = PROPS[key];
  let wide = 0;
  let deep = 0;
  for (const b of p.boxes) {
    wide = Math.max(wide, Math.abs(b.x || 0) * 2 + b.w);
    deep = Math.max(deep, Math.abs(b.y || 0) * 2 + b.d);
  }
  return { w: wide, d: deep };
}

/**
 * Back-to-front order for a prop's own boxes, per camera rotation.
 *
 * A shelf's uprights have to be drawn behind its shelves, and which upright
 * is "behind" changes when the camera turns. Four fixed orders, worked out
 * once, rather than a sort inside the draw loop.
 */
const DEPTH = [
  (x, y) => x + y,
  (x, y) => y - x,
  (x, y) => -x - y,
  (x, y) => x - y,
];
const orderCache = new Map();
export function propBoxes(key, rot = 0) {
  const id = `${key}|${rot}`;
  let out = orderCache.get(id);
  if (!out) {
    const depth = DEPTH[((rot % 4) + 4) % 4];
    out = [...PROPS[key].boxes].sort(
      (a, b) => depth(a.x || 0, a.y || 0) - depth(b.x || 0, b.y || 0) || (a.z || 0) - (b.z || 0),
    );
    orderCache.set(id, out);
  }
  return out;
}

/** Height and span of every row, worked out once at load. */
export const PROP_METRICS = Object.fromEntries(
  PROP_KEYS.map((key) => [key, { h: propHeight(key), ...propSpan(key) }]),
);

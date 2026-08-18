// One box, drawn one way.
//
// Every solid thing in this world is the same shape: a footprint extruded
// upward, showing a top and the two vertical faces that face the camera.
// Walls, props, loot containers and the figures themselves.
//
// That shape used to exist three times, copy-pasted, and the copies had
// drifted apart. The wall derived its faces from FACE_SHADE; the crate and
// the car used hand-picked colours that shaded the *right* face light and the
// *left* face dark, which is the exact opposite of the wall and of LIGHT_DIR.
// Three boxes on one floor were lit by two different suns. One function fixes
// that by construction rather than by discipline: there is nowhere left to
// put a second opinion about where the light is.
//
// Footprints are given in grid units -- `w` along +x, `d` along +y, 1 being a
// whole tile -- not in screen pixels. A railing is 0.94 by 0.1 and has to come
// out as a long thin rail running down-right, which a screen-space diamond
// cannot express: it would be a spike across the corner instead. Heights stay
// in pixels, because a shelf is tall in the way a wall is tall (WALL_H = 26)
// rather than in fractions of a floor tile.

import { TILE_W, TILE_H } from './iso.js';
import { shade, FACE_SHADE, Lighting } from '../ui/palette.js';

/**
 * How far a box's shadow reaches per unit of height, as a fraction of one
 * grid step. Below about 0.4 the shadow hides under the box and the object
 * looks pasted on; above about 0.8 the sun is low enough that shadows from
 * adjacent props merge into one dark smear. 0.55 is a high afternoon sun,
 * which is also what the floor's own cast shadows in `shadowAt` assume.
 */
export const SHADOW_SLANT = 0.55;

/** Height in pixels that counts as one grid step, for shadow length. */
export const UNIT_H = 26;

/**
 * The four corners of a footprint, in screen offsets from its centre.
 * Returned in draw order: top, right, bottom, left.
 */
export function footprint(w, d, zoom = 1) {
  const hx = (TILE_W / 2) * zoom;
  const hy = (TILE_H / 2) * zoom;
  return [
    [(d - w) * hx / 2, -(w + d) * hy / 2], // -x -y : screen top
    [(w + d) * hx / 2, (w - d) * hy / 2], // +x -y : screen right
    [(w - d) * hx / 2, (w + d) * hy / 2], // +x +y : screen bottom
    [-(w + d) * hx / 2, (d - w) * hy / 2], // -x +y : screen left
  ];
}

/**
 * The three visible face colours, derived from one base.
 *
 * Pure, and the only place the derivation happens -- a test can assert the
 * left face is lighter than the right without going near a canvas.
 */
export function boxFaces(colour, opts = {}) {
  const tone = opts.tone || 0;
  return {
    top: opts.top || shade(colour, FACE_SHADE.top + tone),
    left: shade(colour, FACE_SHADE.left + tone),
    right: shade(colour, FACE_SHADE.right + tone),
  };
}

// Face triples are rebuilt for every box of every figure, sixty times a
// second, from a set of maybe forty distinct colours. Memoised rather than
// re-parsed; the cap is there so a procedural colour can never grow it
// without bound.
const faceCache = new Map();
function facesFor(colour, tone, top) {
  const key = `${colour}|${tone}|${top || ''}`;
  let f = faceCache.get(key);
  if (!f) {
    if (faceCache.size > 256) faceCache.clear();
    f = boxFaces(colour, { tone, top });
    faceCache.set(key, f);
  }
  return f;
}

/**
 * Trace the box's outer silhouette: the outline of the top and both faces at
 * once. Used for the unlit veil, and anywhere the whole shape is wanted.
 */
export function boxSilhouette(ctx, cx, cy, zoom, w, d, h) {
  const [a, b, c, e] = footprint(w, d, zoom);
  const hh = h * zoom;
  ctx.beginPath();
  ctx.moveTo(cx + e[0], cy + e[1]);
  ctx.lineTo(cx + c[0], cy + c[1]);
  ctx.lineTo(cx + b[0], cy + b[1]);
  ctx.lineTo(cx + b[0], cy + b[1] - hh);
  ctx.lineTo(cx + a[0], cy + a[1] - hh);
  ctx.lineTo(cx + e[0], cy + e[1] - hh);
  ctx.closePath();
}

/**
 * The shadow a box of this size throws on the floor.
 *
 * Not a blob. Sweeping the footprint along the light gives its shadow
 * exactly, and because the sweep runs parallel to two of the footprint's own
 * edges -- the light travels along +x, and so do they -- the six-point hull
 * collapses to four. One fill, no dearer than the ellipse it replaces, and it
 * grows with the object's height the way a real shadow does.
 */
export function boxShadow(ctx, cx, cy, zoom, w, d, h, opts = {}) {
  const reach = (h / UNIT_H) * SHADOW_SLANT * (opts.reach ?? 1);
  const ox = reach * (TILE_W / 2) * zoom;
  const oy = reach * (TILE_H / 2) * zoom;
  const a = opts.alpha ?? 0.3;

  // Two passes: a soft skirt, then the core. Cheaper than a blur filter, and
  // it stops the shadow reading as a cut-out.
  for (const [grow, alpha] of [[1.22, a * 0.45], [1, a]]) {
    const [p0, p1, p2, p3] = footprint(w * grow, d * grow, zoom);
    ctx.fillStyle = `rgba(4,7,11,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx + p3[0], cy + p3[1]);
    ctx.lineTo(cx + p0[0], cy + p0[1]);
    ctx.lineTo(cx + p1[0] + ox, cy + p1[1] + oy);
    ctx.lineTo(cx + p2[0] + ox, cy + p2[1] + oy);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Draw one box. `cx`/`cy` is the centre of its footprint on the ground, `w`
 * and `d` its footprint in grid units, `h` its height in unzoomed pixels.
 */
export function isoBox(ctx, cx, cy, zoom, w, d, h, colour, opts = {}) {
  const f = facesFor(colour, opts.tone || 0, opts.top);
  const [a, b, c, e] = footprint(w, d, zoom);
  const hh = h * zoom;
  const z = (opts.z || 0) * zoom; // underside height, for stacked boxes
  const base = (p) => [cx + p[0], cy + p[1] - z];
  const [ax, ay] = base(a);
  const [bx, by] = base(b);
  const [cx2, cy2] = base(c);
  const [ex, ey] = base(e);

  // The +x face, on the lower right: turned away from the light.
  if (!opts.hideRight) {
    ctx.fillStyle = f.right;
    ctx.beginPath();
    ctx.moveTo(cx2, cy2);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by - hh);
    ctx.lineTo(cx2, cy2 - hh);
    ctx.closePath();
    ctx.fill();
  }
  // The +y face, on the lower left: catches the light at a glance.
  if (!opts.hideLeft) {
    ctx.fillStyle = f.left;
    ctx.beginPath();
    ctx.moveTo(cx2, cy2);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex, ey - hh);
    ctx.lineTo(cx2, cy2 - hh);
    ctx.closePath();
    ctx.fill();
  }
  // Top.
  ctx.fillStyle = f.top;
  ctx.beginPath();
  ctx.moveTo(ax, ay - hh);
  ctx.lineTo(bx, by - hh);
  ctx.lineTo(cx2, cy2 - hh);
  ctx.lineTo(ex, ey - hh);
  ctx.closePath();
  ctx.fill();
  if (opts.outline !== null) {
    ctx.strokeStyle = opts.outline || 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Rim light along the two far top edges, so a lid reads as a surface with a
  // direction rather than a flat cap.
  if (opts.rim) {
    ctx.strokeStyle = `${Lighting.rim}${opts.rim})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ex, ey - hh);
    ctx.lineTo(ax, ay - hh);
    ctx.lineTo(bx, by - hh);
    ctx.stroke();
  }
}

/** The cold veil over anything outside the squad's sight. */
export function dimBox(ctx, cx, cy, zoom, w, d, h, alpha = 0.55) {
  boxSilhouette(ctx, cx, cy, zoom, w, d, h);
  ctx.fillStyle = `${Lighting.coldFog}${alpha})`;
  ctx.fill();
}

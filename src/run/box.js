// One box, drawn one way.
//
// Every solid thing in this world is the same shape: a footprint diamond
// extruded upward, showing a top and the two vertical faces that face the
// camera. Walls, crates, cars, containers and -- from here on -- props and
// the figures themselves.
//
// That shape used to exist three times, copy-pasted, and the copies had
// drifted apart. The wall derived its faces from FACE_SHADE; the crate and
// the car used hand-picked colours that shaded the *right* face light and the
// *left* face dark, which is the exact opposite of the wall and of LIGHT_DIR.
// Three boxes on one floor were lit by two different suns. One function fixes
// that by construction rather than by discipline: there is now nowhere to put
// a second opinion about where the light is.

import { TILE_W, TILE_H } from './iso.js';
import { shade, FACE_SHADE, Lighting } from '../ui/palette.js';

/**
 * How far a box's shadow reaches per unit of height, as a fraction of one
 * grid step. Below about 0.4 the shadow hides under the box and the object
 * looks pasted on; above about 0.8 the sun is low enough that shadows from
 * adjacent props merge into a single dark smear. 0.55 is a high afternoon
 * sun, which is also what the floor's own cast shadows in `shadowAt` assume.
 */
export const SHADOW_SLANT = 0.55;

/** Height in pixels that counts as one grid step, for shadow length. */
export const UNIT_H = 26;

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
 * Trace the box's outer silhouette: the six-point outline of top and both
 * faces. Used for the unlit veil and anywhere the whole shape is wanted at
 * once.
 */
export function boxSilhouette(ctx, cx, cy, hw, hh, h) {
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy - h - hh);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
}

/**
 * The shadow a box of this size throws on the floor.
 *
 * Not a blob. Sweeping the footprint diamond along the light gives a
 * parallelogram, exactly: the offset runs parallel to the diamond's own
 * upper-right edge (both are 2:1), so two of the four swept corners land on
 * top of the other two and the six-point hull collapses to four. One fill,
 * no more expensive than the ellipse it replaces, and it grows with the
 * object's height the way a real shadow does.
 */
export function boxShadow(ctx, cx, cy, hw, hh, h, opts = {}) {
  const reach = (h / UNIT_H) * SHADOW_SLANT * (opts.reach ?? 1);
  const ox = reach * (TILE_W / 2);
  const oy = reach * (TILE_H / 2);
  const a = opts.alpha ?? 0.3;

  // Two passes: a soft skirt, then the core. Cheaper than a blur filter and
  // it stops the shadow reading as a cut-out.
  for (const [grow, alpha] of [[1.22, a * 0.45], [1, a]]) {
    const gw = hw * grow;
    const gh = hh * grow;
    ctx.fillStyle = `rgba(4,7,11,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx - gw, cy);
    ctx.lineTo(cx, cy - gh);
    ctx.lineTo(cx + gw + ox, cy + oy);
    ctx.lineTo(cx + ox, cy + gh + oy);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Draw one box. `cx`/`cy` is the centre of its footprint on the ground;
 * `hw`/`hh` are the footprint's half-diagonals and `h` its height, all in
 * screen pixels with the caller's zoom already applied -- a wall is measured
 * in tiles and a forearm is measured in itself, so the scale belongs to the
 * caller.
 */
export function isoBox(ctx, cx, cy, hw, hh, h, colour, opts = {}) {
  const f = facesFor(colour, opts.tone || 0, opts.top);

  // Right face, toward +x: turned away from the light.
  if (!opts.hideRight) {
    ctx.fillStyle = f.right;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw, cy - h);
    ctx.lineTo(cx, cy + hh - h);
    ctx.closePath();
    ctx.fill();
  }
  // Left face, toward +y: catches the light at a glance.
  if (!opts.hideLeft) {
    ctx.fillStyle = f.left;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.lineTo(cx - hw, cy - h);
    ctx.lineTo(cx, cy + hh - h);
    ctx.closePath();
    ctx.fill();
  }
  // Top.
  ctx.fillStyle = f.top;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - hh);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy - h + hh);
  ctx.lineTo(cx - hw, cy - h);
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
    ctx.moveTo(cx - hw, cy - h);
    ctx.lineTo(cx, cy - h - hh);
    ctx.lineTo(cx + hw, cy - h);
    ctx.stroke();
  }
}

/** The cold veil over anything outside the squad's sight. */
export function dimBox(ctx, cx, cy, hw, hh, h, alpha = 0.55) {
  boxSilhouette(ctx, cx, cy, hw, hh, h);
  ctx.fillStyle = `${Lighting.coldFog}${alpha})`;
  ctx.fill();
}

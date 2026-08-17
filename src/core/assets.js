// The one file the game loads from disk.
//
// Everything else -- every tile, figure, panel, texture and sound -- is still
// generated at runtime, and that is deliberate. The splash art is a painted
// piece, which is exactly the thing the procedural rules cannot produce and
// should not try to imitate, so it is the single exception rather than the
// start of an asset pipeline.
//
// Loading is fire-and-forget, and **every consumer has to cope with `null`**.
// That is not defensive habit: an image arrives a frame or several after the
// first paint, and a title screen that goes blank while it waits is worse than
// one that never had a picture. Callers keep a drawable fallback.

/** @type {Map<string, {img: HTMLImageElement|null, ready: boolean, failed: boolean}>} */
const entries = new Map();

/**
 * The image for `src`, or null while it is still coming (or if it never will).
 *
 * Starts the load on the first call and is safe to call every frame after that,
 * which is what lets a render function ask for a picture without any of the
 * scenes owning a loading state.
 */
export function image(src) {
  let e = entries.get(src);
  if (!e) {
    e = { img: null, ready: false, failed: false };
    entries.set(src, e);
    if (typeof Image === 'undefined') {
      // Node, during tests. Nothing to load and nothing to wait for.
      e.failed = true;
    } else {
      const img = new Image();
      img.onload = () => { e.img = img; e.ready = true; };
      img.onerror = () => { e.failed = true; };
      img.src = src;
    }
  }
  return e.ready ? e.img : null;
}

/** True once the load has definitively failed, so a caller can stop hoping. */
export function imageFailed(src) {
  return entries.get(src)?.failed ?? false;
}

/** Test seam. */
export function forgetImages() {
  entries.clear();
}

/**
 * Where the splash art lives.
 *
 * A relative path when the game is served as modules, and a data URI when the
 * single-file build has inlined it -- that build is one file with no directory
 * to sit next to, so it hands the URL in on the global rather than leaving this
 * module to guess which shape it is running in.
 */
export const SPLASH_SRC = globalThis.__SPLASH_URL__ || 'Splash-screen.jpg';

/**
 * Draw an image to cover a box, cropping the overflowing axis evenly.
 *
 * The art ships at exactly 16:9, the same as the canvas, so today this is an
 * identity fit -- it is written properly anyway because the whole point of the
 * file being swappable is that the next one might not be.
 */
export function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

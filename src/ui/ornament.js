// The procedural version of a carved, printed interface.
//
// There are no image files in this project, so every material here is generated:
// plank seams and grain from a seeded noise field, paper blotching from stacked
// radial stains, brass from a two-stop gradient with a rivet on top. The point of
// putting them all in one module is that a "panel" then has a *material* rather
// than a fill colour, and a screen cannot accidentally invent a new one.
//
// Two rules run through everything:
//
//   One candle, upper left. The same light direction the world view uses, so a
//   bevel, a rivet and a wall face all agree about where the light is. Highlights
//   go on top-left edges, shadow on bottom-right. Nothing shades against it.
//
//   Contour over detail. Forms are closed with a heavy ink line and filled with
//   flat, dirty colour -- the shadow is a *shape*, not a gradient. That is what
//   makes procedural art read as drawn instead of as rendered, and it is also the
//   only style that survives being redrawn sixty times a second.
//
// Textures are expensive to generate and cheap to blit, so each one is painted
// once into an offscreen canvas keyed by its size and then reused. Panel sizes
// are stable from frame to frame, so in practice the cache is warm after the
// first frame of any screen and the per-frame cost is one `drawImage`.

import { makeRng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { mix, shadeHex } from './palette.js';
import { Ink, Wood, Parch, Brass, Theme } from './theme.js';

// ---------------------------------------------------------------------------
// Offscreen texture cache
// ---------------------------------------------------------------------------

const cache = new Map();
/** Generous enough for every panel on the busiest screen, bounded so a resizing
 *  element cannot leak canvases forever. */
const CACHE_MAX = 96;

function makeCanvas(w, h) {
  // Guarded rather than assumed: the mechanics tests run in Node, and a module
  // that touches `document` at import time cannot be tested at all.
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w));
  cv.height = Math.max(1, Math.ceil(h));
  return cv;
}

function texture(key, w, h, paint) {
  const hit = cache.get(key);
  if (hit) {
    // Re-inserted so the eviction order is least-recently-used rather than
    // insertion order; otherwise a permanent backdrop gets evicted by churn.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const cv = makeCanvas(w, h);
  if (!cv) return null;
  paint(cv.getContext('2d'), cv.width, cv.height);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, cv);
  return cv;
}

/** Test seam: how many textures are currently held. */
export function textureCount() {
  return cache.size;
}

export function clearTextures() {
  cache.clear();
}

/**
 * A seed from a size, so a given panel always gets the same grain.
 *
 * Deterministic on purpose. Random-per-frame noise on a static panel shimmers,
 * which is the single most obvious way procedural texture gives itself away.
 */
function seedOf(w, h, salt = 0) {
  return Math.round(w) * 7919 + Math.round(h) * 104729 + salt * 31;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * Stained oak, in planks.
 *
 * Planks rather than one flat field because a seam every couple of dozen pixels
 * is what tells the eye the surface has a scale -- an unbroken gradient could be
 * any size at all.
 */
function paintWood(c, w, h) {
  const rand = makeRng(seedOf(w, h)).next;
  c.fillStyle = Wood.base;
  c.fillRect(0, 0, w, h);

  const plankH = 24 + Math.floor(rand() * 14);
  for (let py = 0; py < h; py += plankH) {
    // A narrow tone range. The first pass swung each plank up to 0.85 of the way
    // to deep or mid, which on a tall panel with empty space in it read as bold
    // horizontal stripes -- the surface was competing with its own contents.
    const tone = rand();
    c.fillStyle = mix(Wood.base, tone < 0.5 ? Wood.deep : Wood.mid, 0.12 + rand() * 0.3);
    c.fillRect(0, py, w, plankH);

    // Grain: long wavy lines with very little amplitude. Drawn in both directions
    // from the plank tone so the surface reads as fibrous rather than striped.
    const lines = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < lines; i++) {
      const gy = py + 3 + rand() * (plankH - 6);
      const amp = 0.6 + rand() * 1.8;
      const period = 60 + rand() * 140;
      c.strokeStyle = rand() < 0.5
        ? `rgba(${hexRgb(Wood.light)},${0.1 + rand() * 0.14})`
        : `rgba(${hexRgb(Wood.deep)},${0.12 + rand() * 0.16})`;
      c.lineWidth = rand() < 0.75 ? 1 : 1.6;
      c.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = gy + Math.sin((x / period) * Math.PI * 2 + i) * amp;
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }

    // The seam, with a lit edge under it: two 1px lines is the whole reason a
    // plank looks thick instead of drawn on.
    if (py > 0) {
      c.fillStyle = Wood.seam;
      c.fillRect(0, py - 1, w, 1.4);
      c.fillStyle = `rgba(${hexRgb(Wood.light)},0.16)`;
      c.fillRect(0, py + 0.6, w, 1);
    }
  }

  // A knot or two. Cheap, and the one piece of detail that stops a panel from
  // looking like a repeating pattern.
  const knots = rand() < 0.55 ? 1 : rand() < 0.5 ? 2 : 0;
  for (let k = 0; k < knots; k++) {
    const kx = 20 + rand() * Math.max(1, w - 40);
    const ky = 12 + rand() * Math.max(1, h - 24);
    const kr = 4 + rand() * 7;
    for (let r = kr; r > 0.6; r -= 1.4) {
      c.strokeStyle = `rgba(${hexRgb(Wood.deep)},${0.1 + 0.24 * (r / kr)})`;
      c.lineWidth = 1.1;
      c.beginPath();
      c.ellipse(kx, ky, r, r * 0.62, 0.3, 0, Math.PI * 2);
      c.stroke();
    }
  }

  edgeShade(c, w, h, `rgba(${hexRgb(Wood.deep)},`, 0.5, 14);
}

/**
 * Aged paper.
 *
 * The blotches do the work. Flat parchment colour looks like beige plastic; what
 * makes paper is that no two square inches of it are the same value.
 */
function paintParchment(c, w, h) {
  const rand = makeRng(seedOf(w, h, 3)).next;
  c.fillStyle = Parch.base;
  c.fillRect(0, 0, w, h);

  const stains = Math.round(14 + (w * h) / 5200);
  for (let i = 0; i < stains; i++) {
    const sx = rand() * w;
    const sy = rand() * h;
    const sr = 12 + rand() * Math.max(24, Math.min(w, h) * 0.5);
    const dark = rand() < 0.62;
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, sr);
    const col = dark ? Parch.stain : Parch.light;
    g.addColorStop(0, `rgba(${hexRgb(col)},${dark ? 0.1 + rand() * 0.1 : 0.14 + rand() * 0.12})`);
    g.addColorStop(1, `rgba(${hexRgb(col)},0)`);
    c.fillStyle = g;
    c.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }

  // Fibre. Single pixels, because anything larger reads as dust on the screen
  // rather than as tooth in the paper.
  const flecks = Math.round((w * h) / 900);
  for (let i = 0; i < flecks; i++) {
    c.fillStyle = rand() < 0.5
      ? `rgba(${hexRgb(Parch.stain)},${0.1 + rand() * 0.22})`
      : `rgba(255,252,240,${0.06 + rand() * 0.16})`;
    c.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 1);
  }

  edgeShade(c, w, h, `rgba(${hexRgb(Parch.stain)},`, 0.42, 18);
}

/** Darken all four edges inward. Paper foxes at the edges and wood wears there. */
function edgeShade(c, w, h, rgbaPrefix, strength, depth) {
  const sides = [
    [0, 0, depth, 0, w, h],
    [w, 0, w - depth, 0, w, h],
    [0, 0, 0, depth, w, h],
    [0, h, 0, h - depth, w, h],
  ];
  for (const [x0, y0, x1, y1] of sides) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `${rgbaPrefix}${strength})`);
    g.addColorStop(1, `${rgbaPrefix}0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** `#rrggbb` plus an alpha, since every wash and tint here needs one. */
export function withAlpha(hex, a) {
  return hex.startsWith('#') ? `rgba(${hexRgb(hex)},${a})` : hex;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Nearly square. Two pixels of radius, not six.
 *
 * A carved panel has arrises, not fillets; the small radius exists only so the
 * heavy contour line does not spike at the corners.
 */
export function carvedRect(ctx, x, y, w, h, r = 2) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * A hand-cut edge: the rectangle with a small seeded wobble along each side.
 *
 * Deterministic from the size, like the textures, so a document does not
 * writhe while the player reads it.
 */
export function deckledRect(ctx, x, y, w, h, amp = 1.8) {
  const rand = makeRng(seedOf(w, h, 7)).next;
  const step = 13;
  ctx.beginPath();
  const jag = () => (rand() - 0.5) * 2 * amp;
  ctx.moveTo(x, y);
  for (let px = x + step; px < x + w; px += step) ctx.lineTo(px, y + jag());
  ctx.lineTo(x + w, y);
  for (let py = y + step; py < y + h; py += step) ctx.lineTo(x + w + jag(), py);
  ctx.lineTo(x + w, y + h);
  for (let px = x + w - step; px > x; px -= step) ctx.lineTo(px, y + h + jag());
  ctx.lineTo(x, y + h);
  for (let py = y + h - step; py > y; py -= step) ctx.lineTo(x + jag(), py);
  ctx.closePath();
}

/**
 * Close a form with ink.
 *
 * Drawn as two passes: a heavy outer contour and a lighter inner line just
 * inside it. One line looks like a border; two look like a brush that pressed
 * harder on the outside of the curve.
 */
export function inkContour(ctx, pathFn, opts = {}) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  pathFn();
  ctx.strokeStyle = opts.color || Ink.line;
  ctx.lineWidth = opts.width ?? 2.6;
  ctx.stroke();
  if (opts.inner !== false) {
    ctx.strokeStyle = opts.innerColor || `rgba(${hexRgb(Wood.light)},0.3)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fittings
// ---------------------------------------------------------------------------

/**
 * A brass rivet: lit from the upper left, like everything else.
 *
 * Three arcs and a dot. At the sizes it is used, anything more elaborate is
 * invisible, and anything less reads as a smudge.
 */
export function rivet(ctx, cx, cy, r = 3) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = Brass.base;
  ctx.fill();
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - r * 0.22, cy - r * 0.26, r * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = Brass.hi;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = `rgba(${hexRgb(Brass.dark)},0.8)`;
  ctx.stroke();
}

/**
 * An iron corner brace: two arms, a mitred corner, one barb, one pin.
 *
 * The first version of this had a proper volute -- a curl of about two thirds the
 * bracket's width. At the 11px the panels actually use, a curl that size reads as
 * a *letter* sitting in the corner rather than as a fitting, and a screen with six
 * panels on it looked annotated. So the ornament is now the arms, and the only
 * flourish is a short diagonal barb across the mitre.
 *
 * `sx`/`sy` of 1 draw the top-left orientation; flip them for the other three
 * corners, which is why the whole thing is built around the origin.
 */
export function bracket(ctx, x, y, size, sx = 1, sy = 1, opts = {}) {
  const arm = opts.arm ?? size * 1.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  const draw = () => {
    ctx.beginPath();
    ctx.moveTo(arm, 0);
    ctx.lineTo(size * 0.3, 0);
    ctx.lineTo(0, size * 0.3);
    ctx.lineTo(0, arm);
    // The barb: a single short diagonal across the mitre, which is enough to say
    // "forged" without saying anything else.
    ctx.moveTo(size * 0.42, size * 0.18);
    ctx.lineTo(size * 0.18, size * 0.42);
  };

  draw();
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 2.8;
  ctx.stroke();
  draw();
  ctx.strokeStyle = opts.color || Brass.base;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
}

/**
 * A divider: two thin brass lines with a lozenge at the centre.
 *
 * Used instead of a 1px grey rule anywhere a section needs separating, because
 * a plain rule is the one detail that would give the whole interface away.
 */
export function brassRule(ctx, x, y, w, opts = {}) {
  const col = opts.color || Brass.base;
  const cx = x + w / 2;
  const gap = opts.gap ?? 2.2;
  ctx.save();
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(cx - 7, y);
  ctx.moveTo(cx + 7, y); ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  for (const dy of [-gap / 2, gap / 2]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy); ctx.lineTo(cx - 7, y + dy);
    ctx.moveTo(cx + 7, y + dy); ctx.lineTo(x + w, y + dy);
    ctx.stroke();
  }
  // The lozenge.
  ctx.beginPath();
  ctx.moveTo(cx, y - 4); ctx.lineTo(cx + 4.5, y); ctx.lineTo(cx, y + 4); ctx.lineTo(cx - 4.5, y);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

/** A brass plate, for anything that has to look screwed on. */
export function brassPlate(ctx, x, y, w, h, opts = {}) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, opts.hi || Brass.hi);
  g.addColorStop(0.45, opts.base || Brass.base);
  g.addColorStop(1, opts.dark || Brass.dark);
  ctx.fillStyle = g;
  carvedRect(ctx, x, y, w, h, opts.radius ?? 2);
  ctx.fill();
  inkContour(ctx, () => carvedRect(ctx, x, y, w, h, opts.radius ?? 2), { width: 2, inner: false });
  if (opts.rivets !== false && w > 26 && h > 14) {
    for (const rx of [x + 5, x + w - 5]) for (const ry of [y + 5, y + h - 5]) rivet(ctx, rx, ry, 2.2);
  }
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * The default panel: a stained plank surface, inked, with brass at the corners.
 *
 * @param {object} [opts]
 *   `tint`      colour blended over the wood, for panels that carry a status
 *   `brackets`  false to leave the corners bare (small panels have no room)
 *   `title`     drawn as a plaque heading with a brass rule under it
 *   `raise`     drop shadow depth; 0 for something flush with the backdrop
 */
export function woodPanel(ctx, x, y, w, h, opts = {}) {
  const r = opts.radius ?? 2;
  const path = () => carvedRect(ctx, x, y, w, h, r);

  if (opts.raise !== 0) {
    ctx.save();
    ctx.shadowColor = Ink.shadow;
    ctx.shadowBlur = opts.raise ?? 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = Wood.base;
    path();
    ctx.fill();
    ctx.restore();
  }

  const tex = texture(`wood:${Math.round(w)}x${Math.round(h)}`, w, h, paintWood);
  ctx.save();
  path();
  ctx.clip();
  if (tex) ctx.drawImage(tex, x, y);
  else { ctx.fillStyle = Wood.base; ctx.fillRect(x, y, w, h); }
  if (opts.tint) {
    ctx.fillStyle = opts.tint;
    ctx.fillRect(x, y, w, h);
  }
  // Bevel: lit along the top-left arris, shadowed along the bottom-right.
  ctx.fillStyle = 'rgba(255,226,180,0.11)';
  ctx.fillRect(x, y, w, 1.5);
  ctx.fillRect(x, y, 1.5, h);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(x, y + h - 1.5, w, 1.5);
  ctx.fillRect(x + w - 1.5, y, 1.5, h);
  ctx.restore();

  inkContour(ctx, path, { width: opts.contour ?? 2.6, inner: false });

  if (opts.brackets !== false && w > 60 && h > 46) {
    const s = opts.bracketSize ?? 11;
    const i = 4;
    bracket(ctx, x + i, y + i, s, 1, 1);
    bracket(ctx, x + w - i, y + i, s, -1, 1);
    bracket(ctx, x + i, y + h - i, s, 1, -1);
    bracket(ctx, x + w - i, y + h - i, s, -1, -1);
  }

  if (opts.title) {
    const ty = y + 11;
    tracked(ctx, String(opts.title).toUpperCase(), x + 15, ty, {
      font: Theme.display(11.5, 700),
      color: opts.titleColor || Brass.hi,
      spacing: 1.6,
      baseline: 'top',
      shadow: true,
    });
    brassRule(ctx, x + 15, ty + 19, w - 30);
  }
}

/**
 * A document: hand-cut paper, dark ink, shadowed off the surface below.
 *
 * Reserved for things the player reads as *written* -- tooltips, objectives,
 * the log. Using it for structure as well would flatten the distinction that
 * makes it worth having.
 */
export function parchmentCard(ctx, x, y, w, h, opts = {}) {
  const path = () => (opts.deckle === false
    ? carvedRect(ctx, x, y, w, h, 1)
    : deckledRect(ctx, x, y, w, h, opts.amp ?? 1.6));

  ctx.save();
  ctx.shadowColor = 'rgba(4,3,2,0.6)';
  ctx.shadowBlur = opts.raise ?? 9;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = Parch.base;
  path();
  ctx.fill();
  ctx.restore();

  const tex = texture(`parch:${Math.round(w)}x${Math.round(h)}`, w, h, paintParchment);
  ctx.save();
  path();
  ctx.clip();
  if (tex) ctx.drawImage(tex, x, y);
  else { ctx.fillStyle = Parch.base; ctx.fillRect(x, y, w, h); }
  if (opts.tint) { ctx.fillStyle = opts.tint; ctx.fillRect(x, y, w, h); }
  ctx.restore();

  inkContour(ctx, path, { width: 1.4, inner: false, color: `rgba(${hexRgb(Parch.stain)},0.85)` });

  if (opts.title) {
    tracked(ctx, String(opts.title).toUpperCase(), x + 12, y + 10, {
      font: Theme.display(11, 700),
      color: Parch.ink,
      spacing: 1.5,
      baseline: 'top',
    });
    ctx.strokeStyle = `rgba(${hexRgb(Parch.stain)},0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 27.5);
    ctx.lineTo(x + w - 12, y + 27.5);
    ctx.stroke();
  }
}

/**
 * The backdrop every screen sits on: dark boards, then a candle vignette.
 *
 * Drawn as one cached image rather than composed per frame -- it never changes,
 * and it covers the entire viewport.
 */
export function backdrop(ctx, w, h) {
  const tex = texture(`backdrop:${w}x${h}`, w, h, (c, cw, ch) => {
    c.fillStyle = Theme.bgDeep;
    c.fillRect(0, 0, cw, ch);
    const rand = makeRng(11).next;
    // Boards, much darker and coarser than a panel: this is the wall behind
    // everything, and it has to lose to whatever is in front of it.
    const plank = 58;
    for (let py = 0; py < ch; py += plank) {
      c.fillStyle = mix(Theme.bgDeep, Wood.deep, 0.3 + rand() * 0.5);
      c.fillRect(0, py, cw, plank);
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(0, py, cw, 1.4);
      for (let i = 0; i < 9; i++) {
        const gy = py + 4 + rand() * (plank - 8);
        c.strokeStyle = `rgba(${hexRgb(Wood.mid)},${0.05 + rand() * 0.08})`;
        c.lineWidth = 1;
        c.beginPath();
        for (let x = 0; x <= cw; x += 10) {
          c.lineTo(x, gy + Math.sin(x / 90 + i) * 1.4);
        }
        c.stroke();
      }
    }
    paintVignette(c, cw, ch, 0.82);
  });
  if (tex) ctx.drawImage(tex, 0, 0);
  else { ctx.fillStyle = Theme.bg; ctx.fillRect(0, 0, w, h); }
}

function paintVignette(c, w, h, strength) {
  const g = c.createRadialGradient(w * 0.42, h * 0.4, Math.min(w, h) * 0.16, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, `rgba(6,4,3,${strength * 0.34})`);
  g.addColorStop(1, `rgba(3,2,1,${strength})`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/**
 * Candlelight falloff over the finished frame.
 *
 * Applied last, over everything including the world view, so the whole screen
 * agrees it is being lit rather than displayed. Off-centre and up, because a
 * lamp hangs above and to the left.
 */
export function vignette(ctx, w, h, strength = 0.55) {
  const tex = texture(`vig:${w}x${h}:${strength}`, w, h, (c, cw, ch) => paintVignette(c, cw, ch, strength));
  if (tex) ctx.drawImage(tex, 0, 0);
}

// ---------------------------------------------------------------------------
// Portraits
// ---------------------------------------------------------------------------

/**
 * How hard the frame grades what is inside it.
 *
 * The ten portraits were painted separately and measured all over the place --
 * warmth from -23 (teal alley) to +12 (khaki bunker), against an interface that
 * sits at +23. Hung raw they read as ten pictures rather than as one roster.
 *
 * The frame therefore does what a frame in a lamplit room does: it puts every
 * face under the same light. A warm wash pulls the set toward each other and
 * toward the wood, and an inner vignette drops the corners so the head is what
 * survives. Both are cheap composites rather than `ctx.filter`, which not every
 * browser honours -- a grade that silently does nothing on some machines is
 * worse than a slightly weaker one everywhere.
 */
export const PORTRAIT_GRADE = { wash: 0.17, vignette: 0.55, saturate: 0.68 };

/**
 * A framed portrait: brass-cornered aperture, graded, cropped to fill.
 *
 * `crop` of 0 shows the whole square as painted; higher values push in toward
 * the head, which is what the small placements want -- at 40 pixels a full
 * upper body is a smudge, and the face is the only part carrying information.
 *
 * Draws the empty frame when the image has not arrived, so a slot never pops
 * into existence and the layout is the same either way.
 */
export function portraitFrame(ctx, img, x, y, w, h, opts = {}) {
  const r = opts.radius ?? 2;
  const path = () => carvedRect(ctx, x, y, w, h, r);

  // The aperture is a hole in the panel, so it is dark before anything fills it.
  ctx.fillStyle = '#0d0906';
  path();
  ctx.fill();

  if (img) {
    ctx.save();
    path();
    ctx.clip();

    // Cover, biased upward: a head sits in the top third of every one of these,
    // so centring the crop vertically would cut it off to show a torso.
    const crop = clamp(opts.crop ?? 0, 0, 0.6);
    const src = img.width * (1 - crop);
    const sx = (img.width - src) / 2;
    const sy = (img.height - src) * (opts.anchor ?? 0.12);
    const scale = Math.max(w / src, h / src);
    const dw = src * scale;
    const dh = src * scale;

    const grade = opts.grade ?? 1;
    // Pulled toward grey before the wash goes on. The wash alone is a uniform
    // shift, so it moves the whole set without closing the gaps inside it --
    // measured, it took the mean from -3 to +20 and the spread only from 38 to
    // 29, leaving two teal portraits still reading as visitors. Desaturation is
    // the part that actually converges them, because it scales each one's
    // distance from neutral rather than adding the same amount to all of them.
    //
    // `ctx.filter` is not universal. An engine that ignores it still gets the
    // wash and the vignette, so the grade degrades to weaker rather than absent.
    if (grade > 0 && PORTRAIT_GRADE.saturate < 1) {
      ctx.filter = `saturate(${PORTRAIT_GRADE.saturate})`;
    }
    ctx.drawImage(img, sx, sy, src, src, x + (w - dw) / 2, y, dw, dh);
    ctx.filter = 'none';

    if (grade > 0) {
      ctx.fillStyle = withAlpha('#e8a552', PORTRAIT_GRADE.wash * grade);
      ctx.fillRect(x, y, w, h);
      const v = ctx.createRadialGradient(
        x + w / 2, y + h * 0.42, Math.min(w, h) * 0.2,
        x + w / 2, y + h * 0.5, Math.max(w, h) * 0.72,
      );
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(8,5,3,${PORTRAIT_GRADE.vignette * grade})`);
      ctx.fillStyle = v;
      ctx.fillRect(x, y, w, h);
    }
    if (opts.tint) {
      ctx.fillStyle = opts.tint;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  // Glass: a single diagonal highlight, so the aperture reads as covered.
  if (opts.glass !== false && w > 40) {
    ctx.save();
    path();
    ctx.clip();
    const gl = ctx.createLinearGradient(x, y, x + w * 0.8, y + h);
    gl.addColorStop(0, 'rgba(255,240,214,0.09)');
    gl.addColorStop(0.4, 'rgba(255,240,214,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  inkContour(ctx, path, {
    width: opts.contour ?? 2.2,
    inner: false,
    color: opts.frameColor || Ink.line,
  });
  // A thin brass lip just inside the ink, which is what makes it a frame rather
  // than a cut-out. Skipped when small: at 40px it would be most of the picture.
  if (w > 34) {
    ctx.strokeStyle = withAlpha(opts.frameColor || Brass.base, 0.7);
    ctx.lineWidth = 1;
    carvedRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1));
    ctx.stroke();
  }
  if (opts.brackets !== false && w >= 96) {
    const s = 9;
    bracket(ctx, x + 3, y + 3, s, 1, 1);
    bracket(ctx, x + w - 3, y + 3, s, -1, 1);
    bracket(ctx, x + 3, y + h - 3, s, 1, -1);
    bracket(ctx, x + w - 3, y + h - 3, s, -1, -1);
  }
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * Letterspaced text.
 *
 * Drawn a glyph at a time. `ctx.letterSpacing` exists in current Chromium but
 * not everywhere, and silently doing nothing is worse than being slow: tracking
 * is doing real work in this design, not decorating it.
 *
 * @returns {number} the width drawn, so callers can lay out after it
 */
export function tracked(ctx, text, x, y, opts = {}) {
  const s = String(text);
  const spacing = opts.spacing ?? 1.5;
  ctx.save();
  ctx.font = opts.font || Theme.display(13, 700);
  ctx.textBaseline = opts.baseline || 'top';
  ctx.textAlign = 'left';
  const w = trackedWidth(ctx, s, spacing);
  let cx = x;
  if (opts.align === 'center') cx = x - w / 2;
  else if (opts.align === 'right') cx = x - w;
  if (opts.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
  }
  ctx.fillStyle = opts.color || Theme.text;
  for (const ch of s) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.restore();
  return w;
}

/** Width `tracked` would draw, with the font already set on the context. */
export function trackedWidth(ctx, text, spacing = 1.5) {
  const s = String(text);
  if (!s.length) return 0;
  let w = 0;
  for (const ch of s) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}

/**
 * A heading, cut into the surface.
 *
 * Two passes offset by a pixel: a dark one down-right and the light one on top.
 * That is the cheapest possible engraving, and at heading sizes it is enough.
 */
export function engraved(ctx, text, x, y, opts = {}) {
  const font = opts.font || Theme.display(opts.size || 22, 700);
  const spacing = opts.spacing ?? 2.4;
  const base = { font, spacing, align: opts.align, baseline: opts.baseline || 'top' };
  tracked(ctx, text, x + 1, y + 1.5, { ...base, color: opts.shadowColor || 'rgba(0,0,0,0.7)' });
  return tracked(ctx, text, x, y, { ...base, color: opts.color || Brass.hi });
}

/**
 * A stamped label on a brass plate. For the one heading per screen that has to
 * be the loudest thing on it.
 */
export function titlePlate(ctx, text, x, y, opts = {}) {
  const size = opts.size || 20;
  ctx.font = Theme.display(size, 700);
  const spacing = opts.spacing ?? 2.6;
  const tw = trackedWidth(ctx, String(text).toUpperCase(), spacing);
  const padX = opts.padX ?? 18;
  const h = opts.height ?? size + 18;
  const w = tw + padX * 2;
  const px = opts.align === 'center' ? x - w / 2 : x;
  brassPlate(ctx, px, y, w, h, { rivets: opts.rivets });
  tracked(ctx, String(text).toUpperCase(), px + padX, y + h / 2, {
    font: Theme.display(size, 700),
    color: opts.color || '#2a1c08',
    spacing,
    baseline: 'middle',
  });
  return { w, h };
}

// ---------------------------------------------------------------------------
// Wear
// ---------------------------------------------------------------------------

/**
 * Scratches and chips over a finished surface.
 *
 * Optional and used sparingly. A little wear sells a material; wear everywhere
 * just lowers contrast across the whole screen.
 */
export function wear(ctx, x, y, w, h, amount = 1) {
  const rand = makeRng(seedOf(w, h, 13)).next;
  ctx.save();
  carvedRect(ctx, x, y, w, h, 2);
  ctx.clip();
  const n = Math.round(6 * amount);
  for (let i = 0; i < n; i++) {
    const sx = x + rand() * w;
    const sy = y + rand() * h;
    const len = 4 + rand() * 22;
    const a = rand() * Math.PI;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(255,226,180,0.12)';
    ctx.lineWidth = rand() < 0.7 ? 1 : 1.8;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** A status wash for a panel: `tint` values that stay in the material's range. */
export const Wash = {
  good: `rgba(${hexRgb(Theme.good)},0.13)`,
  bad: `rgba(${hexRgb(Theme.bad)},0.15)`,
  warn: `rgba(${hexRgb(Theme.warn)},0.12)`,
  accent: `rgba(${hexRgb(Theme.accent)},0.11)`,
  dead: 'rgba(0,0,0,0.4)',
};

/** Exposed for tests: the derived colours the widgets rely on. */
export const Derived = {
  buttonFace: shadeHex(Wood.mid, 6),
  buttonHot: shadeHex(Wood.light, 10),
};

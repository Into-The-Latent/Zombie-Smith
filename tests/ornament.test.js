// The carved-and-printed interface.
//
// "Does this look intentional?" is otherwise a matter of opinion, so the parts
// of the art direction that *are* numbers get asserted here: the interface is
// warm and the street is cold, ink is darker than everything it closes, paper
// is light enough to take dark ink, and the procedural surfaces are stable
// frame to frame rather than seething.

import { describe, test, assert, equal, close } from './harness.js';
import { Theme, Ink, Wood, Parch, Brass } from '../src/ui/theme.js';
import { Base, SITE_PALETTE, sitePalette } from '../src/ui/palette.js';
import {
  withAlpha, trackedWidth, deckledRect, carvedRect, textureCount, woodPanel,
  parchmentCard, backdrop, vignette, tracked, engraved, bracket, rivet, brassRule,
} from '../src/ui/ornament.js';

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
/** Positive is warm (red over blue), negative is cold. */
const temp = (hex) => {
  const c = rgb(hex);
  return c.r - c.b;
};
const lum = (hex) => {
  const c = rgb(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
/** WCAG-style contrast ratio, for "can this text be read on this surface". */
const contrast = (a, b) => {
  const f = (hex) => {
    const c = rgb(hex);
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  };
  const [hi, lo] = [f(a), f(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * A canvas context that records instead of drawing.
 *
 * Enough of the 2D API for the ornament module to run headless, which is the
 * only way to assert that a procedural surface is deterministic.
 */
function recordingCtx() {
  const calls = [];
  const path = [];
  const stub = new Proxy({
    calls,
    path,
    canvas: { width: 1280, height: 720 },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    measureText: (t) => ({ width: String(t).length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    moveTo: (x, y) => path.push(['M', x, y]),
    lineTo: (x, y) => path.push(['L', x, y]),
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Everything else is a no-op that logs it was reached.
      return (...args) => { calls.push([prop, ...args]); };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return stub;
}

describe('the interface palette', () => {
  test('the workshop is warm and the street is cold', () => {
    // The whole reason the two halves of the game are told apart before a word
    // is read. Asserted as a measurement rather than trusted to a comment.
    const uiWarm = [Wood.deep, Wood.base, Wood.mid, Wood.light, Parch.base, Brass.base]
      .map(temp);
    const worldCold = [Base.steelDark, Base.steel, Base.steelLight].map(temp);

    assert(uiWarm.every((t) => t > 12),
      `every interface material must read warm, got ${uiWarm.join(', ')}`);
    assert(worldCold.every((t) => t < 0),
      `every structural world colour must read cold, got ${worldCold.join(', ')}`);

    const uiMean = uiWarm.reduce((a, b) => a + b, 0) / uiWarm.length;
    const worldMean = worldCold.reduce((a, b) => a + b, 0) / worldCold.length;
    assert(uiMean - worldMean > 60,
      `the two halves have to be separated by temperature, gap was ${(uiMean - worldMean).toFixed(0)}`);
  });

  test('every site floor still reads cold, so the split survives per-site tinting', () => {
    // The warm sites (warehouse ochre, garage rust) are the risk: if the tint
    // pushes a floor warmer than the interface, the street stops being the cold
    // half on exactly the maps where the fiction needs it most.
    for (const key of Object.keys(SITE_PALETTE)) {
      const floor = sitePalette(key).floor;
      assert(temp(floor) < temp(Wood.base),
        `${key} floor (${floor}) must stay cooler than the workshop's own wood`);
    }
  });

  test('wood is ordered, so a bevel and a recess cannot invert', () => {
    const order = [Wood.seam, Wood.deep, Wood.base, Wood.mid, Wood.light].map(lum);
    for (let i = 1; i < order.length; i++) {
      assert(order[i] > order[i - 1],
        `wood tones must climb; ${order.map((v) => v.toFixed(1)).join(' < ')}`);
    }
  });

  test('ink is darker than anything it closes', () => {
    const closed = [Wood.deep, Wood.base, Wood.mid, Wood.light, Parch.base, Parch.dark,
      Brass.base, Brass.dark, Theme.bg];
    for (const hex of closed) {
      assert(lum(Ink.line) < lum(hex),
        `ink (${Ink.line}) must be darker than ${hex} or the contour disappears`);
    }
  });

  test('text is readable on the surface it is drawn on', () => {
    // Bone on wood, and iron-gall on paper. Both are real reading surfaces, so
    // both get a real threshold rather than a glance.
    assert(contrast(Theme.text, Wood.base) > 7,
      `body text on wood measured ${contrast(Theme.text, Wood.base).toFixed(1)}:1`);
    assert(contrast(Parch.ink, Parch.base) > 7,
      `ink on paper measured ${contrast(Parch.ink, Parch.base).toFixed(1)}:1`);
    // Dimmed text still has to clear the ordinary reading bar.
    assert(contrast(Theme.textDim, Wood.base) > 3,
      `dim text on wood measured ${contrast(Theme.textDim, Wood.base).toFixed(1)}:1`);
    assert(contrast(Parch.inkDim, Parch.base) > 3,
      `dim ink on paper measured ${contrast(Parch.inkDim, Parch.base).toFixed(1)}:1`);
  });

  test('brass is the brightest fitting, so the eye goes to the thing to press', () => {
    assert(lum(Brass.hi) > lum(Theme.text) * 0.72,
      'brass highlight has to compete with bone text');
    assert(lum(Brass.hi) > lum(Wood.light) * 2,
      'and stand well clear of the wood it is screwed to');
  });

  test('paper is lighter than wood, so a document reads as laid on top', () => {
    assert(lum(Parch.dark) > lum(Wood.light) * 2.2,
      'even the shadowed side of paper outranks the brightest wood');
  });
});

describe('the ornament toolkit', () => {
  test('it imports and runs headless, which is what makes any of this testable', () => {
    // No `document` in Node. Every surface must degrade to a flat fill rather
    // than throwing, or the module could never be covered at all.
    equal(typeof document, 'undefined', 'this test is only meaningful without a DOM');
    const ctx = recordingCtx();
    woodPanel(ctx, 10, 10, 200, 120, { title: 'Group' });
    parchmentCard(ctx, 10, 10, 200, 120, { title: 'Notes' });
    backdrop(ctx, 1280, 720);
    vignette(ctx, 1280, 720);
    bracket(ctx, 4, 4, 11);
    rivet(ctx, 20, 20, 3);
    brassRule(ctx, 10, 40, 120);
    equal(textureCount(), 0, 'and nothing is cached, because nothing could be made');
    assert(ctx.calls.length > 0, 'but it still drew something');
  });

  test('a hand-cut edge is the same edge every frame', () => {
    // Seeded from the size. Re-rolling per frame is the single most obvious way
    // procedural texture gives itself away: the paper would writhe while read.
    const a = recordingCtx();
    const b = recordingCtx();
    deckledRect(a, 40, 40, 220, 90);
    deckledRect(b, 40, 40, 220, 90);
    equal(JSON.stringify(a.path), JSON.stringify(b.path),
      'same size, same edge');
    assert(a.path.length > 20, 'and it is actually jagged, not a rectangle');

    const c = recordingCtx();
    deckledRect(c, 40, 40, 221, 90);
    assert(JSON.stringify(c.path) !== JSON.stringify(a.path),
      'a different size gets a different cut');
  });

  test('a carved rect is nearly square, because the interface is carved', () => {
    // Guards the one shape that would give the whole thing away: a 6px fillet.
    const ctx = recordingCtx();
    carvedRect(ctx, 0, 0, 100, 40);
    const arcs = ctx.calls.filter((c) => c[0] === 'arcTo');
    equal(arcs.length, 4);
    for (const a of arcs) {
      const r = a[a.length - 1];
      assert(r <= 2, `corner radius must stay carved, got ${r}`);
    }
  });

  test('tracking is measured, not assumed', () => {
    const ctx = recordingCtx();
    // The stub measures 7px a character, so the arithmetic is checkable: five
    // glyphs and four gaps.
    close(trackedWidth(ctx, 'FORGE', 2), 5 * 7 + 4 * 2, 1e-9);
    equal(trackedWidth(ctx, '', 2), 0, 'and an empty string takes no room');
    equal(trackedWidth(ctx, 'X', 2), 7, 'one glyph has no gap after it');
  });

  test('tracked text reports the width it actually drew', () => {
    const ctx = recordingCtx();
    const w = tracked(ctx, 'DAY 1', 10, 10, { spacing: 2 });
    close(w, 5 * 7 + 4 * 2, 1e-9, 'callers lay out after headings using this');
    const drawn = ctx.calls.filter((c) => c[0] === 'fillText');
    equal(drawn.length, 5, 'a glyph at a time, so the spacing is ours and not the browser\'s');
  });

  test('engraved type is drawn twice, which is the whole engraving', () => {
    const ctx = recordingCtx();
    engraved(ctx, 'ARMOURY', 40, 26);
    const drawn = ctx.calls.filter((c) => c[0] === 'fillText');
    equal(drawn.length, 'ARMOURY'.length * 2, 'a dark pass and a light one');
  });

  test('withAlpha builds rgba from hex and leaves anything else alone', () => {
    equal(withAlpha('#ffffff', 0.5), 'rgba(255,255,255,0.5)');
    equal(withAlpha('#000000', 1), 'rgba(0,0,0,1)');
    equal(withAlpha(Brass.base, 0.25), 'rgba(163,123,52,0.25)');
    equal(withAlpha('rgba(1,2,3,0.4)', 0.9), 'rgba(1,2,3,0.4)',
      'already-alpha colours pass straight through');
  });
});

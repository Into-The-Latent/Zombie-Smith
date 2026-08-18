// The one box.
//
// There is no assertion that says a crate looks like a crate, but there is
// one that says every box on the floor is lit by the same sun -- which is
// exactly what went wrong when the shape was copy-pasted three times. The
// wall derived its faces from FACE_SHADE; the crate and the car had picked
// their own colours, and had them the wrong way round. Nothing on screen
// screamed about it, so it stood for months.

import { describe, test, assert, equal, close } from './harness.js';
import { boxFaces, boxShadow, isoBox, SHADOW_SLANT, UNIT_H } from '../src/run/box.js';
import { FACE_SHADE, Material, CAR_PAINT } from '../src/ui/palette.js';
import { TILE_W, TILE_H } from '../src/run/iso.js';

const rgb = (s) => s.match(/\d+/g).map(Number);
const lum = (s) => { const [r, g, b] = rgb(s); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/**
 * A canvas that remembers instead of drawing. Enough of the 2D context for
 * the geometry to be inspected without a browser.
 */
function recorder() {
  const shapes = [];
  let cur = null;
  return {
    shapes,
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    beginPath() { cur = { pts: [], fill: null, stroke: null }; },
    moveTo(x, y) { cur.pts.push([x, y]); },
    lineTo(x, y) { cur.pts.push([x, y]); },
    closePath() {},
    fill() { cur.fill = this.fillStyle; shapes.push(cur); },
    stroke() { if (cur) cur.stroke = this.strokeStyle; },
  };
}

describe('the faces of a box', () => {
  test('the left face catches the light and the right face is turned away', () => {
    // The whole point of the extraction. Crates and cars used to have this
    // backwards, so two boxes on one floor implied two suns.
    const f = boxFaces('#808080');
    assert(lum(f.left) > lum(f.right),
      `left ${lum(f.left).toFixed(1)} should be lighter than right ${lum(f.right).toFixed(1)}`);
    assert(lum(f.top) > lum(f.left), 'and the top is lit most of all');
  });

  test('every face is exactly its FACE_SHADE offset from the base', () => {
    const [r] = rgb(boxFaces('#808080').top);
    equal(r, 0x80 + FACE_SHADE.top);
    equal(rgb(boxFaces('#808080').left)[0], 0x80 + FACE_SHADE.left);
    equal(rgb(boxFaces('#808080').right)[0], 0x80 + FACE_SHADE.right);
  });

  test('a base colour dark enough to underflow is clamped, not wrapped', () => {
    // -46 on a #0a channel would go negative; a wrap would give a bright face
    // on the darkest surface in the game.
    const f = boxFaces('#0a0a0a');
    for (const c of rgb(f.right)) assert(c >= 0 && c <= 255, `channel out of range: ${c}`);
    assert(lum(f.right) < lum(f.top), 'and it is still the darkest face');
  });

  test('a top override replaces only the top', () => {
    // Walls do this: their lids carry more of the site tint than their sides.
    const f = boxFaces('#808080', { top: '#ffffff' });
    equal(f.top, '#ffffff');
    equal(f.left, boxFaces('#808080').left);
  });

  test('tone shifts all three faces together', () => {
    const base = boxFaces('#808080');
    const up = boxFaces('#808080', { tone: 20 });
    for (const k of ['top', 'left', 'right']) {
      equal(rgb(up[k])[0] - rgb(base[k])[0], 20, `${k} did not move with the tone`);
    }
  });

  test('the materials and car paints all resolve', () => {
    for (const [name, hex] of Object.entries(Material)) {
      assert(/^#[0-9a-f]{6}$/i.test(hex), `${name} is not a hex colour`);
      assert(lum(boxFaces(hex).left) > lum(boxFaces(hex).right), `${name} is lit backwards`);
    }
    for (const hex of CAR_PAINT) assert(/^#[0-9a-f]{6}$/i.test(hex), `${hex} is not a hex colour`);
  });
});

describe('the shadow a box throws', () => {
  test('it runs down-right along the tile slope, like every other shadow', () => {
    // Shadows must all agree on where the sun is. The tile diamond is 2:1, so
    // a shadow that follows it lands parallel to the tile edges rather than
    // cutting across them.
    const ctx = recorder();
    boxShadow(ctx, 0, 0, 32, 16, UNIT_H);
    const core = ctx.shapes[ctx.shapes.length - 1];
    // Points are [left, top, far-right, far-bottom]; the far pair carries the
    // offset, the near pair does not.
    const [left, , farRight] = core.pts;
    const ox = farRight[0] - 32;
    const oy = farRight[1];
    close(ox / oy, TILE_W / TILE_H, 1e-9, 'the offset is not parallel to the tile slope');
    assert(ox > 0 && oy > 0, 'the shadow falls down-right, away from the light');
    equal(left[0], -32, 'and the near edge stays put under the box');
  });

  test('a taller box throws a longer shadow', () => {
    // The blob it replaced was one size for a car and for a toolbox.
    const reach = (h) => {
      const ctx = recorder();
      boxShadow(ctx, 0, 0, 32, 16, h);
      return ctx.shapes[ctx.shapes.length - 1].pts[2][0] - 32;
    };
    const short = reach(10);
    const tall = reach(40);
    assert(tall > short * 3.5, `${tall.toFixed(1)} should be about four times ${short.toFixed(1)}`);
    close(reach(UNIT_H), SHADOW_SLANT * (TILE_W / 2), 1e-9,
      'one grid-step of height should reach SHADOW_SLANT of a grid step');
  });

  test('it is two passes: a soft skirt under a darker core', () => {
    const ctx = recorder();
    boxShadow(ctx, 0, 0, 32, 16, 20);
    equal(ctx.shapes.length, 2);
    const [skirt, core] = ctx.shapes;
    assert(Number(skirt.fill.match(/[\d.]+\)$/)[0].slice(0, -1))
      < Number(core.fill.match(/[\d.]+\)$/)[0].slice(0, -1)), 'the skirt must be the fainter of the two');
    assert(Math.abs(skirt.pts[0][0]) > Math.abs(core.pts[0][0]), 'and the wider');
  });
});

describe('drawing one', () => {
  test('three quads: right, left, top', () => {
    const ctx = recorder();
    isoBox(ctx, 0, 0, 32, 16, 26, '#808080');
    equal(ctx.shapes.length, 3);
    for (const s of ctx.shapes) equal(s.pts.length, 4, 'every face is a quad');
  });

  test('a hidden face is not drawn at all', () => {
    // Walls in a run share seams; drawing them anyway painted the same pixels
    // twice at two alphas.
    const ctx = recorder();
    isoBox(ctx, 0, 0, 32, 16, 26, '#808080', { hideLeft: true, hideRight: true });
    equal(ctx.shapes.length, 1, 'only the top survives');
  });

  test('the box stands on its footprint, not through it', () => {
    // cy is ground level: the box goes up from there and nothing dips below
    // the near corner, or props would sink into the floor.
    const ctx = recorder();
    isoBox(ctx, 0, 0, 32, 16, 26, '#808080');
    const lowest = Math.max(...ctx.shapes.flatMap((s) => s.pts.map((p) => p[1])));
    equal(lowest, 16, 'the lowest point is the footprint diamond');
    const highest = Math.min(...ctx.shapes.flatMap((s) => s.pts.map((p) => p[1])));
    equal(highest, -42, 'and the highest is the far top corner');
  });
});

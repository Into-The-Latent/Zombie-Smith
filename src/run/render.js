// Isometric renderer. All art is procedural canvas drawing -- no assets.
//
// Draw order is painter's algorithm along the (x + y) diagonal: floors first
// (they are flat and occlude nothing), then every standing thing sorted back
// to front so walls correctly hide what is behind them.

import {
  TILE_W, TILE_H, WALL_H, project, tilePath, worldToScreen, screenToWorld,
  viewToGrid, depthOf,
} from './iso.js';
import { isoBox, boxShadow, dimBox } from './box.js';
import {
  tileAt, WALL, PROP, BLOCK, EXIT, ENTRY, VOID,
} from './map.js';
import { PROPS, PROP_KEYS, PROP_METRICS, propBoxes } from '../data/props.js';
import { CONTAINERS } from '../game/loot.js';
import { CLASSES } from '../data/progression.js';
import { ENEMIES } from '../data/enemies.js';
import { Theme } from '../ui/theme.js';
import { clamp } from '../core/util.js';
import {
  sitePalette, shade, LIGHT_DIR, Lighting, Material, CAR_PAINT,
} from '../ui/palette.js';

/** Palettes are derived once per site, not per frame. */
const paletteCache = new Map();
function paletteFor(site) {
  const key = site?.key || 'transit';
  if (!paletteCache.has(key)) paletteCache.set(key, sitePalette(key));
  return paletteCache.get(key);
}

const isSolid = (t) => t === WALL || t === VOID;

/**
 * Which way the light lies on the grid, at this camera rotation.
 *
 * The light is fixed to the *screen* -- FACE_SHADE is written in screen terms
 * ("the left face catches it") and a light that swung round with the world
 * would relight every surface as the camera turned. So the constant is a view
 * direction, and this puts it back on the grid to ask about neighbours.
 */
const lightDir = (rot) => viewToGrid(LIGHT_DIR.x, LIGHT_DIR.y, rot);

/**
 * How much of the light this floor tile loses to something standing between
 * it and the lamp. Walls throw a long shadow, and it falls along the light so
 * every shadow on screen agrees.
 */
function shadowAt(map, x, y, rot) {
  const { x: lx, y: ly } = lightDir(rot);
  let s = 0;
  if (isSolid(tileAt(map, x + lx, y + ly))) s = Math.max(s, 1);

  // A wall is tall enough to shadow the tile beyond its neighbour.
  if (isSolid(tileAt(map, x + lx * 2, y + ly * 2))) s = Math.max(s, 0.42);

  // Soften the edges so shadows are not a hard one-tile stripe.
  for (const off of [-1, 1]) {
    if (isSolid(tileAt(map, x + lx, y + ly + off))) s = Math.max(s, 0.34);
  }
  return s;
}

export function drawWorld(ctx, battle, view, cam, opts = {}) {
  const { map } = battle;
  const { x: vx, y: vy, w: vw, h: vh } = view;
  const t = opts.time || 0;
  const rot = cam.rot || 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(vx, vy, vw, vh);
  ctx.clip();

  // Sky / void behind the level.
  const g = ctx.createLinearGradient(0, vy, 0, vy + vh);
  g.addColorStop(0, '#0a0d12');
  g.addColorStop(1, '#05070a');
  ctx.fillStyle = g;
  ctx.fillRect(vx, vy, vw, vh);

  // A quarter turn is a different projection, not a rotation of the same one,
  // so it lands in one frame. What sells it as a turn rather than a jump is a
  // short screen-space swing afterwards: the world settles into place from the
  // side it came from. It decays inside a fifth of a second, which is under
  // the time it takes to move the mouse, so picking is never meaningfully out.
  ctx.save();
  if (cam.turn > 0) {
    const e = cam.turn * cam.turn;
    ctx.translate(vx + vw / 2, vy + vh / 2);
    ctx.rotate(e * 0.16 * cam.turnDir);
    ctx.scale(1 + e * 0.06, 1 + e * 0.06);
    ctx.translate(-(vx + vw / 2), -(vy + vh / 2));
  }

  const P = (gx, gy) => project(cam, gx, gy, vw, vh, vx, vy);

  // Cull to what can actually land on screen.
  const margin = 3;
  const margins = cam.turn > 0 ? 6 : 0; // the swing shows a little more world
  const corners = [
    unprojectCorner(cam, vx - margins, vy - margins, view),
    unprojectCorner(cam, vx + vw + margins, vy - margins, view),
    unprojectCorner(cam, vx - margins, vy + vh + margins, view),
    unprojectCorner(cam, vx + vw + margins, vy + vh + margins, view),
  ];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.gx); maxX = Math.max(maxX, c.gx);
    minY = Math.min(minY, c.gy); maxY = Math.max(maxY, c.gy);
  }
  minX = Math.max(0, Math.floor(minX) - margin);
  minY = Math.max(0, Math.floor(minY) - margin);
  maxX = Math.min(map.w - 1, Math.ceil(maxX) + margin);
  maxY = Math.min(map.h - 1, Math.ceil(maxY) + margin);

  // ---- floors -------------------------------------------------------------
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = tileAt(map, x, y);
      if (tile === VOID || tile === WALL) continue;
      const i = y * map.w + x;
      if (!battle.seen[i]) continue;
      const lit = battle.visible[i] === 1;
      const p = P(x, y);
      drawFloor(ctx, p.x, p.y, cam.zoom, map, x, y, tile, lit, t, rot);
    }
  }

  // Blood decals sit on top of the floor but under everything else.
  for (const d of map.decals) {
    const i = d.y * map.w + d.x;
    if (!battle.seen[i]) continue;
    const p = P(d.x, d.y);
    ctx.fillStyle = `rgba(90,20,18,${battle.visible[i] ? d.a : d.a * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, d.r * cam.zoom, d.r * 0.5 * cam.zoom, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Each survivor carries a light. Warm pools on the floor do more for the
  // mood than any amount of extra tile detail, and they make the squad's
  // reach legible at a glance.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const u of battle.units) {
    if (u.side !== 'player' || u.state === 'dead') continue;
    const ax = u.anim ? u.anim.x : u.x;
    const ay = u.anim ? u.anim.y : u.y;
    const p = P(ax, ay);
    const r = (u.sight * 0.4 + 2.5) * TILE_W * 0.34 * cam.zoom;
    const flicker = 0.9 + 0.1 * Math.sin(t * 3.1 + u.bob);
    const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g2.addColorStop(0, `rgba(255,186,110,${0.085 * flicker})`);
    g2.addColorStop(0.4, `rgba(210,140,80,${0.03 * flicker})`);
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ---- overlays painted onto the floor (range, path, targeting) -----------
  if (opts.overlay) opts.overlay(ctx, P, cam.zoom);

  // ---- standing things, back to front -------------------------------------
  const sprites = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * map.w + x;
      if (!battle.seen[i]) continue;
      const tile = tileAt(map, x, y);
      if (tile === WALL) sprites.push({ x, y, z: 0, kind: 'wall' });
      else if (tile === PROP || tile === BLOCK) sprites.push({ x, y, z: 1, kind: 'prop' });
    }
  }
  for (const c of map.containers) {
    const i = c.y * map.w + c.x;
    if (!battle.seen[i]) continue;
    sprites.push({ x: c.x, y: c.y, z: 2, kind: 'container', data: c });
  }
  for (const u of battle.units) {
    if (u.state === 'dead' && !u.corpseFade) continue;
    const ax = u.anim ? u.anim.x : u.x;
    const ay = u.anim ? u.anim.y : u.y;
    const i = Math.round(ay) * map.w + Math.round(ax);
    if (u.side === 'zombie' && battle.visible[i] !== 1) continue;
    sprites.push({ x: ax, y: ay, z: 3, kind: 'unit', data: u });
  }

  // Back to front along whichever diagonal is now the far one. This and the
  // projection must read the same rotation, or things pass through each other.
  sprites.sort((a, b) => depthOf(a.x, a.y, rot) - depthOf(b.x, b.y, rot) || a.z - b.z);

  for (const s of sprites) {
    const p = P(s.x, s.y);
    const i = Math.round(s.y) * map.w + Math.round(s.x);
    const lit = battle.visible[i] === 1;
    switch (s.kind) {
      case 'wall': drawWall(ctx, p.x, p.y, cam.zoom, map, s.x, s.y, lit, rot); break;
      case 'prop': drawProp(ctx, p.x, p.y, cam.zoom, map, s.x, s.y, lit, rot); break;
      case 'container': drawContainer(ctx, p.x, p.y, cam.zoom, s.data, lit, t); break;
      case 'unit': drawUnit(ctx, p.x, p.y, cam.zoom, s.data, t, battle, opts, rot); break;
    }
  }

  // ---- transient effects ---------------------------------------------------
  for (const ping of battle.noisePings) {
    const p = P(ping.x, ping.y);
    const a = 1 - ping.t;
    if (a <= 0) continue;
    ctx.strokeStyle = `rgba(232,163,61,${a * 0.5})`;
    ctx.lineWidth = 2;
    const rr = ping.r * ping.t;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rr * (TILE_W / 2) * cam.zoom, rr * (TILE_H / 2) * cam.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (opts.tracers) {
    for (const tr of opts.tracers) {
      const a = P(tr.from.x, tr.from.y);
      const b = P(tr.to.x, tr.to.y);
      const alpha = 1 - tr.t;
      ctx.strokeStyle = tr.hit ? `rgba(255,226,160,${alpha})` : `rgba(160,175,200,${alpha * 0.7})`;
      ctx.lineWidth = tr.hit ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 18 * cam.zoom);
      ctx.lineTo(b.x, b.y - 16 * cam.zoom);
      ctx.stroke();

      // Muzzle flash: brief, bright, and gone.
      if (tr.t < 0.3) {
        const f = 1 - tr.t / 0.3;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fg = ctx.createRadialGradient(a.x, a.y - 18 * cam.zoom, 0, a.x, a.y - 18 * cam.zoom, 34 * f * cam.zoom);
        fg.addColorStop(0, `rgba(255,236,180,${0.85 * f})`);
        fg.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(a.x, a.y - 18 * cam.zoom, 34 * f * cam.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  for (const f of battle.floaters) {
    const p = P(f.x, f.y);
    const a = clamp(1 - f.t / f.life, 0, 1);
    ctx.font = Theme.font(f.size || 15, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const yy = p.y - 34 * cam.zoom - f.t * 34;
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(0,0,0,${a * 0.8})`;
    ctx.strokeText(f.text, p.x, yy);
    ctx.fillStyle = f.color.replace('ALPHA', a.toFixed(2));
    ctx.fillText(f.text, p.x, yy);
  }

  ctx.restore(); // end of the swing: the air and the grain are screen-fixed

  // A faint colour cast per site, so each location has its own air.
  const pal = paletteFor(map.site);
  ctx.fillStyle = pal.haze;
  ctx.fillRect(vx, vy, vw, vh);

  // Film grain. Cheap, and it stops large flat areas reading as vector fills.
  drawGrain(ctx, vx, vy, vw, vh, t);

  // Vignette last: pulls the eye to the middle and hides the cull boundary.
  const vig = ctx.createRadialGradient(
    vx + vw / 2, vy + vh * 0.45, Math.min(vw, vh) * 0.34,
    vx + vw / 2, vy + vh * 0.45, Math.max(vw, vh) * 0.78,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(vx, vy, vw, vh);

  ctx.restore();
}

/**
 * Screen-space grain, drawn from a small tiled pattern so it costs one fill
 * rather than thousands of rects. The pattern is built once and shifted each
 * frame, which reads as grain moving without the cost of regenerating it.
 */
let grainPattern = null;
function drawGrain(ctx, vx, vy, vw, vh, t) {
  if (!grainPattern) {
    const size = 96;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 12;
    }
    g.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(c, 'repeat');
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  // Jump by whole pixels each frame so it flickers like film, not like noise.
  const jx = Math.floor(t * 24) % 96;
  const jy = Math.floor(t * 17) % 96;
  ctx.translate(-jx, -jy);
  ctx.fillStyle = grainPattern;
  ctx.fillRect(vx, vy, vw + 96, vh + 96);
  ctx.restore();
}

function unprojectCorner(cam, px, py, view) {
  const sx = (px - view.x - view.w / 2) / cam.zoom + cam.x;
  const sy = (py - view.y - view.h / 2) / cam.zoom + cam.y;
  return screenToWorld(sx, sy, cam.rot || 0);
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function drawFloor(ctx, cx, cy, zoom, map, x, y, tile, lit, t, rot) {
  const pal = paletteFor(map.site);
  let base = (x + y) % 2 === 0 ? pal.floor : pal.floorAlt;

  if (tile === EXIT || tile === ENTRY) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + (tile === EXIT ? 0 : Math.PI));
    base = tile === EXIT ? '#2c4a35' : '#3a3a4e';
    tilePath(ctx, cx, cy, zoom);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = tile === EXIT
      ? `rgba(79,180,119,${0.45 + pulse * 0.45})`
      : `rgba(120,140,190,${0.3 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!lit) {
      tilePath(ctx, cx, cy, zoom);
      ctx.fillStyle = 'rgba(6,9,14,0.55)';
      ctx.fill();
    }
    return;
  }

  tilePath(ctx, cx, cy, zoom);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Surface marks appropriate to the material, rather than generic noise.
  if (zoom > 0.62) drawSurface(ctx, cx, cy, zoom, x, y, pal);

  // Contact shading where the floor meets geometry.
  const walls = countAdjacentSolid(map, x, y);
  if (walls > 0) {
    tilePath(ctx, cx, cy, zoom);
    ctx.fillStyle = `rgba(4,7,11,${Math.min(0.24, walls * 0.06)})`;
    ctx.fill();
  }

  // Cast shadow, thrown away from the light.
  const shadow = shadowAt(map, x, y, rot);
  if (shadow > 0) {
    tilePath(ctx, cx, cy, zoom);
    ctx.fillStyle = `rgba(5,8,13,${0.5 * shadow})`;
    ctx.fill();
  }

  if (!lit) {
    tilePath(ctx, cx, cy, zoom);
    ctx.fillStyle = `${Lighting.coldFog}0.66)`;
    ctx.fill();
  }
}

/** Material-specific marks: grit and cracks, asphalt patches, grout lines. */
function drawSurface(ctx, cx, cy, zoom, x, y, pal) {
  const h = hash2(x, y);

  // Metal walkways, where a site would have them. They run in strips rather
  // than scattering, because a walkway is a route: whole rows of it read as
  // somewhere to walk, and single grated tiles read as a mistake.
  if (pal.grate && hash2(y * 3.1, 17) > 0.66) {
    drawGrate(ctx, cx, cy, zoom, pal);
    return;
  }

  if (pal.texture === 'tile') {
    // Grout runs along the tile edges, so the floor reads as laid, not poured.
    ctx.strokeStyle = pal.grout;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    tilePath(ctx, cx, cy, zoom, 5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  if (pal.texture === 'oil' && h > 0.78) {
    // Old spills, darker than the floor and irregular.
    ctx.fillStyle = 'rgba(10,12,16,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx + (h - 0.5) * 20 * zoom, cy, 13 * zoom, 6 * zoom, h * 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (pal.texture === 'asphalt' && h > 0.72) {
    // Patched repairs in slabs, following the tile shape.
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    tilePath(ctx, cx, cy, zoom, 8 + h * 6);
    ctx.fill();
    return;
  }

  // Concrete: fine grit, plus the occasional crack.
  if (h > 0.5) {
    ctx.fillStyle = h > 0.85 ? pal.grit : 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 3; i++) {
      const j = hash2(x * 7 + i, y * 13 - i);
      const ox = (j - 0.5) * TILE_W * 0.5 * zoom;
      const oy = ((j * 31) % 1 - 0.5) * TILE_H * 0.5 * zoom;
      ctx.fillRect(cx + ox, cy + oy, 2 * zoom, 1.6 * zoom);
    }
  }
  if (h > 0.93) {
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 14 * zoom, cy - 3 * zoom);
    ctx.lineTo(cx - 2 * zoom, cy + 2 * zoom);
    ctx.lineTo(cx + 12 * zoom, cy - 2 * zoom);
    ctx.stroke();
  }
}

/**
 * A grated steel walkway: a lattice traced along the grid's own axes, so it
 * lies in the floor plane instead of sitting on it as a pattern. The dark
 * fill underneath is what sells it -- a grating is mostly the hole.
 */
function drawGrate(ctx, cx, cy, zoom, pal) {
  tilePath(ctx, cx, cy, zoom);
  ctx.fillStyle = Material.grate;
  ctx.fill();

  ctx.strokeStyle = 'rgba(12,16,21,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of [-0.3, -0.1, 0.1, 0.3]) {
    // Along +x, then along +y: the two directions the tile's own edges run.
    const a = worldToScreen(t, -0.5);
    const b = worldToScreen(t, 0.5);
    ctx.moveTo(cx + a.x * zoom, cy + a.y * zoom);
    ctx.lineTo(cx + b.x * zoom, cy + b.y * zoom);
    const c = worldToScreen(-0.5, t);
    const d = worldToScreen(0.5, t);
    ctx.moveTo(cx + c.x * zoom, cy + c.y * zoom);
    ctx.lineTo(cx + d.x * zoom, cy + d.y * zoom);
  }
  ctx.stroke();

  // A lit edge on the two sides facing the light, so the plate has a lip.
  ctx.strokeStyle = 'rgba(190,205,230,0.14)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - (TILE_W / 2) * zoom, cy);
  ctx.lineTo(cx, cy - (TILE_H / 2) * zoom);
  ctx.lineTo(cx + (TILE_W / 2) * zoom, cy);
  ctx.stroke();
}

/** Cheap deterministic 0..1 noise, so tiles look the same every frame. */
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function countAdjacentSolid(map, x, y) {
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = tileAt(map, x + dx, y + dy);
    if (t === WALL || t === VOID) n += 1;
  }
  return n;
}

function drawWall(ctx, cx, cy, zoom, map, x, y, lit, rot) {
  const pal = paletteFor(map.site);
  // Which grid neighbour is hiding a face is a question about the *screen*:
  // the two faces drawn are the ones pointing down-right and down-left, and
  // which grid direction those are changes with the camera.
  const r = viewToGrid(1, 0, rot);
  const l = viewToGrid(0, 1, rot);
  isoBox(ctx, cx, cy, zoom, 1, 1, WALL_H, pal.wall, {
    top: pal.wallTop,
    // A face a neighbouring wall is pressed against is never seen; skipping it
    // also keeps the shared seam from being painted twice at two alphas.
    hideRight: tileAt(map, x + r.x, y + r.y) === WALL,
    hideLeft: tileAt(map, x + l.x, y + l.y) === WALL,
    rim: 0.22,
  });

  if (!lit) dimBox(ctx, cx, cy, zoom, 1, 1, WALL_H, { alpha: 0.6 });
}

/**
 * Anything from the catalogue. The renderer knows how to draw a pile of
 * boxes and nothing else about props -- what a locker is lives in
 * data/props.js, which is what makes the catalogue extensible by editing
 * data rather than by editing this file.
 */
function drawProp(ctx, cx, cy, zoom, map, x, y, lit, rot) {
  const key = PROP_KEYS[map.props[y * map.w + x] - 1] || 'crate';
  const m = PROP_METRICS[key];
  const seed = Math.abs(x * 73 + y * 31);

  boxShadow(ctx, cx, cy, zoom, m.w, m.d, m.h, { alpha: 0.28, rot });
  for (const b of propBoxes(key, rot)) {
    const off = worldToScreen(b.x || 0, b.y || 0, rot);
    isoBox(ctx, cx + off.x * zoom, cy + off.y * zoom, zoom, b.w, b.d, b.h,
      b.m === 'paint' ? CAR_PAINT[seed % CAR_PAINT.length] : Material[b.m] || b.m,
      { z: b.z, rim: b.rim, tone: b.tone, rot, outline: 'rgba(0,0,0,0.35)' });
  }

  // One veil over the whole prop rather than one per box: overlapping veils
  // stack, and a locker's three doors came out darker than its carcass.
  if (!lit) dimBox(ctx, cx, cy, zoom, m.w, m.d, m.h, { rot });
}

function drawContainer(ctx, cx, cy, zoom, c, lit, t) {
  const def = CONTAINERS[c.kind];
  const span = 0.4;
  const h = c.opened ? 8 : 15;

  boxShadow(ctx, cx, cy, zoom, span, span, h, { alpha: 0.26 });
  isoBox(ctx, cx, cy, zoom, span, span, h, c.opened ? '#4a4f57' : def.color, {
    outline: 'rgba(0,0,0,0.4)',
  });

  if (!c.opened && lit) {
    // A little glint so the eye finds lootables.
    const a = 0.35 + 0.35 * Math.sin(t * 3 + cx * 0.05);
    ctx.fillStyle = `rgba(255,235,180,${a})`;
    ctx.beginPath();
    ctx.arc(cx, cy - (h + 4) * zoom, 2.2 * zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!lit) dimBox(ctx, cx, cy, zoom, span, span, h);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function drawUnit(ctx, cx, cy, zoom, u, t, battle, opts, rot = 0) {
  const isPlayer = u.side === 'player';
  const bob = Math.sin(t * (isPlayer ? 2.4 : 1.5) + u.bob) * 1.4 * zoom;
  const down = u.state === 'down';

  // A figure's own contact shadow. Shorter reach than a solid box: a person
  // is mostly air, and at full length two survivors standing together threw
  // one continuous slick across the floor.
  if (down) boxShadow(ctx, cx, cy, zoom, 0.48, 0.48, 9, { alpha: 0.32 });
  else boxShadow(ctx, cx, cy, zoom, 0.28, 0.28, 34, { reach: 0.75, alpha: 0.3 });

  // Selection / turn rings.
  if (opts.selectedId === u.id) {
    ctx.strokeStyle = Theme.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 20 * zoom, 10 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (opts.targetId === u.id) {
    ctx.strokeStyle = Theme.bad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 20 * zoom, 10 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isPlayer && u.state === 'idle' && u.ap > 0 && battle.phase === 'player') {
    ctx.strokeStyle = 'rgba(232,163,61,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 18 * zoom, 9 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const hurt = u.flash > 0;
  ctx.save();
  ctx.translate(cx, cy - bob);
  if (down) ctx.rotate(-0.9);
  // Face the way the unit last moved or attacked. Facing is kept on the grid,
  // so it has to be turned into a screen direction before it can be drawn.
  const facingLeft = Math.cos((u.facing ?? 0) + rot * Math.PI / 2) < -0.15;
  if (facingLeft) ctx.scale(-1, 1);
  const s = zoom;

  if (isPlayer) {
    const cls = CLASSES[u.cls];
    drawHumanoid(ctx, s, {
      body: cls.color,
      dark: shade(cls.color, -55),
      head: '#e0c19a',
      hurt,
      lean: 0,
      weapon: u.active === 'melee' || !u.primary ? 'melee' : 'gun',
      overwatch: u.overwatch,
    });
  } else {
    const def = ENEMIES[u.key];
    const shape = ZOMBIE_SHAPE[u.key] || ZOMBIE_SHAPE.shambler;
    drawHumanoid(ctx, s, {
      body: def.color,
      dark: def.dark,
      head: shade(def.color, 25),
      hurt,
      zombie: true,
      weapon: null,
      shape,
      t,
      bob: u.bob,
      calling: !!u.alerted,
    });
  }
  ctx.restore();

  // ---- overhead info -------------------------------------------------------
  const topY = cy - (u.key === 'brute' ? 52 : 44) * zoom - bob;

  if (!down || isPlayer) {
    const bw = 30 * zoom;
    const bh = 4 * zoom;
    const frac = clamp(u.hp / u.hpMax, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(cx - bw / 2 - 1, topY - 1, bw + 2, bh + 2);
    ctx.fillStyle = isPlayer
      ? frac > 0.5 ? Theme.good : frac > 0.25 ? Theme.warn : Theme.bad
      : '#b6533f';
    ctx.fillRect(cx - bw / 2, topY, bw * frac, bh);
  }

  if (isPlayer && battle.phase === 'player' && u.state === 'idle') {
    const n = Math.min(u.apMax, 8);
    const pw = 5 * zoom;
    const gap = 2 * zoom;
    const total = n * pw + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < u.ap ? Theme.accent : 'rgba(255,255,255,0.16)';
      ctx.fillRect(cx - total / 2 + i * (pw + gap), topY - 7 * zoom, pw, 3 * zoom);
    }
  }

  if (u.overwatch) {
    ctx.fillStyle = Theme.info;
    ctx.font = Theme.font(11 * zoom, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('OW', cx, topY - 11 * zoom);
  }
  if (down) {
    ctx.fillStyle = Theme.bad;
    ctx.font = Theme.font(11 * zoom, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`DOWN ${u.bleed}`, cx, topY - 4 * zoom);
  }
  if (!isPlayer && u.alerted) {
    ctx.fillStyle = Theme.bad;
    ctx.font = Theme.font(14 * zoom, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('!', cx, topY - 6 * zoom);
  }
}

/**
 * Body shape per zombie archetype.
 *
 * These are the readability workhorses. A tactical turn depends on telling a
 * Runner from a Brute at a glance, and at low zoom colour alone does not carry
 * that -- the *outline* has to. Each entry is a deliberate silhouette:
 * proportions, stance and one exaggerated feature.
 */
export const ZOMBIE_SHAPE = {
  shambler: {
    scale: 1, lean: 0.2, shoulder: 7, waist: 6, height: 30, headR: 6.2, headY: -36,
    // Uneven shoulders and one arm hanging lower than the other.
    armDrop: 4, armSpread: 0, legSpread: 0, feature: 'slack',
  },
  runner: {
    scale: 0.94, lean: 0.5, shoulder: 5.5, waist: 5, height: 28, headR: 5.6, headY: -34,
    // Pitched forward, arms trailing behind: reads as motion even standing.
    armDrop: -6, armSpread: -3, legSpread: 3, feature: 'lean',
  },
  brute: {
    scale: 1.3, lean: 0.1, shoulder: 11, waist: 7.5, height: 27, headR: 5.2, headY: -31,
    // Enormous shoulders, head sunk between them, stubby limbs.
    armDrop: 2, armSpread: 3, legSpread: 2, feature: 'hulk',
  },
  spitter: {
    scale: 1.02, lean: -0.12, shoulder: 5, waist: 9.5, height: 29, headR: 5.4, headY: -37,
    // Distended middle, thin limbs, head tipped back to lob.
    armDrop: 5, armSpread: -1, legSpread: 0, feature: 'bloat',
  },
  screamer: {
    scale: 0.98, lean: -0.22, shoulder: 6, waist: 5, height: 31, headR: 6, headY: -38,
    // Head thrown back, arms splayed wide, jaw open.
    armDrop: -8, armSpread: 5, legSpread: 1, feature: 'scream',
  },
};

/** A chunky little iso figure. `o.shape` drives the silhouette. */
function drawHumanoid(ctx, s, o) {
  const sh = o.shape || {
    scale: 1, lean: 0, shoulder: 7, waist: 6, height: 30, headR: 6.2, headY: -36,
    armDrop: 0, armSpread: 0, legSpread: 0, feature: null,
  };
  ctx.save();
  ctx.scale(s * sh.scale, s * sh.scale);
  if (sh.lean) ctx.rotate(sh.lean);

  const body = o.hurt ? '#ffffff' : o.body;
  const dark = o.hurt ? '#ffd8d8' : o.dark;
  const sp = sh.legSpread;

  // Legs
  ctx.fillStyle = dark;
  ctx.fillRect(-6 - sp, -12, 4.5, 12);
  ctx.fillRect(1.5 + sp, -12, 4.5, 12);
  // Torso: shoulder and waist widths give each type its taper.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-sh.shoulder, -sh.height);
  ctx.lineTo(sh.shoulder, -sh.height);
  ctx.lineTo(sh.waist, -11);
  ctx.lineTo(-sh.waist, -11);
  ctx.closePath();
  ctx.fill();
  // Arms, hung at the archetype's own height and spread.
  ctx.fillStyle = dark;
  ctx.fillRect(-sh.shoulder - 2.5 - sh.armSpread, -sh.height + 1, 3.5, 15 + sh.armDrop);
  ctx.fillRect(sh.shoulder - 1 + sh.armSpread, -sh.height + 1, 3.5, 15 + sh.armDrop * 0.6);
  // Head
  ctx.fillStyle = o.hurt ? '#ffffff' : o.head;
  ctx.beginPath();
  ctx.arc(0, sh.headY, sh.headR, 0, Math.PI * 2);
  ctx.fill();

  if (o.zombie) {
    drawZombieFace(ctx, sh, o);
    // Ragged hem, so the outline is never a clean rectangle.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(-sh.waist, -13); ctx.lineTo(-3, -10); ctx.lineTo(0, -13);
    ctx.lineTo(3, -10); ctx.lineTo(sh.waist, -13);
    ctx.lineTo(sh.waist, -16); ctx.lineTo(-sh.waist, -16); ctx.closePath();
    ctx.fill();
  } else {
    // Face plate so survivors read as "alive" at a glance.
    ctx.fillStyle = 'rgba(30,35,45,0.85)';
    ctx.fillRect(-5.4, -38.5, 10.8, 3.4);
  }

  // Rim light down the lit edge, lifting the figure off the floor.
  ctx.strokeStyle = `${Lighting.rim}0.3)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-sh.shoulder, -sh.height);
  ctx.lineTo(-sh.waist, -11);
  ctx.stroke();

  if (o.weapon === 'gun') {
    ctx.fillStyle = '#2c3340';
    ctx.fillRect(6, -25, 15, 3);
    ctx.fillRect(9, -22, 4, 4);
  } else if (o.weapon === 'melee') {
    ctx.strokeStyle = '#9aa5b1';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(8, -26);
    ctx.lineTo(17, -36);
    ctx.stroke();
  }

  if (o.overwatch) {
    ctx.strokeStyle = 'rgba(74,159,216,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, -26, 15, -0.9, 0.9);
    ctx.stroke();
  }

  ctx.restore();
}

/** The one exaggerated feature that names each archetype. */
function drawZombieFace(ctx, sh, o) {
  const hy = sh.headY;

  // Dead eyes, common to all of them.
  ctx.fillStyle = 'rgba(20,10,10,0.75)';
  ctx.fillRect(-3.4, hy - 1.6, 1.8, 2.2);
  ctx.fillRect(1.6, hy - 1.6, 1.8, 2.2);

  switch (sh.feature) {
    case 'scream': {
      // A jaw hanging wide open, pulsing, plus sound rings.
      const open = 3 + Math.sin((o.t || 0) * 9 + (o.bob || 0)) * 1.4;
      ctx.fillStyle = 'rgba(60,10,14,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, hy + 3.4, 3.2, open, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rings only while it is actually calling, or they read as decoration.
      if (o.calling) {
        ctx.strokeStyle = 'rgba(200,140,210,0.55)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(0, hy, sh.headR + i * 4, -2.4, -0.7);
          ctx.stroke();
        }
      }
      break;
    }
    case 'bloat':
      // A swollen sac at the belly, the thing it throws.
      ctx.fillStyle = 'rgba(150,200,120,0.32)';
      ctx.beginPath();
      ctx.ellipse(0, -19, sh.waist * 0.85, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(40,10,10,0.8)';
      ctx.fillRect(-2, hy + 2.4, 4, 2.2);
      break;
    case 'hulk':
      // Slabs of dead muscle over the shoulders.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(-sh.shoulder * 0.6, -sh.height + 2, 5, 3.5, -0.3, 0, Math.PI * 2);
      ctx.ellipse(sh.shoulder * 0.6, -sh.height + 2, 5, 3.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'lean':
      // Nothing extra: the pitch and trailing arms carry it.
      break;
    default:
      ctx.fillStyle = 'rgba(40,10,10,0.8)';
      ctx.fillRect(-2.2, hy + 2.6, 4.4, 2.4);
      break;
  }
}

// ---------------------------------------------------------------------------
// Floor overlays
// ---------------------------------------------------------------------------

export function paintTile(ctx, P, zoom, x, y, fill, stroke, inset = 2) {
  const p = P(x, y);
  tilePath(ctx, p.x, p.y, zoom, inset);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

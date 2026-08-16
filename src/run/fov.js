// Line of sight and field of view.
//
// Waist-high cover (crates, cars) deliberately does *not* block sight -- you
// can see over it, you just can't walk through it and it soaks incoming fire.

import { blocksSight } from './map.js';

/**
 * True if nothing sight-blocking sits strictly between the two tiles.
 *
 * A raw Bresenham walk is not symmetric -- tracing A->B and B->A can round
 * through different tiles and disagree. That would let a zombie see a
 * survivor who cannot see it back, so the endpoints are put into a canonical
 * order first and the same line is always traced.
 */
export function hasLineOfSight(map, x0, y0, x1, y1) {
  if (y1 < y0 || (y1 === y0 && x1 < x0)) {
    [x0, x1] = [x1, x0];
    [y0, y1] = [y1, y0];
  }
  return traceClear(map, x0, y0, x1, y1);
}

function traceClear(map, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  for (let guard = 0; guard < 512; guard++) {
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) return true;
    if (blocksSight(map, x, y)) return false;
  }
  return false;
}

/**
 * Mark every tile within `radius` of (cx,cy) that has line of sight.
 * Writes 1 into `visible` and `seen` (both Uint8Array, length w*h).
 */
export function computeFov(map, cx, cy, radius, visible, seen) {
  const r2 = radius * radius;
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(map.w - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(map.h - 1, cy + radius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (!hasLineOfSight(map, cx, cy, x, y)) continue;
      const i = y * map.w + x;
      visible[i] = 1;
      seen[i] = 1;
      // Reveal the wall faces bounding a lit floor tile, or rooms look open.
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
          if (blocksSight(map, nx, ny)) {
            const j = ny * map.w + nx;
            visible[j] = 1;
            seen[j] = 1;
          }
        }
      }
    }
  }
}

/** Rebuild the whole party's shared vision. */
export function refreshVision(battle) {
  const { map } = battle;
  battle.visible.fill(0);
  for (const u of battle.units) {
    if (u.side !== 'player' || u.state === 'dead') continue;
    // A downed survivor still has their eyes open, just barely.
    const r = u.state === 'down' ? 3 : u.sight;
    computeFov(map, u.x, u.y, r, battle.visible, battle.seen);
  }
}

export const isVisible = (battle, x, y) =>
  x >= 0 && y >= 0 && x < battle.map.w && y < battle.map.h && battle.visible[y * battle.map.w + x] === 1;

export const isSeen = (battle, x, y) =>
  x >= 0 && y >= 0 && x < battle.map.w && y < battle.map.h && battle.seen[y * battle.map.w + x] === 1;

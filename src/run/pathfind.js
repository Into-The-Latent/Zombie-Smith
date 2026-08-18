// A* over the tile grid. Diagonals cost the same as orthogonals (Chebyshev),
// which matches how action points are spent.

import { isWalkable, isShutDoor } from './map.js';

/**
 * What entering a tile costs, in action points.
 *
 * A shut door is walkable -- routes have to exist through it -- but you pay
 * for the shove as well as the step. Without this the move preview promises
 * reach through a door that the move itself cannot deliver.
 */
export const stepCost = (map, x, y) => (isShutDoor(map, x, y) ? 2 : 1);

/** Minimal binary heap keyed by `f`. */
class Heap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

const heuristic = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/**
 * @param {object} map
 * @param {number} sx start x
 * @param {number} sy start y
 * @param {number} tx target x
 * @param {number} ty target y
 * @param {(x:number,y:number)=>boolean} [blocked] extra blockers (units)
 * @param {object} [opts] { maxCost, adjacent } -- `adjacent` stops one tile
 *        short of the target, which is what melee AI wants.
 * @returns {Array<[number,number]>|null} steps excluding the start tile
 */
export function findPath(map, sx, sy, tx, ty, blocked = null, opts = {}) {
  const maxCost = opts.maxCost ?? 400;
  const adjacent = !!opts.adjacent;

  if (sx === tx && sy === ty) return [];
  if (!adjacent && !isWalkable(map, tx, ty)) return null;

  const key = (x, y) => y * map.w + x;
  const goal = (x, y) => (adjacent ? heuristic(x, y, tx, ty) <= 1 : x === tx && y === ty);

  const open = new Heap();
  const gScore = new Map();
  const cameFrom = new Map();
  const startKey = key(sx, sy);
  gScore.set(startKey, 0);
  open.push({ x: sx, y: sy, f: heuristic(sx, sy, tx, ty) });

  const closed = new Set();
  let found = null;

  while (open.size) {
    const cur = open.pop();
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (goal(cur.x, cur.y)) {
      found = ck;
      break;
    }

    const g = gScore.get(ck);
    if (g >= maxCost) continue;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!isWalkable(map, nx, ny)) continue;
        if (dx && dy && (!isWalkable(map, cur.x + dx, cur.y) || !isWalkable(map, cur.x, cur.y + dy))) {
          continue; // no corner cutting
        }
        // The goal tile itself may be occupied when we only need adjacency.
        if (blocked && blocked(nx, ny) && !(nx === tx && ny === ty && adjacent)) continue;

        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const ng = g + stepCost(map, nx, ny);
        if (gScore.has(nk) && ng >= gScore.get(nk)) continue;
        gScore.set(nk, ng);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + heuristic(nx, ny, tx, ty) });
      }
    }
  }

  if (found === null) return null;

  const path = [];
  let cur = found;
  while (cur !== startKey) {
    path.push([cur % map.w, Math.floor(cur / map.w)]);
    cur = cameFrom.get(cur);
    if (cur === undefined) return null;
  }
  path.reverse();
  return path;
}

/**
 * Every tile reachable within `budget` steps. Used to paint the move range.
 * @returns {Map<number, number>} tile index -> cost
 */
export function reachable(map, sx, sy, budget, blocked = null) {
  const key = (x, y) => y * map.w + x;
  const dist = new Map([[key(sx, sy), 0]]);
  let frontier = [[sx, sy]];
  // Two buckets rather than one, because a shut door costs two: tiles that
  // cost double are explored a step later, which is exactly what paying for
  // them means.
  let deferred = [];
  for (let step = 1; step <= budget; step++) {
    const next = deferred;
    deferred = [];
    for (const [cx, cy] of frontier) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!isWalkable(map, nx, ny)) continue;
          if (dx && dy && (!isWalkable(map, cx + dx, cy) || !isWalkable(map, cx, cy + dy))) continue;
          if (blocked && blocked(nx, ny)) continue;
          const nk = key(nx, ny);
          if (dist.has(nk)) continue;
          const cost = step + stepCost(map, nx, ny) - 1;
          if (cost > budget) continue;
          dist.set(nk, cost);
          (cost === step ? next : deferred).push([nx, ny]);
        }
      }
    }
    frontier = next;
    if (!frontier.length && !deferred.length) break;
  }
  return dist;
}

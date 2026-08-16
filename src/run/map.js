// Procedural site generation: rooms carved out of solid stone, joined by
// corridors, dressed with cover props and containers.
//
// Props are only ever placed on a room's *interior* (the ring of tiles next
// to a room's walls is always left clear), which means a prop can never wall
// off a doorway and the map is connected by construction.

import { pickContainerKind } from '../game/loot.js';
import { spawnTable } from '../data/enemies.js';

export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;
export const CRATE = 3; // waist-high: blocks movement, half cover, see over
export const CAR = 4; // same rules, bigger silhouette
export const EXIT = 5; // extraction pad
export const ENTRY = 6; // fallback pad (where you came in)

export const WALKABLE = new Set([FLOOR, EXIT, ENTRY]);
export const SIGHT_BLOCKING = new Set([WALL, VOID]);
export const COVER_TILES = new Set([WALL, CRATE, CAR]);

export const SITES = {
  transit: {
    key: 'transit', name: 'Transit Depot',
    floor: '#39414e', floorAlt: '#333a46', wall: '#4b5462', wallTop: '#5b6675',
    rooms: [5, 8], size: 30, blurb: 'Buses, benches, and whatever crawled off them.',
  },
  clinic: {
    key: 'clinic', name: 'Street Clinic',
    floor: '#3d4550', floorAlt: '#454e5a', wall: '#546070', wallTop: '#68758a',
    rooms: [6, 9], size: 30, blurb: 'Medicine still on the shelves. Also the patients.',
    lootBias: 'medcab',
  },
  warehouse: {
    key: 'warehouse', name: 'Freight Warehouse',
    floor: '#3a3a3f', floorAlt: '#43433f', wall: '#57534a', wallTop: '#6b665a',
    rooms: [4, 6], size: 32, blurb: 'Big open floor. Nowhere to hide, plenty to take.',
    lootBias: 'crate', propDensity: 1.5,
  },
  suburb: {
    key: 'suburb', name: 'Suburban Row',
    floor: '#3f4640', floorAlt: '#474d43', wall: '#5a5c50', wallTop: '#6d7062',
    rooms: [7, 10], size: 32, blurb: 'Small rooms, tight corners, a lot of front doors.',
    lootBias: 'locker',
  },
  garage: {
    key: 'garage', name: 'Repair Garage',
    floor: '#383c44', floorAlt: '#3f434b', wall: '#4e545f', wallTop: '#616875',
    rooms: [4, 7], size: 30, blurb: 'Tools, fuel, and a pit you should not look into.',
    lootBias: 'toolbox', cars: 2.2,
  },
};

export const SITE_KEYS = Object.keys(SITES);

/**
 * Share of a room's interior turned into waist-high cover. At the original
 * 4% of walkable area, only 11% of tiles had cover from any given direction
 * and positioning barely mattered -- combat was two lines trading shots.
 */
export const PROP_COVERAGE = 0.3;

/** Extraction sits at this fraction of the longest room-to-room distance. */
export const EXIT_DISTANCE_FRACTION = 0.62;

function idx(map, x, y) {
  return y * map.w + x;
}

export function tileAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return VOID;
  return map.tiles[idx(map, x, y)];
}

export function setTile(map, x, y, t) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return;
  map.tiles[idx(map, x, y)] = t;
}

export const isWalkable = (map, x, y) => WALKABLE.has(tileAt(map, x, y));
export const blocksSight = (map, x, y) => SIGHT_BLOCKING.has(tileAt(map, x, y));

/**
 * Cover the tile (tx,ty) gets from fire coming from (fx,fy).
 * Looks at the single tile the shot must pass over last.
 * @returns 0 none | 1 half | 2 full
 */
export function coverAt(map, tx, ty, fx, fy) {
  const dx = Math.sign(fx - tx);
  const dy = Math.sign(fy - ty);
  let best = 0;
  // Check the orthogonal neighbours facing the shooter (a diagonal shot can
  // be blocked by either of the two adjacent faces).
  const checks = [];
  if (dx !== 0) checks.push([tx + dx, ty]);
  if (dy !== 0) checks.push([tx, ty + dy]);
  if (dx !== 0 && dy !== 0) checks.push([tx + dx, ty + dy]);
  for (const [cx, cy] of checks) {
    const t = tileAt(map, cx, cy);
    if (t === WALL) best = Math.max(best, 2);
    else if (t === CRATE || t === CAR) best = Math.max(best, 1);
  }
  return best;
}

function overlaps(a, b, gap = 1) {
  return (
    a.x - gap < b.x + b.w &&
    a.x + a.w + gap > b.x &&
    a.y - gap < b.y + b.h &&
    a.y + a.h + gap > b.y
  );
}

function carveRect(map, r, tile = FLOOR) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) setTile(map, x, y, tile);
  }
}

function carveCorridor(map, ax, ay, bx, by, rand) {
  // L-shaped, with the elbow order chosen at random.
  if (rand.chance(0.5)) {
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) setTile(map, x, ay, FLOOR);
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) setTile(map, bx, y, FLOOR);
  } else {
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) setTile(map, ax, y, FLOOR);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) setTile(map, x, by, FLOOR);
  }
}

const centerOf = (r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });

/**
 * @param {object} rand seeded rng
 * @param {number} day  campaign day -- scales size, enemy count and loot
 * @param {string} [siteKey]
 */
export function generateMap(rand, day, siteKey = null) {
  const site = SITES[siteKey] || SITES[rand.pick(SITE_KEYS)];
  const size = Math.min(38, site.size + Math.floor(day / 3));
  const map = {
    w: size,
    h: size,
    tiles: new Uint8Array(size * size).fill(WALL),
    site,
    rooms: [],
  };

  // --- rooms -------------------------------------------------------------
  const [minRooms, maxRooms] = site.rooms;
  const want = rand.int(minRooms, maxRooms) + Math.floor(day / 5);
  const rooms = [];
  let guard = 0;
  while (rooms.length < want && guard++ < 400) {
    const w = rand.int(5, 9);
    const h = rand.int(5, 9);
    const r = { x: rand.int(2, size - w - 3), y: rand.int(2, size - h - 3), w, h };
    if (rooms.some((o) => overlaps(r, o, 2))) continue;
    rooms.push(r);
  }
  for (const r of rooms) carveRect(map, r);
  map.rooms = rooms;

  // --- corridors ---------------------------------------------------------
  for (let i = 1; i < rooms.length; i++) {
    const a = centerOf(rooms[i - 1]);
    const b = centerOf(rooms[i]);
    carveCorridor(map, a.x, a.y, b.x, b.y, rand);
  }
  // A couple of loops so the map isn't a pure line.
  const extra = Math.max(1, Math.floor(rooms.length / 3));
  for (let i = 0; i < extra; i++) {
    const a = centerOf(rand.pick(rooms));
    const b = centerOf(rand.pick(rooms));
    if (a.x !== b.x || a.y !== b.y) carveCorridor(map, a.x, a.y, b.x, b.y, rand);
  }

  // --- entry / extraction --------------------------------------------------
  // Deliberately NOT the two furthest rooms: picking the maximum by
  // construction meant every run opened with seven to ten rounds of walking
  // before anything happened. Aim for a good distance instead of the longest.
  const pairs = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const ca = centerOf(rooms[i]);
      const cb = centerOf(rooms[j]);
      pairs.push({ d: Math.hypot(ca.x - cb.x, ca.y - cb.y), a: i, b: j });
    }
  }
  const longest = pairs.reduce((m, p) => Math.max(m, p.d), 1);
  const wanted = longest * EXIT_DISTANCE_FRACTION;
  const best = pairs.reduce(
    (bestSoFar, p) => (Math.abs(p.d - wanted) < Math.abs(bestSoFar.d - wanted) ? p : bestSoFar),
    pairs[0] || { d: 0, a: 0, b: Math.min(1, rooms.length - 1) },
  );
  const entryRoom = rooms[best.a];
  const exitRoom = rooms[best.b];
  const entry = centerOf(entryRoom);
  const exit = centerOf(exitRoom);

  // 2x2 pads so a whole squad can stand on them.
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      setTile(map, entry.x + dx, entry.y + dy, ENTRY);
      setTile(map, exit.x + dx, exit.y + dy, EXIT);
    }
  }
  map.entry = entry;
  map.exit = exit;
  map.entryRoom = entryRoom;
  map.exitRoom = exitRoom;

  // --- containers, richer the further from the entry ----------------------
  // Placed before props so cover can be kept clear of them.
  const containers = [];
  const maxDist = Math.max(1, Math.hypot(entry.x - exit.x, entry.y - exit.y));
  for (const r of rooms) {
    const isEntry = r === entryRoom;
    const n = isEntry ? rand.int(0, 1) : rand.int(1, 3);
    for (let i = 0; i < n; i++) {
      const px = rand.int(r.x, r.x + r.w - 1);
      const py = rand.int(r.y, r.y + r.h - 1);
      if (tileAt(map, px, py) !== FLOOR) continue;
      if (containers.some((c) => c.x === px && c.y === py)) continue;
      let kind = pickContainerKind(rand);
      if (site.lootBias && rand.chance(0.4)) kind = site.lootBias;
      const depth = Math.min(1, Math.hypot(px - entry.x, py - entry.y) / maxDist);
      containers.push({ x: px, y: py, kind, depth, opened: false });
    }
  }
  map.containers = containers;

  // --- cover props ---------------------------------------------------------
  // Connectivity is guaranteed by construction rather than by checking:
  //   * only room interiors are used, so every doorway and corridor stays open
  //     and each room's border ring always joins all of its exits;
  //   * no prop touches another orthogonally, so cover never forms a wall;
  //   * no prop touches a container orthogonally, so loot is always reachable.
  // Candidates are scored by how exposed they are, because cover is only
  // worth placing where someone would otherwise be caught in the open.
  const density = site.propDensity || 1;
  const carBias = site.cars || 0.6;
  const isProp = (x, y) => {
    const t = tileAt(map, x, y);
    return t === CRATE || t === CAR;
  };
  const orthogonal = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const nearContainer = (x, y) =>
    containers.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 1);

  const canPlace = (x, y) => {
    if (tileAt(map, x, y) !== FLOOR) return false;
    if (Math.abs(x - entry.x) < 3 && Math.abs(y - entry.y) < 3) return false;
    if (Math.abs(x - exit.x) < 3 && Math.abs(y - exit.y) < 3) return false;
    if (nearContainer(x, y)) return false;
    return !orthogonal.some(([dx, dy]) => isProp(x + dx, y + dy));
  };
  const exposure = (x, y) =>
    orthogonal.reduce((n, [dx, dy]) => n + (isWalkable(map, x + dx, y + dy) ? 1 : 0), 0);

  for (const r of rooms) {
    if (r.w < 5 || r.h < 5) continue;
    const interior = { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
    const area = interior.w * interior.h;
    const want = Math.round(area * PROP_COVERAGE * density);
    for (let i = 0; i < want; i++) {
      // Sample a few spots and take the most exposed valid one.
      let pick = null;
      let pickScore = -1;
      for (let attempt = 0; attempt < 5; attempt++) {
        const px = rand.int(interior.x, interior.x + interior.w - 1);
        const py = rand.int(interior.y, interior.y + interior.h - 1);
        if (!canPlace(px, py)) continue;
        const score = exposure(px, py);
        if (score > pickScore) {
          pickScore = score;
          pick = [px, py];
        }
      }
      if (!pick) continue;
      setTile(map, pick[0], pick[1], rand.chance(carBias * 0.3) ? CAR : CRATE);
    }
  }

  // --- zombies ------------------------------------------------------------
  const table = spawnTable(day);
  const count = Math.min(24, Math.round(6 + day * 1.4));
  const spawns = [];
  guard = 0;
  while (spawns.length < count && guard++ < 800) {
    const r = rand.pick(rooms);
    if (r === entryRoom) continue;
    const px = rand.int(r.x, r.x + r.w - 1);
    const py = rand.int(r.y, r.y + r.h - 1);
    if (tileAt(map, px, py) !== FLOOR) continue;
    if (spawns.some((s) => s.x === px && s.y === py)) continue;
    if (containers.some((c) => c.x === px && c.y === py)) continue;
    // Keep the first few tiles around the entry pad quiet.
    if (Math.hypot(px - entry.x, py - entry.y) < 7) continue;
    const key = rand.weighted(table).key;
    spawns.push({ x: px, y: py, key });
  }
  map.spawns = spawns;

  // Cosmetic blood decals, purely for mood.
  map.decals = [];
  for (let i = 0; i < Math.round(size * 1.2); i++) {
    const r = rand.pick(rooms);
    const px = rand.int(r.x, r.x + r.w - 1);
    const py = rand.int(r.y, r.y + r.h - 1);
    if (tileAt(map, px, py) === FLOOR) {
      map.decals.push({ x: px, y: py, r: rand.range(6, 15), a: rand.range(0.05, 0.18) });
    }
  }

  return map;
}

/** All walkable tiles adjacent to (x,y), 8-way. */
export function neighbors(map, x, y, out = []) {
  out.length = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      // No slipping diagonally between two blocked corners.
      if (dx && dy && (!isWalkable(map, x + dx, y) || !isWalkable(map, x, y + dy))) continue;
      out.push([nx, ny]);
    }
  }
  return out;
}

/** Free walkable tile nearest to (x,y) that no unit occupies. */
export function findFreeTile(map, x, y, occupied, maxR = 6) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (isWalkable(map, nx, ny) && !occupied(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

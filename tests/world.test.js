import { describe, test, assert, equal, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  generateMap, tileAt, isWalkable, coverAt, WALL, FLOOR, CRATE, EXIT, ENTRY, SITE_KEYS,
} from '../src/run/map.js';
import { findPath, reachable } from '../src/run/pathfind.js';
import { hasLineOfSight, computeFov } from '../src/run/fov.js';

const mapFor = (seed, day = 5, site = null) => generateMap(makeRng(seed), day, site);

describe('map generation', () => {
  test('every site archetype generates a usable map', () => {
    for (const site of SITE_KEYS) {
      const map = mapFor(11, 6, site);
      assert(map.rooms.length >= 3, `${site} produced too few rooms`);
      assert(map.entry && map.exit, `${site} is missing its pads`);
      assert(tileAt(map, map.entry.x, map.entry.y) === ENTRY);
      assert(tileAt(map, map.exit.x, map.exit.y) === EXIT);
    }
  });

  test('the extraction pad is always reachable from the entry pad', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const map = mapFor(seed, 1 + (seed % 18));
      const path = findPath(map, map.entry.x, map.entry.y, map.exit.x, map.exit.y, null, { maxCost: 4000 });
      assert(path !== null, `seed ${seed}: no route from entry to extraction`);
    }
  });

  test('every container and spawn sits on a walkable tile', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const map = mapFor(seed, 10);
      for (const c of map.containers) {
        assert(isWalkable(map, c.x, c.y), `seed ${seed}: container inside geometry`);
      }
      for (const s of map.spawns) {
        assert(isWalkable(map, s.x, s.y), `seed ${seed}: zombie spawned inside a wall`);
      }
    }
  });

  test('every container is reachable from the entry pad', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const map = mapFor(seed, 8);
      for (const c of map.containers) {
        const path = findPath(map, map.entry.x, map.entry.y, c.x, c.y, null, { maxCost: 4000 });
        assert(path !== null, `seed ${seed}: container at ${c.x},${c.y} is walled off`);
      }
    }
  });

  test('nothing spawns on top of the entry pad', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const map = mapFor(seed, 14);
      for (const s of map.spawns) {
        const d = Math.hypot(s.x - map.entry.x, s.y - map.entry.y);
        assert(d >= 7, `seed ${seed}: a zombie started ${d.toFixed(1)} tiles from the squad`);
      }
    }
  });

  test('the same seed produces the same map', () => {
    const a = mapFor(777, 9, 'clinic');
    const b = mapFor(777, 9, 'clinic');
    equal(a.tiles.join(','), b.tiles.join(','));
    equal(JSON.stringify(a.containers), JSON.stringify(b.containers));
  });

  test('map size grows with the campaign but stays bounded', () => {
    const early = mapFor(3, 1, 'transit');
    const late = mapFor(3, 40, 'transit');
    assert(late.w >= early.w);
    between(late.w, 20, 38);
  });
});

describe('cover', () => {
  /** A 7x7 room with a single crate, so cover maths is unambiguous. */
  function testRoom() {
    const w = 7;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {}, rooms: [], decals: [], containers: [] };
    for (let i = 0; i < w; i++) {
      map.tiles[i] = WALL;
      map.tiles[(w - 1) * w + i] = WALL;
      map.tiles[i * w] = WALL;
      map.tiles[i * w + w - 1] = WALL;
    }
    return map;
  }

  test('a crate between shooter and target gives half cover', () => {
    const map = testRoom();
    map.tiles[3 * 7 + 2] = CRATE; // crate to the west of (3,3)
    equal(coverAt(map, 3, 3, 1, 3), 1, 'shot from the west is half covered');
    equal(coverAt(map, 3, 3, 5, 3), 0, 'shot from the east is exposed');
  });

  test('a wall gives full cover', () => {
    const map = testRoom();
    // (1,3) is against the west wall at x=0.
    equal(coverAt(map, 1, 3, 5, 3), 0, 'the wall is behind, not between');
    equal(coverAt(map, 1, 3, 0, 3), 2, 'facing the wall the target is fully covered');
  });

  test('open ground gives nothing', () => {
    const map = testRoom();
    equal(coverAt(map, 3, 3, 5, 5), 0);
  });
});

describe('line of sight', () => {
  test('sight is blocked by walls but not by crates', () => {
    const w = 9;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    assert(hasLineOfSight(map, 1, 4, 7, 4), 'open floor should be visible');

    map.tiles[4 * w + 4] = WALL;
    assert(!hasLineOfSight(map, 1, 4, 7, 4), 'a wall must block sight');

    map.tiles[4 * w + 4] = CRATE;
    assert(hasLineOfSight(map, 1, 4, 7, 4), 'you can see over a crate');
  });

  test('sight is symmetric', () => {
    const w = 9;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    map.tiles[3 * w + 5] = WALL;
    for (let y = 1; y < 8; y++) {
      for (let x = 1; x < 8; x++) {
        equal(
          hasLineOfSight(map, 2, 2, x, y),
          hasLineOfSight(map, x, y, 2, 2),
          `asymmetric sight between (2,2) and (${x},${y})`,
        );
      }
    }
  });

  test('field of view respects the radius', () => {
    const w = 21;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    const vis = new Uint8Array(w * w);
    const seen = new Uint8Array(w * w);
    computeFov(map, 10, 10, 4, vis, seen);
    assert(vis[10 * w + 13] === 1, 'inside the radius should be lit');
    assert(vis[10 * w + 17] === 0, 'well outside the radius should stay dark');
    equal(vis.join(','), seen.join(','), 'everything visible is also remembered');
  });
});

describe('pathfinding', () => {
  function corridor() {
    const w = 9;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(WALL), site: {} };
    for (let x = 1; x < 8; x++) map.tiles[4 * w + x] = FLOOR;
    return map;
  }

  test('finds the obvious straight path', () => {
    const map = corridor();
    const path = findPath(map, 1, 4, 7, 4);
    assert(path !== null);
    equal(path.length, 6);
    equal(path[path.length - 1][0], 7);
  });

  test('returns null when the target is unreachable', () => {
    const map = corridor();
    equal(findPath(map, 1, 4, 1, 1), null);
  });

  test('routes around a blocking unit', () => {
    const w = 9;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    const blocked = (x, y) => x === 4 && y === 4;
    const path = findPath(map, 2, 4, 6, 4, blocked);
    assert(path !== null);
    assert(!path.some(([x, y]) => x === 4 && y === 4), 'path walked through an occupied tile');
  });

  test('will not cut a diagonal corner between two walls', () => {
    const w = 5;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    map.tiles[1 * w + 2] = WALL;
    map.tiles[2 * w + 1] = WALL;
    const path = findPath(map, 1, 1, 2, 2);
    // The direct diagonal is illegal, so any valid route is longer than one step.
    assert(path === null || path.length > 1, 'squeezed diagonally between two walls');
  });

  test('adjacent mode stops one tile short, which is what melee needs', () => {
    const w = 9;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    const path = findPath(map, 1, 4, 7, 4, null, { adjacent: true });
    assert(path !== null);
    const [lx, ly] = path[path.length - 1];
    equal(Math.max(Math.abs(lx - 7), Math.abs(ly - 4)), 1);
  });

  test('reachable set matches the action point budget', () => {
    const w = 15;
    const map = { w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), site: {} };
    const set = reachable(map, 7, 7, 2);
    for (const [key, cost] of set) {
      const x = key % w;
      const y = Math.floor(key / w);
      const cheb = Math.max(Math.abs(x - 7), Math.abs(y - 7));
      assert(cost <= 2, 'reachable returned a tile beyond the budget');
      equal(cost, cheb, `cost at (${x},${y}) should equal Chebyshev distance on open ground`);
    }
    // 5x5 block of tiles centred on the start.
    equal(set.size, 25);
  });
});

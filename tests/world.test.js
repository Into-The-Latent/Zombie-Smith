import { describe, test, assert, equal, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  generateMap, tileAt, isWalkable, coverAt, WALL, FLOOR, PROP, BLOCK, PROP_TILES,
  EXIT, ENTRY, SITE_KEYS,
} from '../src/run/map.js';
import { findPath, reachable } from '../src/run/pathfind.js';
import {
  PROPS, PROP_KEYS, propTable, propHeight, propSpan, HALF, FULL, HALF_MAX_H,
} from '../src/data/props.js';
import { Material } from '../src/ui/palette.js';
import { hasLineOfSight, computeFov } from '../src/run/fov.js';

const mapFor = (seed, day = 5, site = null) => generateMap(makeRng(seed), day, site);

/** True if a survivor at (x,y) can step within `range` and gain prop cover. */
function propCoverWithin(map, x, y, range) {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > range) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      for (let ey = -1; ey <= 1; ey++) {
        for (let ex = -1; ex <= 1; ex++) {
          const t = tileAt(map, nx + ex, ny + ey);
          if (PROP_TILES.has(t)) return true;
        }
      }
    }
  }
  return false;
}

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

  test('maps afford cover from most places a survivor can stand', () => {
    // Guards the fix for cover being decorative: at the original prop density
    // only 3% of tiles had crate cover, so positioning did not matter.
    let stand = 0;
    let reachable = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const map = mapFor(seed + 500, 8);
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          if (tileAt(map, x, y) !== FLOOR) continue;
          stand += 1;
          if (propCoverWithin(map, x, y, 2)) reachable += 1;
        }
      }
    }
    const frac = reachable / stand;
    assert(frac > 0.6, `only ${(frac * 100).toFixed(0)}% of tiles can reach cover -- positioning is decorative again`);
  });

  test('the walk to extraction stays inside a sane budget', () => {
    // Extraction used to be the furthest room by construction, which meant
    // seven to ten rounds of pure walking before anything happened.
    for (const day of [1, 10, 20]) {
      const lengths = [];
      for (let seed = 1; seed <= 20; seed++) {
        const map = mapFor(seed * 77 + day, day);
        const path = findPath(map, map.entry.x, map.entry.y, map.exit.x, map.exit.y, null, { maxCost: 5000 });
        assert(path, `day ${day} seed ${seed}: no route to extraction`);
        lengths.push(path.length);
      }
      lengths.sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)];
      assert(median <= 28, `day ${day}: median walk is ${median} tiles, too much of the run is transit`);
      assert(median >= 8, `day ${day}: median walk is only ${median} tiles, extraction is trivially close`);
    }
  });

  test('props never seal off a container or form solid walls', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = mapFor(seed + 200, 12);
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          const t = tileAt(map, x, y);
          if (!PROP_TILES.has(t)) continue;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            assert(!PROP_TILES.has(tileAt(map, x + dx, y + dy)),
              `seed ${seed}: props touch orthogonally at ${x},${y} -- that is a wall, not cover`);
          }
          assert(!map.containers.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 1),
            `seed ${seed}: a prop at ${x},${y} crowds a container`);
        }
      }
    }
  });

  test('map size grows with the campaign but stays bounded', () => {
    const early = mapFor(3, 1, 'transit');
    const late = mapFor(3, 40, 'transit');
    assert(late.w >= early.w);
    between(late.w, 20, 38);
  });
});

describe('the prop catalogue', () => {
  test('every row is a real prop: a class, boxes, and somewhere to stand', () => {
    for (const key of PROP_KEYS) {
      const p = PROPS[key];
      equal(p.key, key, 'a row must know its own key');
      assert(p.cover === HALF || p.cover === FULL, `${key} has no gameplay class`);
      assert(p.boxes.length > 0, `${key} draws nothing`);
      assert(Object.keys(p.sites).length > 0, `${key} belongs to no site`);
      for (const site of Object.keys(p.sites)) {
        assert(SITE_KEYS.includes(site), `${key} names a site that does not exist: ${site}`);
      }
    }
  });

  test('a box never claims a material that is not in the palette', () => {
    // The rule the catalogue exists to keep: props name materials, and colour
    // lives in ui/palette.js. A typo here would otherwise reach the canvas as
    // a silent black box.
    for (const key of PROP_KEYS) {
      for (const b of PROPS[key].boxes) {
        assert(b.m === 'paint' || Material[b.m], `${key} uses an unknown material "${b.m}"`);
        assert(b.w > 0 && b.d > 0 && b.h > 0, `${key} has a box with no size`);
      }
    }
  });

  test('waist-high means waist-high', () => {
    // Half cover promises you can see and shoot over it. Without this, a row
    // could quietly claim half cover at shelf height and the tooltip would lie.
    for (const key of PROP_KEYS) {
      const h = propHeight(key);
      if (PROPS[key].cover === HALF) {
        assert(h <= HALF_MAX_H, `${key} is ${h} tall and still claims half cover`);
      } else {
        assert(h > HALF_MAX_H, `${key} claims full cover at only ${h} tall`);
      }
    }
  });

  test('nothing overhangs the tile it stands on', () => {
    // Props are placed one to a tile and never orthogonally adjacent, but a
    // box wider than its tile would still reach into a neighbour it does not
    // own and look like it is standing in the aisle.
    for (const key of PROP_KEYS) {
      const { w, d } = propSpan(key);
      assert(w <= 1 && d <= 1, `${key} spans ${w.toFixed(2)}x${d.toFixed(2)} tiles`);
    }
  });

  test('every site can furnish itself, and each has its own character', () => {
    const tables = Object.fromEntries(SITE_KEYS.map((k) => [k, propTable(k)]));
    for (const [site, table] of Object.entries(tables)) {
      assert(table.length >= 4, `${site} can only draw ${table.length} kinds of prop`);
      assert(table.some((e) => PROPS[e.key].cover === FULL), `${site} has no full cover at all`);
      assert(table.some((e) => PROPS[e.key].cover === HALF), `${site} has no half cover at all`);
    }
    // No two sites furnish from the same weighted list, or the catalogue is
    // decoration rather than a sense of place.
    const shapes = SITE_KEYS.map((k) => JSON.stringify(tables[k]));
    equal(new Set(shapes).size, SITE_KEYS.length, 'two sites furnish identically');
  });

  test('generated maps only ever place props the site owns', () => {
    for (const site of SITE_KEYS) {
      const allowed = new Set(propTable(site).map((e) => e.key));
      for (let seed = 1; seed <= 12; seed++) {
        const map = mapFor(seed * 3 + 1, 8, site);
        for (let i = 0; i < map.tiles.length; i++) {
          const p = map.props[i];
          if (!p) {
            assert(!PROP_TILES.has(map.tiles[i]),
              `${site} seed ${seed}: a prop tile with no catalogue row behind it`);
            continue;
          }
          const key = PROP_KEYS[p - 1];
          assert(allowed.has(key), `${site} placed a ${key}, which is not on its list`);
          // The tile has to match the row's class, or cover would lie.
          const want = PROPS[key].cover === FULL ? BLOCK : PROP;
          equal(map.tiles[i], want, `${key} was placed as the wrong class`);
        }
      }
    }
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
    map.tiles[3 * 7 + 2] = PROP; // crate to the west of (3,3)
    equal(coverAt(map, 3, 3, 1, 3), 1, 'shot from the west is half covered');
    equal(coverAt(map, 3, 3, 5, 3), 0, 'shot from the east is exposed');
  });

  test('a full-cover prop stops a shot the way a wall does', () => {
    // Shelving and lockers are the reason BLOCK exists: cover you cannot see
    // through, without having to be architecture.
    const map = testRoom();
    map.tiles[3 * 7 + 2] = BLOCK;
    equal(coverAt(map, 3, 3, 1, 3), 2, 'shelving is full cover');
    equal(coverAt(map, 3, 3, 5, 3), 0, 'and only from the side it is on');
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

    map.tiles[4 * w + 4] = PROP;
    assert(hasLineOfSight(map, 1, 4, 7, 4), 'you can see over a crate');

    // Shelving and lockers are the other half of the catalogue: tall enough
    // to stop a shot, and tall enough to hide behind.
    map.tiles[4 * w + 4] = BLOCK;
    assert(!hasLineOfSight(map, 1, 4, 7, 4), 'a full-height prop must block sight');
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

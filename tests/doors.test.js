// Doors, and the choice they exist to pose.
//
// A shut door is the cheapest tension in the genre: you can put an ear to it
// and pay a turn to know, or shove it open and find out at the same moment
// the room does. Both cost one action point, which is what makes it a choice
// rather than an obvious answer.

import { describe, test, assert, equal, between } from './harness.js';
import { makeRng } from '../src/core/rng.js';
import {
  generateMap, tileAt, isWalkable, coverAt, openDoor, isShutDoor, doorAxis,
  WALL, FLOOR, DOOR, DOOR_OPEN, SITE_KEYS, SITES,
} from '../src/run/map.js';
import { hasLineOfSight } from '../src/run/fov.js';
import { reachable, findPath, stepCost } from '../src/run/pathfind.js';
import { listenAt, LISTEN_RADIUS } from '../src/run/combat.js';
import { createBattle, beginRound } from '../src/run/battle.js';
import { newGame } from '../src/core/state.js';

const mapFor = (seed, day = 6, site = null) => generateMap(makeRng(seed), day, site);

function room(w = 9) {
  const map = {
    w, h: w, tiles: new Uint8Array(w * w).fill(FLOOR), props: new Uint8Array(w * w), site: {},
    decals: [], containers: [], rooms: [],
  };
  for (let i = 0; i < w; i++) {
    map.tiles[i] = WALL;
    map.tiles[(w - 1) * w + i] = WALL;
    map.tiles[i * w] = WALL;
    map.tiles[i * w + w - 1] = WALL;
  }
  return map;
}

describe('where doors get hung', () => {
  test('only in doorways: walled on one axis, open on the other', () => {
    // Doorways are recognised after carving rather than marked during it --
    // a floor tile walled on one axis is where a corridor met a room, by
    // construction. If that recognition is wrong, doors appear in the middle
    // of rooms and the whole mechanic reads as a bug.
    for (const site of SITE_KEYS) {
      for (let seed = 1; seed <= 8; seed++) {
        const map = mapFor(seed * 11 + 3, 7, site);
        for (let y = 0; y < map.h; y++) {
          for (let x = 0; x < map.w; x++) {
            if (tileAt(map, x, y) !== DOOR) continue;
            const acrossX = tileAt(map, x - 1, y) === WALL && tileAt(map, x + 1, y) === WALL;
            const acrossY = tileAt(map, x, y - 1) === WALL && tileAt(map, x, y + 1) === WALL;
            assert(acrossX !== acrossY, `${site}: a door at ${x},${y} is not in a doorway`);
            const through = acrossX
              ? isWalkable(map, x, y - 1) && isWalkable(map, x, y + 1)
              : isWalkable(map, x - 1, y) && isWalkable(map, x + 1, y);
            assert(through, `${site}: a door at ${x},${y} leads nowhere`);
          }
        }
      }
    }
  });

  test('never two in a row', () => {
    // Two doors back to back is an airlock. It reads as a generation bug and
    // costs two action points to walk through.
    for (let seed = 1; seed <= 25; seed++) {
      const map = mapFor(seed * 7 + 1, 9);
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          if (tileAt(map, x, y) !== DOOR) continue;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            assert(tileAt(map, x + dx, y + dy) !== DOOR, `airlock at ${x},${y}`);
          }
        }
      }
    }
  });

  test('each site is as full of doors as its description claims', () => {
    // Suburban Row has promised "a lot of front doors" since the sites were
    // written; the warehouse promised a big open floor.
    const count = (site) => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const map = mapFor(seed * 13 + 2, 6, site);
        for (const t of map.tiles) if (t === DOOR) total += 1;
      }
      return total / 20;
    };
    const suburb = count('suburb');
    const warehouse = count('warehouse');
    assert(suburb > warehouse * 3, `suburb ${suburb.toFixed(1)} vs warehouse ${warehouse.toFixed(1)}`);
    for (const site of SITE_KEYS) {
      if (!SITES[site].doors) continue;
      assert(count(site) > 0, `${site} claims doors and generates none`);
    }
  });

  test('nothing is sealed in: the extraction pad is still reachable', () => {
    // Doors are walkable so that routes exist through them. If that ever
    // changed, a run could generate with its objective behind a shut door and
    // no way to say so.
    for (let seed = 1; seed <= 30; seed++) {
      const map = mapFor(seed + 400, 10);
      const path = findPath(map, map.entry.x, map.entry.y, map.exit.x, map.exit.y);
      assert(path, `seed ${seed}: no route from the entry pad to extraction`);
    }
  });
});

describe('a shut door', () => {
  test('cannot be seen through, and an open one can', () => {
    const map = room();
    assert(hasLineOfSight(map, 1, 4, 7, 4), 'open floor should be visible');
    map.tiles[4 * 9 + 4] = DOOR;
    assert(!hasLineOfSight(map, 1, 4, 7, 4), 'a shut door must block sight');
    map.tiles[4 * 9 + 4] = DOOR_OPEN;
    assert(hasLineOfSight(map, 1, 4, 7, 4), 'an open one must not');
  });

  test('is full cover, the way a wall is', () => {
    const map = room(7);
    map.tiles[3 * 7 + 2] = DOOR;
    equal(coverAt(map, 3, 3, 1, 3), 2, 'shooting across a shut door is shooting at a wall');
    map.tiles[3 * 7 + 2] = DOOR_OPEN;
    equal(coverAt(map, 3, 3, 1, 3), 0, 'an open doorway covers nobody');
  });

  test('opens once, and stays open', () => {
    const map = room();
    map.tiles[4 * 9 + 4] = DOOR;
    assert(isShutDoor(map, 4, 4));
    assert(openDoor(map, 4, 4), 'the first shove opens it');
    assert(!isShutDoor(map, 4, 4));
    assert(!openDoor(map, 4, 4), 'and there is nothing left to open');
    equal(tileAt(map, 4, 4), DOOR_OPEN);
  });

  test('hangs the way the walls beside it run', () => {
    // Orientation is derived rather than stored, so it cannot disagree with
    // the map it was cut into.
    const map = room();
    map.tiles[4 * 9 + 4] = DOOR;
    map.tiles[4 * 9 + 3] = WALL;
    map.tiles[4 * 9 + 5] = WALL;
    equal(doorAxis(map, 4, 4), 'x', 'walls east and west means the leaf spans east-west');
    map.tiles[4 * 9 + 3] = FLOOR;
    map.tiles[4 * 9 + 5] = FLOOR;
    equal(doorAxis(map, 4, 4), 'y');
  });

  test('costs the shove as well as the step', () => {
    // The move preview and the move itself have to agree. Before the cost
    // existed, the range overlay promised reach through a door that the move
    // could not deliver, and a survivor stopped a tile short with no reason
    // given.
    const map = room(11);
    equal(stepCost(map, 5, 5), 1, 'plain floor is one');
    map.tiles[5 * 11 + 5] = DOOR;
    equal(stepCost(map, 5, 5), 2, 'a shut door is two');

    const open = room(11);
    const through = room(11);
    through.tiles[5 * 11 + 5] = DOOR;
    const at = (m, x, y) => reachable(m, 1, 5, 6).get(y * 11 + x);
    assert(at(through, 5, 5) === at(open, 5, 5) + 1,
      'a tile behind a door is one action point further away');
  });
});

describe('listening at one', () => {
  test('finds what is moving out of sight, and ignores what is already in it', () => {
    const state = newGame(12);
    const battle = createBattle(state, state.survivors.map((s) => s.id), makeRng(4), 'suburb');
    const zombies = battle.units.filter((u) => u.side === 'zombie');
    assert(zombies.length >= 2, 'need a couple of zombies to test with');

    // One just out of sight, one further off than any ear could reach.
    const [near, far] = zombies;
    near.x = 5; near.y = 5;
    far.x = 5 + LISTEN_RADIUS + 3; far.y = 5;
    battle.visible.fill(0);

    const heard = listenAt(battle, 5, 4);
    assert(heard.some((h) => h.x === 5 && h.y === 5), 'the near one should be heard');
    assert(!heard.some((h) => h.x === far.x), 'the far one is out of earshot');
    equal(heard[0].kind, near.key, 'and you can tell what it is by the sound of it');

    // Anything already in plain view is not news.
    battle.visible[5 * battle.map.w + 5] = 1;
    equal(listenAt(battle, 5, 4).length, 0, 'seeing it is not hearing it');
  });

  test('what was heard is forgotten when the round turns', () => {
    // A ghost from last round is worse than no ghost: it says something is
    // where it no longer is.
    const state = newGame(13);
    const battle = createBattle(state, state.survivors.map((s) => s.id), makeRng(5), 'clinic');
    battle.heard = [{ x: 3, y: 3, kind: 'shambler' }];
    beginRound(battle);
    equal(battle.heard.length, 0);
  });

  test('a fresh battle starts with nothing heard', () => {
    const state = newGame(14);
    const battle = createBattle(state, state.survivors.map((s) => s.id), makeRng(6));
    equal(battle.heard.length, 0);
  });
});

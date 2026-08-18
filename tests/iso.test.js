// The camera can stand at four corners.
//
// Rotation is the one change in this project that touches a fact four
// separate pieces of code derive independently: where a tile lands, which way
// the mouse points, which sprite is in front, and which grid direction the
// light comes from. They agree only because they all go through gridToView.
// These tests are what stops them drifting apart again.

import { describe, test, assert, equal, close } from './harness.js';
import {
  TILE_W, TILE_H, gridToView, viewToGrid, worldToScreen, screenToWorld, depthOf,
  makeCamera, cameraLookAt, rotateCamera, project, unproject,
} from '../src/run/iso.js';
import { LIGHT_DIR } from '../src/ui/palette.js';

const ROTS = [0, 1, 2, 3];

describe('turning the camera', () => {
  test('every rotation is reversible, on the grid and on the screen', () => {
    for (const rot of ROTS) {
      for (let x = -6; x <= 6; x++) {
        for (let y = -6; y <= 6; y++) {
          const v = gridToView(x, y, rot);
          const back = viewToGrid(v.x, v.y, rot);
          equal(`${back.x},${back.y}`, `${x},${y}`, `rot ${rot} lost (${x},${y})`);

          const s = worldToScreen(x, y, rot);
          const w = screenToWorld(s.x, s.y, rot);
          close(w.gx, x, 1e-9, `rot ${rot} projection is not invertible in x`);
          close(w.gy, y, 1e-9, `rot ${rot} projection is not invertible in y`);
        }
      }
    }
  });

  test('four turns come back to where they started', () => {
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        let p = { x, y };
        for (let i = 0; i < 4; i++) p = gridToView(p.x, p.y, 1);
        equal(`${p.x},${p.y}`, `${x},${y}`);
      }
    }
  });

  test('a quarter turn moves a tile a quarter of the way round the screen', () => {
    // The projection is 2:1, so a tile one step along +x sits at (32,16) at
    // rot 0. Every rotation should put it at one of the four diagonals, at the
    // same distance from the centre -- not squashed, not flipped.
    const seen = new Set();
    for (const rot of ROTS) {
      const p = worldToScreen(1, 0, rot);
      close(Math.abs(p.x), TILE_W / 2, 1e-9, `rot ${rot} distorted x`);
      close(Math.abs(p.y), TILE_H / 2, 1e-9, `rot ${rot} distorted y`);
      seen.add(`${p.x},${p.y}`);
    }
    equal(seen.size, 4, 'two rotations put the same tile in the same place');
  });

  test('the mouse lands on the tile it is over, whatever the rotation', () => {
    // Picking runs through unproject and drawing through project. If they read
    // different rotations, the game highlights one tile and acts on another.
    const cam = makeCamera();
    cam.zoom = 1.4;
    for (const rot of ROTS) {
      cam.rot = rot;
      cameraLookAt(cam, 9, 5);
      for (const [gx, gy] of [[9, 5], [12, 5], [9, 9], [4, 11], [14, 2]]) {
        const p = project(cam, gx, gy, 1280, 640, 0, 80);
        const back = unproject(cam, p.x, p.y, 1280, 640, 0, 80);
        close(back.gx, gx, 1e-9, `rot ${rot}: picked the wrong tile`);
        close(back.gy, gy, 1e-9, `rot ${rot}: picked the wrong tile`);
      }
    }
  });
});

describe('depth, at every rotation', () => {
  test('what is nearer the camera sorts later', () => {
    // The painter's algorithm is the whole reason walls hide what is behind
    // them. At rot 0 the far corner is low x and low y; a quarter turn makes
    // it a different corner, and the sort has to follow.
    for (const rot of ROTS) {
      for (const [ax, ay, bx, by] of [[0, 0, 1, 0], [0, 0, 0, 1], [3, 3, 4, 4], [5, 2, 5, 3]]) {
        const near = gridToView(bx, by, rot);
        const far = gridToView(ax, ay, rot);
        const nearer = near.x + near.y > far.x + far.y;
        const sortsLater = depthOf(bx, by, rot) > depthOf(ax, ay, rot);
        equal(sortsLater, nearer, `rot ${rot}: (${bx},${by}) sorts wrong against (${ax},${ay})`);
      }
    }
  });

  test('depth is the screen-vertical order, which is what makes it work', () => {
    // Anything drawn later must be lower on screen, or it would be painted
    // over something it should be standing in front of.
    for (const rot of ROTS) {
      const cells = [];
      for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) cells.push([x, y]);
      cells.sort((a, b) => depthOf(a[0], a[1], rot) - depthOf(b[0], b[1], rot));
      for (let i = 1; i < cells.length; i++) {
        const prev = worldToScreen(cells[i - 1][0], cells[i - 1][1], rot);
        const cur = worldToScreen(cells[i][0], cells[i][1], rot);
        assert(cur.y >= prev.y - 1e-9,
          `rot ${rot}: draw order climbs the screen at ${cells[i]}`);
      }
    }
  });
});

describe('the light stays where it is', () => {
  test('it comes from screen upper-left at every rotation', () => {
    // FACE_SHADE is written in screen terms -- the left face catches the light
    // -- so the light is fixed to the screen and the *grid* direction is what
    // changes. A light that turned with the world would relight every surface
    // in the level each time the camera moved.
    for (const rot of ROTS) {
      const grid = viewToGrid(LIGHT_DIR.x, LIGHT_DIR.y, rot);
      const onScreen = worldToScreen(grid.x, grid.y, rot);
      assert(onScreen.x < 0 && onScreen.y < 0,
        `rot ${rot}: the light moved to ${onScreen.x},${onScreen.y}`);
    }
  });

  test('and it names a different grid direction at each one', () => {
    const dirs = ROTS.map((rot) => {
      const g = viewToGrid(LIGHT_DIR.x, LIGHT_DIR.y, rot);
      return `${g.x},${g.y}`;
    });
    equal(new Set(dirs).size, 4, 'two rotations claim the same light direction');
  });
});

describe('the camera itself', () => {
  test('turning keeps you looking at the same place', () => {
    // Without this the view leaps sideways and the player has to find their
    // squad again after every turn.
    const cam = makeCamera();
    cameraLookAt(cam, 11, 7);
    for (let i = 0; i < 4; i++) {
      rotateCamera(cam, 1);
      const at = screenToWorld(cam.x, cam.y, cam.rot);
      close(at.gx, 11, 1e-9, `after ${i + 1} turns the camera drifted in x`);
      close(at.gy, 7, 1e-9, `after ${i + 1} turns the camera drifted in y`);
    }
    equal(cam.rot, 0, 'and four turns is a full circle');
  });

  test('turning either way stays in range', () => {
    const cam = makeCamera();
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        rotateCamera(cam, dir);
        assert(cam.rot >= 0 && cam.rot <= 3, `rot went out of range: ${cam.rot}`);
      }
    }
  });
});

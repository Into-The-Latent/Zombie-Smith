// Isometric projection + camera.
//
// Classic 2:1 "Diablo" diamond, with a camera that can stand at any of four
// corners. Rotation happens here and nowhere else: the grid is turned into
// *view* coordinates first, and everything downstream -- the projection, its
// inverse, the painter's-algorithm depth key, which wall faces are hidden,
// which grid direction the light comes from -- is derived from that one
// function. Four things that must agree, from one place, or they drift.
//
// Nothing in the simulation knows about any of this. Cover compares grid
// neighbours, sight traces grid lines, the pathfinder walks grid tiles and
// the AI reads grid distances, all of which are true whichever corner the
// camera is standing at. Rotation is a drawing concern.

export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 26; // pixel height of a wall block's vertical face

/** How long the world takes to swing round after a turn, in seconds. */
export const TURN_TIME = 0.22;

/**
 * Grid coordinates as the camera sees them. `rot` is quarter-turns
 * anticlockwise; at rot 0 the two are the same thing.
 */
export function gridToView(gx, gy, rot = 0) {
  switch (((rot % 4) + 4) % 4) {
    case 1: return { x: -gy, y: gx };
    case 2: return { x: -gx, y: -gy };
    case 3: return { x: gy, y: -gx };
    default: return { x: gx, y: gy };
  }
}

/** The inverse: what the camera sees, put back on the grid. */
export function viewToGrid(vx, vy, rot = 0) {
  switch (((rot % 4) + 4) % 4) {
    case 1: return { x: vy, y: -vx };
    case 2: return { x: -vx, y: -vy };
    case 3: return { x: -vy, y: vx };
    default: return { x: vx, y: vy };
  }
}

/**
 * Painter's-algorithm depth. Ascending order draws back to front, which at
 * rot 0 is the familiar (x + y) diagonal and at every other rotation is the
 * diagonal that has become the far one. The sort and the projection have to
 * come from the same rotation or sprites push through each other the moment
 * the camera turns.
 */
export function depthOf(gx, gy, rot = 0) {
  const v = gridToView(gx, gy, rot);
  return v.x + v.y;
}

export function worldToScreen(gx, gy, rot = 0) {
  const v = gridToView(gx, gy, rot);
  return {
    x: (v.x - v.y) * (TILE_W / 2),
    y: (v.x + v.y) * (TILE_H / 2),
  };
}

/** Inverse projection -- returns fractional grid coordinates. */
export function screenToWorld(sx, sy, rot = 0) {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  const g = viewToGrid((a + b) / 2, (b - a) / 2, rot);
  return { gx: g.x, gy: g.y };
}

export function makeCamera() {
  return {
    x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, shake: 0, shakeX: 0, shakeY: 0,
    rot: 0,
    /** Decays from 1 to 0 after a turn; the world swings in over it. */
    turn: 0,
    turnDir: 0,
  };
}

/** Centre the camera on a grid position immediately. */
export function cameraLookAt(cam, gx, gy) {
  const p = worldToScreen(gx, gy, cam.rot);
  cam.x = cam.targetX = p.x;
  cam.y = cam.targetY = p.y;
}

export function cameraPanTo(cam, gx, gy) {
  const p = worldToScreen(gx, gy, cam.rot);
  cam.targetX = p.x;
  cam.targetY = p.y;
}

/**
 * Turn the camera a quarter turn, keeping whatever it was looking at in the
 * middle of the screen. Without that the view appears to leap sideways, and
 * the player has to find their squad again after every turn.
 */
export function rotateCamera(cam, dir) {
  const at = screenToWorld(cam.x, cam.y, cam.rot);
  cam.rot = (((cam.rot + dir) % 4) + 4) % 4;
  cameraLookAt(cam, at.gx, at.gy);
  cam.turn = 1;
  cam.turnDir = dir;
}

export function updateCamera(cam, dt) {
  const k = 1 - Math.exp(-7 * dt);
  cam.x += (cam.targetX - cam.x) * k;
  cam.y += (cam.targetY - cam.y) * k;
  if (cam.turn > 0) cam.turn = Math.max(0, cam.turn - dt / TURN_TIME);
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 3.2);
    const m = cam.shake * 9;
    cam.shakeX = (Math.random() * 2 - 1) * m;
    cam.shakeY = (Math.random() * 2 - 1) * m;
  } else {
    cam.shakeX = cam.shakeY = 0;
  }
}

/** Where a grid cell lands on the canvas, given the camera and viewport. */
export function project(cam, gx, gy, viewW, viewH, viewX = 0, viewY = 0) {
  const p = worldToScreen(gx, gy, cam.rot);
  return {
    x: viewX + viewW / 2 + (p.x - cam.x + cam.shakeX) * cam.zoom,
    y: viewY + viewH / 2 + (p.y - cam.y + cam.shakeY) * cam.zoom,
  };
}

/** Canvas point -> fractional grid coords. */
export function unproject(cam, px, py, viewW, viewH, viewX = 0, viewY = 0) {
  const sx = (px - viewX - viewW / 2) / cam.zoom + cam.x - cam.shakeX;
  const sy = (py - viewY - viewH / 2) / cam.zoom + cam.y - cam.shakeY;
  return screenToWorld(sx, sy, cam.rot);
}

/** Trace the diamond of a single tile (in screen space, centre at cx/cy). */
export function tilePath(ctx, cx, cy, zoom = 1, inset = 0) {
  const hw = (TILE_W / 2 - inset) * zoom;
  const hh = (TILE_H / 2 - inset * 0.5) * zoom;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

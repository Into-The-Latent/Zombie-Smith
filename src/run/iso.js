// Isometric projection + camera.
//
// Classic 2:1 "Diablo" diamond. Grid +x runs down-right on screen, +y runs
// down-left, so the painter's-algorithm draw order is simply (x + y) ascending.

export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 26; // pixel height of a wall block's vertical face

export function worldToScreen(gx, gy) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

/** Inverse projection -- returns fractional grid coordinates. */
export function screenToWorld(sx, sy) {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

export function makeCamera() {
  return { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, shake: 0, shakeX: 0, shakeY: 0 };
}

/** Centre the camera on a grid position immediately. */
export function cameraLookAt(cam, gx, gy) {
  const p = worldToScreen(gx, gy);
  cam.x = cam.targetX = p.x;
  cam.y = cam.targetY = p.y;
}

export function cameraPanTo(cam, gx, gy) {
  const p = worldToScreen(gx, gy);
  cam.targetX = p.x;
  cam.targetY = p.y;
}

export function updateCamera(cam, dt) {
  const k = 1 - Math.exp(-7 * dt);
  cam.x += (cam.targetX - cam.x) * k;
  cam.y += (cam.targetY - cam.y) * k;
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
  const p = worldToScreen(gx, gy);
  return {
    x: viewX + viewW / 2 + (p.x - cam.x + cam.shakeX) * cam.zoom,
    y: viewY + viewH / 2 + (p.y - cam.y + cam.shakeY) * cam.zoom,
  };
}

/** Canvas point -> fractional grid coords. */
export function unproject(cam, px, py, viewW, viewH, viewX = 0, viewY = 0) {
  const sx = (px - viewX - viewW / 2) / cam.zoom + cam.x - cam.shakeX;
  const sy = (py - viewY - viewH / 2) / cam.zoom + cam.y - cam.shakeY;
  return screenToWorld(sx, sy);
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

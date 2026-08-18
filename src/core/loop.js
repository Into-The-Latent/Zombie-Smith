// Game loop + scene stack.
//
// A scene is a plain object with any of:
//   enter(data)      called when pushed or revealed by a replace
//   exit()           called when popped
//   update(dt)       dt in seconds, clamped
//   render(ctx)
//   onResult(result) called on the parent when a child scene pops

import { endFrame, consumeInputEdges } from './input.js';
import { W, H } from '../ui/theme.js';

export const Game = {
  stack: [],
  time: 0,
  paused: false,

  /**
   * Called once a frame after every scene has drawn, as `(ctx, dt, stack)`.
   *
   * For chrome that has to appear over a whole class of screens -- the daylight
   * clock over the preparation phase. One hook rather than a call in each
   * scene, because a timer some stations forget to run is worse than none.
   */
  overlay: null,

  current() {
    return this.stack[this.stack.length - 1] || null;
  },

  push(scene, data) {
    this.stack.push(scene);
    consumeInputEdges();
    scene.enter?.(data);
    return scene;
  },

  pop(result) {
    const s = this.stack.pop();
    s?.exit?.();
    consumeInputEdges();
    const parent = this.current();
    if (parent && result !== undefined) parent.onResult?.(result);
    return s;
  },

  /** Replace the whole stack -- used for top-level screen changes. */
  replace(scene, data) {
    while (this.stack.length) this.stack.pop()?.exit?.();
    return this.push(scene, data);
  },

  /** Pop back to the scene below, then replace it. */
  swap(scene, data) {
    this.stack.pop()?.exit?.();
    return this.push(scene, data);
  },
};

let ctx = null;
let last = 0;
let rafId = 0;

export function startLoop(canvasCtx) {
  ctx = canvasCtx;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}

export function stopLoop() {
  cancelAnimationFrame(rafId);
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  // Clamp so a background tab doesn't fire one enormous step on return.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  Game.time += dt;

  const scene = Game.current();
  if (!scene) return;

  // Only the top scene updates, but scenes below still draw (modals).
  scene.update?.(dt);

  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < Game.stack.length; i++) {
    const s = Game.stack[i];
    if (i < Game.stack.length - 1 && s.renderWhenCovered === false) continue;
    s.render?.(ctx);
  }
  Game.overlay?.(ctx, dt, Game.stack);

  endFrame();
}

// Entry point: set up the canvas, wire input, start the loop on the title.

import { Game, startLoop } from './core/loop.js';
import { attachInput } from './core/input.js';
import { unlockAudio } from './core/audio.js';
import { W, H } from './ui/theme.js';
import { makeTitleScene } from './scenes/title.js';
import { makeWorkshopScene } from './scenes/workshop.js';
import { phaseClockOverlay } from './ui/clocks.js';
import { vignette } from './ui/ornament.js';
import { newGame, advanceDay, State } from './core/state.js';
import { pourProjection } from './game/chem.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

/** Keep the backing store sharp on high-DPI displays without changing the
 *  logical 1280x720 coordinate space every scene draws in. */
function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
}

sizeCanvas();
window.addEventListener('resize', sizeCanvas);

attachInput(canvas, W, H);

// Browsers keep audio suspended until the user interacts.
const wake = () => unlockAudio();
canvas.addEventListener('mousedown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });

// Daylight over the preparation screens, nightfall over the run. One hook, so
// no screen can forget the clock it is supposed to be running -- and the candle
// falloff on top of it, over the world view as well, so every screen is lit by
// the same lamp rather than merely displayed.
Game.overlay = (c, dt, stack) => {
  vignette(c, W, H, 0.5);
  phaseClockOverlay(c, dt, stack);
};

Game.push(makeTitleScene());
startLoop(ctx);

// Handy for poking at a live game from the console, and the seam the headless
// smoke test uses to start a reproducible campaign.
window.ZS = {
  Game,
  newGame,
  advanceDay,
  pourProjection,
  /** A getter, because `State` is a live binding the scenes swap out. */
  get state() {
    return State;
  },
  startCampaign(seed) {
    Game.replace(makeWorkshopScene(newGame(seed)));
  },
};

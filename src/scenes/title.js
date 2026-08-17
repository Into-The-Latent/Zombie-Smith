// Title screen.
//
// The one screen with a painted backdrop rather than a generated one. The art
// already carries the wordmark and the subtitle, so this scene deliberately
// draws neither over it -- laying a second title on top of a painted one is the
// surest way to make both look like placeholders.
//
// The menu needs no scrim. Every control here is a solid object in the game's
// own materials, and a wooden plaque with brass fittings is legible on top of
// anything; only the loose text lines are shadowed. That is the whole reason
// the interface was rebuilt out of materials in the first place.

import { Game } from '../core/loop.js';
import { Theme, W, H, Parch } from '../ui/theme.js';
import { beginUI, endUI, button, label } from '../ui/widgets.js';
import { engraved, parchmentCard } from '../ui/ornament.js';
import { image, SPLASH_SRC, drawCover } from '../core/assets.js';
import { newGame } from '../core/state.js';
import { loadGame, peekSave, deleteSave } from '../core/save.js';
import { unlockAudio, setMuted, isMuted } from '../core/audio.js';
import { makeWorkshopScene } from './workshop.js';

/** The menu column: bottom left, clear of the subtitle painted across the centre. */
const MENU = { x: 56, w: 240, bottom: 650 };

export function makeTitleScene() {
  return {
    name: 'title',
    time: 0,
    save: peekSave(),
    confirmWipe: false,

    update(dt) {
      this.time += dt;
    },

    render(ctx) {
      beginUI();

      // The art arrives a frame or more after the first paint, and may never
      // arrive at all -- a missing file, or a build served from somewhere the
      // path does not resolve. The generated skyline is still here for that,
      // and it carries the wordmark, since in that case nothing else would.
      const art = image(SPLASH_SRC);
      if (art) {
        drawCover(ctx, art, 0, 0, W, H);
      } else {
        drawGeneratedBackdrop(ctx, this.time);
        drawWordmark(ctx);
      }

      const bx = MENU.x;
      const bw = MENU.w;

      // Laid out upward from a fixed bottom, so adding or dropping the continue
      // button moves the block rather than leaving a hole in the middle of it.
      const soundY = MENU.bottom - 34;
      const startY = soundY - 78;
      const continueY = startY - 94;
      const taglineY = (this.save ? continueY : startY) - 30;

      shadowed(ctx, () => {
        label(ctx, 'Make the weapon. Then go and use it.', bx + 2, taglineY, {
          size: 15, color: '#e8dcc2',
        });
      });

      if (this.save) {
        if (button(ctx, bx, continueY, bw, 50, 'CONTINUE', { tone: 'primary', size: 15 })) {
          unlockAudio();
          const s = loadGame();
          if (s) Game.replace(makeWorkshopScene(s));
        }
        // The save summary is written information, so it is written down: a
        // paper slip, which also gives it a surface to be read against.
        parchmentCard(ctx, bx, continueY + 56, bw, 26, { amp: 1, raise: 6 });
        label(ctx, `day ${this.save.day} · ${this.save.alive} alive · ${this.save.runs} runs`,
          bx + bw / 2, continueY + 69, {
            size: 11.5, color: Parch.ink, align: 'center', baseline: 'middle',
          });
      }

      if (button(ctx, bx, startY, bw, 50, this.save ? 'NEW GAME' : 'START', {
        tone: this.save ? 'default' : 'primary', size: 15,
      })) {
        if (this.save && !this.confirmWipe) {
          this.confirmWipe = true;
        } else {
          unlockAudio();
          deleteSave();
          Game.replace(makeWorkshopScene(newGame()));
        }
      }
      if (this.confirmWipe) {
        shadowed(ctx, () => {
          label(ctx, 'Click again — this overwrites the save.', bx + 2, startY + 56, {
            size: 11.5, weight: 700, color: '#e8756c',
          });
        });
      }

      if (button(ctx, bx, soundY, 150, 34, isMuted() ? 'SOUND: OFF' : 'SOUND: ON', { size: 11.5 })) {
        unlockAudio();
        setMuted(!isMuted());
      }

      endUI(ctx);
    },
  };
}

/** Loose text over painted art needs a hard shadow or it dissolves into it. */
function shadowed(ctx, draw) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1;
  draw();
  ctx.restore();
}

/**
 * The wordmark, for the case where the art never loads.
 *
 * Set the way the painted one is -- one line, heavily tracked, in the same
 * rust red -- so the fallback reads as the same game rather than as an error.
 */
function drawWordmark(ctx) {
  engraved(ctx, 'WE ARE LOSING DAYLIGHT', W / 2, 150, {
    size: 52, spacing: 6, align: 'center', color: '#b83a2e',
  });
  label(ctx, 'A zombie game inspired by Darkest Dungeon', W / 2, 232, {
    size: 15, color: Theme.textDim, align: 'center',
  });
}

function drawGeneratedBackdrop(ctx, t) {
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#141c26');
  g.addColorStop(0.55, '#0c1016');
  g.addColorStop(1, '#07090d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const moonY = 120 + Math.sin(t * 0.2) * 3;
  ctx.fillStyle = 'rgba(200,210,225,0.16)';
  ctx.beginPath();
  ctx.arc(1060, moonY, 54, 0, Math.PI * 2);
  ctx.fill();

  drawSkyline(ctx, t);

  // Forge glow from below.
  const fg = ctx.createRadialGradient(W / 2, H + 40, 30, W / 2, H + 40, 520);
  fg.addColorStop(0, `rgba(216,96,58,${0.3 + 0.05 * Math.sin(t * 2)})`);
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, W, H);
}

function drawSkyline(ctx, t) {
  const rand = mulberry(20260816);
  const horizon = H - 150;
  // Two parallax bands of buildings.
  for (let layer = 0; layer < 2; layer++) {
    const shade = layer === 0 ? '#0f141b' : '#0a0e13';
    ctx.fillStyle = shade;
    let x = -40;
    while (x < W + 40) {
      const bw = 40 + rand() * 90;
      const bh = (layer === 0 ? 90 : 150) + rand() * (layer === 0 ? 120 : 190);
      const y = horizon + layer * 26 - bh;
      ctx.fillRect(x, y, bw, bh + 200);
      // A few windows still lit, flickering.
      if (layer === 1) {
        for (let wy = y + 14; wy < y + bh - 10; wy += 22) {
          for (let wx = x + 10; wx < x + bw - 12; wx += 18) {
            if (rand() > 0.9) {
              const flick = 0.25 + 0.15 * Math.sin(t * 1.7 + wx * 0.3 + wy);
              ctx.fillStyle = `rgba(230,180,90,${flick})`;
              ctx.fillRect(wx, wy, 6, 9);
              ctx.fillStyle = shade;
            }
          }
        }
      }
      x += bw + 6 + rand() * 18;
    }
  }
}

/** Local deterministic noise so the skyline is the same every frame. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

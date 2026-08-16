// Title screen.

import { Game } from '../core/loop.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, button, label, panel } from '../ui/widgets.js';
import { newGame } from '../core/state.js';
import { loadGame, peekSave, deleteSave } from '../core/save.js';
import { unlockAudio, setMuted, isMuted } from '../core/audio.js';
import { makeWorkshopScene } from './workshop.js';

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
      ctx.fillStyle = '#07090d';
      ctx.fillRect(0, 0, W, H);

      // Sky and a skyline of dead buildings.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#141c26');
      g.addColorStop(0.55, '#0c1016');
      g.addColorStop(1, '#07090d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const moonY = 120 + Math.sin(this.time * 0.2) * 3;
      ctx.fillStyle = 'rgba(200,210,225,0.16)';
      ctx.beginPath();
      ctx.arc(1060, moonY, 54, 0, Math.PI * 2);
      ctx.fill();

      drawSkyline(ctx, this.time);

      // Forge glow from below.
      const fg = ctx.createRadialGradient(W / 2, H + 40, 30, W / 2, H + 40, 520);
      fg.addColorStop(0, `rgba(216,96,58,${0.3 + 0.05 * Math.sin(this.time * 2)})`);
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);

      label(ctx, 'ZOMBIE', W / 2, 168, {
        size: 84, weight: 800, color: '#e8e3d8', align: 'center',
      });
      label(ctx, 'SMITH', W / 2, 246, {
        size: 84, weight: 800, color: Theme.accent, align: 'center',
      });
      label(ctx, 'Make the weapon. Then go and use it.', W / 2, 348, {
        size: 16, color: Theme.textDim, align: 'center',
      });

      const bx = W / 2 - 130;
      let by = 400;

      if (this.save) {
        if (button(ctx, bx, by, 260, 52, 'CONTINUE', { tone: 'primary', size: 16 })) {
          unlockAudio();
          const s = loadGame();
          if (s) Game.replace(makeWorkshopScene(s));
        }
        label(ctx, `day ${this.save.day} · ${this.save.alive} alive · ${this.save.runs} runs`, W / 2, by + 58, {
          size: 12, color: Theme.textFaint, align: 'center',
        });
        by += 88;
      }

      if (button(ctx, bx, by, 260, 52, this.save ? 'NEW GAME' : 'START', {
        tone: this.save ? 'default' : 'primary', size: 16,
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
        label(ctx, 'Click again — this overwrites the save.', W / 2, by + 58, {
          size: 12, weight: 700, color: Theme.bad, align: 'center',
        });
      }
      by += 76;

      if (button(ctx, bx + 60, by, 140, 36, isMuted() ? 'SOUND: OFF' : 'SOUND: ON', { size: 12 })) {
        unlockAudio();
        setMuted(!isMuted());
      }

      // Blurb.
      panel(ctx, 40, H - 128, 420, 110, { fill: 'rgba(14,18,25,0.7)' });
      label(ctx, 'Two halves of one loop', 60, H - 112, { size: 12, weight: 700, color: Theme.accent });
      label(ctx, 'Craft by hand at the bench — timing, tracking and torque decide', 60, H - 90, {
        size: 11.5, color: Theme.textDim,
      });
      label(ctx, 'what the weapon becomes. Then take it out into an isometric,', 60, H - 74, {
        size: 11.5, color: Theme.textDim,
      });
      label(ctx, 'turn-based street where noise is the real enemy.', 60, H - 58, {
        size: 11.5, color: Theme.textDim,
      });
      label(ctx, 'H in a run for the controls.', 60, H - 36, { size: 11, color: Theme.textFaint });

      endUI(ctx);
    },
  };
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

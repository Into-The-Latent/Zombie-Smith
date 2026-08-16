// The two small stations: the ammo press and the chem bench. Both are short
// skill loops that trade materials for consumables.

import { Input, keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, row, roundRect } from '../ui/widgets.js';
import { clamp } from '../core/util.js';
import { TimingBar, gradeFor } from '../game/minigames.js';
import { AMMO, MATERIALS } from '../data/materials.js';
import { canAfford, pay, logLine } from '../core/state.js';
import { makeRng } from '../core/rng.js';

const AMMO_UNLOCKS = { light: null, shell: 'wpn_shotgun', rifle: 'wpn_rifle' };

// ---------------------------------------------------------------------------
// Ammo press
// ---------------------------------------------------------------------------

export function makeAmmoScene(state, onDone) {
  const rand = makeRng((state.seed ^ (state.day * 104729)) >>> 0);

  return {
    name: 'ammo',
    state,
    rand,
    phase: 'select',
    ammoKey: 'light',
    pressesLeft: 0,
    results: [],
    produced: 0,
    bar: null,
    time: 0,
    flash: 0,

    start() {
      this.phase = 'press';
      this.pressesLeft = 6;
      this.results = [];
      this.produced = 0;
      this.bar = new TimingBar({ zoneHalf: 0.15, speed: 0.85, wander: 0.26 });
    },

    doPress() {
      const a = AMMO[this.ammoKey];
      if (!canAfford(state, a.cost)) {
        Sfx.deny();
        this.phase = 'done';
        return;
      }
      pay(state, a.cost);
      const acc = this.bar.strike();
      // A missed press still burns the materials -- that is the tension.
      const mult = acc >= 0.9 ? 1.5 : acc > 0.35 ? 1 : 0.4;
      const n = Math.max(1, Math.round(a.perCraft * mult));
      state.ammo[this.ammoKey] = (state.ammo[this.ammoKey] || 0) + n;
      this.produced += n;
      this.results.push({ acc, n });
      this.pressesLeft -= 1;
      this.flash = 0.3;
      if (acc >= 0.9) Sfx.hammerPerfect();
      else if (acc > 0.35) Sfx.press();
      else Sfx.hammerBad();
      this.bar.advance(rand, { shrink: 0.96, speedUp: 1.07 });
      if (this.pressesLeft <= 0 || !canAfford(state, a.cost)) {
        this.phase = 'done';
        logLine(state, `Pressed ${this.produced} ${AMMO[this.ammoKey].short}.`);
        Sfx.craftDone();
      }
    },

    update(dt) {
      this.time += dt;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
      if (this.phase !== 'press' && keyPressed('Escape')) {
        onDone();
        return;
      }
      if (this.phase === 'press') {
        this.bar.update(dt);
        if (keyPressed(' ') || (Input.clicked && Input.y > 250 && Input.y < 520)) {
          Input.clickConsumed = true;
          this.doPress();
        }
        if (keyPressed('Escape')) this.phase = 'done';
      }
    },

    render(ctx) {
      beginUI();
      frame(ctx, 'THE AMMO PRESS', 'One good stroke seats the primer. A bad one wastes the case.');

      if (this.phase === 'select') {
        panel(ctx, 300, 140, 680, 400, { title: 'Calibre' });
        let y = 186;
        for (const key of ['light', 'shell', 'rifle']) {
          const a = AMMO[key];
          const locked = AMMO_UNLOCKS[key] && !state.unlocks.includes(AMMO_UNLOCKS[key]);
          const sel = key === this.ammoKey;
          const r = row(ctx, 320, y, 640, 68, {
            selected: sel,
            tooltip: locked ? 'Research the matching weapon first.' : `Yields ${a.perCraft} rounds per good press.`,
          });
          label(ctx, a.name, 336, y + 10, {
            size: 15, weight: 700, color: locked ? Theme.textFaint : sel ? Theme.accent : Theme.text,
          });
          label(ctx, locked ? 'LOCKED' : `${a.perCraft} rounds per press   have ${state.ammo[key] || 0}`, 336, y + 32, {
            size: 12, color: locked ? Theme.bad : Theme.textDim, font: Theme.mono(12),
          });
          let cx = 336;
          ctx.font = Theme.font(11, 600);
          for (const [k, v] of Object.entries(a.cost)) {
            const ok = (state.resources[k] || 0) >= v;
            ctx.fillStyle = ok ? Theme.textFaint : Theme.bad;
            const txt = `${v} ${MATERIALS[k].short}`;
            ctx.fillText(txt, cx, y + 50);
            cx += ctx.measureText(txt).width + 12;
          }
          if (r === 'click' && !locked) this.ammoKey = key;
          y += 76;
        }

        const a = AMMO[this.ammoKey];
        const afford = canAfford(state, a.cost);
        if (button(ctx, 300, 566, 240, 44, 'RUN THE PRESS', {
          tone: 'primary', disabled: !afford,
          tooltip: afford ? 'Six strokes. Each one costs materials.' : 'Not enough materials for a single press.',
        })) this.start();
        if (button(ctx, 740, 566, 240, 44, 'BACK', {})) onDone();
        return;
      }

      // Press view.
      const cx = W / 2;
      ctx.fillStyle = '#191e27';
      roundRect(ctx, cx - 200, 330, 400, 150, 8);
      ctx.fill();
      ctx.strokeStyle = Theme.border;
      ctx.stroke();

      // Ram.
      const ramDrop = this.flash > 0 ? 26 * this.flash : 0;
      ctx.fillStyle = '#3a434f';
      roundRect(ctx, cx - 40, 300 + ramDrop, 80, 70, 4);
      ctx.fill();
      ctx.fillStyle = AMMO[this.ammoKey].color;
      roundRect(ctx, cx - 14, 400, 28, 44, 3);
      ctx.fill();

      if (this.phase === 'press') {
        this.bar.render(ctx, cx - 300, 250, 600, 26, { zoneColor: 'rgba(216,180,90,0.3)' });
        label(ctx, `${this.pressesLeft} strokes left`, cx, 200, {
          size: 18, weight: 700, color: Theme.text, align: 'center',
        });
        label(ctx, 'Space or click to drive the press', cx, 520, {
          size: 13, color: Theme.textDim, align: 'center',
        });
      }

      label(ctx, `${this.produced} rounds made`, cx, 560, {
        size: 22, weight: 800, color: Theme.accent, align: 'center',
      });

      let rx = cx - (this.results.length * 44) / 2;
      for (const r of this.results) {
        const g = gradeFor(r.acc);
        ctx.fillStyle = g.color;
        roundRect(ctx, rx, 596, 38, 22, 4);
        ctx.fill();
        label(ctx, `+${r.n}`, rx + 19, 607, {
          size: 12, weight: 800, color: '#10141a', align: 'center', baseline: 'middle',
        });
        rx += 44;
      }

      if (this.phase === 'done') {
        if (button(ctx, cx - 230, 646, 220, 40, 'PRESS MORE', {})) this.phase = 'select';
        if (button(ctx, cx + 10, 646, 220, 40, 'BACK TO WORKSHOP', { tone: 'primary' })) onDone();
      }
      endUI(ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Chem bench (medipacks)
// ---------------------------------------------------------------------------

const VIAL_COST = { chem: 2, cloth: 1 };

export function makeMedScene(state, onDone) {
  return {
    name: 'med',
    state,
    phase: 'select',
    fill: 0,
    filling: false,
    dir: 1,
    target: 0.72,
    vialsLeft: 0,
    results: [],
    produced: 0,
    time: 0,

    start() {
      this.phase = 'mix';
      this.vialsLeft = 3;
      this.results = [];
      this.produced = 0;
      this.fill = 0;
      this.filling = false;
      this.target = 0.7;
    },

    lockVial() {
      const d = Math.abs(this.fill - this.target);
      const acc = clamp(1 - d / 0.22, 0, 1);
      pay(state, VIAL_COST);
      let n = 0;
      if (acc >= 0.9) n = 2;
      else if (acc > 0.3) n = 1;
      state.medipacks += n;
      this.produced += n;
      this.results.push({ acc, n });
      this.vialsLeft -= 1;
      this.fill = 0;
      this.filling = false;
      this.target = 0.5 + Math.random() * 0.35;
      if (acc >= 0.9) Sfx.heal();
      else if (n) Sfx.press();
      else Sfx.hammerBad();
      if (this.vialsLeft <= 0 || !canAfford(state, VIAL_COST)) {
        this.phase = 'done';
        logLine(state, `Cooked ${this.produced} medipack${this.produced === 1 ? '' : 's'}.`);
        Sfx.craftDone();
      }
    },

    update(dt) {
      this.time += dt;
      if (this.phase !== 'mix') {
        if (keyPressed('Escape')) onDone();
        return;
      }
      const held = Input.down || Input.keys.has(' ');
      if (held) {
        this.filling = true;
        // Overfilling wraps past the top and spills back down -- releasing
        // late is as bad as releasing early.
        this.fill += dt * 0.55 * this.dir;
        if (this.fill >= 1) {
          this.fill = 1;
          this.dir = -1;
        } else if (this.fill <= 0) {
          this.fill = 0;
          this.dir = 1;
        }
      } else if (this.filling) {
        this.dir = 1;
        this.lockVial();
      }
      if (keyPressed('Escape')) this.phase = 'done';
    },

    render(ctx) {
      beginUI();
      frame(ctx, 'THE CHEM BENCH', 'Hold to draw the mix, release exactly on the line.');

      if (this.phase === 'select') {
        panel(ctx, 380, 180, 520, 280, { title: 'Medipacks' });
        label(ctx, 'Three vials per batch.', 404, 226, { size: 14, color: Theme.text });
        label(ctx, 'A clean fill yields two packs, a sloppy one yields nothing.', 404, 250, {
          size: 12, color: Theme.textDim,
        });
        label(ctx, `Cost per vial: 2 chem, 1 cloth`, 404, 288, { size: 13, weight: 700, color: Theme.accent });
        label(ctx, `In stock: ${state.medipacks} medipacks, ${state.resources.chem} chem, ${state.resources.cloth} cloth`,
          404, 314, { size: 12, color: Theme.textDim, font: Theme.mono(12) });

        const afford = canAfford(state, VIAL_COST);
        if (button(ctx, 404, 372, 220, 44, 'START MIXING', { tone: 'primary', disabled: !afford })) this.start();
        if (button(ctx, 650, 372, 220, 44, 'BACK', {})) onDone();
        endUI(ctx);
        return;
      }

      // Vial.
      const cx = W / 2;
      const vy = 200;
      const vh = 300;
      const vw = 110;
      ctx.fillStyle = '#10151c';
      roundRect(ctx, cx - vw / 2, vy, vw, vh, 10);
      ctx.fill();
      ctx.strokeStyle = Theme.border;
      ctx.lineWidth = 2;
      ctx.stroke();

      const fh = vh * this.fill;
      const grad = ctx.createLinearGradient(0, vy + vh - fh, 0, vy + vh);
      grad.addColorStop(0, '#7fe0a8');
      grad.addColorStop(1, '#2f8f5c');
      ctx.fillStyle = grad;
      roundRect(ctx, cx - vw / 2 + 4, vy + vh - fh, vw - 8, Math.max(0, fh - 4), 8);
      ctx.fill();

      // Target line.
      const ty = vy + vh - vh * this.target;
      ctx.strokeStyle = Theme.accent;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(cx - vw / 2 - 26, ty);
      ctx.lineTo(cx + vw / 2 + 26, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, 'FILL LINE', cx + vw / 2 + 34, ty - 7, { size: 11, weight: 700, color: Theme.accent });

      if (this.phase === 'mix') {
        label(ctx, `${this.vialsLeft} vials left`, cx, 150, {
          size: 18, weight: 700, color: Theme.text, align: 'center',
        });
        label(ctx, 'Hold space or the mouse button', cx, 530, {
          size: 13, color: Theme.textDim, align: 'center',
        });
      }

      label(ctx, `${this.produced} medipacks`, cx, 566, {
        size: 22, weight: 800, color: Theme.good, align: 'center',
      });

      let rx = cx - (this.results.length * 48) / 2;
      for (const r of this.results) {
        const g = gradeFor(r.acc);
        ctx.fillStyle = g.color;
        roundRect(ctx, rx, 600, 42, 22, 4);
        ctx.fill();
        label(ctx, `+${r.n}`, rx + 21, 611, {
          size: 12, weight: 800, color: '#10141a', align: 'center', baseline: 'middle',
        });
        rx += 48;
      }

      if (this.phase === 'done') {
        if (button(ctx, cx - 230, 646, 220, 40, 'MIX MORE', {
          disabled: !canAfford(state, VIAL_COST),
        })) this.phase = 'select';
        if (button(ctx, cx + 10, 646, 220, 40, 'BACK TO WORKSHOP', { tone: 'primary' })) onDone();
      }
      endUI(ctx);
    },
  };
}

function frame(ctx, title, subtitle) {
  ctx.fillStyle = Theme.bg;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 400, 30, W / 2, 400, 620);
  g.addColorStop(0, 'rgba(60,80,110,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  label(ctx, title, W / 2, 40, { size: 26, weight: 800, color: Theme.text, align: 'center' });
  label(ctx, subtitle, W / 2, 76, { size: 13, color: Theme.textDim, align: 'center' });
}

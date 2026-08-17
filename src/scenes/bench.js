// The two small stations: the ammo press and the chem bench. Both are short
// skill loops that trade materials for consumables.

import { Input, keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, row, roundRect } from '../ui/widgets.js';
import {
  TimingBar, gradeFor, pourAccuracy, medipackYield, POUR_RATE, POUR_TOLERANCE,
} from '../game/minigames.js';
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

const BATCH_COST = { chem: 3, cloth: 2 };

/**
 * A batch is three measures poured in turn. Splitting it into separate
 * ingredients is what makes the station playable: the old single-vial version
 * asked for one release inside a 40ms window, which nobody can hit, and three
 * averaged pours forgive a bad one.
 */
const INGREDIENTS = [
  { key: 'antiseptic', name: 'Antiseptic', color: '#e8a33d', hint: 'Cuts the rot out of a wound.' },
  { key: 'coagulant', name: 'Coagulant', color: '#d7443e', hint: 'Stops the bleeding.' },
  { key: 'saline', name: 'Saline', color: '#6fb7d8', hint: 'Thins the mix so it travels.' },
];

const TUBE = { w: 108, h: 264, gap: 34, y: 210 };

function tubeRect(i) {
  const total = INGREDIENTS.length * TUBE.w + (INGREDIENTS.length - 1) * TUBE.gap;
  return {
    x: W / 2 - total / 2 + i * (TUBE.w + TUBE.gap),
    y: TUBE.y,
    w: TUBE.w,
    h: TUBE.h,
  };
}

export function makeMedScene(state, onDone) {
  const rand = makeRng((state.seed ^ (state.day * 15485863)) >>> 0);

  return {
    name: 'med',
    state,
    phase: 'select',
    index: 0,
    level: 0,
    pouring: false,
    spoiled: false,
    targets: [],
    results: [],
    produced: 0,
    batches: 0,
    time: 0,

    startBatch() {
      this.phase = 'mix';
      this.index = 0;
      this.level = 0;
      this.pouring = false;
      this.spoiled = false;
      this.results = [];
      // Marks sit clear of both ends so no measure is a tap or a full tube.
      this.targets = INGREDIENTS.map(() => rand.range(0.3, 0.82));
      pay(state, BATCH_COST);
      this.batches += 1;
    },

    lockPour() {
      const acc = pourAccuracy(this.level, this.targets[this.index]);
      this.results.push({ acc, level: this.level, overflowed: this.level > 1 });
      this.pouring = false;
      this.spoiled = false;
      this.level = 0;
      this.index += 1;

      if (acc >= 0.8) Sfx.heal();
      else if (acc > 0.2) Sfx.press();
      else Sfx.hammerBad();

      if (this.index >= INGREDIENTS.length) this.finishBatch();
    },

    finishBatch() {
      const mean = this.results.reduce((a, r) => a + r.acc, 0) / this.results.length;
      const n = medipackYield(mean);
      state.medipacks += n;
      this.produced += n;
      this.mean = mean;
      this.lastYield = n;
      this.phase = 'done';
      logLine(state, `Mixed ${n} medipack${n === 1 ? '' : 's'}.`);
      if (n > 0) Sfx.craftDone();
      else Sfx.deny();
    },

    update(dt) {
      this.time += dt;

      if (this.phase !== 'mix') {
        if (keyPressed('Escape')) onDone();
        return;
      }
      if (keyPressed('Escape')) {
        this.finishBatch();
        return;
      }

      // Start on a fresh press, never on a held button. Reacting to "is held"
      // meant the click that opened the station poured the first measure and
      // locked it the instant that same click was released.
      const pressed = keyPressed(' ') || (Input.clicked && !Input.clickConsumed);
      const held = Input.keys.has(' ') || Input.down;

      if (!this.pouring && pressed) {
        Input.clickConsumed = true;
        this.pouring = true;
        return;
      }
      if (!this.pouring) return;

      this.level += dt * POUR_RATE;

      // Tip it too far and the measure is spoiled; it stops on its own.
      if (this.level > 1) {
        this.level = 1.001;
        this.spoiled = true;
        this.lockPour();
        return;
      }
      if (!held) this.lockPour();
    },

    render(ctx) {
      beginUI();
      frame(ctx, 'THE CHEM BENCH', 'Pour each measure to its mark. Hold to pour, release to stop.');

      if (this.phase === 'select') {
        panel(ctx, 340, 150, 600, 340, { title: 'Medipack batch' });
        let y = 196;
        for (const ing of INGREDIENTS) {
          ctx.fillStyle = ing.color;
          roundRect(ctx, 364, y + 3, 10, 10, 2);
          ctx.fill();
          label(ctx, ing.name, 386, y, { size: 14, weight: 700, color: Theme.text });
          label(ctx, ing.hint, 500, y + 1, { size: 12, color: Theme.textDim });
          y += 28;
        }
        y += 14;
        label(ctx, 'Three measures. A clean batch yields three packs, a rough one still yields one.',
          364, y, { size: 12, color: Theme.textDim });
        y += 26;
        label(ctx, `Cost per batch: ${Object.entries(BATCH_COST).map(([k, v]) => `${v} ${MATERIALS[k].short}`).join(', ')}`,
          364, y, { size: 13, weight: 700, color: Theme.accent });
        y += 24;
        label(ctx, `In stock: ${state.medipacks} medipacks, ${state.resources.chem} chem, ${state.resources.cloth} cloth`,
          364, y, { size: 12, color: Theme.textDim, font: Theme.mono(12) });

        const afford = canAfford(state, BATCH_COST);
        if (button(ctx, 364, 420, 240, 46, 'START A BATCH', {
          tone: 'primary', disabled: !afford,
          tooltip: afford ? 'Three measures, poured one at a time.' : 'Not enough chem or cloth.',
        })) this.startBatch();
        if (button(ctx, 676, 420, 240, 46, 'BACK', { hotkey: 'Escape' })) onDone();
        endUI(ctx);
        return;
      }

      // --- the three tubes ---------------------------------------------------
      INGREDIENTS.forEach((ing, i) => {
        const r = tubeRect(i);
        const done = i < this.index;
        const active = i === this.index && this.phase === 'mix';
        const result = this.results[i];
        const level = done ? result.level : active ? this.level : 0;
        const target = this.targets[i];

        // Glass.
        ctx.fillStyle = '#0e131a';
        roundRect(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.fill();

        // Liquid.
        const fh = Math.min(1, level) * r.h;
        if (fh > 2) {
          const grad = ctx.createLinearGradient(0, r.y + r.h - fh, 0, r.y + r.h);
          grad.addColorStop(0, ing.color);
          grad.addColorStop(1, shadeDown(ing.color));
          ctx.fillStyle = grad;
          roundRect(ctx, r.x + 4, r.y + r.h - fh, r.w - 8, Math.max(0, fh - 4), 7);
          ctx.fill();
        }

        // The mark and its tolerance band go *over* the liquid: drawn behind,
        // they vanish under the fill exactly when the player needs to see them.
        const bandH = POUR_TOLERANCE * r.h;
        const ty = r.y + r.h - target * r.h;
        ctx.fillStyle = 'rgba(226,240,232,0.14)';
        ctx.fillRect(r.x + 2, ty - bandH, r.w - 4, bandH * 2);
        ctx.strokeStyle = 'rgba(226,240,232,0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 2, ty - bandH, r.w - 4, bandH * 2);

        ctx.strokeStyle = done
          ? (result.acc > 0.5 ? Theme.good : Theme.bad)
          : Theme.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(r.x - 12, ty);
        ctx.lineTo(r.x + r.w + 12, ty);
        ctx.stroke();

        // Glass edge over the top of the liquid.
        ctx.strokeStyle = active ? Theme.accent : Theme.border;
        ctx.lineWidth = active ? 2.5 : 1.5;
        roundRect(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.stroke();

        label(ctx, ing.name.toUpperCase(), r.x + r.w / 2, r.y + r.h + 14, {
          size: 12, weight: 800, align: 'center',
          color: active ? Theme.accent : done ? Theme.textDim : Theme.textFaint,
        });

        if (done) {
          const g = gradeFor(result.acc);
          label(ctx, result.overflowed ? 'SPILLED' : g.text, r.x + r.w / 2, r.y + r.h + 34, {
            size: 11, weight: 700, color: g.color, align: 'center',
          });
        } else if (active) {
          label(ctx, 'POURING', r.x + r.w / 2, r.y + r.h + 34, {
            size: 11, weight: 700, align: 'center',
            color: this.pouring ? Theme.good : Theme.textFaint,
          });
        }
      });

      if (this.phase === 'mix') {
        const ing = INGREDIENTS[this.index];
        label(ctx, `Measure ${this.index + 1} of ${INGREDIENTS.length}: ${ing.name}`, W / 2, 150, {
          size: 18, weight: 700, color: Theme.text, align: 'center',
        });
        label(ctx, this.pouring ? 'Release on the line' : 'Hold Space or the mouse button to pour',
          W / 2, 176, { size: 13, color: this.pouring ? Theme.good : Theme.textDim, align: 'center' });
        label(ctx, 'Esc to stop and bottle what you have', W / 2, 690, {
          size: 11, color: Theme.textFaint, align: 'center',
        });
      }

      if (this.phase === 'done') {
        const n = this.lastYield ?? 0;
        label(ctx, n > 0 ? `+${n} medipack${n === 1 ? '' : 's'}` : 'The batch was ruined',
          W / 2, 528, { size: 24, weight: 800, align: 'center', color: n > 0 ? Theme.good : Theme.bad });
        label(ctx, `mixture ${Math.round((this.mean ?? 0) * 100)}%  ·  ${this.produced} made this session`,
          W / 2, 560, { size: 13, color: Theme.textDim, align: 'center' });

        const afford = canAfford(state, BATCH_COST);
        if (button(ctx, W / 2 - 230, 604, 220, 42, 'ANOTHER BATCH', {
          disabled: !afford,
          tooltip: afford ? 'Mix another.' : 'Not enough chem or cloth.',
        })) this.startBatch();
        if (button(ctx, W / 2 + 10, 604, 220, 42, 'BACK TO WORKSHOP', { tone: 'primary' })) onDone();
      }

      endUI(ctx);
    },
  };
}

function shadeDown(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.55);
  const g = Math.round(((n >> 8) & 255) * 0.55);
  const b = Math.round((n & 255) * 0.55);
  return `rgb(${r},${g},${b})`;
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

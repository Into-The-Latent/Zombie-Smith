// The chem bench: chop, pour, cook.
//
// Three stages with three different demands. Chopping is aim, pouring is
// metering with a vessel you hold in your hand, cooking is regulation. The
// mechanics themselves live in game/chem.js; this file is presentation and
// input only.

import { Input, keyPressed, setCursor } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, roundRect } from '../ui/widgets.js';
import { clamp } from '../core/util.js';
import {
  ChopBoard, chopMarks, PourBeaker, CookPot,
  batchQuality, chemYield, POUR_TILT_THRESHOLD,
} from '../game/chem.js';
import { gradeFor } from '../game/minigames.js';
import { MATERIALS } from '../data/materials.js';
import { canAfford, pay, logLine } from '../core/state.js';
import { makeRng } from '../core/rng.js';

const BATCH_COST = { chem: 3, cloth: 2 };

const INGREDIENTS = [
  { key: 'antiseptic', name: 'Antiseptic', color: '#e8a33d', target: 0.5 },
  { key: 'coagulant', name: 'Coagulant', color: '#d7443e', target: 0.62 },
  { key: 'saline', name: 'Saline', color: '#6fb7d8', target: 0.44 },
];

// Chopping board.
const BOARD = { x: 300, y: 392, w: 680, h: 92 };
// The flask that receives the pours and then goes on the burner.
const FLASK = { x: W / 2 - 62, y: 404, w: 124, h: 186 };
/** The mouth a pour has to land in, in screen space. */
const MOUTH = { x: FLASK.x + 8, y: FLASK.y - 26, w: FLASK.w - 16, h: 54 };

/**
 * Does the stream land in the flask?
 *
 * Only horizontal alignment matters, plus being above the mouth -- the liquid
 * falls, so that is what the drawn stream shows. Requiring the spout inside a
 * small box failed constantly, because the spout swings outward as the vessel
 * pivots and the player cannot predict where it will end up.
 *
 * One function, used by both the simulation and the renderer, so the stream
 * can never appear to land somewhere it does not count.
 */
function isOverMouth(spout) {
  return spout.x >= MOUTH.x && spout.x <= MOUTH.x + MOUTH.w
    && spout.y <= MOUTH.y + MOUTH.h;
}

export function makeMedScene(state, onDone) {
  const rand = makeRng((state.seed ^ (state.day * 15485863)) >>> 0);

  return {
    name: 'med',
    state,
    phase: 'select',
    time: 0,

    board: null,
    chopFlash: 0,
    bladeDrop: 0,

    beakers: [],
    pourIndex: 0,
    poured: [],

    pot: null,
    flame: 0,

    scores: { chop: 0, pour: 0, cook: 0 },
    produced: 0,
    lastYield: 0,
    ruined: false,

    exit() {
      setCursor('default');
    },

    startBatch() {
      pay(state, BATCH_COST);
      this.phase = 'chop';
      this.board = new ChopBoard(chopMarks(rand, 5));
      this.beakers = INGREDIENTS.map((ing) => new PourBeaker({
        target: ing.target * rand.range(0.9, 1.1),
      }));
      this.pourIndex = 0;
      this.poured = [];
      this.pot = null;
      this.flame = 0;
      this.ruined = false;
      this.scores = { chop: 0, pour: 0, cook: 0 };
      setCursor('default');
    },

    // --- chop ---------------------------------------------------------------
    updateChop(dt) {
      this.bladeDrop = Math.max(0, this.bladeDrop - dt * 5);
      if (this.chopFlash > 0) this.chopFlash = Math.max(0, this.chopFlash - dt * 2.5);

      if (Input.clicked && !Input.clickConsumed) {
        Input.clickConsumed = true;
        const x = clamp((Input.x - BOARD.x) / BOARD.w, 0, 1);
        const res = this.board.cut(x);
        if (!res) return;
        this.bladeDrop = 1;
        this.chopFlash = 1;
        if (res.acc >= 0.75) Sfx.melee();
        else if (res.acc > 0) Sfx.grind();
        else Sfx.hammerBad();

        if (this.board.done) {
          this.scores.chop = this.board.score;
          this.phase = 'pour';
          setCursor('none');
        }
      }
    },

    // --- pour ---------------------------------------------------------------
    updatePour(dt) {
      const beaker = this.beakers[this.pourIndex];
      if (!beaker) return;

      const spout = beakerSpout(Input.x, Input.y, beaker.tilt);
      const flowed = beaker.update(dt, Input.down, isOverMouth(spout));
      if (flowed > 0 && Math.random() < 0.35) Sfx.grind();

      // Commit the measure by setting the vessel down, or when it runs dry.
      const commit = keyPressed(' ') || Input.rightClicked
        || (beaker.remaining <= 0 && beaker.stopped);
      if (commit && beaker.stopped) {
        this.poured.push({ ing: INGREDIENTS[this.pourIndex], beaker, acc: beaker.score });
        if (beaker.score >= 0.75) Sfx.press();
        else if (beaker.score > 0.2) Sfx.click();
        else Sfx.hammerBad();
        this.pourIndex += 1;

        if (this.pourIndex >= this.beakers.length) {
          this.scores.pour = this.poured.reduce((a, p) => a + p.acc, 0) / this.poured.length;
          this.phase = 'cook';
          this.pot = new CookPot();
          setCursor('default');
        }
      }
    },

    // --- cook ---------------------------------------------------------------
    updateCook(dt) {
      const heating = Input.down || Input.keys.has(' ');
      this.flame += ((heating ? 1 : 0) - this.flame) * clamp(dt * 7, 0, 1);
      this.pot.update(dt, heating);

      if (this.pot.done) {
        this.scores.cook = this.pot.score;
        this.ruined = this.pot.ruined;
        this.finish();
      }
    },

    finish() {
      const quality = batchQuality(this.scores);
      const n = chemYield(quality, this.ruined);
      state.medipacks += n;
      this.produced += n;
      this.quality = quality;
      this.lastYield = n;
      this.phase = 'done';
      setCursor('default');
      logLine(state, this.ruined
        ? 'Scorched a batch of medipacks.'
        : `Mixed ${n} medipack${n === 1 ? '' : 's'}.`);
      if (n > 0) Sfx.craftDone();
      else Sfx.deny();
    },

    update(dt) {
      this.time += dt;

      if (keyPressed('Escape')) {
        if (this.phase === 'select' || this.phase === 'done') {
          onDone();
        } else {
          // Walking away mid-batch wastes it -- the materials are already in.
          setCursor('default');
          this.phase = 'select';
          Sfx.deny();
          logLine(state, 'Abandoned a half-made batch.');
        }
        return;
      }

      switch (this.phase) {
        case 'chop': this.updateChop(dt); break;
        case 'pour': this.updatePour(dt); break;
        case 'cook': this.updateCook(dt); break;
        default: break;
      }
    },

    render(ctx) {
      beginUI();
      backdrop(ctx, this.time, this.phase === 'cook' ? this.flame : 0);

      switch (this.phase) {
        case 'select': renderSelect(this, ctx, state, onDone); break;
        case 'chop': renderChop(this, ctx); break;
        case 'pour': renderPour(this, ctx); break;
        case 'cook': renderCook(this, ctx); break;
        case 'done': renderDone(this, ctx, state, onDone); break;
        default: break;
      }

      if (this.phase !== 'select' && this.phase !== 'done') {
        stageStrip(ctx, this.phase);
        label(ctx, 'Esc to abandon the batch', W / 2, 692, {
          size: 11, color: Theme.textFaint, align: 'center',
        });
      }
      endUI(ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

const STAGES = [
  ['chop', 'CHOP'],
  ['pour', 'POUR'],
  ['cook', 'COOK'],
];

function stageStrip(ctx, phase) {
  const idx = STAGES.findIndex(([k]) => k === phase);
  const pipW = 84;
  const startX = W / 2 - (STAGES.length * (pipW + 10) - 10) / 2;
  STAGES.forEach(([, name], i) => {
    const x = startX + i * (pipW + 10);
    ctx.fillStyle = i < idx ? Theme.good : i === idx ? Theme.accent : '#242c37';
    roundRect(ctx, x, 108, pipW, 5, 2.5);
    ctx.fill();
    label(ctx, name, x + pipW / 2, 120, {
      size: 10, weight: 800, align: 'center',
      color: i < idx ? Theme.good : i === idx ? Theme.accent : Theme.textFaint,
    });
  });
}

function backdrop(ctx, t, flame) {
  ctx.fillStyle = Theme.bg;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 420, 30, W / 2, 420, 640);
  g.addColorStop(0, 'rgba(60,84,110,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (flame > 0.02) {
    const fg = ctx.createRadialGradient(W / 2, 600, 20, W / 2, 600, 420);
    const a = 0.1 + 0.06 * Math.sin(t * 12) * flame;
    fg.addColorStop(0, `rgba(226,110,50,${a * flame + 0.06 * flame})`);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, W, H);
  }

  // Bench surface.
  ctx.fillStyle = '#151a22';
  ctx.fillRect(0, 596, W, H - 596);
  ctx.strokeStyle = Theme.border;
  ctx.beginPath();
  ctx.moveTo(0, 596.5);
  ctx.lineTo(W, 596.5);
  ctx.stroke();
}

function header(ctx, title, sub, subColor = Theme.textDim) {
  label(ctx, title, W / 2, 40, { size: 26, weight: 800, color: Theme.text, align: 'center' });
  label(ctx, sub, W / 2, 76, { size: 13.5, color: subColor, align: 'center' });
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

function renderSelect(scene, ctx, state, onDone) {
  header(ctx, 'THE CHEM BENCH', 'Chop the ingredients, pour the measures, cook it without scorching it.');

  panel(ctx, 340, 152, 600, 356, { title: 'Medipack batch' });
  let y = 200;
  for (const [name, text] of [
    ['1. Chop', 'Bring the blade down on each mark. Aim, not speed.'],
    ['2. Pour', 'The beaker is in your hand. Hold to tip it, release to stop.'],
    ['3. Cook', 'Hold the burner to climb, let go to coast. Do not scorch it.'],
  ]) {
    label(ctx, name, 366, y, { size: 14, weight: 700, color: Theme.accent });
    label(ctx, text, 470, y + 1, { size: 12, color: Theme.textDim });
    y += 30;
  }

  y += 12;
  label(ctx, 'Each beaker holds more than the recipe wants. You can top a measure up,', 366, y, {
    size: 12, color: Theme.textDim,
  });
  label(ctx, 'but you can never take any back out.', 366, y + 18, { size: 12, color: Theme.textDim });
  y += 52;
  label(ctx, `Cost per batch: ${Object.entries(BATCH_COST).map(([k, v]) => `${v} ${MATERIALS[k].short}`).join(', ')}`,
    366, y, { size: 13, weight: 700, color: Theme.accent });
  y += 24;
  label(ctx, `In stock: ${state.medipacks} medipacks, ${state.resources.chem} chem, ${state.resources.cloth} cloth`,
    366, y, { size: 12, color: Theme.textDim, font: Theme.mono(12) });
  y += 20;
  label(ctx, 'A clean batch makes four packs. A scorched one makes none.', 366, y, {
    size: 12, color: Theme.textFaint,
  });

  const afford = canAfford(state, BATCH_COST);
  if (button(ctx, 366, 440, 240, 46, 'START A BATCH', {
    tone: 'primary', disabled: !afford,
    tooltip: afford ? 'Three stages, start to finish.' : 'Not enough chem or cloth.',
  })) scene.startBatch();
  if (button(ctx, 674, 440, 240, 46, 'BACK', { hotkey: 'Escape' })) onDone();
}

// ---------------------------------------------------------------------------
// Chop
// ---------------------------------------------------------------------------

function renderChop(scene, ctx) {
  const b = scene.board;
  const left = b.marks.filter((m) => !m.cut).length;
  header(ctx, 'CHOP THE INGREDIENTS',
    left ? `Click on each mark. ${left} left.` : 'Done.');

  // Board.
  ctx.fillStyle = '#3a2c1e';
  roundRect(ctx, BOARD.x - 14, BOARD.y - 14, BOARD.w + 28, BOARD.h + 28, 8);
  ctx.fill();
  ctx.strokeStyle = '#4b3a27';
  ctx.lineWidth = 2;
  ctx.stroke();

  // The strip of ingredient, split at every cut that landed.
  const cuts = b.marks.filter((m) => m.cut).map((m) => m.x).sort((x, z) => x - z);
  const edges = [0, ...cuts, 1];
  for (let i = 0; i < edges.length - 1; i++) {
    const x0 = BOARD.x + edges[i] * BOARD.w;
    const x1 = BOARD.x + edges[i + 1] * BOARD.w;
    const inset = i === 0 || i === edges.length - 2 ? 0 : 2;
    ctx.fillStyle = i % 2 === 0 ? '#7fa06a' : '#71915e';
    roundRect(ctx, x0 + inset, BOARD.y, Math.max(1, x1 - x0 - inset * 2), BOARD.h, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Marks still to cut, plus the grade of the ones already done.
  for (const m of b.marks) {
    const x = BOARD.x + m.x * BOARD.w;
    if (m.cut) {
      ctx.strokeStyle = m.acc > 0.7 ? Theme.good : m.acc > 0 ? Theme.warn : Theme.bad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, BOARD.y - 10);
      ctx.lineTo(x, BOARD.y + BOARD.h + 10);
      ctx.stroke();
    } else {
      // Tolerance band, so the player can see how much slack there is.
      const tol = b.tolerance * BOARD.w;
      ctx.fillStyle = 'rgba(232,163,61,0.14)';
      ctx.fillRect(x - tol, BOARD.y, tol * 2, BOARD.h);
      ctx.strokeStyle = 'rgba(232,163,61,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, BOARD.y - 6);
      ctx.lineTo(x, BOARD.y + BOARD.h + 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Blade, tracking the mouse along the board only.
  const bx = clamp(Input.x, BOARD.x, BOARD.x + BOARD.w);
  const drop = scene.bladeDrop * 26;
  drawCleaver(ctx, bx, BOARD.y - 92 + drop);

  if (b.lastCut && scene.chopFlash > 0) {
    const g = gradeFor(b.lastCut.acc);
    ctx.globalAlpha = clamp(scene.chopFlash, 0, 1);
    label(ctx, b.lastCut.wild ? 'MANGLED' : g.text, BOARD.x + b.lastCut.x * BOARD.w, BOARD.y + BOARD.h + 34, {
      size: 15, weight: 800, color: g.color, align: 'center',
    });
    ctx.globalAlpha = 1;
  }

  const cutsMade = b.marks.length - left;
  if (cutsMade > 0) {
    const live = b.partialScore;
    label(ctx, `evenness ${Math.round(live * 100)}% over ${cutsMade} cut${cutsMade === 1 ? '' : 's'}`,
      W / 2, 556, {
        size: 14, weight: 700, align: 'center',
        color: live > 0.7 ? Theme.good : live > 0.4 ? Theme.warn : Theme.bad,
      });
  }
}

function drawCleaver(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  // Handle.
  ctx.fillStyle = '#5a3f28';
  roundRect(ctx, -5, -46, 10, 34, 3);
  ctx.fill();
  // Blade.
  ctx.fillStyle = '#c3ccd6';
  ctx.beginPath();
  ctx.moveTo(-22, -12);
  ctx.lineTo(22, -12);
  ctx.lineTo(22, 58);
  ctx.lineTo(-22, 66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e6edf5';
  ctx.beginPath();
  ctx.moveTo(-22, 66);
  ctx.lineTo(22, 58);
  ctx.lineTo(22, 66);
  ctx.lineTo(-22, 74);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-22, -12, 44, 70);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pour
// ---------------------------------------------------------------------------

const BEAKER = { w: 62, h: 74 };

/** Where the lip of a tilted beaker sits, given the hand position. */
function beakerSpout(hx, hy, tilt) {
  const a = tilt * 1.45; // radians of pivot at full tilt
  const lipX = BEAKER.w * 0.5;
  const lipY = -BEAKER.h * 0.5;
  return {
    x: hx + lipX * Math.cos(a) - lipY * Math.sin(a),
    y: hy + lipX * Math.sin(a) + lipY * Math.cos(a),
    angle: a,
  };
}

function renderPour(scene, ctx) {
  const i = scene.pourIndex;
  const ing = INGREDIENTS[i];
  const beaker = scene.beakers[i];

  header(ctx, `POUR THE ${ing.name.toUpperCase()}`,
    Input.down ? 'Release to stop the flow' : 'Hold the left mouse button to tip the beaker',
    Input.down ? Theme.good : Theme.textDim);

  drawFlask(ctx, scene, i);

  // What the recipe asks for, against what has gone in.
  const barX = W / 2 - 150;
  label(ctx, 'IN THE FLASK', barX, 168, { size: 10.5, weight: 700, color: Theme.textFaint });
  const scale = Math.max(beaker.capacity, beaker.target * 1.4);
  bar(ctx, barX, 186, 300, 16, beaker.poured / scale, 1, ing.color, { text: '' });
  // Target mark with its tolerance band.
  const tx = barX + (beaker.target / scale) * 300;
  const tw = (beaker.tolerance / scale) * 300;
  ctx.fillStyle = 'rgba(226,240,232,0.16)';
  ctx.fillRect(tx - tw, 182, tw * 2, 24);
  ctx.strokeStyle = Theme.accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(tx, 178);
  ctx.lineTo(tx, 210);
  ctx.stroke();
  label(ctx, 'MARK', tx, 214, { size: 9.5, weight: 700, color: Theme.accent, align: 'center' });

  const acc = beaker.score;
  const settled = beaker.stopped;
  ctx.globalAlpha = settled ? 1 : 0.45;
  label(ctx, `${Math.round(acc * 100)}%`, barX + 316, 184, {
    size: 17, weight: 800,
    color: !settled ? Theme.textDim
      : acc > 0.7 ? Theme.good : acc > 0.35 ? Theme.warn : Theme.bad,
  });
  ctx.globalAlpha = 1;
  label(ctx, settled ? 'accuracy' : 'still settling', barX + 316, 204, {
    size: 9.5, color: Theme.textFaint,
  });
  label(ctx, `beaker ${Math.round(beaker.fillFraction * 100)}% left`, barX - 132, 188, {
    size: 12, color: Theme.textDim,
  });
  if (beaker.spilled > 0.001) {
    label(ctx, `${Math.round((beaker.spilled / beaker.capacity) * 100)}% on the bench`, barX - 132, 206, {
      size: 11, weight: 700, color: Theme.bad,
    });
  }

  // The stream, drawn from the lip to wherever it lands.
  const spout = beakerSpout(Input.x, Input.y, beaker.tilt);
  const aligned = isOverMouth(spout);
  if (beaker.tilt > POUR_TILT_THRESHOLD && beaker.remaining > 0) {
    const landY = aligned ? MOUTH.y + 10 : 596;
    ctx.strokeStyle = ing.color;
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(spout.x, spout.y);
    ctx.bezierCurveTo(spout.x + 4, spout.y + 30, spout.x - 2, landY - 40, spout.x, landY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!aligned) {
      ctx.fillStyle = 'rgba(215,68,62,0.55)';
      ctx.beginPath();
      ctx.ellipse(spout.x, 598, 26, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, 'MISSING THE FLASK', spout.x, 562, {
        size: 11, weight: 800, color: Theme.bad, align: 'center',
      });
    }
  }

  // Aiming aid: a guide from the lip straight down, and a lit rim when the
  // stream would land in the flask.
  if (!aligned || beaker.tilt <= POUR_TILT_THRESHOLD) {
    ctx.strokeStyle = aligned ? 'rgba(79,180,119,0.5)' : 'rgba(140,155,175,0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(spout.x, spout.y);
    ctx.lineTo(spout.x, MOUTH.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (aligned) {
    ctx.strokeStyle = Theme.good;
    ctx.lineWidth = 3;
    roundRect(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, 6);
    ctx.stroke();
  }

  drawBeaker(ctx, Input.x, Input.y, beaker, ing);

  // Prompt to commit, once the vessel is upright again.
  if (beaker.stopped) {
    const tone = acc > 0.7 ? Theme.good : Theme.accent;
    label(ctx, beaker.remaining <= 0
      ? 'The beaker is empty -- setting it down'
      : 'Space or right click to set it down and take the next',
    W / 2, 640, { size: 13, weight: 700, color: tone, align: 'center' });
  }

  // Measures already committed.
  let sx = 40;
  for (const p of scene.poured) {
    const g = gradeFor(p.acc);
    ctx.fillStyle = p.ing.color;
    roundRect(ctx, sx, 168, 8, 8, 2);
    ctx.fill();
    label(ctx, p.ing.name, sx + 16, 166, { size: 11.5, weight: 700, color: Theme.text });
    label(ctx, g.text, sx + 16, 182, { size: 10.5, weight: 700, color: g.color });
    sx += 118;
  }
}

function drawFlask(ctx, scene, upTo) {
  // Glass.
  ctx.fillStyle = 'rgba(12,18,24,0.85)';
  roundRect(ctx, FLASK.x, FLASK.y, FLASK.w, FLASK.h, 12);
  ctx.fill();

  // Layers of everything poured so far, plus the one in progress.
  let acc = 0;
  const total = 2.2; // full flask, in the same units as the beakers
  const layers = [...scene.poured.map((p) => ({ color: p.ing.color, amount: p.beaker.poured }))];
  if (upTo < scene.beakers.length) {
    layers.push({ color: INGREDIENTS[upTo].color, amount: scene.beakers[upTo].poured });
  }
  for (const l of layers) {
    const h = (l.amount / total) * FLASK.h;
    if (h <= 0.5) continue;
    ctx.fillStyle = l.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(FLASK.x + 4, FLASK.y + FLASK.h - acc - h, FLASK.w - 8, h);
    ctx.globalAlpha = 1;
    acc += h;
  }

  // Neck and mouth.
  ctx.fillStyle = '#1b232c';
  roundRect(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, 6);
  ctx.fill();
  ctx.strokeStyle = Theme.borderHi;
  ctx.lineWidth = 2;
  roundRect(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, 6);
  ctx.stroke();

  ctx.strokeStyle = Theme.borderHi;
  ctx.lineWidth = 2;
  roundRect(ctx, FLASK.x, FLASK.y, FLASK.w, FLASK.h, 12);
  ctx.stroke();

  // Graduations.
  ctx.strokeStyle = 'rgba(226,240,232,0.18)';
  ctx.lineWidth = 1;
  for (let g = 1; g < 5; g++) {
    const gy = FLASK.y + FLASK.h - (g / 5) * FLASK.h;
    ctx.beginPath();
    ctx.moveTo(FLASK.x + FLASK.w - 26, gy);
    ctx.lineTo(FLASK.x + FLASK.w - 6, gy);
    ctx.stroke();
  }
}

function drawBeaker(ctx, hx, hy, beaker, ing) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(beaker.tilt * 1.45);

  const w = BEAKER.w;
  const h = BEAKER.h;
  const x = -w / 2;
  const y = -h / 2;

  // Liquid, sitting in the bottom of the vessel.
  const fill = beaker.fillFraction;
  ctx.fillStyle = 'rgba(14,20,26,0.9)';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  if (fill > 0.01) {
    ctx.fillStyle = ing.color;
    const fh = fill * (h - 8);
    roundRect(ctx, x + 4, y + h - 4 - fh, w - 8, fh, 4);
    ctx.fill();
  }

  ctx.strokeStyle = '#cfd8e3';
  ctx.lineWidth = 2.5;
  roundRect(ctx, x, y, w, h, 6);
  ctx.stroke();

  // Lip, on the pouring side.
  ctx.fillStyle = '#e6edf5';
  roundRect(ctx, x + w - 12, y - 5, 16, 7, 3);
  ctx.fill();

  ctx.restore();

  // A small hand-hold marker so the cursor position stays obvious.
  ctx.fillStyle = 'rgba(232,163,61,0.9)';
  ctx.beginPath();
  ctx.arc(hx, hy, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Cook
// ---------------------------------------------------------------------------

function renderCook(scene, ctx) {
  const pot = scene.pot;
  header(ctx, 'COOK IT',
    pot.tooHot ? 'TOO HOT -- ease off' : pot.inBand ? 'Holding it right there' : 'Hold to heat, release to coast',
    pot.tooHot ? Theme.bad : pot.inBand ? Theme.good : Theme.textDim);

  // Burner under the flask.
  const flame = scene.flame;
  const cx = W / 2;
  if (flame > 0.02) {
    for (let i = 0; i < 7; i++) {
      const fx = cx - 42 + i * 14;
      const fh = (16 + Math.sin(scene.time * 14 + i) * 7 + i % 3 * 4) * flame;
      const g = ctx.createLinearGradient(0, 596 - fh, 0, 596);
      g.addColorStop(0, `rgba(255,214,120,${0.85 * flame})`);
      g.addColorStop(1, `rgba(226,96,40,${0.35 * flame})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx - 5, 596);
      ctx.quadraticCurveTo(fx, 596 - fh, fx + 5, 596);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#2a323c';
  roundRect(ctx, cx - 66, 588, 132, 12, 4);
  ctx.fill();

  // The flask, tinted by how hot it is.
  drawFlask(ctx, scene, scene.beakers.length);
  const heat = clamp(pot.temp, 0, 1);
  ctx.fillStyle = `rgba(255,${Math.round(150 - heat * 90)},60,${heat * 0.3})`;
  roundRect(ctx, FLASK.x + 4, FLASK.y + 4, FLASK.w - 8, FLASK.h - 8, 10);
  ctx.fill();

  // Bubbles once it is working.
  if (pot.inBand || pot.tooHot) {
    for (let i = 0; i < 6; i++) {
      const t = (scene.time * (0.6 + i * 0.13)) % 1;
      const bx = FLASK.x + 22 + ((i * 37) % (FLASK.w - 44));
      const by = FLASK.y + FLASK.h - 10 - t * (FLASK.h - 30);
      ctx.fillStyle = `rgba(255,255,255,${0.25 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(bx, by, 2 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Temperature column.
  const gx = 300;
  const gy = 210;
  const gh = 330;
  ctx.fillStyle = '#0e131a';
  roundRect(ctx, gx, gy, 46, gh, 8);
  ctx.fill();

  const bandTop = gy + gh - pot.bandHi * gh;
  const bandH = (pot.bandHi - pot.bandLo) * gh;
  ctx.fillStyle = 'rgba(79,180,119,0.22)';
  ctx.fillRect(gx + 2, bandTop, 42, bandH);
  ctx.strokeStyle = 'rgba(79,180,119,0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(gx + 2, bandTop, 42, bandH);

  const th = pot.temp * gh;
  const tg = ctx.createLinearGradient(0, gy + gh - th, 0, gy + gh);
  tg.addColorStop(0, pot.tooHot ? '#ff7a4a' : '#ffc46a');
  tg.addColorStop(1, '#8a3a20');
  ctx.fillStyle = tg;
  roundRect(ctx, gx + 6, gy + gh - th, 34, Math.max(0, th), 5);
  ctx.fill();

  ctx.strokeStyle = Theme.borderHi;
  ctx.lineWidth = 1.5;
  roundRect(ctx, gx, gy, 46, gh, 8);
  ctx.stroke();
  label(ctx, 'HEAT', gx + 23, gy - 20, { size: 10.5, weight: 700, color: Theme.textFaint, align: 'center' });
  label(ctx, 'SIMMER', gx + 56, bandTop + bandH / 2 - 6, { size: 10.5, weight: 700, color: Theme.good });

  // Cooked and scorched.
  const px = 780;
  label(ctx, 'COOKED', px, 250, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, px, 268, 220, 18, pot.progress, 1, Theme.good, { text: `${Math.round(pot.progress * 100)}%` });
  label(ctx, 'SCORCHED', px, 310, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, px, 328, 220, 18, pot.scorch, 1, pot.scorch > 0.6 ? Theme.bad : Theme.warn,
    { text: `${Math.round(pot.scorch * 100)}%` });
  label(ctx, 'Scorch it completely and the batch is lost.', px, 356, {
    size: 11, color: pot.scorch > 0.4 ? Theme.bad : Theme.textFaint,
  });

  label(ctx, 'Hold the left mouse button or Space', W / 2, 648, {
    size: 12.5, color: Theme.textDim, align: 'center',
  });
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

function renderDone(scene, ctx, state, onDone) {
  const n = scene.lastYield;
  header(ctx, scene.ruined ? 'SCORCHED' : 'BOTTLED',
    scene.ruined ? 'The whole batch went black in the flask.' : 'Sealed and shelved.',
    scene.ruined ? Theme.bad : Theme.textDim);

  panel(ctx, 400, 150, 480, 300, { title: 'Batch report' });
  let y = 200;
  for (const [key, name] of STAGES) {
    const v = scene.scores[key] ?? 0;
    label(ctx, name, 428, y, { size: 12, weight: 700, color: Theme.textFaint });
    const tone = v > 0.75 ? Theme.good : v > 0.45 ? Theme.warn : Theme.bad;
    bar(ctx, 520, y + 1, 240, 14, v, 1, tone, { text: `${Math.round(v * 100)}%` });
    label(ctx, gradeFor(v).text, 772, y + 1, { size: 10.5, weight: 700, color: tone });
    y += 30;
  }

  y += 16;
  label(ctx, 'BATCH QUALITY', 428, y, { size: 11, weight: 700, color: Theme.textFaint });
  label(ctx, `${Math.round((scene.quality ?? 0) * 100)}%`, 760, y - 6, {
    size: 24, weight: 800, align: 'right',
    color: scene.ruined ? Theme.bad : Theme.accent,
  });

  y += 48;
  label(ctx, n > 0 ? `+${n} medipack${n === 1 ? '' : 's'}` : 'Nothing usable',
    640, y, { size: 26, weight: 800, align: 'center', color: n > 0 ? Theme.good : Theme.bad });
  y += 36;
  label(ctx, `${scene.produced} made this session · ${state.medipacks} in store`, 640, y, {
    size: 12, color: Theme.textDim, align: 'center',
  });

  const afford = canAfford(state, BATCH_COST);
  if (button(ctx, 410, 482, 220, 44, 'ANOTHER BATCH', {
    disabled: !afford,
    tooltip: afford ? 'Mix another.' : 'Not enough chem or cloth.',
  })) scene.startBatch();
  if (button(ctx, 650, 482, 220, 44, 'BACK TO WORKSHOP', { tone: 'primary' })) onDone();
}

// The chem bench: chop, pour, cook.
//
// Three stages with three different demands. Chopping is aim, pouring is
// metering with a vessel you hold in your hand, cooking is regulation. The
// mechanics themselves live in game/chem.js; this file is presentation and
// input only.

import { Input, keyPressed, setCursor } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, roundRect, hintBar } from '../ui/widgets.js';
import { clamp } from '../core/util.js';
import {
  ChopBoard, chopMarks, PourBeaker, CookPot,
  batchQuality, chemYield, pourScore, pourProjection, addSpill, CHOP_CORE_FRACTION,
  VESSEL, surfaceAt, lipAt, toMl, mlLabel,
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
/**
 * Dead time after the last cut before the board can be left.
 *
 * The stage used to advance on the very click that finished it, so the one
 * thing the player was working towards -- the finished board -- was on screen
 * for a single frame.
 */
const CHOP_REVIEW_LOCK = 0.4;
// The flask that receives the pours and then goes on the burner.
const FLASK = { x: W / 2 - 62, y: 404, w: 124, h: 186 };
/** The mouth a pour has to land in, in screen space. */
const MOUTH = { x: FLASK.x + 8, y: FLASK.y - 26, w: FLASK.w - 16, h: 54 };
/** The part of the glass liquid may occupy -- clear of the neck. */
const LIQUID = { top: FLASK.y + 30, bottom: FLASK.y + FLASK.h - 5 };

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
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    state,
    phase: 'select',
    time: 0,

    board: null,
    chopFlash: 0,
    bladeDrop: 0,
    chopDone: false,
    reviewT: 0,

    beakers: [],
    pourIndex: 0,
    poured: [],
    /** Puddles on the bench: `{x, amount, color}`, merged when they touch. */
    spills: [],
    /** Falling droplets, for when the flow is too slow to be a stream. */
    drops: [],
    dripAcc: 0,
    holding: false,
    /**
     * A stage ignores a held button until it has seen it up once.
     *
     * Without this the input that ends one stage carries into the next: the
     * click that leaves the finished board would tip the first beaker before
     * the player had even looked at it.
     */
    armed: false,

    pot: null,
    flame: 0,

    scores: { chop: 0, pour: 0, cook: 0 },
    produced: 0,
    lastYield: 0,
    ruined: false,
    /** Why the batch died, when it did. */
    failure: '',

    exit() {
      setCursor('default');
    },

    startBatch() {
      pay(state, BATCH_COST);
      this.phase = 'chop';
      this.board = new ChopBoard(chopMarks(rand, 5));
      this.chopDone = false;
      this.reviewT = 0;
      this.beakers = INGREDIENTS.map((ing) => new PourBeaker({
        target: ing.target * rand.range(0.9, 1.1),
      }));
      this.pourIndex = 0;
      this.poured = [];
      this.spills = [];
      this.drops = [];
      this.dripAcc = 0;
      this.holding = false;
      this.armed = false;
      this.pot = null;
      this.flame = 0;
      this.ruined = false;
      this.failure = '';
      this.scores = { chop: 0, pour: 0, cook: 0 };
      setCursor('default');
    },

    // --- chop ---------------------------------------------------------------
    updateChop(dt) {
      this.bladeDrop = Math.max(0, this.bladeDrop - dt * 5);
      if (this.chopFlash > 0) this.chopFlash = Math.max(0, this.chopFlash - dt * 2.5);

      // The board stays up once it is finished. Leaving it is a separate,
      // deliberate press, locked out briefly so the click that made the last
      // cut cannot double as the one that skips past the result.
      if (this.chopDone) {
        this.reviewT += dt;
        const go = keyPressed(' ') || (Input.clicked && !Input.clickConsumed);
        if (this.reviewT > CHOP_REVIEW_LOCK && go) {
          Input.clickConsumed = true;
          this.phase = 'pour';
          this.armed = false;
          setCursor('none');
          Sfx.click();
        }
        return;
      }

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
          this.chopDone = true;
          this.reviewT = 0;
        }
      }
    },

    // --- pour ---------------------------------------------------------------
    updatePour(dt) {
      const beaker = this.beakers[this.pourIndex];
      if (!beaker) return;

      if (!this.armed && !Input.down) this.armed = true;
      this.holding = this.armed && Input.down;

      const spout = beakerSpout(Input.x, Input.y, beaker.tilt);
      const aligned = isOverMouth(spout);
      const flowed = beaker.update(dt, this.holding, aligned);
      if (flowed > 0 && Math.random() < 0.35) Sfx.grind();
      if (flowed > 0 && !aligned) addSpill(this.spills, spout.x, flowed, INGREDIENTS[this.pourIndex].color);

      // Once the flow is slower than a stream it breaks into drops. They are
      // shed at the lip and fall on their own, so a drop already in the air does
      // not follow the cursor around.
      if (beaker.dripping) {
        this.dripAcc += flowed;
        if (this.dripAcc >= DROP_VOLUME) {
          this.dripAcc -= DROP_VOLUME;
          this.drops.push({
            x: spout.x, y: spout.y, vy: 0,
            landY: aligned ? MOUTH.y + 6 : BENCH_Y,
            color: INGREDIENTS[this.pourIndex].color,
          });
        }
      } else {
        this.dripAcc = 0;
      }
      advanceDrops(this.drops, dt);

      // Commit the measure by setting the vessel down, or when it runs dry.
      const commit = keyPressed(' ') || Input.rightClicked
        || (beaker.remaining <= 0 && beaker.stopped);
      if (commit && beaker.stopped) {
        const ing = INGREDIENTS[this.pourIndex];
        this.poured.push({ ing, beaker, acc: beaker.score, short: beaker.short });
        // Too little of an active ingredient and there is no medicine in the
        // flask, however well the rest of it goes.
        if (beaker.short) {
          this.ruined = true;
          this.failure = `Not enough ${ing.name.toLowerCase()} -- ${mlLabel(beaker.poured)} of ${mlLabel(beaker.minimum)} needed.`;
          Sfx.deny();
        }
        if (beaker.short) Sfx.hammerBad();
        else if (beaker.score >= 0.75) Sfx.press();
        else if (beaker.score > 0.2) Sfx.click();
        else Sfx.hammerBad();
        this.pourIndex += 1;
        this.armed = false;
        this.holding = false;

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
      if (!this.armed && !Input.down && !Input.keys.has(' ')) this.armed = true;
      const heating = this.armed && (Input.down || Input.keys.has(' '));
      this.flame += ((heating ? 1 : 0) - this.flame) * clamp(dt * 7, 0, 1);
      this.pot.update(dt, heating);

      if (this.pot.done) {
        this.scores.cook = this.pot.score;
        if (this.pot.ruined) {
          this.ruined = true;
          this.failure = 'Scorched black in the flask.';
        }
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
        ? `Wasted a batch of medipacks. ${this.failure}`
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
        hintBar(ctx, W / 2, 682, stageHints(this));
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

const ABANDON = { key: 'ESC', text: 'abandon the batch' };

/** Everything the current stage will respond to, spelled out. */
function stageHints(scene) {
  switch (scene.phase) {
    case 'chop':
      return scene.chopDone
        ? [{ key: 'SPACE / LMB', text: 'on to the measures', tone: Theme.accent }, ABANDON]
        : [{ key: 'LMB', text: 'bring the blade down on the mark' }, ABANDON];
    case 'pour':
      return [
        { key: 'HOLD LMB', text: 'tip the beaker', tone: scene.holding ? Theme.good : undefined },
        { key: 'SPACE / RMB', text: 'set it down' },
        ABANDON,
      ];
    case 'cook':
      return [
        { key: 'HOLD LMB / SPACE', text: 'work the burner' },
        { key: 'RELEASE', text: 'let it coast' },
        ABANDON,
      ];
    default:
      return [ABANDON];
  }
}

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

  panel(ctx, 340, 148, 600, 392, { title: 'Medipack batch' });
  let y = 200;
  for (const [name, text] of [
    ['1. Chop', 'Bring the blade down on each mark. Aim, not speed.'],
    ['2. Pour', 'Tip the beaker until the liquid clears its lip.'],
    ['3. Cook', 'Hold the burner to climb, let go to coast. Do not scorch it.'],
  ]) {
    label(ctx, name, 366, y, { size: 14, weight: 700, color: Theme.accent });
    label(ctx, text, 470, y + 1, { size: 12, color: Theme.textDim });
    y += 30;
  }

  y += 12;
  for (const line of [
    'Liquid leaves a beaker when its surface clears the lip, so a full one tips',
    'out at a touch and an emptying one has to be turned right over. It keeps',
    'running as your wrist comes back, so aim with the projected mark, not the',
    'level. You can top a measure up; you can never take any back out.',
    'Every ingredient has a minimum. Fall below it and there is no medicine in',
    'the flask at all, however well the rest of the batch goes.',
  ]) {
    label(ctx, line, 366, y, { size: 12, color: Theme.textDim });
    y += 17;
  }
  y += 14;
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
  if (button(ctx, 366, 474, 240, 46, 'START A BATCH', {
    tone: 'primary', disabled: !afford, hotkey: 'Enter',
    tooltip: afford ? 'Three stages, start to finish.' : 'Not enough chem or cloth.',
  })) scene.startBatch();
  if (button(ctx, 674, 474, 240, 46, 'BACK', { hotkey: 'Escape' })) onDone();

  hintBar(ctx, W / 2, 566, [
    { key: 'LMB', text: 'chop and pour' },
    { key: 'SPACE', text: 'set a beaker down, work the burner' },
    { key: 'ESC', text: 'back out' },
  ]);
}

// ---------------------------------------------------------------------------
// Chop
// ---------------------------------------------------------------------------

function renderChop(scene, ctx) {
  const b = scene.board;
  const left = b.marks.filter((m) => !m.cut).length;
  const review = scene.chopDone;
  header(ctx, review ? 'BOARD FINISHED' : 'CHOP THE INGREDIENTS',
    review ? 'Every piece as it came out. Take a look before you move on.'
      : `Click on each mark. ${left} left.`,
    review ? Theme.accent : Theme.textDim);

  // Board.
  ctx.fillStyle = '#3a2c1e';
  roundRect(ctx, BOARD.x - 14, BOARD.y - 14, BOARD.w + 28, BOARD.h + 28, 8);
  ctx.fill();
  ctx.strokeStyle = '#4b3a27';
  ctx.lineWidth = 2;
  ctx.stroke();

  // The strip of ingredient, split where the blade actually came down. Cutting
  // it at the guide marks instead meant a mangled board and a flawless one
  // produced identical pieces, so the player could not see their own mistake.
  const cuts = b.marks.filter((m) => m.cut).map((m) => m.at).sort((x, z) => x - z);
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

  // Which mark this cut will actually be judged against. A cut always resolves
  // to the nearest mark still standing, so after one miss the next click can
  // silently be scored against a mark the player was not aiming at -- and the
  // whole rest of the board cascades. Showing the target makes that impossible
  // to walk into.
  const bladeAt = clamp((Input.x - BOARD.x) / BOARD.w, 0, 1);
  const target = review ? null : b.nextMark(bladeAt)?.m;

  // Guide marks still waiting, with the slack they allow.
  for (const m of b.marks) {
    if (m.cut) continue;
    const x = BOARD.x + m.x * BOARD.w;
    const tol = b.tolerance * BOARD.w;
    const next = m === target;

    ctx.fillStyle = next ? 'rgba(232,163,61,0.2)' : 'rgba(232,163,61,0.06)';
    ctx.fillRect(x - tol, BOARD.y, tol * 2, BOARD.h);
    // The core, where the cut counts as clean rather than close.
    if (next) {
      const core = tol * CHOP_CORE_FRACTION;
      ctx.fillStyle = 'rgba(79,180,119,0.26)';
      ctx.fillRect(x - core, BOARD.y, core * 2, BOARD.h);
    }
    ctx.strokeStyle = next ? 'rgba(232,163,61,0.95)' : 'rgba(232,163,61,0.3)';
    ctx.lineWidth = next ? 2 : 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, BOARD.y - 6);
    ctx.lineTo(x, BOARD.y + BOARD.h + 6);
    ctx.stroke();
    ctx.setLineDash([]);

    // Everything marking the target sits below the board: above it is where the
    // cleaver hangs, and it covered the label completely.
    if (next) {
      const ty = BOARD.y + BOARD.h + 16;
      ctx.fillStyle = Theme.accent;
      ctx.beginPath();
      ctx.moveTo(x, ty - 5);
      ctx.lineTo(x - 5, ty + 3);
      ctx.lineTo(x + 5, ty + 3);
      ctx.closePath();
      ctx.fill();
      label(ctx, 'NEXT CUT', x, ty + 6, {
        size: 9.5, weight: 800, color: Theme.accent, align: 'center',
      });

      // A tie from the blade to the mark it will actually be judged against.
      const bx2 = clamp(Input.x, BOARD.x, BOARD.x + BOARD.w);
      if (Math.abs(bx2 - x) > tol) {
        ctx.strokeStyle = 'rgba(232,163,61,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(bx2, ty - 1);
        ctx.lineTo(x, ty - 1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Cuts already made. While chopping these are knife marks in steel, drawn
  // where the blade landed, with a tie back to the mark that was aimed at so
  // the error is legible. The grading colour is saved for the review.
  for (const m of b.marks) {
    if (!m.cut) continue;
    const at = BOARD.x + m.at * BOARD.w;
    const aim = BOARD.x + m.x * BOARD.w;

    if (Math.abs(at - aim) > 1.5) {
      ctx.strokeStyle = review
        ? 'rgba(255,255,255,0.2)'
        : 'rgba(232,163,61,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(aim, BOARD.y - 4);
      ctx.lineTo(aim, BOARD.y + BOARD.h + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      // The gap between aim and blade, called out along the bottom edge.
      ctx.strokeStyle = review ? gradeFor(m.acc).color : 'rgba(226,240,232,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.min(at, aim), BOARD.y + BOARD.h + 7);
      ctx.lineTo(Math.max(at, aim), BOARD.y + BOARD.h + 7);
      ctx.stroke();
    }

    ctx.strokeStyle = review
      ? (m.acc > 0.7 ? Theme.good : m.acc > 0 ? Theme.warn : Theme.bad)
      : '#e6edf5';
    ctx.lineWidth = review ? 2 : 2.5;
    ctx.beginPath();
    ctx.moveTo(at, BOARD.y - 10);
    ctx.lineTo(at, BOARD.y + BOARD.h + 10);
    ctx.stroke();
  }

  // Blade, tracking the mouse along the board only. Lifted away once the board
  // is done, so nothing sits over the result the player is being shown.
  if (!review) {
    const bx = clamp(Input.x, BOARD.x, BOARD.x + BOARD.w);
    const drop = scene.bladeDrop * 26;
    drawCleaver(ctx, bx, BOARD.y - 92 + drop);
  }

  if (b.lastCut && scene.chopFlash > 0 && !review) {
    const g = gradeFor(b.lastCut.acc);
    ctx.globalAlpha = clamp(scene.chopFlash, 0, 1);
    label(ctx, b.lastCut.wild ? 'MANGLED' : g.text, BOARD.x + b.lastCut.x * BOARD.w, BOARD.y + BOARD.h + 40, {
      size: 15, weight: 800, color: g.color, align: 'center',
    });
    ctx.globalAlpha = 1;
  }

  if (review) {
    chopResult(ctx, b, scene.reviewT);
    return;
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

/** Every cut, graded, held on screen until the player chooses to move on. */
function chopResult(ctx, board, reviewT) {
  const s = board.score;
  const tone = s > 0.7 ? Theme.good : s > 0.4 ? Theme.warn : Theme.bad;

  // A grade over each cut, at the blade, not at the mark it was aiming for.
  board.marks.forEach((m) => {
    const x = BOARD.x + (m.at ?? m.x) * BOARD.w;
    const g = gradeFor(m.acc);
    label(ctx, m.acc === 0 ? 'MANGLED' : g.text, x, BOARD.y - 34, {
      size: 10.5, weight: 800, color: m.acc === 0 ? Theme.bad : g.color, align: 'center',
    });
  });

  label(ctx, 'EVENNESS', W / 2 - 118, 528, { size: 11, weight: 700, color: Theme.textFaint });
  bar(ctx, W / 2 - 118, 546, 180, 18, s, 1, tone, { text: `${Math.round(s * 100)}%` });
  label(ctx, gradeFor(s).text, W / 2 + 74, 548, { size: 14, weight: 800, color: tone });
  label(ctx, `${board.marks.length} cuts · this sets how well the batch mixes`, W / 2, 574, {
    size: 11.5, color: Theme.textFaint, align: 'center',
  });

  // The prompt appears only once the lock is up, so it never invites a press
  // that will be swallowed.
  if (reviewT > CHOP_REVIEW_LOCK) {
    const pulse = 0.72 + 0.28 * Math.sin(reviewT * 5);
    ctx.globalAlpha = pulse;
    label(ctx, 'SPACE OR CLICK TO POUR THE MEASURES', W / 2, 618, {
      size: 14, weight: 800, color: Theme.accent, align: 'center',
    });
    ctx.globalAlpha = 1;
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

// Clearly taller than it is wide. At a near-square 62x74 a tipped beaker read
// as an orange diamond, because nothing about the silhouette said which end
// was the top.
/** Where puddles sit -- clear of the bench's top edge, not straddling it. */
const BENCH_Y = 607;

/**
 * How much liquid makes one drop.
 *
 * 0.3ml, so the ~2.4ml that leaves during the drip phase of a pour becomes eight
 * drops over a third of a second, which reads as dripping rather than as one
 * stray blob.
 */
const DROP_VOLUME = 0.003;
/** Pixels per second squared. Fast enough to read as falling, not floating. */
const DROP_GRAVITY = 1400;

/** Move every drop, and drop the ones that have landed. */
function advanceDrops(drops, dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.vy += DROP_GRAVITY * dt;
    d.y += d.vy * dt;
    if (d.y >= d.landY) drops.splice(i, 1);
  }
}

function drawDrops(ctx, drops) {
  for (const d of drops) {
    // Stretched along the fall, the way a falling droplet actually reads.
    const stretch = clamp(1 + d.vy / 900, 1, 2.6);
    ctx.fillStyle = d.color;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, 2.2, 2.2 * stretch, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(d.x - 0.6, d.y - 1.4 * stretch, 0.7, 0.9 * stretch, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Every puddle, drawn flat on the bench with a wet edge. */
function drawSpills(ctx, spills) {
  for (const s of spills) {
    // Sized purely by volume, with no minimum: a fixed base radius meant a
    // fraction of a millilitre painted a puddle the size of a real spill.
    if (s.amount < DROP_VOLUME * 0.5) continue;
    const rx = Math.sqrt(s.amount) * 96;
    const ry = 2 + Math.sqrt(s.amount) * 14;
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.ellipse(s.x, BENCH_Y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(s.x, BENCH_Y + ry * 0.35, rx * 0.82, ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(s.x, BENCH_Y, rx, ry, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// The vessel comes from the physics, not from here: liquid leaves it when the
// surface clears the lip, so the drawn shape has to be the simulated shape.
const BEAKER = { w: VESSEL.w, h: VESSEL.h };
/**
 * How much narrower the base is than the rim.
 *
 * Pronounced on purpose: the physics fixes the vessel's proportions, and at that
 * aspect ratio a straight-sided glass reads as a diamond the moment it is tipped.
 */
const BEAKER_TAPER = 12;
/** Glass left above the fill line, so a full flask still looks like glassware. */
const FLASK_HEADROOM = 1.16;

/** Where the lip of a tilted beaker sits, given the hand position. */
function beakerSpout(hx, hy, tilt) {
  const a = tilt * VESSEL.maxAngle;
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

  const spout = beakerSpout(Input.x, Input.y, beaker.tilt);
  const aligned = isOverMouth(spout);

  // Where the measure ends up if the button comes up this instant. The vessel
  // dribbles after release, so the number worth watching is this one, not the
  // amount already in the flask.
  const extra = pourProjection(beaker);
  const landing = aligned ? beaker.poured + extra : beaker.poured;
  const spillAfter = aligned ? beaker.spilled : beaker.spilled + extra;
  const settled = beaker.stopped;
  const acc = settled ? beaker.score : pourScore(beaker, landing, spillAfter);
  const wouldRuin = landing < beaker.minimum;

  // The warning lives in the header, because the beaker follows the cursor and
  // covered anything written across the middle of the bench.
  const needsMore = !beaker.pouring && beaker.remaining > 0;
  const sub = wouldRuin
    ? `Under ${mlLabel(beaker.minimum)} and the batch is dead -- keep pouring`
    : scene.holding
      ? (needsMore
        ? 'Tip it further -- the liquid is not over the lip yet'
        : 'Release to stop the flow -- it keeps running as it comes back')
      : 'Hold the left mouse button over the flask to tip the beaker';
  header(ctx, `POUR ${mlLabel(beaker.target).toUpperCase()} OF ${ing.name.toUpperCase()}`, sub,
    wouldRuin ? Theme.bad
      : scene.holding && !needsMore ? Theme.good
        : scene.holding ? Theme.warn : Theme.textDim);

  drawFlask(ctx, scene, i);

  // What the recipe asks for, against what has gone in.
  const barX = W / 2 - 150;
  label(ctx, 'IN THE FLASK', barX, 152, { size: 10.5, weight: 700, color: Theme.textFaint });
  // Scaled to the mark, not to the beaker: the vessel holds well over twice what
  // the recipe wants, and against the full capacity the mark and its bands were
  // squeezed into a third of the bar.
  const scale = beaker.target * 2;
  const at = (v) => barX + clamp(v / scale, 0, 1) * 300;
  bar(ctx, barX, 186, 300, 16, beaker.poured / scale, 1, ing.color, { text: '' });
  // The mark, its tolerance, and the inner band that counts as a clean measure.
  const tx = at(beaker.target);
  const tw = (beaker.tolerance / scale) * 300;
  const sw = (beaker.sweet / scale) * 300;
  ctx.fillStyle = 'rgba(226,240,232,0.14)';
  ctx.fillRect(tx - tw, 182, tw * 2, 24);
  ctx.fillStyle = 'rgba(79,180,119,0.32)';
  ctx.fillRect(tx - sw, 182, sw * 2, 24);
  // Below the minimum the whole batch is dead, so it gets a hard boundary rather
  // than a shade: everything left of this line is a ruined medipack.
  const mx = at(beaker.minimum);
  ctx.fillStyle = 'rgba(215,68,62,0.16)';
  ctx.fillRect(barX, 182, mx - barX, 24);
  ctx.strokeStyle = Theme.bad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx, 180);
  ctx.lineTo(mx, 208);
  ctx.stroke();
  label(ctx, `MIN ${toMl(beaker.minimum)}`, mx - 5, 214, {
    size: 9, weight: 800, color: Theme.bad, align: 'right',
  });

  ctx.strokeStyle = Theme.accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(tx, 178);
  ctx.lineTo(tx, 210);
  ctx.stroke();
  label(ctx, mlLabel(beaker.target), tx, 214, {
    size: 9.5, weight: 700, color: Theme.accent, align: 'center',
  });

  // Ghost tick for the projected landing, while there is still liquid moving.
  if (!settled && extra > 0.001) {
    const gx = at(landing);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx, 174);
    ctx.lineTo(gx, 212);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Everything the player meters by is a volume, not a percentage: the reading
  // that matters is where the measure lands, in the units the recipe is written
  // in. The score is a grade word, which is what a grade is.
  const shownTone = acc > 0.7 ? Theme.good : acc > 0.35 ? Theme.warn : Theme.bad;
  label(ctx, mlLabel(landing), barX + 316, 180, { size: 19, weight: 800, color: shownTone });
  const errMl = toMl(landing) - toMl(beaker.target);
  label(ctx, errMl === 0 ? 'on the mark'
    : errMl > 0 ? `${errMl} ml over` : `${-errMl} ml short`,
  barX + 316, 203, { size: 11, weight: 700, color: errMl === 0 ? Theme.good : shownTone });
  label(ctx, wouldRuin ? 'BELOW MINIMUM' : settled ? gradeFor(acc).text : 'if you stop now',
    barX + 316, 219, {
      size: 9.5, weight: 800, color: wouldRuin ? Theme.bad : Theme.textFaint,
    });

  label(ctx, `${mlLabel(beaker.remaining)} in the beaker`, barX - 150, 182, {
    size: 12, color: Theme.textDim,
  });
  if (beaker.spilled > 0.001) {
    label(ctx, `${mlLabel(beaker.spilled)} on the bench`, barX - 150, 200, {
      size: 11, weight: 700, color: Theme.bad,
    });
  }
  // How far the wrist has to go before anything comes out at all -- the thing
  // that changes as the vessel empties.
  if (!beaker.pouring && beaker.remaining > 0) {
    label(ctx, `tip past ${Math.round(beaker.tiltToPour * VESSEL.maxAngle * 57.3)}\u00b0 to pour`,
      barX - 150, beaker.spilled > 0.001 ? 218 : 200, { size: 10.5, color: Theme.textFaint });
  }

  // Everything already on the bench, under the stream that is adding to it.
  drawSpills(ctx, scene.spills);
  drawDrops(ctx, scene.drops);

  // The stream, drawn from the lip to wherever it lands. Its width tracks the
  // flow -- the same quantity the physics pours by -- so the fade as the wrist
  // comes back is visible in the liquid, not only in the numbers. Below a
  // stream's worth of flow it is not drawn at all: that is the dripping case,
  // and drawing a hairline there left a permanent thread down the screen.
  if (beaker.pouring && !beaker.dripping) {
    const over = clamp(beaker.flowRate / beaker.maxFlow, 0, 1);
    const landY = aligned ? MOUTH.y + 10 : BENCH_Y;
    ctx.strokeStyle = ing.color;
    ctx.lineWidth = 1.6 + over * 3.4;
    ctx.globalAlpha = 0.55 + over * 0.35;
    ctx.beginPath();
    ctx.moveTo(spout.x, spout.y);
    ctx.bezierCurveTo(spout.x + 4, spout.y + 30, spout.x - 2, landY - 40, spout.x, landY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!aligned) {
      // Splash where it is landing, on top of the puddle it is feeding.
      const splash = 7 + over * 9;
      ctx.fillStyle = ing.color;
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        const d = splash * (0.5 + ((i * 37) % 11) / 11);
        ctx.beginPath();
        ctx.ellipse(spout.x + Math.cos(a) * d, BENCH_Y - 3 - Math.abs(Math.sin(a)) * 5,
          2, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      label(ctx, 'MISSING THE FLASK', spout.x, 562, {
        size: 11, weight: 800, color: Theme.bad, align: 'center',
      });
    }
  }

  // Aiming aid. When the stream would miss, the useful information is which way
  // to move, so the guide leans towards the flask instead of dropping straight
  // down alongside the wasted liquid.
  if (!aligned) {
    ctx.strokeStyle = 'rgba(215,68,62,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(spout.x, spout.y);
    ctx.lineTo(clamp(spout.x, MOUTH.x + 10, MOUTH.x + MOUTH.w - 10), MOUTH.y - 8);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (!beaker.pouring) {
    ctx.strokeStyle = 'rgba(79,180,119,0.5)';
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
  if (settled) {
    const tone = acc > 0.7 ? Theme.good : Theme.accent;
    const err = toMl(beaker.poured) - toMl(beaker.target);
    label(ctx, beaker.short
      ? `Only ${mlLabel(beaker.poured)} -- setting this down kills the batch. Esc to start over.`
      : `${mlLabel(beaker.poured)} measured, ${err === 0 ? 'dead on' : err > 0 ? `${err} over` : `${-err} short`}. Set it down to take the next.`,
    W / 2, 640, { size: 13, weight: 700, color: beaker.short ? Theme.bad : tone, align: 'center' });
  }

  // Measures already committed.
  let sx = 40;
  for (const p of scene.poured) {
    const g = gradeFor(p.acc);
    ctx.fillStyle = p.ing.color;
    roundRect(ctx, sx, 168, 8, 8, 2);
    ctx.fill();
    label(ctx, p.ing.name, sx + 16, 160, { size: 11.5, weight: 700, color: Theme.text });
    label(ctx, mlLabel(p.beaker.poured), sx + 16, 175, { size: 11, weight: 700, color: p.ing.color });
    label(ctx, p.short ? 'TOO LITTLE' : g.text, sx + 16, 190, {
      size: 10, weight: 700, color: p.short ? Theme.bad : g.color,
    });
    sx += 118;
  }
}

function drawFlask(ctx, scene, upTo) {
  // Neck, drawn only where it stands clear of the body. Filling the whole
  // mouth rect painted over the top of the glass, so a full flask hid its own
  // level behind the neck.
  ctx.fillStyle = '#161d25';
  roundRect(ctx, MOUTH.x, MOUTH.y, MOUTH.w, FLASK.y - MOUTH.y + 10, 6);
  ctx.fill();

  // Glass.
  ctx.fillStyle = 'rgba(12,18,24,0.85)';
  roundRect(ctx, FLASK.x, FLASK.y, FLASK.w, FLASK.h, 12);
  ctx.fill();

  // Layers of everything poured so far, plus the one in progress.
  //
  // The scale comes from the recipe, not a fixed number. Against a flat 2.2 a
  // perfect batch of three measures reached barely two thirds of the glass and
  // read as short, which is exactly the wrong feedback for a flawless pour.
  let acc = 0;
  const recipe = scene.beakers.reduce((a, b) => a + b.target, 0);
  const total = Math.max(0.01, recipe * FLASK_HEADROOM);
  const colH = LIQUID.bottom - LIQUID.top;
  const layers = [...scene.poured.map((p) => ({ color: p.ing.color, amount: p.beaker.poured }))];
  if (upTo < scene.beakers.length) {
    layers.push({ color: INGREDIENTS[upTo].color, amount: scene.beakers[upTo].poured });
  }
  for (const l of layers) {
    const h = (l.amount / total) * colH;
    if (h <= 0.5) continue;
    ctx.fillStyle = l.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(FLASK.x + 4, LIQUID.bottom - acc - h, FLASK.w - 8, h);
    ctx.globalAlpha = 1;
    acc += h;
  }

  ctx.strokeStyle = Theme.borderHi;
  ctx.lineWidth = 2;
  roundRect(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, 6);
  ctx.stroke();
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

  // The fill line: where the liquid sits when all three measures are right.
  const ly = LIQUID.bottom - (recipe / total) * colH;
  ctx.strokeStyle = 'rgba(232,163,61,0.85)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(FLASK.x - 6, ly);
  ctx.lineTo(FLASK.x + FLASK.w + 6, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  label(ctx, 'FULL', FLASK.x + FLASK.w + 10, ly - 5, {
    size: 9.5, weight: 700, color: Theme.accent,
  });

  // The surface, so the burner can tint and bubble the liquid rather than the
  // empty glass above it.
  return LIQUID.bottom - acc;
}

/** The vessel outline in local space, centred on the hand, lip towards +x. */
function beakerPath(ctx) {
  const { w, h } = BEAKER;
  const x = -w / 2;
  const y = -h / 2;
  const taper = BEAKER_TAPER;
  ctx.beginPath();
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x + taper, y + h - 3);
  ctx.quadraticCurveTo(x + taper, y + h, x + taper + 4, y + h);
  ctx.lineTo(x + w - taper - 4, y + h);
  ctx.quadraticCurveTo(x + w - taper, y + h, x + w - taper, y + h - 3);
  ctx.lineTo(x + w, y + 3);
  ctx.closePath();
}

function drawBeaker(ctx, hx, hy, beaker, ing) {
  const a = beaker.angle;
  const { w, h } = BEAKER;
  const x = -w / 2;
  const y = -h / 2;
  const taper = BEAKER_TAPER;

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(a);

  beakerPath(ctx);
  ctx.fillStyle = 'rgba(14,20,26,0.88)';
  ctx.fill();

  // The liquid stays level with the bench, not with the glass, and its surface
  // comes from the same function the physics pours by -- so when the stream is
  // running you can see that the liquid really has reached the lip.
  const fill = beaker.fill;
  if (fill > 0.005) {
    ctx.save();
    beakerPath(ctx);
    ctx.clip();
    ctx.rotate(-a);
    const surface = surfaceAt(a, fill);
    ctx.fillStyle = ing.color;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(-w - h, surface, (w + h) * 2, (w + h) * 2);
    ctx.globalAlpha = 1;
    // A bright meniscus, so the level is readable at a glance while it drops.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w - h, surface);
    ctx.lineTo(w + h, surface);
    ctx.stroke();
    ctx.restore();
  }

  // The height the surface has to reach before anything pours, drawn level with
  // the bench inside the glass. This is the rule of the stage made visible: tip
  // until the liquid is over this line.
  ctx.save();
  beakerPath(ctx);
  ctx.clip();
  ctx.rotate(-a);
  const lip = lipAt(a);
  ctx.strokeStyle = beaker.pouring ? 'rgba(255,255,255,0.35)' : 'rgba(232,163,61,0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(-w - h, lip);
  ctx.lineTo(w + h, lip);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.strokeStyle = '#cfd8e3';
  ctx.lineWidth = 2.5;
  beakerPath(ctx);
  ctx.stroke();

  // Graduations, drawn over the liquid because they are etched on the glass --
  // and because under it they vanished the moment the beaker was full.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  for (let g = 1; g < 5; g++) {
    const gy = y + (g / 5) * h;
    const inset = 5 + taper * (1 - g / 5);
    ctx.beginPath();
    ctx.moveTo(x + inset, gy);
    ctx.lineTo(x + inset + (g % 2 ? 8 : 13), gy);
    ctx.stroke();
  }

  // Spout: a proper pulled lip, which is the end the liquid leaves from.
  ctx.fillStyle = '#e6edf5';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 10, y + 2);
  ctx.lineTo(w / 2 + 9, y - 5);
  ctx.lineTo(w / 2 + 9, y + 2);
  ctx.lineTo(w / 2 - 5, y + 10);
  ctx.closePath();
  ctx.fill();
  // Rim, so the open top is unmistakable.
  ctx.strokeStyle = '#f2f6fb';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x + w, y + 3);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Cook
// ---------------------------------------------------------------------------

function renderCook(scene, ctx) {
  const pot = scene.pot;
  const sub = pot.tooHot ? 'TOO HOT -- ease off'
    : pot.inBand ? 'Holding it right there'
      : pot.tooCold ? 'GOING DULL -- get the heat back under it'
        : 'Hold to heat, release to coast';
  header(ctx, 'COOK IT', sub,
    pot.tooHot || pot.tooCold ? Theme.bad : pot.inBand ? Theme.good : Theme.textDim);

  // Burner under the flask.
  // The burner has to be wider than the glass, or every tongue of flame is
  // drawn behind the flask and the stage looks unheated while it boils.
  const flame = scene.flame;
  const cx = W / 2;
  const base = 594;
  if (flame > 0.02) {
    for (let i = 0; i < 13; i++) {
      const fx = cx - 84 + i * 14;
      // Deliberately not tapered towards the edges: the edge tongues are the
      // only ones the glass does not hide, so they carry the whole effect.
      const fh = (26 + Math.sin(scene.time * 14 + i) * 9 + (i % 3) * 6) * flame;
      const g = ctx.createLinearGradient(0, base - fh, 0, base);
      g.addColorStop(0, `rgba(255,214,120,${0.9 * flame})`);
      g.addColorStop(1, `rgba(226,96,40,${0.35 * flame})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx - 6, base);
      ctx.quadraticCurveTo(fx, base - fh, fx + 6, base);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#2a323c';
  roundRect(ctx, cx - 86, base - 2, 172, 12, 4);
  ctx.fill();
  // Anything slopped earlier is still on the bench, next to the burner.
  drawSpills(ctx, scene.spills);
  // Tripod legs, so the flask reads as standing over the flame.
  ctx.strokeStyle = '#39424e';
  ctx.lineWidth = 3;
  for (const off of [-70, 70]) {
    ctx.beginPath();
    ctx.moveTo(cx + off, base);
    ctx.lineTo(cx + off * 0.82, FLASK.y + FLASK.h - 4);
    ctx.stroke();
  }

  // The flask, tinted by how hot it is -- over the liquid only, since a red
  // wash across the empty glass read as another layer sitting on top.
  const surface = drawFlask(ctx, scene, scene.beakers.length);
  const heat = clamp(pot.temp, 0, 1);
  ctx.fillStyle = `rgba(255,${Math.round(150 - heat * 90)},60,${heat * 0.3})`;
  ctx.fillRect(FLASK.x + 4, surface, FLASK.w - 8, LIQUID.bottom - surface);

  // Bubbles once it is working, rising to the surface and no further.
  if (pot.inBand || pot.tooHot) {
    const depth = Math.max(12, LIQUID.bottom - surface);
    for (let i = 0; i < 7; i++) {
      const t = (scene.time * (0.6 + i * 0.13)) % 1;
      const bx = FLASK.x + 22 + ((i * 37) % (FLASK.w - 44));
      const by = LIQUID.bottom - 6 - t * (depth - 8);
      ctx.fillStyle = `rgba(255,255,255,${0.3 * (1 - t)})`;
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
  const bandBottom = bandTop + bandH;

  // Once it has simmered, falling back below the band is a cost rather than
  // just slow progress, so the cold end is marked as somewhere not to be.
  if (pot.started) {
    ctx.fillStyle = 'rgba(96,124,168,0.16)';
    ctx.fillRect(gx + 2, bandBottom, 42, gy + gh - bandBottom);
    ctx.strokeStyle = 'rgba(120,150,196,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx + 2, bandBottom + 0.5);
    ctx.lineTo(gx + 44, bandBottom + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, 'GOES DULL', gx + 56, bandBottom + 8, {
      size: 10, weight: 700, color: pot.tooCold ? Theme.bad : 'rgba(120,150,196,0.75)',
    });
  }

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

  // Cooked, and the two ways to spoil it.
  const px = 780;
  label(ctx, 'COOKED', px, 240, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, px, 258, 220, 18, pot.progress, 1, Theme.good, { text: `${Math.round(pot.progress * 100)}%` });

  label(ctx, 'SCORCHED', px, 300, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, px, 318, 220, 18, pot.scorch, 1, pot.scorch > 0.6 ? Theme.bad : Theme.warn,
    { text: `${Math.round(pot.scorch * 100)}%` });
  label(ctx, 'Scorch it completely and the batch is lost.', px, 342, {
    size: 11, color: pot.scorch > 0.4 ? Theme.bad : Theme.textFaint,
  });

  label(ctx, 'DULL', px, 378, {
    size: 10.5, weight: 700, color: pot.tooCold ? Theme.bad : Theme.textFaint,
  });
  bar(ctx, px, 396, 220, 18, pot.dull, 1, pot.dull > 0.5 ? Theme.bad : Theme.info,
    { text: `${Math.round(pot.dull * 100)}%` });
  label(ctx, pot.started
    ? 'It has been up to temperature. Let it drop and it goes flat.'
    : 'Once it simmers, it has to stay there.', px, 420, {
    size: 11, color: pot.dull > 0.3 ? Theme.bad : Theme.textFaint,
  });
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

function renderDone(scene, ctx, state, onDone) {
  const n = scene.lastYield;
  header(ctx, scene.ruined ? 'RUINED' : 'BOTTLED',
    scene.ruined ? scene.failure || 'The batch came to nothing.' : 'Sealed and shelved.',
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
    disabled: !afford, hotkey: 'Enter',
    tooltip: afford ? 'Mix another.' : 'Not enough chem or cloth.',
  })) scene.startBatch();
  if (button(ctx, 650, 482, 220, 44, 'BACK TO WORKSHOP', { tone: 'primary', hotkey: 'Escape' })) onDone();

  hintBar(ctx, W / 2, 552, [
    { key: 'ENTER', text: 'mix another batch' },
    { key: 'ESC', text: 'back to the workshop' },
  ]);
}

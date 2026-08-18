// The forge: pick a pattern, pick your stock, then earn the weapon's stats
// across three hands-on stages.

import { Input, keyPressed, setCursor, consumeInputEdges } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H, Brass, Ink } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, row, roundRect, dim, hintBar } from '../ui/widgets.js';
import { backdrop, engraved, withAlpha, carvedRect, inkContour } from '../ui/ornament.js';
import { clamp } from '../core/util.js';
import { forgiveness, gradeFor } from '../game/minigames.js';
import {
  Blank, Edge, Bolt, fitScore, COLD, HOT, EDGE_TARGET, EDGE_RUIN, BOLT_STRIP,
} from '../game/smith.js';
import { mix } from '../ui/palette.js';
import { buildWeapon, weaponStats, tierFor, profileLabel } from '../game/craft.js';
import { templatesFor, WEAPON_TEMPLATES } from '../data/weapons.js';
import { STOCK, stockList, MATERIALS } from '../data/materials.js';
import { canAfford, pay, logLine } from '../core/state.js';
import { CLASSES } from '../data/progression.js';
import { makeRng } from '../core/rng.js';

const STAGE_TITLES = {
  shape: 'SHAPE THE BLANK',
  grind: 'GRIND THE EDGE',
  fit: 'FIT AND TORQUE',
};

export function makeForgeScene(state, onDone) {
  const rand = makeRng((state.seed ^ (state.day * 7919)) >>> 0);

  const scene = {
    name: 'forge',
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    state,
    rand,
    phase: 'select',
    tplKey: templatesFor(state.unlocks)[0]?.key || 'pipe_club',
    stockKey: 'scrap_steel',
    crafterId: state.survivors.find((s) => s.status !== 'dead')?.id || null,
    scores: {},
    stageIndex: 0,
    stages: [],
    result: null,
    time: 0,
    grade: null,
    gradeTimer: 0,

    // --- shape state
    heat: 1,
    reheats: 3,
    strikesLeft: 0,
    strikeLog: [],
    bar: null,

    // --- grind state
    trace: null,

    // --- fit state
    dial: null,
    bolts: [],
    boltsLeft: 0,

    enter() {},

    /** Whatever tool was in hand, the pointer comes back with the player. */
    exit() {
      setCursor('default');
    },

    update(dt) {
      this.time += dt;
      if (this.gradeTimer > 0) this.gradeTimer = Math.max(0, this.gradeTimer - dt);

      switch (this.phase) {
        case 'shape': updateShape(this, dt); break;
        case 'grind': updateGrind(this, dt); break;
        case 'fit': updateFit(this, dt); break;
        default: break;
      }

      if (keyPressed('Escape')) {
        // Backing out of a stage throws the piece away; from the picker or the
        // result card it just leaves the forge.
        if (this.phase === 'select' || this.phase === 'result') onDone();
        else abandon(this, state);
      }
    },

    render(ctx) {
      beginUI();
      background(ctx, this.time);
      switch (this.phase) {
        case 'select': renderSelect(this, ctx, state); break;
        case 'shape': renderShape(this, ctx, state); break;
        case 'grind': renderGrind(this, ctx); break;
        case 'fit': renderFit(this, ctx); break;
        case 'result': renderResult(this, ctx, state, onDone); break;
        default: break;
      }
      if (this.gradeTimer > 0 && this.grade) {
        const a = clamp(this.gradeTimer / 0.9, 0, 1);
        ctx.globalAlpha = a;
        // Sits below every stage's play area so it never covers the toy.
        label(ctx, this.grade.text, W / 2, 644 - (1 - a) * 26, {
          size: 34, weight: 800, color: this.grade.color, align: 'center',
        });
        ctx.globalAlpha = 1;
      }
      endUI(ctx);
    },
  };

  scene.onDone = onDone;
  return scene;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function crafterOf(state, scene) {
  return state.survivors.find((s) => s.id === scene.crafterId) || null;
}

function totalCost(scene) {
  const tpl = WEAPON_TEMPLATES[scene.tplKey];
  const stock = STOCK[scene.stockKey];
  const cost = {};
  for (const [k, v] of Object.entries(tpl.cost)) cost[k] = (cost[k] || 0) + v;
  for (const [k, v] of Object.entries(stock.cost)) cost[k] = (cost[k] || 0) + v;
  return cost;
}

function beginCraft(scene, state) {
  const cost = totalCost(scene);
  if (!canAfford(state, cost)) {
    Sfx.deny();
    return;
  }
  pay(state, cost);

  const tpl = WEAPON_TEMPLATES[scene.tplKey];
  scene.stages = [...tpl.stages];
  scene.stageIndex = 0;
  scene.scores = {};
  scene.reheats = 3;
  startStage(scene, state);
}

function startStage(scene, state) {
  const stage = scene.stages[scene.stageIndex];
  const stock = STOCK[scene.stockKey];
  const crafter = crafterOf(state, scene);
  const f = forgiveness(stock.workability, crafter?.craftBonus || 0);
  const tpl = WEAPON_TEMPLATES[scene.tplKey];
  scene.phase = stage;

  if (stage === 'shape') {
    scene.blank = new Blank({ kind: tpl.kind, forgiveness: f });
    scene.reheats = 3;
    scene.hammerAcc = 0;
    scene.sparks = [];
    scene.shake = 0;
    setCursor('none');
  } else if (stage === 'grind') {
    scene.edge = new Edge({ forgiveness: f });
    scene.sparks = [];
    setCursor('none');
  } else if (stage === 'fit') {
    scene.bolts = Array.from({ length: 4 }, () => new Bolt({ forgiveness: f, rand: scene.rand }));
    scene.boltIndex = 0;
    setCursor('default');
  }
  // A stage ignores a held button until it has seen it up once, so the press
  // that ends one stage cannot carry straight into the next and start swinging.
  scene.armed = false;
  // And the key edge is spent here too. The phase changes during `update`, so
  // the incoming stage renders in the same frame and its own hotkey would
  // otherwise see the press that ended the previous one.
  consumeInputEdges();
}

function finishStage(scene, state, score) {
  // Where the work went has to be read off the bar before the bar goes away:
  // `startStage` builds a fresh one for the next stage. This used to point at
  // the old zone picker's tally, which no longer exists -- so every weapon came
  // out with a dead-even profile and nothing said so.
  if (scene.stages[scene.stageIndex] === 'shape' && scene.blank) {
    scene.shapeProfile = scene.blank.profile;
  }
  scene.scores[scene.stages[scene.stageIndex]] = clamp(score, 0, 1);
  scene.grade = gradeFor(score);
  scene.gradeTimer = 0.9;
  Sfx.craftDone();
  scene.stageIndex += 1;
  if (scene.stageIndex >= scene.stages.length) {
    const crafter = crafterOf(state, scene);
    const weapon = buildWeapon({
      tpl: scene.tplKey,
      stock: scene.stockKey,
      scores: scene.scores,
      crafter: crafter ? crafter.name : 'Workshop',
      profile: scene.shapeProfile,
    });
    state.stash.push(weapon);
    state.stats.crafted += 1;
    logLine(state, `${crafter ? crafter.name : 'Someone'} finished a ${weapon.name}.`);
    scene.result = weapon;
    scene.phase = 'result';
  } else {
    startStage(scene, state);
  }
}

function abandon(scene, state) {
  // Bailing mid-craft wastes the materials -- they are already in the fire.
  scene.phase = 'select';
  // And you put the tool down on the way out, or the pattern picker inherits a
  // hidden cursor from a stage that is no longer running.
  setCursor('default');
  Sfx.deny();
  logLine(state, 'Scrapped a half-finished piece.');
}

// ---------------------------------------------------------------------------
// Geometry shared by simulation and drawing
//
// One source for where a cell is on screen and which cell the cursor is over.
// Two copies of this would drift, and the stage would score a blow somewhere
// other than where the player watched it land -- which is exactly the bug the
// chem bench's pour had before `isOverMouth` became the single answer.
// ---------------------------------------------------------------------------

/** The bar on the anvil, and the blade on the rest. */
const BAR = { x: 316, y: 322, w: 648, half: 27 };

function cellAtX(px, cells) {
  return clamp(Math.floor(((px - BAR.x) / BAR.w) * cells), 0, cells - 1);
}

function cellX(i, cells) {
  return BAR.x + ((i + 0.5) / cells) * BAR.w;
}

/** Blows per second while the hammer is held down. */
const HAMMER_RATE = 4.2;

/**
 * Is the tool over the work?
 *
 * One answer, used by three callers that must agree: whether a blow lands,
 * whether the hammer is drawn, and whether the system cursor is hidden. It was
 * written out as a literal band in each of them, and they had already drifted
 * -- the cursor was hidden for the whole stage while the hammer was only drawn
 * inside the band, so reaching for a button left nothing on screen at all.
 */
function overWork(y) {
  return y > 240 && y < 520;
}

/**
 * Hide the pointer only where the tool replaces it.
 *
 * Called every frame rather than once when the stage starts, which is what the
 * bug was: the hand holds a hammer at the anvil and a pointer everywhere else.
 */
function toolCursor(over) {
  setCursor(over ? 'none' : 'default');
}

/** Colour of steel at a given heat. The gauge and the bar are the same reading. */
function steelColor(heat) {
  const h = clamp(heat, 0, 1);
  // Topped out at a hot yellow rather than white. A bar at full heat filling
  // the screen with #fff6e0 read as a blank rectangle -- the point of colouring
  // per cell is to show the heat *gradient* along the bar, and a ramp that
  // saturates loses exactly that.
  if (h > 0.86) return mix('#ff9d2e', '#ffca55', (h - 0.86) / 0.14);
  if (h > 0.62) return mix('#e0561a', '#ff9d2e', (h - 0.62) / 0.24);
  if (h > 0.36) return mix('#a8281a', '#e0561a', (h - 0.36) / 0.26);
  if (h > 0.16) return mix('#43241e', '#b62d18', (h - 0.16) / 0.2);
  return mix('#393d45', '#43241e', h / 0.16);
}

/** Colour of a ground edge as the temper goes: bright steel, straw, then blue. */
function temperColor(t, burnt) {
  if (burnt) return '#4a5f86';
  const v = clamp(t, 0, 1);
  if (v < 0.45) return mix('#cfd8e2', '#e8c98a', v / 0.45);
  return mix('#e8c98a', '#7d84b8', (v - 0.45) / 0.55);
}

function addSparks(scene, x, y, n, power = 1) {
  for (let i = 0; i < n; i++) {
    scene.sparks.push({
      x, y,
      vx: (Math.random() * 2 - 1) * 190 * power,
      vy: -Math.random() * 210 * power - 40,
      life: 0.3 + Math.random() * 0.4,
      t: 0,
    });
  }
}

function advanceSparks(scene, dt) {
  const s = scene.sparks;
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s[i];
    k.t += dt;
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    k.vy += 900 * dt;
    if (k.t >= k.life) s.splice(i, 1);
  }
}

function drawSparks(scene, ctx) {
  for (const k of scene.sparks) {
    const a = 1 - k.t / k.life;
    ctx.fillStyle = `rgba(255,${190 + Math.floor(50 * a)},${110 + Math.floor(60 * a)},${a})`;
    ctx.fillRect(k.x - 1.5, k.y - 1.5, 3, 3);
  }
}

// ---------------------------------------------------------------------------
// Stage: shape -- draw the bar down to the profile
// ---------------------------------------------------------------------------

function reheat(scene) {
  const { state } = scene;
  if (scene.reheats <= 0 || (state.resources.fuel || 0) < 1) {
    Sfx.deny();
    return;
  }
  state.resources.fuel -= 1;
  scene.reheats -= 1;
  scene.blank.reheat();
  Sfx.press();
}

function updateShape(scene, dt) {
  const b = scene.blank;
  b.tick(dt);
  advanceSparks(scene, dt);
  if (scene.shake > 0) scene.shake = Math.max(0, scene.shake - dt * 6);

  if (!scene.armed && !Input.down) scene.armed = true;

  if (keyPressed('r')) reheat(scene);

  // Hold to hammer. A blow is not a click: a smith working a bar swings in a
  // rhythm and moves along it, so the stage asks where and how long rather than
  // asking for fifty separate presses.
  const over = overWork(Input.y);
  toolCursor(over);
  if (scene.armed && Input.down && over) {
    // The first blow lands the instant the button goes down, and the rhythm
    // continues from there. Without this the accumulator started from nothing
    // on every press, so any hold shorter than one beat -- 238ms at this rate --
    // produced no blow at all: a tap did nothing, and a player tapping quickly
    // could work the bar for a minute without moving a gram of steel.
    if (Input.clicked) scene.hammerAcc = 1;
    scene.hammerAcc += dt * HAMMER_RATE;
    while (scene.hammerAcc >= 1) {
      scene.hammerAcc -= 1;
      const cell = cellAtX(Input.x, b.cells);
      const r = b.strike(cell, 1, scene.rand);
      scene.shake = 1;
      const x = cellX(cell, b.cells);
      if (r.cracked) {
        Sfx.hammerBad();
        addSparks(scene, x, BAR.y, 4, 0.4);
      } else {
        // The sound follows the steel: hot metal takes a blow softly, cold
        // metal rings, so the bar tells you it is going off before the gauge
        // does.
        if (r.heat > 0.6) Sfx.hammerGood();
        else if (r.heat > COLD) Sfx.press();
        else Sfx.hammerBad();
        addSparks(scene, x, BAR.y, r.heat > 0.5 ? 9 : 3, clamp(r.heat + 0.3, 0.3, 1.3));
      }
    }
  } else {
    scene.hammerAcc = 0;
  }

  if (keyPressed(' ')) finishStage(scene, scene.state, b.score);
}

// ---------------------------------------------------------------------------
// Stage: grind -- take the bevel down against the wheel
// ---------------------------------------------------------------------------

/** Mouse height inside the band maps to how hard the edge is leaned in. */
function pressureAt(py) {
  return clamp((py - (BAR.y - 60)) / 150, 0, 1);
}

function updateGrind(scene, dt) {
  const e = scene.edge;
  advanceSparks(scene, dt);
  if (!scene.armed && !Input.down) scene.armed = true;

  const over = overWork(Input.y);
  toolCursor(over);
  const touching = scene.armed && Input.down && over;
  if (touching) {
    const cell = cellAtX(Input.x, e.cells);
    const p = pressureAt(Input.y);
    const r = e.press(cell, p, dt);
    if (r.removed > 0 && Math.random() < 0.8) {
      addSparks(scene, cellX(cell, e.cells), BAR.y + 6, 1 + Math.floor(p * 4), 0.5 + p);
    }
    if (Math.random() < p * 0.25) Sfx.grind();
  }
  e.tick(dt, touching);

  if (keyPressed(' ')) finishStage(scene, scene.state, e.score);
}

// ---------------------------------------------------------------------------
// Stage: fit -- torque the fasteners
// ---------------------------------------------------------------------------

/** Below this a release is a slip, not a decision. */
const SLIP = 0.12;

function updateFit(scene, dt) {
  if (!scene.armed && !Input.down) scene.armed = true;
  const bolt = scene.bolts[scene.boltIndex];
  if (!bolt) return;

  // The wrench is the mouse and only the mouse. Space used to turn it too, and
  // since Space is the "done" key on every other stage, a single stray tap
  // seated all four bolts at no tension at all -- a whole stage lost to a
  // keypress that means something else everywhere else in the forge.
  const turning = scene.armed && Input.down;
  const was = bolt.turning;
  bolt.update(dt, turning);
  if (bolt.turning && Math.random() < 0.3) Sfx.grind();

  if (bolt.stripped && was) {
    Sfx.hammerBad();
    advanceBolt(scene);
  } else if (was && !turning) {
    if (bolt.torque < SLIP) {
      // Barely a quarter turn: the wrench slipped off rather than the bolt
      // being set. Nothing is committed, because committing here would punish
      // a mis-click with a ruined fastener and no way to see why.
      bolt.torque = 0;
      bolt.turned = 0;
      Sfx.deny();
      return;
    }
    // Letting go seats it. Whatever tension is on it is what it keeps.
    bolt.release();
    Sfx.press();
    advanceBolt(scene);
  }
}

function advanceBolt(scene) {
  scene.boltIndex += 1;
  scene.armed = false;
  if (scene.boltIndex >= scene.bolts.length) {
    finishStage(scene, scene.state, fitScore(scene.bolts));
  }
}

function background(ctx, t) {
  backdrop(ctx, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.72, 40, W / 2, H * 0.72, 600);
  const glow = 0.16 + 0.03 * Math.sin(t * 2.2);
  g.addColorStop(0, `rgba(210,96,58,${glow})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function renderSelect(scene, ctx, state) {
  engraved(ctx, 'THE FORGE', 40, 26, { size: 26, spacing: 3.4 });
  label(ctx, 'Three stages. What you earn in each one is what the weapon becomes.', 40, 60, {
    size: 13, color: Theme.textDim,
  });

  // --- patterns ------------------------------------------------------------
  panel(ctx, 40, 92, 360, 540, { title: 'Pattern' });
  const tpls = templatesFor(state.unlocks);
  let y = 132;
  for (const t of tpls) {
    const sel = t.key === scene.tplKey;
    const r = row(ctx, 54, y, 332, 62, { selected: sel, tooltip: t.desc });
    label(ctx, t.name, 66, y + 8, { size: 14, weight: 700, color: sel ? Theme.accent : Theme.text });
    label(ctx, `${t.base.dmg} dmg  ${t.base.acc}% acc  ${t.base.ap} AP${t.ammo ? `  ${t.base.mag} rnd` : '  melee'}`,
      66, y + 27, { size: 11, color: Theme.textDim, font: Theme.mono(11) });
    let cx = 66;
    ctx.font = Theme.font(10, 600);
    for (const [k, v] of Object.entries(t.cost)) {
      const ok = (state.resources[k] || 0) >= v;
      ctx.fillStyle = ok ? Theme.textFaint : Theme.bad;
      ctx.fillText(`${v} ${MATERIALS[k].short}`, cx, y + 45);
      cx += ctx.measureText(`${v} ${MATERIALS[k].short}`).width + 10;
    }
    if (r === 'click') scene.tplKey = t.key;
    y += 68;
  }

  // --- stock ---------------------------------------------------------------
  panel(ctx, 416, 92, 340, 300, { title: 'Stock' });
  y = 132;
  for (const s of stockList(state.unlocks)) {
    const sel = s.key === scene.stockKey;
    const r = row(ctx, 430, y, 312, 58, { selected: sel, tooltip: s.desc });
    label(ctx, s.name, 442, y + 7, { size: 13, weight: 700, color: sel ? Theme.accent : Theme.text });
    const mults = `dmg x${s.mult.dmg.toFixed(2)}  acc x${s.mult.acc.toFixed(2)}  wear x${s.mult.dur.toFixed(2)}`;
    label(ctx, mults, 442, y + 25, { size: 10.5, color: Theme.textDim, font: Theme.mono(10.5) });
    label(ctx, `workability ${Math.round(s.workability * 100)}%`, 442, y + 40, {
      size: 10, color: s.workability >= 0.9 ? Theme.good : Theme.warn,
    });
    if (r === 'click') scene.stockKey = s.key;
    y += 64;
  }

  // --- crafter -------------------------------------------------------------
  panel(ctx, 416, 406, 340, 226, { title: 'At the bench' });
  y = 446;
  for (const sv of state.survivors.filter((s) => s.status !== 'dead')) {
    const sel = sv.id === scene.crafterId;
    const cls = CLASSES[sv.cls];
    const r = row(ctx, 430, y, 312, 44, {
      selected: sel,
      tooltip: `${cls.name}: ${cls.desc}`,
    });
    ctx.fillStyle = cls.color;
    roundRect(ctx, 438, y + 8, 4, 28, 2);
    ctx.fill();
    label(ctx, sv.name, 450, y + 7, { size: 13, weight: 700, color: sel ? Theme.accent : Theme.text });
    const bonus = Math.round((sv.craftBonus || 0) * 100);
    label(ctx, `${cls.name}  ${bonus > 0 ? `+${bonus}% forgiveness` : 'no bench bonus'}`, 450, y + 24, {
      size: 10.5, color: bonus > 0 ? Theme.good : Theme.textFaint,
    });
    if (r === 'click') scene.crafterId = sv.id;
    y += 50;
  }

  // --- preview -------------------------------------------------------------
  panel(ctx, 772, 92, 468, 540, { title: 'Projected' });
  const tpl = WEAPON_TEMPLATES[scene.tplKey];
  const stock = STOCK[scene.stockKey];
  const crafter = crafterOf(state, scene);

  label(ctx, tpl.name, 792, 132, { size: 22, weight: 800, color: Theme.text });
  label(ctx, tpl.desc, 792, 162, { size: 12, color: Theme.textDim });

  const mid = buildWeapon({ tpl: scene.tplKey, stock: scene.stockKey, scores: { shape: 0.55, grind: 0.55, fit: 0.55 } });
  const best = buildWeapon({ tpl: scene.tplKey, stock: scene.stockKey, scores: { shape: 1, grind: 1, fit: 1 } });
  const ms = weaponStats(mid);
  const bs = weaponStats(best);

  const rows = [
    ['Damage', ms.dmg, bs.dmg],
    ['Accuracy', `${ms.acc}%`, `${bs.acc}%`],
    ['Crit', `${Math.round(ms.crit * 100)}%`, `${Math.round(bs.crit * 100)}%`],
    ['AP cost', ms.ap, bs.ap],
    ['Range', ms.range, bs.range],
    ...(tpl.ammo ? [['Magazine', ms.mag, bs.mag]] : []),
    ['Noise', ms.noise, bs.noise],
    ['Condition', ms.dur, bs.dur],
  ];

  label(ctx, 'AVERAGE WORK', 990, 196, { size: 10, weight: 700, color: Theme.textFaint, align: 'right' });
  label(ctx, 'FLAWLESS', 1210, 196, { size: 10, weight: 700, color: Theme.accent, align: 'right' });
  y = 218;
  for (const [name, a, b] of rows) {
    label(ctx, name, 792, y, { size: 13, color: Theme.textDim });
    label(ctx, String(a), 990, y, { size: 13, weight: 600, color: Theme.text, align: 'right' });
    label(ctx, String(b), 1210, y, { size: 13, weight: 700, color: Theme.accent, align: 'right' });
    y += 24;
  }

  y += 12;
  label(ctx, `Stock: ${stock.name}`, 792, y, { size: 12, color: Theme.textDim });
  y += 20;
  label(ctx, `Stages: ${tpl.stages.map((s) => STAGE_TITLES[s].toLowerCase()).join(' -> ')}`, 792, y, {
    size: 12, color: Theme.textDim,
  });
  y += 20;
  if (crafter) {
    label(ctx, `${crafter.name} at the bench.`, 792, y, { size: 12, color: Theme.textDim });
  }

  // --- cost + start --------------------------------------------------------
  const cost = totalCost(scene);
  const afford = canAfford(state, cost);
  y = 540;
  label(ctx, 'MATERIALS', 792, y, { size: 11, weight: 700, color: Theme.textFaint });
  let cx = 792;
  ctx.font = Theme.font(13, 700);
  for (const [k, v] of Object.entries(cost)) {
    const ok = (state.resources[k] || 0) >= v;
    ctx.fillStyle = ok ? Theme.text : Theme.bad;
    const txt = `${v} ${MATERIALS[k].name}`;
    ctx.fillText(txt, cx, y + 18);
    cx += ctx.measureText(txt).width + 16;
  }

  if (button(ctx, 792, 578, 200, 42, 'LIGHT THE FORGE', {
    tone: 'primary', size: 14, disabled: !afford,
    tooltip: afford ? 'Begin the craft.' : 'Not enough materials.',
  })) {
    beginCraft(scene, state);
  }
  if (button(ctx, 1010, 578, 200, 42, 'BACK TO WORKSHOP', { size: 13 })) {
    scene.onDone();
  }
}

function stageHeader(scene, ctx, title, instruction) {
  engraved(ctx, title, W / 2, 32, { size: 26, spacing: 3.4, align: 'center' });
  label(ctx, instruction, W / 2, 70, { size: 14, color: Theme.textDim, align: 'center' });

  const total = scene.stages.length;
  const pipW = 60;
  const startX = W / 2 - (total * (pipW + 8) - 8) / 2;
  for (let i = 0; i < total; i++) {
    const done = i < scene.stageIndex;
    const cur = i === scene.stageIndex;
    ctx.fillStyle = done ? Theme.good : cur ? Theme.accent : '#242c37';
    roundRect(ctx, startX + i * (pipW + 8), 100, pipW, 5, 2.5);
    ctx.fill();
  }
  label(ctx, 'Esc to abandon (materials are lost)', W / 2, 690, {
    size: 11, color: Theme.textFaint, align: 'center',
  });
}

/**
 * The bar, drawn from its own thickness array.
 *
 * The whole point of the rebuilt stage: the object on screen *is* the state.
 * There is no gauge standing in for the work, so a blank that was hammered
 * badly is a visibly bad shape and you can see it while you still have heat
 * left to fix it.
 */
function drawBar(ctx, b, opts = {}) {
  const cells = b.cells;
  const top = (i, arr) => BAR.y - arr[i] * BAR.half;
  const bot = (i, arr) => BAR.y + arr[i] * BAR.half;

  // The pattern, as a dark silhouette behind the steel. Drawn behind so that
  // anywhere the bar is still too thick, the steel visibly overhangs it -- the
  // question 'am I finished' becomes a question about a picture.
  if (opts.target !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    for (let i = 0; i < cells; i++) {
      const x = cellX(i, cells);
      if (i === 0) ctx.moveTo(x, top(i, b.target)); else ctx.lineTo(x, top(i, b.target));
    }
    for (let i = cells - 1; i >= 0; i--) ctx.lineTo(cellX(i, cells), bot(i, b.target));
    ctx.closePath();
    ctx.fill();
  }

  // The steel itself, one quad per cell so each carries its own heat.
  for (let i = 0; i < cells; i++) {
    const x0 = BAR.x + (i / cells) * BAR.w;
    const x1 = BAR.x + ((i + 1) / cells) * BAR.w;
    const t = b.thickness[i] * BAR.half;
    ctx.fillStyle = steelColor(b.heat[i]);
    ctx.fillRect(x0 - 0.5, BAR.y - t, x1 - x0 + 1, t * 2);
  }

  // Glow, so hot steel lights the anvil rather than merely being orange.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < cells; i += 2) {
    const h = b.heat[i];
    if (h < 0.35) continue;
    const x = cellX(i, cells);
    const g = ctx.createRadialGradient(x, BAR.y, 2, x, BAR.y, 70 * h);
    g.addColorStop(0, `rgba(255,150,60,${0.16 * h})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, BAR.y - 70, 140, 140);
  }
  ctx.restore();

  // Scale on anything that has gone below working heat.
  //
  // The steel colour alone was carrying this and it was too quiet: dark red
  // against mid red is a fine distinction to have to make at speed, and getting
  // it wrong cracks the piece. Cold steel crusts over, so the dead sections
  // announce themselves on the object rather than in a gauge.
  for (let i = 0; i < cells; i++) {
    if (b.heat[i] >= COLD) continue;
    const x0 = BAR.x + (i / cells) * BAR.w;
    const x1 = BAR.x + ((i + 1) / cells) * BAR.w;
    const t = b.thickness[i] * BAR.half;
    const dead = clamp(1 - b.heat[i] / COLD, 0, 1);
    ctx.fillStyle = `rgba(38,38,42,${0.35 + dead * 0.5})`;
    ctx.fillRect(x0 - 0.5, BAR.y - t, x1 - x0 + 1, t * 2);
    // A little flaking, so it reads as crust rather than as a shadow.
    ctx.fillStyle = `rgba(16,16,18,${0.3 + dead * 0.4})`;
    for (let k = 0; k < 3; k++) {
      const fy = BAR.y - t + ((k * 7 + i * 5) % Math.max(1, t * 2));
      ctx.fillRect(x0 + ((i * 3 + k * 5) % 12), fy, 3, 2);
    }
  }

  // Ink contour over the top and bottom edge, like everything else in the game.
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i < cells; i++) {
      const x = cellX(i, cells);
      const y = BAR.y + side * b.thickness[i] * BAR.half;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // The pattern line last, over the steel, because a guide the work can cover
  // is a guide you cannot use at exactly the moment you need it.
  if (opts.target !== false) {
    // Two passes: a dark line, then a bright dash on top of it. The pattern has
    // to be readable both against the dark shop behind the bar and against
    // glowing steel, and a single gold line vanished completely on hot metal --
    // which is precisely where the guide is needed.
    ctx.save();
    for (const [dash, colour, wide] of [[[], Ink.line, 3.4], [[6, 4], '#ffe9c4', 1.5]]) {
      ctx.setLineDash(dash);
      ctx.strokeStyle = colour;
      ctx.lineWidth = wide;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < cells; i++) {
          const x = cellX(i, cells);
          const y = BAR.y + side * b.target[i] * BAR.half;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Cracks: a permanent mark on the steel, not a number in a corner.
  for (const c of b.cracks) {
    const x = cellX(c, cells);
    const t = b.thickness[c] * BAR.half;
    ctx.strokeStyle = '#120a08';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x, BAR.y - t);
    ctx.lineTo(x + 4, BAR.y - t * 0.2);
    ctx.lineTo(x - 3, BAR.y + t * 0.45);
    ctx.stroke();
  }
}

/**
 * Heat along the bar, drawn directly under it and to the same width.
 *
 * Spatial rather than summarised, because the decision it feeds is spatial: the
 * question is never "how hot is the bar" but "is the bit I am about to hit still
 * workable, or should I move along". A single averaged gauge cannot answer that
 * and quietly implies the wrong thing on a bar heated unevenly, which after a
 * few blows is every bar.
 */
function drawHeatStrip(ctx, b) {
  const y = BAR.y + BAR.half + 12;
  const h = 9;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(BAR.x, y, BAR.w, h);
  for (let i = 0; i < b.cells; i++) {
    const x0 = BAR.x + (i / b.cells) * BAR.w;
    const x1 = BAR.x + ((i + 1) / b.cells) * BAR.w;
    const heat = b.heat[i];
    ctx.fillStyle = steelColor(heat);
    ctx.fillRect(x0, y, x1 - x0 + 0.5, h);
    if (heat < COLD) {
      // Hatched, so a cold section is legible even to an eye that cannot
      // separate the reds.
      ctx.fillStyle = 'rgba(20,20,24,0.72)';
      ctx.fillRect(x0, y, x1 - x0 + 0.5, h);
      ctx.fillStyle = 'rgba(150,150,160,0.35)';
      for (let k = 0; k < 3; k++) ctx.fillRect(x0 + k * 7, y + 1, 2, h - 2);
    } else if (heat > HOT) {
      ctx.fillStyle = 'rgba(255,240,214,0.4)';
      ctx.fillRect(x0, y + h - 2, x1 - x0 + 0.5, 2);
    }
  }
  inkContour(ctx, () => carvedRect(ctx, BAR.x, y, BAR.w, h, 1), { width: 1.4, inner: false });

  // Where the hammer is, so the strip is read at the point of attention.
  if (overWork(Input.y)) {
    const x = clamp(Input.x, BAR.x, BAR.x + BAR.w);
    ctx.fillStyle = withAlpha(Brass.hi, 0.9);
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 4, y - 10);
    ctx.lineTo(x - 4, y - 10);
    ctx.closePath();
    ctx.fill();
  }
}

/** The gap between steel and target, as a bar the player can read at a glance. */
function drawFitGauge(ctx, b, x, y, w) {
  const h = 34;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  carvedRect(ctx, x, y, w, h, 2);
  ctx.fill();
  for (let i = 0; i < b.cells; i++) {
    const d = b.thickness[i] - b.target[i];
    const cw = w / b.cells;
    const cx = x + i * cw;
    const over = clamp(Math.abs(d) / 0.35, 0, 1);
    ctx.fillStyle = Math.abs(d) < 0.045
      ? withAlpha(Theme.good, 0.85)
      : withAlpha(d > 0 ? Theme.warn : Theme.bad, 0.35 + over * 0.5);
    const bh = 4 + over * (h - 10);
    ctx.fillRect(cx + 0.5, y + h - 3 - bh, cw - 1, bh);
  }
  inkContour(ctx, () => carvedRect(ctx, x, y, w, h, 2), { width: 1.6, inner: false });
}

function drawHammer(ctx, x, y, swing, heat = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5 + swing * 0.55);
  // Haft.
  ctx.fillStyle = '#5a3d22';
  ctx.fillRect(-4, -6, 8, 82);
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(-4, -6, 8, 82);
  // Head.
  const g = ctx.createLinearGradient(-26, -18, 26, 14);
  g.addColorStop(0, '#8b93a0');
  g.addColorStop(0.5, '#5c646f');
  g.addColorStop(1, '#3a4048');
  ctx.fillStyle = g;
  carvedRect(ctx, -26, -20, 52, 26, 2);
  ctx.fill();
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,214,0.35)';
  ctx.fillRect(-24, -18, 48, 2);
  ctx.restore();

  // Warn before the blow, not after it. Striking cold steel cracks the piece
  // permanently, so the one place that has to say so is where the player is
  // already looking: the head of their own hammer.
  if (heat < COLD) {
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 160));
    ctx.strokeStyle = Theme.bad;
    ctx.lineWidth = 2.5;
    carvedRect(ctx, x - 30, y - 26, 60, 32, 2);
    ctx.stroke();
    ctx.restore();
    label(ctx, 'COLD', x, y - 42, {
      size: 11, weight: 800, color: Theme.bad, align: 'center', font: Theme.mono(11, 800),
    });
  }
}

function renderShape(scene, ctx, state) {
  const b = scene.blank;
  stageHeader(scene, ctx, STAGE_TITLES.shape,
    'Hold to hammer. Metal moves where you strike it -- and off the ends for good.');

  ctx.save();
  if (scene.shake > 0) {
    ctx.translate((Math.random() * 2 - 1) * scene.shake * 2.5,
      (Math.random() * 2 - 1) * scene.shake * 2.5);
  }

  drawAnvil(ctx);
  drawBar(ctx, b);
  drawHeatStrip(ctx, b);
  drawSparks(scene, ctx);
  ctx.restore();

  // Readouts, on the board rather than floating.
  panel(ctx, 316, 486, 648, 96, { brackets: false });
  label(ctx, 'SHAPE AGAINST THE PATTERN', 332, 498, {
    size: 10.5, weight: 700, color: Theme.textFaint,
  });
  drawFitGauge(ctx, b, 332, 514, 616);

  const workable = b.workable;
  panel(ctx, 316, 130, 300, 74, { brackets: false });
  label(ctx, 'WORKABLE STEEL', 332, 142, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, 332, 160, 268, 14, workable, 1,
    workable > 0.6 ? Theme.good : workable > 0.25 ? Theme.warn : Theme.bad,
    { text: workable <= 0 ? 'ALL COLD' : `${Math.round(workable * 100)}%` });
  label(ctx, `${scene.reheats} reheat${scene.reheats === 1 ? '' : 's'} left  ·  R`, 332, 180, {
    size: 11, color: scene.reheats ? Theme.textDim : Theme.bad,
  });

  panel(ctx, 664, 130, 300, 74, { brackets: false });
  label(ctx, 'TRUE TO PATTERN', 680, 142, { size: 10.5, weight: 700, color: Theme.textFaint });
  const sc = b.score;
  bar(ctx, 680, 160, 268, 14, sc, 1,
    sc > 0.75 ? Theme.good : sc > 0.4 ? Theme.warn : Theme.bad,
    { text: `${Math.round(sc * 100)}%` });
  label(ctx, b.cracks.length ? `${b.cracks.length} crack${b.cracks.length > 1 ? 's' : ''}`
    : 'sound steel', 680, 180, {
    size: 11, color: b.cracks.length ? Theme.bad : Theme.textDim,
  });

  if (button(ctx, W / 2 - 110, 600, 220, 44, 'OFF THE ANVIL', {
    tone: 'primary', size: 14, hotkey: ' ',
  })) {
    finishStage(scene, state, b.score);
  }

  hintBar(ctx, W / 2, 654, [
    { key: 'HOLD', text: 'hammer where the cursor is' },
    { key: 'R', text: 'back in the fire' },
    { key: 'SPACE', text: 'done' },
  ]);

  if (overWork(Input.y)) {
    const cell = cellAtX(Input.x, b.cells);
    drawHammer(ctx, Input.x, BAR.y - 96 + scene.shake * 34, scene.shake, b.heat[cell]);
  }
}

function drawAnvil(ctx) {
  // Clear of the heat strip, which lives between the bar and the anvil face.
  const y = BAR.y + 60;
  ctx.fillStyle = '#3a3f47';
  carvedRect(ctx, BAR.x - 30, y, BAR.w + 60, 26, 2);
  ctx.fill();
  ctx.fillStyle = '#2a2e34';
  carvedRect(ctx, BAR.x + 90, y + 26, BAR.w - 180, 74, 2);
  ctx.fill();
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 2.2;
  carvedRect(ctx, BAR.x - 30, y, BAR.w + 60, 26, 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,214,0.12)';
  ctx.fillRect(BAR.x - 28, y + 1, BAR.w + 56, 2);
}

/**
 * Vertical geometry of the blade.
 *
 * Deliberately big. The first pass drew the whole blade 64px deep with the
 * finished line 26px up, which put "grind to here" and "you have gone through
 * it" ten pixels apart -- they read as one line, and the two labels sat on top
 * of each other. The bevel is the entire subject of the screen, so it gets the
 * room. `unit` is pixels per unit of stock removed, which is what keeps the
 * drawing and both guide lines derived from the same number.
 */
const BLADE = { centre: 296, top: 56, belly: 78, unit: 56 };

const bladeTargetY = () => BLADE.centre + BLADE.belly - EDGE_TARGET * BLADE.unit;
const bladeRuinY = () => BLADE.centre + BLADE.belly - EDGE_RUIN * BLADE.unit;

/** Screen y of the ground edge at a cell -- the line the steel is cut back to. */
function edgeY(e, i) {
  return BLADE.centre + BLADE.belly - Math.min(e.ground[i], EDGE_RUIN + 0.1) * BLADE.unit;
}

function renderGrind(scene, ctx) {
  const e = scene.edge;
  stageHeader(scene, ctx, STAGE_TITLES.grind,
    'Grind the steel back to the line. Lower is harder -- and hard enough burns the temper.');

  const cells = e.cells;
  const targetY = bladeTargetY();
  const ruinY = bladeRuinY();
  const bellyY = BLADE.centre + BLADE.belly;

  for (let i = 0; i < cells; i++) {
    const x0 = BAR.x + (i / cells) * BAR.w;
    const x1 = BAR.x + ((i + 1) / cells) * BAR.w;
    const w = x1 - x0 + 1;
    const ey = edgeY(e, i);
    // Spine: the stock above the through-line, which no honest grind reaches.
    ctx.fillStyle = '#79828e';
    ctx.fillRect(x0 - 0.5, BLADE.centre - BLADE.top, w, Math.max(0, ruinY - (BLADE.centre - BLADE.top)));
    // The bevel, carrying its temper colour.
    if (ey > ruinY) {
      ctx.fillStyle = temperColor(e.temper[i], e.burnt[i]);
      ctx.fillRect(x0 - 0.5, ruinY, w, ey - ruinY);
    }

    // A honed glint on anything that has reached the line: "done" is something
    // you can see on the steel, not only in a readout.
    if (e.ground[i] >= EDGE_TARGET * 0.9 && e.ground[i] <= EDGE_RUIN) {
      ctx.fillStyle = 'rgba(255,252,240,0.8)';
      ctx.fillRect(x0 - 0.5, ey - 2.5, w, 2.5);
    }
    if (e.ground[i] > EDGE_RUIN) {
      ctx.fillStyle = withAlpha(Theme.bad, 0.6);
      ctx.fillRect(x0 - 0.5, ey, w, 5);
    }
  }

  // The stock still to come off, hatched over the steel that is still proud of
  // the line. Without it the metal that has to go looks exactly like the spine
  // that must not, and the stage becomes "grind and hope". Drawn over the blade
  // rather than under it, which is where the first attempt put it -- invisible.
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < cells; i++) {
    const x0 = BAR.x + (i / cells) * BAR.w;
    const ey = edgeY(e, i);
    if (ey > targetY) ctx.rect(x0 - 0.5, targetY, (BAR.w / cells) + 1, ey - targetY);
  }
  ctx.clip();
  ctx.fillStyle = withAlpha(Theme.warn, 0.16);
  ctx.fillRect(BAR.x, targetY, BAR.w, bellyY - targetY);
  ctx.strokeStyle = withAlpha(Theme.warn, 0.34);
  ctx.lineWidth = 2;
  for (let d = -160; d < BAR.w + 160; d += 11) {
    ctx.beginPath();
    ctx.moveTo(BAR.x + d, targetY);
    ctx.lineTo(BAR.x + d + 160, bellyY + 80);
    ctx.stroke();
  }
  ctx.restore();

  // The line to grind to, and the line past which the edge is gone. Set the
  // same way as the shape stage's pattern -- dark stroke, bright dash over it --
  // because that is what made shaping readable at a glance.
  for (const [y, bright, dash] of [
    [targetY, '#ffe9c4', [6, 4]],
    [ruinY, withAlpha(Theme.bad, 0.9), [3, 5]],
  ]) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = Ink.line;
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(BAR.x, y); ctx.lineTo(BAR.x + BAR.w, y); ctx.stroke();
    ctx.setLineDash(dash);
    ctx.strokeStyle = bright;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(BAR.x, y); ctx.lineTo(BAR.x + BAR.w, y); ctx.stroke();
    ctx.restore();
  }
  label(ctx, 'GRIND TO HERE', BAR.x - 10, targetY - 6, {
    size: 9.5, weight: 800, color: '#ffe9c4', align: 'right', font: Theme.mono(9.5, 800),
  });
  label(ctx, 'GROUND THROUGH', BAR.x - 10, ruinY - 6, {
    size: 9.5, weight: 800, color: Theme.bad, align: 'right', font: Theme.mono(9.5, 800),
  });

  // Ink along the spine and along the working edge.
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(BAR.x, BLADE.centre - BLADE.top);
  ctx.lineTo(BAR.x + BAR.w, BLADE.centre - BLADE.top);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < cells; i++) {
    const x = cellX(i, cells);
    if (i === 0) ctx.moveTo(x, edgeY(e, i)); else ctx.lineTo(x, edgeY(e, i));
  }
  ctx.stroke();

  // The wheel, under the edge where it is cutting rather than on top of the
  // work hiding it. No anvil here -- an anvil under a grinding wheel was a
  // leftover from the stage next door.
  const over = overWork(Input.y);
  const touching = scene.armed && Input.down && over;
  const p = pressureAt(Input.y);
  if (over) {
    const wx = clamp(Input.x, BAR.x, BAR.x + BAR.w);
    const wy = bellyY + 52 - p * 14;
    // Contact: a wedge of light from wheel to steel, widening with pressure.
    ctx.fillStyle = withAlpha('#ffd9a0', 0.05 + p * 0.18);
    ctx.fillRect(wx - 20 - p * 12, targetY, 40 + p * 24, wy - targetY);
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(scene.time * (touching ? 26 : 9));
    ctx.fillStyle = touching ? '#5a4c40' : '#4a4038';
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = Ink.line;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = 'rgba(255,240,214,0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos((i / 8) * Math.PI * 2) * 42, Math.sin((i / 8) * Math.PI * 2) * 42);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawSparks(scene, ctx);

  panel(ctx, 316, 486, 648, 96, { brackets: false });
  label(ctx, 'PRESSURE', 332, 498, { size: 10.5, weight: 700, color: Theme.textFaint });
  drawPressureGauge(ctx, 332, 514, 200, p);
  label(ctx, 'STILL DULL', 620, 498, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, 620, 514, 328, 14, e.remaining, 1,
    e.remaining > 0.3 ? Theme.warn : Theme.good,
    { text: e.remaining <= 0 ? 'EDGE ALL ROUND' : `${Math.round(e.remaining * 100)}% OF THE EDGE` });
  label(ctx, e.burntCells ? `${e.burntCells} burnt -- ease off` : 'temper holding', 332, 540, {
    size: 11, color: e.burntCells ? Theme.bad : Theme.textDim,
  });

  if (button(ctx, W / 2 - 110, 600, 220, 44, 'OFF THE WHEEL', {
    tone: 'primary', size: 14, hotkey: ' ',
  })) {
    finishStage(scene, scene.state, e.score);
  }
  hintBar(ctx, W / 2, 654, [
    { key: 'HOLD', text: 'grind' },
    { key: 'MOVE', text: 'along the edge, down to lean in' },
    { key: 'SPACE', text: 'done' },
  ]);
}

/**
 * Pressure, with the band that does not burn marked on it.
 *
 * A bare percentage told the player nothing about which percentages were safe,
 * and the penalty for guessing is a permanently soft edge. Measured: full
 * pressure goes blue before it cuts, 0.85 survives only if you keep moving, and
 * 0.7 is comfortable.
 */
function drawPressureGauge(ctx, x, y, w, p) {
  const h = 14;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  carvedRect(ctx, x, y, w, h, 2);
  ctx.fill();
  ctx.fillStyle = withAlpha(Theme.good, 0.28);
  ctx.fillRect(x, y + 1, w * 0.78, h - 2);
  ctx.fillStyle = withAlpha(Theme.warn, 0.3);
  ctx.fillRect(x + w * 0.78, y + 1, w * 0.12, h - 2);
  ctx.fillStyle = withAlpha(Theme.bad, 0.38);
  ctx.fillRect(x + w * 0.9, y + 1, w * 0.1, h - 2);
  ctx.fillStyle = p > 0.9 ? Theme.bad : p > 0.78 ? Theme.warn : Theme.good;
  ctx.fillRect(x + 1, y + 3, Math.max(2, (w - 2) * p), h - 6);
  inkContour(ctx, () => carvedRect(ctx, x, y, w, h, 2), { width: 1.6, inner: false });
  label(ctx, p > 0.9 ? 'BURNING' : p > 0.78 ? 'HOT' : 'SAFE', x + w + 10, y + 1, {
    size: 10.5, weight: 800, font: Theme.mono(10.5, 800),
    color: p > 0.9 ? Theme.bad : p > 0.78 ? Theme.warn : Theme.good,
  });
}

function renderFit(scene, ctx) {
  stageHeader(scene, ctx, STAGE_TITLES.fit,
    'Hold to turn. Let go on the mark -- past it the thread strips, and that is that.');

  const bolt = scene.bolts[scene.boltIndex];
  const n = scene.bolts.length;

  // The four fasteners, laid out on the piece.
  for (let i = 0; i < n; i++) {
    const x = W / 2 - (n - 1) * 90 / 2 + i * 90;
    const y = 300;
    const b = scene.bolts[i];
    const active = i === scene.boltIndex;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.turned);
    const r = 26;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, -r, r, r);
    const done = b.done;
    g.addColorStop(0, b.stripped ? '#6b4a44' : done ? Brass.hi : '#96a0ad');
    g.addColorStop(1, b.stripped ? '#3a2724' : done ? Brass.dark : '#4d545e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = active ? Brass.hi : Ink.line;
    ctx.lineWidth = active ? 3 : 2;
    ctx.stroke();
    ctx.restore();

    const state = b.stripped ? 'STRIPPED' : !b.done ? '' : b.state.toUpperCase();
    if (state) {
      label(ctx, state, x, y + 40, {
        size: 10.5, weight: 800, align: 'center',
        color: b.stripped ? Theme.bad : b.state === 'seated' ? Theme.good : Theme.warn,
      });
    }
  }

  // The torque gauge for the bolt in hand.
  panel(ctx, 390, 400, 500, 150, { title: `Bolt ${Math.min(scene.boltIndex + 1, n)} of ${n}` });
  if (bolt) {
    const gx = 414;
    const gw = 452;
    const gy = 452;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    carvedRect(ctx, gx, gy, gw, 26, 2);
    ctx.fill();
    // The band, and the strip line past it.
    const bandX = gx + (bolt.target - bolt.band) * gw;
    const bandW = bolt.band * 2 * gw;
    ctx.fillStyle = withAlpha(Theme.good, 0.4);
    ctx.fillRect(bandX, gy + 2, bandW, 22);
    ctx.fillStyle = withAlpha(Theme.bad, 0.55);
    ctx.fillRect(gx + BOLT_STRIP * gw - 3, gy, 3, 26);
    // Tension.
    const t = clamp(bolt.torque, 0, 1);
    ctx.fillStyle = bolt.stripped ? Theme.bad
      : t > bolt.target + bolt.band ? Theme.warn : Brass.hi;
    ctx.fillRect(gx, gy + 2, t * gw, 22);
    inkContour(ctx, () => carvedRect(ctx, gx, gy, gw, 26, 2), { width: 1.8, inner: false });
    label(ctx, 'SLACK', gx, gy + 34, { size: 10, color: Theme.textFaint });
    label(ctx, 'SEATED', gx + bolt.target * gw, gy + 34, {
      size: 10, color: Theme.good, align: 'center',
    });
    label(ctx, 'STRIPPED', gx + gw, gy + 34, { size: 10, color: Theme.bad, align: 'right' });

    label(ctx, bolt.torque < bolt.seat ? 'winding in' : 'the head has seated -- ease it home',
      W / 2, gy + 56, { size: 12, color: Theme.textDim, align: 'center' });
  }

  hintBar(ctx, W / 2, 600, [
    { key: 'HOLD', text: 'turn the wrench' },
    { key: 'LET GO', text: 'seat it there' },
  ]);
}

function renderResult(scene, ctx, state, onDone) {
  const w = scene.result;
  const st = weaponStats(w);
  const tier = tierFor(w.quality);

  dim(ctx, 0.55);
  const pw = 560;
  const ph = 480;
  const px = (W - pw) / 2;
  const py = 110;
  panel(ctx, px, py, pw, ph, { fill: Theme.panel });

  label(ctx, 'OFF THE BENCH', W / 2, py + 22, { size: 12, weight: 700, color: Theme.textFaint, align: 'center' });
  label(ctx, w.name, W / 2, py + 44, { size: 30, weight: 800, color: tier.color, align: 'center' });
  label(ctx, `${STOCK[w.stock].name} -- ${profileLabel(w.profile)} -- made by ${w.crafter}`, W / 2, py + 82, {
    size: 12, color: Theme.textDim, align: 'center',
  });

  // Stars.
  const stars = Math.round(w.quality * 5);
  const sx = W / 2 - (5 * 26 - 6) / 2;
  for (let i = 0; i < 5; i++) drawStar(ctx, sx + i * 26 + 10, py + 118, 10, i < stars ? tier.color : '#2a323d');

  // Stage breakdown.
  let y = py + 150;
  for (const stage of scene.stages) {
    const v = scene.scores[stage] ?? 0;
    label(ctx, STAGE_TITLES[stage], px + 40, y, { size: 11, weight: 700, color: Theme.textFaint });
    bar(ctx, px + 200, y + 1, 240, 12, v, 1, gradeFor(v).color, { text: `${Math.round(v * 100)}%` });
    y += 24;
  }

  y += 14;
  const rows = [
    ['Damage', st.dmg], ['Accuracy', `${st.acc}%`], ['Crit', `${Math.round(st.crit * 100)}%`],
    ['AP cost', st.ap], ['Range', st.range],
    ...(w.ammo ? [['Magazine', st.mag]] : []), ['Noise', st.noise], ['Condition', `${w.dur}`],
  ];
  rows.forEach((r, i) => {
    const col = i % 2;
    const rx = px + 40 + col * 250;
    const ry = y + Math.floor(i / 2) * 24;
    label(ctx, r[0], rx, ry, { size: 12, color: Theme.textDim });
    label(ctx, String(r[1]), rx + 200, ry, { size: 13, weight: 700, color: Theme.text, align: 'right' });
  });

  const bottom = py + ph - 56;
  if (button(ctx, px + 40, bottom, 220, 40, 'FORGE ANOTHER', { size: 13 })) {
    scene.phase = 'select';
    scene.result = null;
  }
  if (button(ctx, px + pw - 260, bottom, 220, 40, 'BACK TO WORKSHOP', { tone: 'primary', size: 13 })) {
    onDone();
  }
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

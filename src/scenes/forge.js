// The forge: pick a pattern, pick your stock, then earn the weapon's stats
// across three hands-on stages.

import { Input, keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, row, roundRect, dim, setTooltip } from '../ui/widgets.js';
import { clamp, lerp, pointInRect } from '../core/util.js';
import { TimingBar, TracePath, TorqueDial, forgiveness, gradeFor } from '../game/minigames.js';
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
    scene.heat = 1;
    scene.strikeLog = [];
    scene.zone = 'core';
    scene.zoneWork = { edge: 0, core: 0, haft: 0 };
    scene.zoneHits = { edge: 0, core: 0, haft: 0 };
    scene.strikesLeft = tpl.kind === 'gun' ? 7 : 6;
    scene.totalStrikes = scene.strikesLeft;
    scene.bar = new TimingBar({
      zoneHalf: 0.17 * f,
      speed: 0.58,
      wander: 0.16,
      zoneCenter: 0.5,
    });
  } else if (stage === 'grind') {
    scene.trace = new TracePath(edgeProfile(tpl.kind), {
      speed: 0.26,
      tolerance: 46 * f,
    });
  } else if (stage === 'fit') {
    scene.dial = new TorqueDial({ sector: 0.8 * f, speed: 1.75 });
    scene.boltsLeft = 4;
    scene.bolts = [];
  }
}

function finishStage(scene, state, score) {
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
      profile: scene.zoneWork,
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
  Sfx.deny();
  logLine(state, 'Scrapped a half-finished piece.');
}

/** Outline the player traces while grinding, shaped by weapon kind. */
function edgeProfile(kind) {
  const cx = 640;
  const cy = 380;
  if (kind === 'gun') {
    return [
      { x: cx - 250, y: cy + 40 },
      { x: cx - 120, y: cy + 28 },
      { x: cx + 30, y: cy + 20 },
      { x: cx + 170, y: cy + 12 },
      { x: cx + 250, y: cy - 6 },
    ];
  }
  return [
    { x: cx - 240, y: cy + 70 },
    { x: cx - 120, y: cy + 10 },
    { x: cx + 10, y: cy - 30 },
    { x: cx + 150, y: cy - 20 },
    { x: cx + 245, y: cy + 30 },
  ];
}

// ---------------------------------------------------------------------------
// Stage: shape
// ---------------------------------------------------------------------------

function heatQuality(heat) {
  // A sweet band: too cold won't move, too hot and it deforms.
  if (heat > 0.85) return lerp(0.75, 1, (1 - heat) / 0.15);
  if (heat >= 0.4) return 1;
  return clamp(0.55 + (heat / 0.4) * 0.45, 0.5, 1);
}

function updateShape(scene, dt) {
  scene.bar.update(dt);
  scene.heat = Math.max(0, scene.heat - dt * 0.055);

  // Pick where the next blow lands. This is the decision half of the stage --
  // timing alone decides how well it is made, allocation decides what it is.
  ZONES.forEach((z, i) => {
    if (keyPressed(String(i + 1))) scene.zone = z.key;
  });
  const hoveredZone = zoneAtPoint(Input.x, Input.y);
  if (hoveredZone && Input.clicked && !Input.clickConsumed) {
    Input.clickConsumed = true;
    scene.zone = hoveredZone;
    Sfx.click();
    return;
  }

  if (keyPressed(' ') || (Input.clicked && !Input.clickConsumed && Input.y > 250 && Input.y < 340)) {
    Input.clickConsumed = true;
    const raw = scene.bar.strike();
    const hq = heatQuality(scene.heat);
    const value = raw * hq;
    scene.strikeLog.push({ raw, value, heat: scene.heat, zone: scene.zone });
    scene.zoneWork[scene.zone] += value;
    scene.zoneHits[scene.zone] += 1;
    scene.strikesLeft -= 1;
    scene.heat = Math.max(0, scene.heat - 0.045);

    if (raw >= 0.85) Sfx.hammerPerfect();
    else if (raw > 0) Sfx.hammerGood();
    else Sfx.hammerBad();

    scene.bar.advance(scene.rand, { shrink: 0.975, speedUp: 1.045 });
    if (scene.strikesLeft <= 0) {
      const total = scene.strikeLog.reduce((a, s) => a + s.value, 0);
      finishStage(scene, scene.state, total / scene.strikeLog.length);
    }
  }

  if (keyPressed('r')) reheat(scene);
}

/**
 * The three places a hammer blow can land. Work put into a zone tilts the
 * matching stat; spreading blows evenly gives a balanced weapon.
 */
export const ZONES = [
  { key: 'edge', name: 'EDGE', stat: 'damage', color: '#d7443e', hint: 'Thin and sharpen the striking end.' },
  { key: 'core', name: 'CORE', stat: 'accuracy', color: '#4a9fd8', hint: 'Straighten the body so it flies true.' },
  { key: 'haft', name: 'HAFT', stat: 'durability', color: '#4fb477', hint: 'Thicken the tang so it survives use.' },
];

const ZONE_BOX = { y: 402, h: 96, w: 126, gap: 14 };

function zoneRect(i) {
  const total = ZONES.length * ZONE_BOX.w + (ZONES.length - 1) * ZONE_BOX.gap;
  const x = W / 2 - total / 2 + i * (ZONE_BOX.w + ZONE_BOX.gap);
  return { x, y: ZONE_BOX.y, w: ZONE_BOX.w, h: ZONE_BOX.h };
}

function zoneAtPoint(px, py) {
  for (let i = 0; i < ZONES.length; i++) {
    const r = zoneRect(i);
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return ZONES[i].key;
  }
  return null;
}

function reheat(scene) {
  const { state } = scene;
  if (scene.reheats <= 0 || (state.resources.fuel || 0) < 1) {
    Sfx.deny();
    return;
  }
  state.resources.fuel -= 1;
  scene.reheats -= 1;
  scene.heat = 1;
  Sfx.press();
}

// ---------------------------------------------------------------------------
// Stage: grind
// ---------------------------------------------------------------------------

function updateGrind(scene, dt) {
  const hit = scene.trace.update(dt, Input.x, Input.y);
  if (hit && Math.random() < 0.25) Sfx.grind();
  if (scene.trace.done) finishStage(scene, scene.state, scene.trace.score);
}

// ---------------------------------------------------------------------------
// Stage: fit
// ---------------------------------------------------------------------------

function updateFit(scene, dt) {
  scene.dial.update(dt);
  if (keyPressed(' ') || (Input.clicked && Input.y > 200 && Input.y < 580)) {
    Input.clickConsumed = true;
    const acc = scene.dial.lock();
    scene.bolts.push(acc);
    scene.boltsLeft -= 1;
    if (acc >= 0.85) Sfx.hammerPerfect();
    else if (acc > 0) Sfx.press();
    else Sfx.hammerBad();
    scene.dial.advance(scene.rand, { shrink: 0.93, speedUp: 1.07 });
    if (scene.boltsLeft <= 0) {
      const total = scene.bolts.reduce((a, b) => a + b, 0);
      finishStage(scene, scene.state, total / scene.bolts.length);
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function background(ctx, t) {
  ctx.fillStyle = Theme.bg;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.72, 40, W / 2, H * 0.72, 600);
  const glow = 0.16 + 0.03 * Math.sin(t * 2.2);
  g.addColorStop(0, `rgba(210,96,58,${glow})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function renderSelect(scene, ctx, state) {
  label(ctx, 'THE FORGE', 40, 28, { size: 26, weight: 800, color: Theme.text });
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
  label(ctx, title, W / 2, 34, { size: 26, weight: 800, color: Theme.accent, align: 'center' });
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

function renderShape(scene, ctx, state) {
  stageHeader(scene, ctx, STAGE_TITLES.shape,
    'Choose where the blow lands, then strike on the band. Keep the steel hot.');

  const cx = W / 2;

  // --- heat ---------------------------------------------------------------
  const hq = heatQuality(scene.heat);
  label(ctx, 'HEAT', cx - 300, 168, { size: 11, weight: 700, color: Theme.textFaint });
  bar(ctx, cx - 300, 186, 320, 16, scene.heat, 1,
    scene.heat > 0.85 ? '#ffd27a' : scene.heat >= 0.4 ? '#e8703d' : '#7d4a3a',
    { text: hq >= 1 ? 'WORKABLE' : scene.heat > 0.85 ? 'TOO SOFT' : 'GOING COLD' });
  label(ctx, `strike power x${hq.toFixed(2)}`, cx + 34, 188, {
    size: 12, color: hq >= 1 ? Theme.good : Theme.warn,
  });
  if (button(ctx, cx + 190, 180, 110, 30, `REHEAT ${scene.reheats}`, {
    size: 12, hotkey: 'r',
    disabled: scene.reheats <= 0 || (state.resources.fuel || 0) < 1,
    tooltip: 'Back in the coals. Costs 1 fuel.',
  })) {
    reheat(scene);
  }

  label(ctx, `${scene.strikesLeft} strikes left`, cx, 130, {
    size: 16, weight: 700, color: Theme.text, align: 'center',
  });

  // --- timing bar ----------------------------------------------------------
  scene.bar.render(ctx, cx - 300, 268, 600, 26);
  label(ctx, 'SPACE TO STRIKE', cx, 302, {
    size: 10.5, weight: 700, color: Theme.textFaint, align: 'center',
  });

  // --- anvil + blank -------------------------------------------------------
  const anvilY = 356;
  ctx.fillStyle = '#20252e';
  roundRect(ctx, cx - 230, anvilY, 460, 26, 6);
  ctx.fill();

  // Each zone is a length of the bar; its fill shows how much work it holds.
  const totalWork = Math.max(0.0001, ZONES.reduce((a, z) => a + scene.zoneWork[z.key], 0));
  ZONES.forEach((z, i) => {
    const r = zoneRect(i);
    const selected = scene.zone === z.key;
    const hot = pointInRect(Input.x, Input.y, r);

    // The glowing billet above each zone.
    const heatCol = scene.heat;
    const hits = scene.zoneHits[z.key];
    const worked = hits > 0;
    const billetH = 30;
    const by = anvilY - billetH - 2;
    if (worked) {
      const q = scene.zoneWork[z.key] / hits;
      ctx.fillStyle = q >= 0.85 ? '#cfd8e3' : q > 0.5 ? '#9aa5b1' : q > 0.2 ? '#6f7a86' : '#4a4038';
    } else {
      ctx.fillStyle = `rgb(${Math.round(120 + 135 * heatCol)},${Math.round(60 + 60 * heatCol)},${Math.round(40 + 20 * heatCol)})`;
    }
    ctx.fillRect(r.x + 6, by, r.w - 12, billetH);
    if (!worked) {
      ctx.fillStyle = `rgba(255,${Math.round(90 + 150 * heatCol)},80,0.25)`;
      ctx.fillRect(r.x + 6, by, r.w - 12, billetH);
    }
    if (selected) {
      ctx.strokeStyle = Theme.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 5, by - 1, r.w - 10, billetH + 2);
    }

    // The zone card.
    ctx.fillStyle = selected ? '#232b36' : hot ? '#1b222c' : '#151a22';
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.strokeStyle = selected ? z.color : Theme.border;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = z.color;
    roundRect(ctx, r.x, r.y, r.w, 3, 1.5);
    ctx.fill();

    label(ctx, z.name, r.x + r.w / 2, r.y + 14, {
      size: 13, weight: 800, color: selected ? z.color : Theme.text, align: 'center',
    });
    label(ctx, z.stat, r.x + r.w / 2, r.y + 32, {
      size: 10.5, color: Theme.textDim, align: 'center',
    });
    label(ctx, `${i + 1}`, r.x + 8, r.y + 8, {
      size: 10, weight: 800, color: Theme.textFaint, font: Theme.mono(10, 800),
    });

    // Share of total work, which is exactly what tilts the stat.
    const share = scene.zoneWork[z.key] / totalWork;
    bar(ctx, r.x + 12, r.y + 52, r.w - 24, 9, share, 1, z.color,
      { text: hits ? `${Math.round(share * 100)}%` : '' });
    label(ctx, hits ? `${hits} blow${hits === 1 ? '' : 's'}` : 'untouched', r.x + r.w / 2, r.y + 70, {
      size: 10, color: hits ? Theme.textDim : Theme.textFaint, align: 'center',
    });

    if (hot) setTooltip(`${z.hint} More work here means more ${z.stat}.`);
  });

  // --- running tally -------------------------------------------------------
  if (scene.strikeLog.length) {
    const avg = scene.strikeLog.reduce((a, s) => a + s.value, 0) / scene.strikeLog.length;
    label(ctx, `workmanship ${Math.round(avg * 100)}%`, cx, 522, {
      size: 14, weight: 700, align: 'center',
      color: avg > 0.7 ? Theme.good : avg > 0.4 ? Theme.warn : Theme.bad,
    });
    label(ctx, `shaping ${profileLabel(scene.zoneWork)}`, cx, 544, {
      size: 12, color: Theme.textDim, align: 'center',
    });
  } else {
    label(ctx, 'Spread the blows for a balanced weapon, or commit to one zone.', cx, 528, {
      size: 12, color: Theme.textFaint, align: 'center',
    });
  }
}

function renderGrind(scene, ctx) {
  stageHeader(scene, ctx, STAGE_TITLES.grind,
    'Hold the piece against the wheel: follow the moving spark with your cursor.');

  ctx.fillStyle = 'rgba(20,24,31,0.7)';
  roundRect(ctx, 320, 250, 640, 280, 10);
  ctx.fill();
  ctx.strokeStyle = Theme.border;
  ctx.stroke();

  scene.trace.render(ctx);

  const s = scene.trace.score;
  label(ctx, `contact ${Math.round(s * 100)}%`, W / 2, 570, {
    size: 18, weight: 700, align: 'center',
    color: s > 0.7 ? Theme.good : s > 0.4 ? Theme.warn : Theme.bad,
  });
  bar(ctx, W / 2 - 200, 600, 400, 12, scene.trace.t, 1, Theme.info);
}

function renderFit(scene, ctx) {
  stageHeader(scene, ctx, STAGE_TITLES.fit,
    'Space or click to bite each bolt while the driver is in the green.');

  scene.dial.render(ctx, W / 2, 380, 130);

  label(ctx, `${scene.boltsLeft} bolts left`, W / 2, 170, {
    size: 16, weight: 700, color: Theme.text, align: 'center',
  });

  // Bolt results.
  const n = 4;
  const startX = W / 2 - (n * 46 - 10) / 2;
  for (let i = 0; i < n; i++) {
    const v = scene.bolts[i];
    const x = startX + i * 46;
    ctx.beginPath();
    ctx.arc(x + 18, 572, 15, 0, Math.PI * 2);
    ctx.fillStyle = v === undefined ? '#20262f' : v >= 0.85 ? Theme.accent : v > 0.35 ? Theme.good : v > 0 ? Theme.warn : Theme.bad;
    ctx.fill();
    ctx.strokeStyle = Theme.border;
    ctx.stroke();
    if (v !== undefined) {
      label(ctx, `${Math.round(v * 100)}`, x + 18, 572, {
        size: 11, weight: 800, color: '#10141a', align: 'center', baseline: 'middle',
      });
    }
  }
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

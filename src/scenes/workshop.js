// The base. Everything between runs happens here.

import { Game } from '../core/loop.js';
import { keyPressed } from '../core/input.js';
import { Theme, W, H, Parch, Brass, Ink } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, labelClipped, roundRect, setTooltip, portrait } from '../ui/widgets.js';
import {
  backdrop, parchmentCard, engraved, tracked, brassRule, withAlpha, carvedRect, rivet,
} from '../ui/ornament.js';
import { pointInRect, wrapText } from '../core/util.js';
import { Input } from '../core/input.js';
import { MATERIALS, MATERIAL_ORDER, AMMO } from '../data/materials.js';
import { CLASSES } from '../data/progression.js';
import { saveGame } from '../core/save.js';
import { MACHINE_TYPES } from '../game/machines.js';
import { makeForgeScene } from './forge.js';
import { makeAmmoScene } from './bench.js';
import { makeMedScene } from './chembench.js';
import { makeArmoryScene } from './armory.js';
import { makeRosterScene } from './roster.js';
import { makeResearchScene } from './research.js';
import { makeDeployScene } from './deploy.js';

export function makeWorkshopScene(state) {
  const back = () => Game.replace(makeWorkshopScene(state));

  const stations = [
    {
      key: 'forge', name: 'The Forge', hotkey: 'f',
      desc: 'Shape, grind and fit a weapon by hand.',
      color: Theme.accent,
      open: () => Game.replace(makeForgeScene(state, back)),
    },
    {
      key: 'ammo', name: 'Ammo Press', hotkey: 'a',
      desc: 'Stamp out rounds. Six strokes a batch.',
      color: '#d8b45a',
      open: () => Game.replace(makeAmmoScene(state, back)),
    },
    {
      key: 'med', name: 'Chem Bench', hotkey: 'c',
      desc: 'Cook medipacks from chem and cloth.',
      color: Theme.good,
      open: () => Game.replace(makeMedScene(state, back)),
    },
    {
      key: 'armory', name: 'Armoury', hotkey: 'w',
      desc: 'Equip, modify, repair and name your weapons.',
      color: Theme.info,
      open: () => Game.replace(makeArmoryScene(state, back)),
    },
    {
      key: 'roster', name: 'Survivors', hotkey: 'r',
      desc: 'Perks, injuries and who is fit to go out.',
      color: Theme.purple,
      open: () => Game.replace(makeRosterScene(state, back)),
    },
    {
      key: 'research', name: 'Blueprints', hotkey: 'b',
      desc: 'Unlock patterns, materials, mods and machines.',
      color: '#8fb46a',
      open: () => Game.replace(makeResearchScene(state, back)),
    },
  ];

  return {
    name: 'workshop',
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    time: 0,

    enter() {
      saveGame();
    },

    update(dt) {
      this.time += dt;
      for (const s of stations) {
        if (keyPressed(s.hotkey)) s.open();
      }
      if (keyPressed(' ')) Game.replace(makeDeployScene(state, back));
    },

    render(ctx) {
      beginUI();
      drawBackdrop(ctx, this.time);
      drawHeader(ctx, state);

      // ---- stations --------------------------------------------------------
      const cols = 3;
      const cw = 268;
      const ch = 132;
      const gx = 40;
      const gy = 150;
      stations.forEach((s, i) => {
        const x = gx + (i % cols) * (cw + 16);
        const y = gy + Math.floor(i / cols) * (ch + 16);
        const r = { x, y, w: cw, h: ch };
        const hot = pointInRect(Input.x, Input.y, r);

        // A station is a plaque on the wall: stained board, brass at the corners,
        // and the station's own colour only as a wash so the six of them read as
        // one set of fittings rather than six differently branded cards.
        panel(ctx, x, y, cw, ch, { tint: hot ? withAlpha(s.color, 0.16) : null });

        drawStationGlyph(ctx, s.key, x + 30, y + 52, s.color, this.time);

        // The label is a paper card tacked to the board, which is what lets the
        // description be read in full instead of truncated to one line.
        const lx = x + 72;
        const lw = cw - 88;
        parchmentCard(ctx, lx, y + 16, lw, 58, { amp: 1.2, raise: 6 });
        rivet(ctx, lx + 7, y + 23, 2.6);
        rivet(ctx, lx + lw - 7, y + 23, 2.6);
        tracked(ctx, s.name.toUpperCase(), lx + 12, y + 26, {
          font: Theme.display(13.5, 700), color: Parch.ink, spacing: 1.3,
        });
        ctx.font = Theme.font(11, 400);
        wrapText(ctx, s.desc, lw - 24).slice(0, 2).forEach((line, li) => {
          label(ctx, line, lx + 12, y + 45 + li * 13, { size: 11, color: Parch.inkDim });
        });

        label(ctx, s.hotkey.toUpperCase(), x + cw - 20, y + ch - 36, {
          size: 10.5, weight: 800, color: withAlpha(Brass.hi, 0.75), align: 'right',
          font: Theme.mono(10.5, 800),
        });

        if (button(ctx, x + 18, y + ch - 40, cw - 60, 28, 'OPEN', {
          size: 11.5, tone: hot ? 'primary' : 'default',
        })) {
          s.open();
        }
      });

      // ---- deploy ----------------------------------------------------------
      const dy = gy + 2 * (ch + 16) + 8;
      const dw = cols * cw + (cols - 1) * 16;
      panel(ctx, gx, dy, dw, 120, { tint: withAlpha(Theme.good, 0.1), bracketSize: 13 });

      engraved(ctx, 'GO SCAVENGING', gx + 28, dy + 22, { size: 22, color: Brass.hi });
      label(ctx, 'Pick a squad and a site. Fights are turn based -- take your time out there.',
        gx + 28, dy + 56, { size: 12.5, color: Theme.textDim });

      const ready = state.survivors.filter((s) => s.status === 'ready' && s.hp > 0).length;
      label(ctx, `${ready} survivor${ready === 1 ? '' : 's'} fit to travel`, gx + 28, dy + 76, {
        size: 12, weight: 700, color: ready ? Theme.text : Theme.bad,
      });

      if (button(ctx, gx + dw - 250, dy + 38, 220, 46, 'HEAD OUT', {
        tone: 'primary', size: 16, hotkey: ' ', disabled: ready === 0,
        tooltip: ready ? 'Choose the squad and the site.' : 'Everyone is hurt. Rest a day first.',
      })) {
        Game.replace(makeDeployScene(state, back));
      }

      // ---- side panel ------------------------------------------------------
      drawSidePanel(ctx, state);

      endUI(ctx);
    },
  };
}

function drawBackdrop(ctx, t) {
  backdrop(ctx, W, H);

  // Forge glow, bottom left. The one live light in the room, so it breathes.
  const glow = 0.2 + 0.05 * Math.sin(t * 1.7) + 0.03 * Math.sin(t * 4.3);
  const g = ctx.createRadialGradient(180, H - 60, 20, 180, H - 60, 560);
  g.addColorStop(0, `rgba(226,112,52,${glow})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Cold light through a window, top right -- the street getting in. Kept faint:
  // its whole job is to make the forge glow read as warm by comparison.
  const g2 = ctx.createRadialGradient(1120, 30, 10, 1120, 30, 460);
  g2.addColorStop(0, 'rgba(96,132,182,0.09)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader(ctx, state) {
  // A board fixed across the top of the wall, rather than a translucent bar.
  const hh = 122;
  ctx.save();
  ctx.fillStyle = withAlpha(Ink.line, 0.72);
  ctx.fillRect(0, 0, W, hh);
  const sheen = ctx.createLinearGradient(0, 0, 0, hh);
  sheen.addColorStop(0, 'rgba(255,220,168,0.07)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, hh);
  ctx.restore();
  brassRule(ctx, 24, hh - 0.5, W - 48);

  engraved(ctx, 'WE ARE LOSING DAYLIGHT', 40, 20, { size: 22, spacing: 3 });
  tracked(ctx, `DAY ${state.day}`, 42, 54, {
    font: Theme.display(13, 700), color: Theme.accent, spacing: 2,
  });

  const alive = state.survivors.filter((s) => s.status !== 'dead');
  label(ctx, `${alive.length} alive  ·  ${state.stats.runs} runs  ·  ${state.stats.kills} kills`, 132, 55, {
    size: 12, color: Theme.textDim,
  });

  // Resource strip: each count sits in its own recessed slot, so the row reads
  // as a rack of bins rather than as a line of text.
  let x = 40;
  const y = 80;
  for (const key of MATERIAL_ORDER) {
    const m = MATERIALS[key];
    const v = state.resources[key] || 0;
    const r = { x: x - 4, y: y - 4, w: 104, h: 30 };
    drawSlot(ctx, x - 4, y - 4, 98, 30);
    ctx.fillStyle = m.color;
    carvedRect(ctx, x + 2, y + 5, 9, 9, 1);
    ctx.fill();
    ctx.strokeStyle = Ink.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    label(ctx, m.short, x + 17, y - 1, { size: 9.5, color: Theme.textFaint });
    label(ctx, String(v), x + 17, y + 9, {
      size: 13, weight: 700, color: v > 0 ? Theme.text : Theme.textFaint, font: Theme.mono(13, 700),
    });
    if (pointInRect(Input.x, Input.y, r)) setTooltip(m.name);
    x += 104;
  }

  // Ammo + medipacks.
  x = 40 + 104 * MATERIAL_ORDER.length + 10;
  for (const key of ['light', 'shell', 'rifle']) {
    const a = AMMO[key];
    drawSlot(ctx, x - 6, y - 4, 52, 30);
    label(ctx, a.short, x, y - 1, { size: 9.5, color: Theme.textFaint });
    label(ctx, String(state.ammo[key] || 0), x, y + 9, {
      size: 13, weight: 700, font: Theme.mono(13, 700),
      color: (state.ammo[key] || 0) > 0 ? Theme.text : Theme.textFaint,
    });
    x += 58;
  }
  drawSlot(ctx, x - 6, y - 4, 52, 30);
  label(ctx, 'MEDI', x, y - 1, { size: 9.5, color: Theme.textFaint });
  label(ctx, String(state.medipacks), x, y + 9, {
    size: 13, weight: 700, font: Theme.mono(13, 700),
    color: state.medipacks > 0 ? Theme.good : Theme.textFaint,
  });
}

/** A shallow recess for a readout to sit in. */
function drawSlot(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  carvedRect(ctx, x, y, w, h, 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(Brass.dark, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawSidePanel(ctx, state) {
  const px = 884;
  const pw = W - px - 40;

  // The three panels are stacked to fit their contents rather than parked at
  // fixed heights. Bare board reads as unfinished furniture in a way that an
  // empty grey rectangle never did, so the material makes slack space a bug.
  const groupH = 50 + Math.max(1, state.survivors.length) * 38;
  const machineH = 46 + Math.max(2, state.machines.length * 2) * 18;
  const logRows = Math.min(4, state.log.length);
  const logH = 44 + Math.max(1, logRows) * 19;

  // Squad at a glance.
  panel(ctx, px, 150, pw, groupH, { title: 'The group' });
  let y = 190;
  for (const sv of state.survivors) {
    const cls = CLASSES[sv.cls];
    const dead = sv.status === 'dead';
    portrait(ctx, sv, px + 14, y + 1, 32, 32, {
      crop: 0.46, tint: dead ? 'rgba(20,6,6,0.6)' : null,
    });
    ctx.fillStyle = dead ? '#3a2b2b' : cls.color;
    roundRect(ctx, px + 52, y + 3, 4, 30, 2);
    ctx.fill();
    label(ctx, sv.name, px + 64, y, {
      size: 13, weight: 700, color: dead ? Theme.textFaint : Theme.text,
    });
    const status = dead ? 'dead'
      : sv.status === 'injured' ? `injured (${sv.injury}d)`
        : `${sv.hp}/${sv.hpMax} hp`;
    labelClipped(ctx, `${cls.name} · lv${sv.level} · ${status}`, px + 64, y + 17, pw - 128, {
      size: 11,
      color: dead ? Theme.textFaint : sv.status === 'injured' ? Theme.warn : Theme.textDim,
    });
    if (sv.pendingPerks > 0) {
      label(ctx, `${sv.pendingPerks} perk`, px + pw - 16, y + 6, {
        size: 11, weight: 800, color: Theme.accent, align: 'right',
      });
    }
    y += 38;
  }

  // Machines.
  const machineY = 150 + groupH + 14;
  panel(ctx, px, machineY, pw, machineH, { title: 'Automation' });
  y = machineY + 40;
  if (!state.machines.length) {
    label(ctx, 'Nothing running yet.', px + 16, y, { size: 12, color: Theme.textFaint });
    label(ctx, 'Research an Ammo Press to start.', px + 16, y + 18, { size: 11, color: Theme.textFaint });
  } else {
    for (const m of state.machines) {
      const type = MACHINE_TYPES[m.key];
      label(ctx, type.name, px + 16, y, { size: 12, weight: 700, color: type.color });
      label(ctx, m.active ? (m.config ? `set to ${AMMO[m.config].short}` : 'running nightly') : 'switched off',
        px + 16, y + 16, { size: 11, color: m.active ? Theme.textDim : Theme.textFaint });
      y += 36;
    }
  }

  // Log.
  const logY = machineY + machineH + 14;
  panel(ctx, px, logY, pw, logH, { title: 'Recent' });
  y = logY + 40;
  for (let i = 0; i < 4 && i < state.log.length; i++) {
    const e = state.log[i];
    labelClipped(ctx, `d${e.day}  ${e.text}`, px + 16, y, pw - 32, { size: 11, color: Theme.textDim });
    y += 19;
  }
}

/**
 * Small procedural icon per station.
 *
 * Drawn twice: once dilated in ink to make a contour, once in the station's own
 * colour on top. Flat coloured shapes were the last thing on these screens that
 * still looked like an icon set rather than something painted, and outlining them
 * costs one closure and eight extra fills of a shape twenty pixels across.
 */
const GLYPH_DILATE = [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4],
  [-1, -1], [1, -1], [-1, 1], [1, 1]];

function drawStationGlyph(ctx, key, cx, cy, color, t) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';

  const paint = () => paintGlyph(ctx, key, t);

  ctx.strokeStyle = Ink.line;
  ctx.fillStyle = Ink.line;
  ctx.lineWidth = 5;
  for (const [dx, dy] of GLYPH_DILATE) {
    ctx.save();
    ctx.translate(dx, dy);
    paint();
    ctx.restore();
  }

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  paint();
  ctx.restore();
}

function paintGlyph(ctx, key, t) {
  switch (key) {
    case 'forge': {
      // Hammer over an anvil.
      const swing = Math.sin(t * 2.4) * 0.25;
      ctx.save();
      ctx.rotate(-0.5 + swing);
      ctx.fillRect(-2, -18, 4, 20);
      ctx.fillRect(-9, -22, 18, 7);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-14, 12); ctx.lineTo(14, 12); ctx.lineTo(9, 4); ctx.lineTo(-9, 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ammo':
      for (let i = 0; i < 3; i++) {
        const x = -12 + i * 12;
        ctx.fillRect(x - 3, -4, 6, 16);
        ctx.beginPath();
        ctx.arc(x, -4, 3, Math.PI, 0);
        ctx.fill();
      }
      break;
    case 'med':
      ctx.fillRect(-4, -14, 8, 28);
      ctx.fillRect(-14, -4, 28, 8);
      break;
    case 'armory':
      ctx.beginPath();
      ctx.moveTo(-14, 10); ctx.lineTo(6, -12); ctx.lineTo(12, -6); ctx.lineTo(-8, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-16, 8, 8, 8);
      break;
    case 'roster':
      ctx.beginPath();
      ctx.arc(-6, -6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8, -3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-15, 14); ctx.quadraticCurveTo(-6, 2, 3, 14);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 14); ctx.quadraticCurveTo(8, 5, 15, 14);
      ctx.closePath();
      ctx.fill();
      break;
    case 'research':
      ctx.strokeRect(-12, -14, 24, 28);
      ctx.beginPath();
      ctx.moveTo(-6, -6); ctx.lineTo(6, -6);
      ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
      ctx.moveTo(-6, 6); ctx.lineTo(2, 6);
      ctx.stroke();
      break;
    default:
      break;
  }
}

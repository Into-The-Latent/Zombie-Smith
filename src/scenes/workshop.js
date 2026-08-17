// The base. Everything between runs happens here.

import { Game } from '../core/loop.js';
import { keyPressed } from '../core/input.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, labelClipped, roundRect, setTooltip } from '../ui/widgets.js';
import { pointInRect } from '../core/util.js';
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

        ctx.fillStyle = hot ? Theme.panelHi : Theme.panel;
        roundRect(ctx, x, y, cw, ch, 8);
        ctx.fill();
        ctx.strokeStyle = hot ? s.color : Theme.border;
        ctx.lineWidth = hot ? 2 : 1;
        ctx.stroke();

        ctx.fillStyle = s.color;
        roundRect(ctx, x, y, cw, 4, 2);
        ctx.fill();

        drawStationGlyph(ctx, s.key, x + 30, y + 46, s.color, this.time);

        label(ctx, s.name, x + 80, y + 30, { size: 17, weight: 700, color: Theme.text });
        labelClipped(ctx, s.desc, x + 80, y + 54, cw - 92, { size: 11.5, color: Theme.textDim });
        label(ctx, s.hotkey.toUpperCase(), x + cw - 18, y + 16, {
          size: 11, weight: 800, color: Theme.textFaint, align: 'right', font: Theme.mono(11, 800),
        });

        if (button(ctx, x + 16, y + ch - 42, cw - 32, 30, 'OPEN', { size: 12, tone: hot ? 'primary' : 'default' })) {
          s.open();
        }
      });

      // ---- deploy ----------------------------------------------------------
      const dy = gy + 2 * (ch + 16) + 8;
      const dw = cols * cw + (cols - 1) * 16;
      ctx.fillStyle = '#171d17';
      roundRect(ctx, gx, dy, dw, 120, 8);
      ctx.fill();
      ctx.strokeStyle = Theme.good;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      label(ctx, 'GO SCAVENGING', gx + 28, dy + 24, { size: 22, weight: 800, color: Theme.good });
      label(ctx, 'Pick a squad and a site. Fights are turn based -- take your time out there.',
        gx + 28, dy + 54, { size: 12.5, color: Theme.textDim });

      const ready = state.survivors.filter((s) => s.status === 'ready' && s.hp > 0).length;
      label(ctx, `${ready} survivor${ready === 1 ? '' : 's'} fit to travel`, gx + 28, dy + 76, {
        size: 12, weight: 700, color: ready ? Theme.text : Theme.bad,
      });

      if (button(ctx, gx + dw - 250, dy + 38, 220, 46, 'HEAD OUT', {
        tone: 'good', size: 16, hotkey: ' ', disabled: ready === 0,
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
  ctx.fillStyle = Theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Forge glow, bottom left.
  const glow = 0.14 + 0.035 * Math.sin(t * 1.7) + 0.02 * Math.sin(t * 4.3);
  const g = ctx.createRadialGradient(180, H - 60, 20, 180, H - 60, 520);
  g.addColorStop(0, `rgba(216,96,58,${glow})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Cold light through a window, top right.
  const g2 = ctx.createRadialGradient(1120, 40, 10, 1120, 40, 460);
  g2.addColorStop(0, 'rgba(90,120,170,0.10)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader(ctx, state) {
  ctx.fillStyle = 'rgba(10,13,18,0.9)';
  ctx.fillRect(0, 0, W, 120);
  ctx.strokeStyle = Theme.border;
  ctx.beginPath();
  ctx.moveTo(0, 120.5);
  ctx.lineTo(W, 120.5);
  ctx.stroke();

  label(ctx, 'ZOMBIE SMITH', 40, 22, { size: 24, weight: 800, color: Theme.text });
  label(ctx, `DAY ${state.day}`, 40, 54, { size: 13, weight: 700, color: Theme.accent });

  const alive = state.survivors.filter((s) => s.status !== 'dead');
  label(ctx, `${alive.length} alive  ·  ${state.stats.runs} runs  ·  ${state.stats.kills} kills`, 120, 55, {
    size: 12, color: Theme.textDim,
  });

  // Resource strip.
  let x = 40;
  const y = 82;
  for (const key of MATERIAL_ORDER) {
    const m = MATERIALS[key];
    const v = state.resources[key] || 0;
    const r = { x: x - 4, y: y - 4, w: 104, h: 28 };
    ctx.fillStyle = m.color;
    roundRect(ctx, x, y + 4, 10, 10, 2);
    ctx.fill();
    label(ctx, m.short, x + 16, y, { size: 10, color: Theme.textFaint });
    label(ctx, String(v), x + 16, y + 10, { size: 13, weight: 700, color: v > 0 ? Theme.text : Theme.textFaint });
    if (pointInRect(Input.x, Input.y, r)) setTooltip(m.name);
    x += 104;
  }

  // Ammo + medipacks.
  x = 40 + 104 * MATERIAL_ORDER.length + 10;
  for (const key of ['light', 'shell', 'rifle']) {
    const a = AMMO[key];
    label(ctx, a.short, x, y, { size: 10, color: Theme.textFaint });
    label(ctx, String(state.ammo[key] || 0), x, y + 10, {
      size: 13, weight: 700, color: (state.ammo[key] || 0) > 0 ? Theme.text : Theme.textFaint,
    });
    x += 58;
  }
  label(ctx, 'MEDI', x, y, { size: 10, color: Theme.textFaint });
  label(ctx, String(state.medipacks), x, y + 10, {
    size: 13, weight: 700, color: state.medipacks > 0 ? Theme.good : Theme.textFaint,
  });
}

function drawSidePanel(ctx, state) {
  const px = 884;
  const pw = W - px - 40;

  // Squad at a glance.
  panel(ctx, px, 150, pw, 250, { title: 'The group' });
  let y = 190;
  for (const sv of state.survivors) {
    const cls = CLASSES[sv.cls];
    const dead = sv.status === 'dead';
    ctx.fillStyle = dead ? '#3a2b2b' : cls.color;
    roundRect(ctx, px + 14, y + 3, 4, 30, 2);
    ctx.fill();
    label(ctx, sv.name, px + 26, y, {
      size: 13, weight: 700, color: dead ? Theme.textFaint : Theme.text,
    });
    const status = dead ? 'dead'
      : sv.status === 'injured' ? `injured (${sv.injury}d)`
        : `${sv.hp}/${sv.hpMax} hp`;
    labelClipped(ctx, `${cls.name} · lv${sv.level} · ${status}`, px + 26, y + 17, pw - 90, {
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
  panel(ctx, px, 412, pw, 148, { title: 'Automation' });
  y = 452;
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
  panel(ctx, px, 572, pw, 116, { title: 'Recent' });
  y = 606;
  for (let i = 0; i < 4 && i < state.log.length; i++) {
    const e = state.log[i];
    labelClipped(ctx, `d${e.day}  ${e.text}`, px + 16, y, pw - 32, { size: 11, color: Theme.textDim });
    y += 19;
  }
}

/** Small procedural icon per station. */
function drawStationGlyph(ctx, key, cx, cy, color, t) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

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
  ctx.restore();
}

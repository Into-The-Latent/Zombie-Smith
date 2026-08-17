// Choose who goes out and where.

import { Game } from '../core/loop.js';
import { keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, row, roundRect } from '../ui/widgets.js';
import { SITES, SITE_KEYS } from '../run/map.js';
import { CLASSES } from '../data/progression.js';
import { equippedWeapons } from '../core/state.js';
import { weaponLabel, weaponStats } from '../game/craft.js';
import { AMMO } from '../data/materials.js';
import { isDeployable } from '../game/survivors.js';
import {
  bankDaylight, daylightColor, daylightFraction, daylightLeft, formatClock,
} from '../game/clocks.js';
import { makeRng } from '../core/rng.js';
import { makeRunScene } from './run.js';

const MAX_SQUAD = 3;

export function makeDeployScene(state, onBack) {
  const ready = state.survivors.filter(isDeployable);

  return {
    name: 'deploy',
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    squad: ready.slice(0, MAX_SQUAD).map((s) => s.id),
    siteKey: SITE_KEYS[(state.day - 1) % SITE_KEYS.length],

    update() {
      if (keyPressed('Escape')) onBack();
      if (keyPressed(' ') && this.squad.length) this.launch();
    },

    launch() {
      const seed = (state.seed ^ (state.day * 2654435761)) >>> 0;
      const rand = makeRng(seed);
      Sfx.click();
      // Whatever light is left is the player's to have earned. Recorded here so
      // the bonus that will hang off it does not have to reconstruct it later.
      bankDaylight(state);
      Game.replace(makeRunScene(state, this.squad, this.siteKey, rand));
    },

    render(ctx) {
      beginUI();
      ctx.fillStyle = Theme.bg;
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(40,55,80,0.15)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      label(ctx, 'HEAD OUT', 40, 28, { size: 26, weight: 800, color: Theme.text });
      label(ctx, `Day ${state.day}. Up to three go; the rest hold the workshop.`, 40, 60, {
        size: 13, color: Theme.textDim,
      });
      if (button(ctx, W - 180, 30, 140, 36, 'BACK', { hotkey: 'Escape' })) onBack();

      // What a quick preparation earned. Still draining while you stand here.
      const light = daylightLeft(state);
      label(ctx, `Daylight in hand  ${formatClock(light)}`, W - 200, 56, {
        size: 12.5, weight: 700, align: 'right', color: daylightColor(daylightFraction(state)),
      });
      label(ctx, light > 0 ? 'banked when you head out' : 'you took the whole day over it', W - 200, 74, {
        size: 10.5, align: 'right', color: Theme.textFaint,
      });

      drawSquadPicker(this, ctx, state);
      drawSitePicker(this, ctx, state);
      drawSummary(this, ctx, state);
      endUI(ctx);
    },
  };
}

function drawSquadPicker(scene, ctx, state) {
  panel(ctx, 40, 92, 470, 400, { title: `Squad (${scene.squad.length} / ${MAX_SQUAD})` });

  let y = 132;
  for (const sv of state.survivors.filter((s) => s.status !== 'dead')) {
    const picked = scene.squad.includes(sv.id);
    const able = isDeployable(sv);
    const cls = CLASSES[sv.cls];
    const { primary, melee } = equippedWeapons(state, sv);

    const r = row(ctx, 54, y, 442, 66, {
      selected: picked,
      fill: able ? '#131820' : '#111116',
      tooltip: able ? cls.desc : 'Still recovering. Give them a day.',
    });

    ctx.fillStyle = able ? cls.color : '#40474f';
    roundRect(ctx, 62, y + 8, 4, 50, 2);
    ctx.fill();

    label(ctx, sv.name, 76, y + 8, {
      size: 14, weight: 700,
      color: !able ? Theme.textFaint : picked ? Theme.accent : Theme.text,
    });
    label(ctx, `${cls.name} · lv${sv.level}`, 76, y + 27, { size: 11, color: Theme.textDim });

    const kit = [primary && weaponLabel(primary), melee && weaponLabel(melee)].filter(Boolean);
    label(ctx, kit.length ? kit.join('  +  ') : 'unarmed', 76, y + 45, {
      size: 11, color: kit.length ? Theme.textFaint : Theme.bad,
    });

    if (able) {
      bar(ctx, 330, y + 12, 130, 8, sv.hp, sv.hpMax,
        sv.hp / sv.hpMax > 0.5 ? Theme.good : Theme.warn, { text: `${sv.hp}/${sv.hpMax}` });
    } else {
      label(ctx, sv.status === 'injured' ? `INJURED ${sv.injury}d` : 'UNFIT', 486, y + 10, {
        size: 10.5, weight: 800, color: Theme.warn, align: 'right',
      });
    }
    if (picked) {
      label(ctx, 'GOING', 486, y + 40, { size: 10.5, weight: 800, color: Theme.accent, align: 'right' });
    }

    if (r === 'click' && able) {
      if (picked) scene.squad = scene.squad.filter((id) => id !== sv.id);
      else if (scene.squad.length < MAX_SQUAD) scene.squad.push(sv.id);
      else Sfx.deny();
    }
    y += 72;
  }
}

function drawSitePicker(scene, ctx, state) {
  panel(ctx, 530, 92, 400, 400, { title: 'Where' });
  let y = 132;
  for (const key of SITE_KEYS) {
    const s = SITES[key];
    const sel = key === scene.siteKey;
    const r = row(ctx, 544, y, 372, 62, { selected: sel, tooltip: s.blurb });
    label(ctx, s.name, 558, y + 9, { size: 14, weight: 700, color: sel ? Theme.accent : Theme.text });
    label(ctx, s.blurb, 558, y + 29, { size: 11, color: Theme.textDim });
    const rooms = `${s.rooms[0]}-${s.rooms[1]} rooms`;
    label(ctx, rooms, 906, y + 9, { size: 10.5, color: Theme.textFaint, align: 'right' });
    if (s.lootBias) {
      label(ctx, `${s.lootBias} rich`, 906, y + 28, { size: 10.5, color: Theme.info, align: 'right' });
    }
    if (r === 'click') scene.siteKey = key;
    y += 68;
  }
}

function drawSummary(scene, ctx, state) {
  panel(ctx, 950, 92, 290, 400, { title: 'Kit check' });
  let y = 132;

  const squad = scene.squad
    .map((id) => state.survivors.find((s) => s.id === id))
    .filter(Boolean);

  const warnings = [];
  let gunners = 0;
  for (const sv of squad) {
    const { primary, melee } = equippedWeapons(state, sv);
    if (!primary && !melee) warnings.push(`${sv.name} has no weapon at all.`);
    if (primary) {
      gunners += 1;
      const st = weaponStats(primary);
      const pool = state.ammo[primary.ammo] || 0;
      if (pool + primary.loaded < st.mag) {
        warnings.push(`${sv.name} cannot fill their magazine.`);
      }
    }
    if (primary && primary.dur <= 0) warnings.push(`${weaponLabel(primary)} is broken.`);
    if (melee && melee.dur <= 0) warnings.push(`${weaponLabel(melee)} is broken.`);
  }
  if (!squad.length) warnings.push('Nobody selected.');
  if (state.medipacks === 0) warnings.push('No medipacks. A knockdown will be permanent.');

  label(ctx, 'CARRYING', 970, y, { size: 10.5, weight: 700, color: Theme.textFaint });
  y += 20;
  label(ctx, `${state.medipacks} medipacks`, 970, y, {
    size: 12, color: state.medipacks ? Theme.text : Theme.bad,
  });
  y += 18;
  for (const key of ['light', 'shell', 'rifle']) {
    const n = state.ammo[key] || 0;
    if (!n && key !== 'light') continue;
    label(ctx, `${n} ${AMMO[key].short}`, 970, y, { size: 12, color: n ? Theme.text : Theme.textFaint });
    y += 18;
  }

  y += 12;
  label(ctx, 'NOTES', 970, y, { size: 10.5, weight: 700, color: Theme.textFaint });
  y += 20;
  if (!warnings.length) {
    label(ctx, 'Everyone is kitted and fed.', 970, y, { size: 12, color: Theme.good });
    y += 20;
  }
  ctx.font = Theme.font(11.5);
  for (const wtext of warnings.slice(0, 7)) {
    const words = wtext.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > 250) {
        label(ctx, line, 970, y, { size: 11.5, color: Theme.warn });
        line = word;
        y += 15;
      } else line = test;
    }
    if (line) {
      label(ctx, line, 970, y, { size: 11.5, color: Theme.warn });
      y += 19;
    }
  }

  if (gunners === 0 && squad.length) {
    label(ctx, 'All melee: quiet, but slow going.', 970, y, { size: 11.5, color: Theme.info });
  }

  // Launch.
  const site = SITES[scene.siteKey];
  panel(ctx, 40, 512, 1200, 176, { title: 'Ready' });
  label(ctx, site.name, 64, 552, { size: 22, weight: 800, color: Theme.text });
  label(ctx, site.blurb, 64, 584, { size: 13, color: Theme.textDim });
  label(ctx,
    `Expect roughly ${Math.min(24, Math.round(6 + state.day * 1.4))} of them on the site. They get tougher every day.`,
    64, 610, { size: 12, color: Theme.textFaint });
  label(ctx, squad.map((s) => s.name).join(', ') || 'No squad selected', 64, 638, {
    size: 13, weight: 700, color: squad.length ? Theme.accent : Theme.bad,
  });

  if (button(ctx, 1000, 588, 220, 58, 'MOVE OUT', {
    tone: 'good', size: 17, hotkey: ' ', disabled: !squad.length,
    tooltip: 'Start the run. (Space)',
  })) {
    scene.launch();
  }
}

// Survivors: levels, perks, injuries, recruitment.

import { keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, row, roundRect } from '../ui/widgets.js';
import { backdrop, engraved } from '../ui/ornament.js';
import { CLASSES, CLASS_ORDER, PERKS, xpForLevel } from '../data/progression.js';
import { makeSurvivor, choosePerk, perkChoices } from '../game/survivors.js';
import { canAfford, pay, equippedWeapons, logLine } from '../core/state.js';
import { weaponLabel, weaponStats } from '../game/craft.js';
import { makeRng } from '../core/rng.js';

const RECRUIT_COST = { food: 5, scrap: 4, cloth: 3 };
const MAX_SURVIVORS = 6;

export function makeRosterScene(state, onDone) {
  const rand = makeRng((state.seed ^ (state.day * 31337)) >>> 0);

  return {
    name: 'roster',
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    selectedId: state.survivors.find((s) => s.status !== 'dead')?.id || state.survivors[0]?.id || null,
    offers: new Map(), // survivorId -> perk keys, stable while the screen is open

    update() {
      if (keyPressed('Escape')) onDone();
    },

    render(ctx) {
      beginUI();
      backdrop(ctx, W, H);

      engraved(ctx, 'SURVIVORS', 40, 26, { size: 26, spacing: 3.4 });
      const alive = state.survivors.filter((s) => s.status !== 'dead').length;
      label(ctx, `${alive} alive of ${state.survivors.length} who have passed through here`, 40, 60, {
        size: 13, color: Theme.textDim,
      });
      if (button(ctx, W - 180, 30, 140, 36, 'BACK', { hotkey: 'Escape' })) onDone();

      drawList(this, ctx, state);
      drawDetail(this, ctx, state, rand);
      endUI(ctx);
    },
  };
}

function drawList(scene, ctx, state) {
  panel(ctx, 40, 92, 380, 596, { title: 'The group' });
  let y = 132;
  for (const sv of state.survivors) {
    const cls = CLASSES[sv.cls];
    const dead = sv.status === 'dead';
    const sel = sv.id === scene.selectedId;
    const r = row(ctx, 54, y, 352, 66, { selected: sel });

    ctx.fillStyle = dead ? '#3a2b2b' : cls.color;
    roundRect(ctx, 62, y + 8, 4, 50, 2);
    ctx.fill();

    label(ctx, sv.name, 76, y + 8, {
      size: 14, weight: 700, color: dead ? Theme.textFaint : sel ? Theme.accent : Theme.text,
    });
    label(ctx, `${cls.name} · level ${sv.level}`, 76, y + 27, { size: 11, color: Theme.textDim });

    if (!dead) {
      bar(ctx, 76, y + 46, 150, 7, sv.hp, sv.hpMax,
        sv.hp / sv.hpMax > 0.5 ? Theme.good : sv.hp / sv.hpMax > 0.25 ? Theme.warn : Theme.bad,
        { text: `${sv.hp}` });
    }

    const statusText = dead ? 'DEAD' : sv.status === 'injured' ? `INJURED ${sv.injury}d` : 'READY';
    label(ctx, statusText, 396, y + 8, {
      size: 10.5, weight: 800, align: 'right',
      color: dead ? Theme.bad : sv.status === 'injured' ? Theme.warn : Theme.good,
    });
    if (sv.pendingPerks > 0) {
      label(ctx, `${sv.pendingPerks} PERK`, 396, y + 26, {
        size: 10.5, weight: 800, color: Theme.accent, align: 'right',
      });
    }

    if (r === 'click') scene.selectedId = sv.id;
    y += 72;
  }

  // Recruiting.
  const canRecruit = state.survivors.filter((s) => s.status !== 'dead').length < MAX_SURVIVORS;
  const afford = canAfford(state, RECRUIT_COST);
  if (button(ctx, 54, 620, 352, 46, canRecruit ? 'TAKE IN A STRANGER' : 'NO ROOM AT THE BENCH', {
    tone: 'primary', size: 13, disabled: !canRecruit || !afford,
    tooltip: `Costs ${Object.entries(RECRUIT_COST).map(([k, v]) => `${v} ${k}`).join(', ')}. You do not get to choose what they are good at.`,
  })) {
    pay(state, RECRUIT_COST);
    const rand = makeRng((state.seed ^ (state.day * 7717) ^ state.survivors.length) >>> 0);
    const sv = makeSurvivor(rand.pick(CLASS_ORDER), rand);
    state.survivors.push(sv);
    scene.selectedId = sv.id;
    logLine(state, `${sv.name} joined the group.`);
    Sfx.craftDone();
  }
}

function drawDetail(scene, ctx, state, rand) {
  const px = 440;
  const pw = W - px - 40;
  panel(ctx, px, 92, pw, 596, { title: 'Detail' });

  const sv = state.survivors.find((s) => s.id === scene.selectedId);
  if (!sv) {
    label(ctx, 'Nobody selected.', px + 24, 140, { size: 13, color: Theme.textFaint });
    return;
  }
  const cls = CLASSES[sv.cls];

  label(ctx, sv.name, px + 24, 128, { size: 26, weight: 800, color: cls.color });
  label(ctx, `${cls.name} · level ${sv.level}`, px + 24, 162, { size: 13, color: Theme.text });
  label(ctx, cls.blurb, px + 24, 182, { size: 11.5, color: Theme.textFaint });

  const statusColor = sv.status === 'dead' ? Theme.bad : sv.status === 'injured' ? Theme.warn : Theme.good;
  const statusText = sv.status === 'dead' ? 'Dead'
    : sv.status === 'injured' ? `Injured — fit again in ${sv.injury} day${sv.injury === 1 ? '' : 's'}`
      : 'Ready to travel';
  label(ctx, statusText, px + pw - 24, 128, { size: 13, weight: 700, color: statusColor, align: 'right' });

  // XP.
  const need = xpForLevel(sv.level);
  label(ctx, 'EXPERIENCE', px + 24, 212, { size: 10.5, weight: 700, color: Theme.textFaint });
  bar(ctx, px + 24, 230, 300, 12, sv.xp, need, Theme.info, { text: `${sv.xp} / ${need}` });

  // Stats.
  const rows = [
    ['Health', `${sv.hp} / ${sv.hpMax}`],
    ['Action points', sv.apMax],
    ['Aim bonus', `${sv.aim >= 0 ? '+' : ''}${sv.aim}`],
    ['Melee bonus', `${sv.meleeBonus >= 0 ? '+' : ''}${sv.meleeBonus}`],
    ['Crit bonus', `+${Math.round(sv.critBonus * 100)}%`],
    ['Armour', sv.armor],
    ['Sight', `${sv.sight} tiles`],
    ['Bench forgiveness', `+${Math.round(sv.craftBonus * 100)}%`],
  ];
  let y = 262;
  for (const [k, v] of rows) {
    label(ctx, k, px + 24, y, { size: 12.5, color: Theme.textDim });
    label(ctx, String(v), px + 300, y, { size: 13, weight: 700, color: Theme.text, align: 'right' });
    y += 21;
  }

  // Loadout.
  const { primary, melee } = equippedWeapons(state, sv);
  label(ctx, 'CARRYING', px + 360, 262, { size: 10.5, weight: 700, color: Theme.textFaint });
  let ly = 282;
  for (const [slot, w] of [['Firearm', primary], ['Melee', melee]]) {
    label(ctx, slot, px + 360, ly, { size: 11, color: Theme.textFaint });
    if (w) {
      const st = weaponStats(w);
      label(ctx, weaponLabel(w), px + 360, ly + 15, { size: 12.5, weight: 700, color: Theme.text });
      label(ctx, `${st.dmg} dmg · ${st.acc}% · ${st.ap} AP`, px + 360, ly + 32, {
        size: 11, color: Theme.textDim, font: Theme.mono(11),
      });
    } else {
      label(ctx, 'nothing', px + 360, ly + 15, { size: 12.5, color: Theme.bad });
    }
    ly += 60;
  }

  // Perks held.
  y = 442;
  label(ctx, 'PERKS', px + 24, y, { size: 10.5, weight: 700, color: Theme.textFaint });
  y += 20;
  if (!sv.perks.length) {
    label(ctx, 'None yet.', px + 24, y, { size: 12, color: Theme.textFaint });
    y += 22;
  } else {
    let cx = px + 24;
    for (const key of sv.perks) {
      const p = PERKS[key];
      const w = ctx.measureText(p.name).width + 26;
      ctx.fillStyle = 'rgba(169,127,174,0.18)';
      roundRect(ctx, cx, y - 2, w, 24, 12);
      ctx.fill();
      ctx.strokeStyle = Theme.purple;
      ctx.stroke();
      label(ctx, p.name, cx + 13, y + 4, { size: 11.5, weight: 600, color: Theme.text });
      cx += w + 8;
      if (cx > px + pw - 180) {
        cx = px + 24;
        y += 30;
      }
    }
    y += 34;
  }

  // Pending perk selection.
  if (sv.pendingPerks > 0 && sv.status !== 'dead') {
    if (!scene.offers.has(sv.id)) scene.offers.set(sv.id, perkChoices(sv, rand));
    const offers = scene.offers.get(sv.id);

    label(ctx, `LEVEL UP — CHOOSE ONE (${sv.pendingPerks} pending)`, px + 24, y, {
      size: 12, weight: 800, color: Theme.accent,
    });
    y += 24;
    const cardW = (pw - 48 - 16) / 3;
    offers.forEach((key, i) => {
      const p = PERKS[key];
      const cx = px + 24 + i * (cardW + 8);
      const r = row(ctx, cx, y, cardW, 92, { tooltip: p.desc });
      label(ctx, p.name, cx + 12, y + 12, { size: 13, weight: 700, color: Theme.accent });
      const words = p.desc.split(' ');
      let line = '';
      let ly2 = y + 34;
      ctx.font = Theme.font(11.5);
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > cardW - 24) {
          label(ctx, line, cx + 12, ly2, { size: 11.5, color: Theme.textDim });
          line = word;
          ly2 += 16;
        } else {
          line = test;
        }
      }
      if (line) label(ctx, line, cx + 12, ly2, { size: 11.5, color: Theme.textDim });

      if (r === 'click') {
        if (choosePerk(sv, key)) {
          Sfx.craftDone();
          scene.offers.delete(sv.id);
          logLine(state, `${sv.name} learned ${p.name}.`);
        }
      }
    });
  } else if (sv.status !== 'dead') {
    label(ctx, `Next perk at level ${sv.level + 1}.`, px + 24, y, { size: 12, color: Theme.textFaint });
  }

  // Footer stats.
  label(ctx, `${sv.kills} kills · ${sv.runs} runs`, px + pw - 24, 660, {
    size: 11.5, color: Theme.textFaint, align: 'right',
  });
}

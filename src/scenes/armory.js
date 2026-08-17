// Armoury: equip, modify, repair, rename and scrap.

import { Input, keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, bar, row, roundRect } from '../ui/widgets.js';
import { weaponStats, weaponLabel, repairCost, tierFor, profileLabel } from '../game/craft.js';
import { WEAPON_TEMPLATES, modsFor } from '../data/weapons.js';
import { STOCK, MATERIALS, AMMO } from '../data/materials.js';
import { canAfford, pay, itemById, logLine } from '../core/state.js';
import { CLASSES } from '../data/progression.js';

export function makeArmoryScene(state, onDone) {
  return {
    name: 'armory',
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    selectedId: state.stash[0]?.id || null,
    renaming: false,
    draft: '',
    scrollTop: 0,

    update() {
      if (this.renaming) {
        for (const ch of Input.typed) if (this.draft.length < 22) this.draft += ch;
        if (keyPressed('Backspace')) this.draft = this.draft.slice(0, -1);
        if (keyPressed('Enter')) {
          const w = itemById(state, this.selectedId);
          if (w) w.customName = this.draft.trim() || null;
          this.renaming = false;
          Sfx.click();
        }
        if (keyPressed('Escape')) this.renaming = false;
        return;
      }
      if (keyPressed('Escape')) onDone();
      if (Input.wheel) this.scrollTop = Math.max(0, this.scrollTop + Input.wheel);
    },

    render(ctx) {
      beginUI();
      ctx.fillStyle = Theme.bg;
      ctx.fillRect(0, 0, W, H);

      label(ctx, 'ARMOURY', 40, 28, { size: 26, weight: 800, color: Theme.text });
      label(ctx, `${state.stash.length} weapons on the rack`, 40, 60, { size: 13, color: Theme.textDim });
      if (button(ctx, W - 180, 30, 140, 36, 'BACK', { hotkey: 'Escape' })) onDone();

      drawList(this, ctx, state);
      drawDetail(this, ctx, state);
      endUI(ctx);
    },
  };
}

function drawList(scene, ctx, state) {
  panel(ctx, 40, 92, 420, 596, { title: 'Rack' });

  const rows = 9;
  const maxScroll = Math.max(0, state.stash.length - rows);
  scene.scrollTop = Math.min(scene.scrollTop, maxScroll);

  if (!state.stash.length) {
    label(ctx, 'Nothing here. Go make something.', 60, 140, { size: 13, color: Theme.textFaint });
    return;
  }

  let y = 132;
  for (let i = scene.scrollTop; i < Math.min(state.stash.length, scene.scrollTop + rows); i++) {
    const w = state.stash[i];
    const st = weaponStats(w);
    const tier = tierFor(w.quality);
    const holder = state.survivors.find(
      (s) => s.equipped.primary === w.id || s.equipped.melee === w.id,
    );
    const sel = w.id === scene.selectedId;
    const broken = w.dur <= 0;

    const r = row(ctx, 54, y, 392, 58, { selected: sel });
    ctx.fillStyle = tier.color;
    roundRect(ctx, 62, y + 8, 4, 42, 2);
    ctx.fill();

    label(ctx, weaponLabel(w), 76, y + 7, {
      size: 13.5, weight: 700, color: broken ? Theme.bad : sel ? Theme.accent : Theme.text,
    });
    label(ctx, `${st.dmg} dmg  ${st.acc}%  ${st.ap} AP${w.ammo ? `  ${st.mag} rnd` : ''}`, 76, y + 25, {
      size: 11, color: Theme.textDim, font: Theme.mono(11),
    });

    const durFrac = w.dur / w.durMax;
    bar(ctx, 76, y + 43, 120, 6, w.dur, w.durMax,
      durFrac > 0.5 ? Theme.good : durFrac > 0.2 ? Theme.warn : Theme.bad);

    if (holder) {
      label(ctx, holder.name, 436, y + 8, { size: 11, weight: 700, color: Theme.info, align: 'right' });
    }
    if (w.mods.length) {
      label(ctx, `${w.mods.length} mod${w.mods.length > 1 ? 's' : ''}`, 436, y + 26, {
        size: 10, color: Theme.purple, align: 'right',
      });
    }
    if (broken) {
      label(ctx, 'BROKEN', 436, y + 42, { size: 10, weight: 800, color: Theme.bad, align: 'right' });
    }

    if (r === 'click') {
      scene.selectedId = w.id;
      scene.renaming = false;
    }
    y += 62;
  }

  if (maxScroll > 0) {
    label(ctx, `scroll for ${maxScroll} more`, 250, 664, {
      size: 11, color: Theme.textFaint, align: 'center',
    });
  }
}

function drawDetail(scene, ctx, state) {
  const px = 480;
  const pw = W - px - 40;
  panel(ctx, px, 92, pw, 596, { title: 'Detail' });

  const w = itemById(state, scene.selectedId);
  if (!w) {
    label(ctx, 'Select a weapon.', px + 24, 140, { size: 13, color: Theme.textFaint });
    return;
  }

  const tpl = WEAPON_TEMPLATES[w.tpl];
  const st = weaponStats(w);
  const tier = tierFor(w.quality);

  // Title / rename.
  if (scene.renaming) {
    label(ctx, scene.draft + (Math.floor(Date.now() / 400) % 2 ? '|' : ''), px + 24, 130, {
      size: 24, weight: 800, color: Theme.accent,
    });
    label(ctx, 'Enter to confirm, Esc to cancel', px + 24, 162, { size: 11, color: Theme.textDim });
  } else {
    label(ctx, weaponLabel(w), px + 24, 130, { size: 24, weight: 800, color: tier.color });
    label(ctx, `${tpl.name} · ${STOCK[w.stock].name} · ${profileLabel(w.profile)} · made by ${w.crafter}`, px + 24, 162, {
      size: 12, color: Theme.textDim,
    });
  }

  if (button(ctx, px + pw - 130, 126, 106, 28, scene.renaming ? 'CANCEL' : 'RENAME', { size: 11 })) {
    scene.renaming = !scene.renaming;
    scene.draft = scene.renaming ? weaponLabel(w) : '';
  }

  // Stats.
  const statRows = [
    ['Damage', st.dmg, st.veteran ? `+${st.veteran} veteran` : ''],
    ['Accuracy', `${st.acc}%`, ''],
    ['Crit chance', `${Math.round(st.crit * 100)}%`, ''],
    ['AP per attack', st.ap, ''],
    ['Range', st.range === 1 ? 'melee' : `${st.range} tiles`, ''],
    ...(w.ammo ? [['Magazine', st.mag, AMMO[w.ammo].name]] : []),
    ['Noise', st.noise, w.kind === 'gun' ? 'tiles of hearing' : 'quiet'],
    ['Armour pierce', st.pen, ''],
  ];
  let y = 194;
  for (const [k, v, note] of statRows) {
    label(ctx, k, px + 24, y, { size: 12.5, color: Theme.textDim });
    label(ctx, String(v), px + 250, y, { size: 13, weight: 700, color: Theme.text, align: 'right' });
    if (note) label(ctx, note, px + 262, y, { size: 11, color: Theme.textFaint });
    y += 22;
  }

  // Condition + repair.
  y += 6;
  label(ctx, 'CONDITION', px + 24, y, { size: 11, weight: 700, color: Theme.textFaint });
  bar(ctx, px + 24, y + 18, 226, 12, w.dur, w.durMax,
    w.dur / w.durMax > 0.5 ? Theme.good : w.dur / w.durMax > 0.2 ? Theme.warn : Theme.bad,
    { text: `${w.dur}/${w.durMax}` });

  const rc = repairCost(w);
  if (button(ctx, px + 262, y + 12, 120, 26, rc ? `REPAIR ${rc.scrap} scrap` : 'PRISTINE', {
    size: 11, disabled: !rc || !canAfford(state, rc),
    tooltip: rc ? 'Bring it back to full condition.' : 'Nothing to fix.',
  })) {
    pay(state, rc);
    w.dur = w.durMax;
    Sfx.press();
  }

  // Quality breakdown.
  y += 46;
  label(ctx, `${tier.name.toUpperCase()} · ${Math.round(w.quality * 100)}% workmanship`, px + 24, y, {
    size: 12, weight: 700, color: tier.color,
  });
  if (w.kills) {
    label(ctx, `${w.kills} kills with this one`, px + 250, y, { size: 11, color: Theme.textFaint });
  }

  // ---- mods ---------------------------------------------------------------
  y += 26;
  label(ctx, 'ATTACHMENTS', px + 24, y, { size: 11, weight: 700, color: Theme.textFaint });
  y += 20;
  const available = modsFor(w, state.unlocks);
  if (!available.length) {
    label(ctx, 'No attachments researched yet.', px + 24, y, { size: 12, color: Theme.textFaint });
    y += 24;
  }
  let mx = px + 24;
  for (const m of available) {
    const fitted = w.mods.includes(m.key);
    const afford = canAfford(state, m.cost);
    const bw = 168;
    const desc = `${m.desc}\n${Object.entries(m.cost).map(([k, v]) => `${v} ${MATERIALS[k].short}`).join('  ')}`;
    if (button(ctx, mx, y, bw, 34, fitted ? `${m.name} ✓` : m.name, {
      size: 11, tone: fitted ? 'good' : 'default',
      disabled: !fitted && !afford,
      tooltip: desc,
      active: fitted,
    })) {
      if (fitted) {
        w.mods = w.mods.filter((k) => k !== m.key);
        Sfx.click();
      } else if (afford) {
        pay(state, m.cost);
        w.mods.push(m.key);
        Sfx.press();
      }
    }
    mx += bw + 8;
    if (mx + bw > px + pw - 24) {
      mx = px + 24;
      y += 40;
    }
  }
  y += 52;

  // ---- who carries it ------------------------------------------------------
  label(ctx, 'ISSUE TO', px + 24, y, { size: 11, weight: 700, color: Theme.textFaint });
  y += 20;
  const slot = w.kind === 'gun' ? 'primary' : 'melee';
  let sx = px + 24;
  for (const sv of state.survivors.filter((s) => s.status !== 'dead')) {
    const has = sv.equipped[slot] === w.id;
    const cls = CLASSES[sv.cls];
    if (button(ctx, sx, y, 150, 34, sv.name, {
      size: 11, tone: has ? 'good' : 'default', active: has,
      tooltip: has
        ? `Unequip from ${sv.name}.`
        : `Give this to ${sv.name} as their ${slot === 'primary' ? 'firearm' : 'melee weapon'}. (${cls.name})`,
    })) {
      if (has) {
        sv.equipped[slot] = null;
      } else {
        // Only one owner at a time.
        for (const other of state.survivors) {
          if (other.equipped.primary === w.id) other.equipped.primary = null;
          if (other.equipped.melee === w.id) other.equipped.melee = null;
        }
        sv.equipped[slot] = w.id;
      }
      Sfx.click();
    }
    sx += 158;
    if (sx + 150 > px + pw - 24) {
      sx = px + 24;
      y += 40;
    }
  }

  // ---- scrap ---------------------------------------------------------------
  const held = state.survivors.some((s) => s.equipped.primary === w.id || s.equipped.melee === w.id);
  if (button(ctx, px + pw - 170, 640, 146, 34, 'SCRAP IT', {
    tone: 'danger', size: 12, disabled: held,
    tooltip: held ? 'Take it off whoever is carrying it first.' : 'Break it down for roughly half its materials.',
  })) {
    const recovered = {};
    for (const [k, v] of Object.entries(WEAPON_TEMPLATES[w.tpl].cost)) {
      recovered[k] = Math.max(1, Math.floor(v / 2));
    }
    for (const [k, v] of Object.entries(recovered)) state.resources[k] = (state.resources[k] || 0) + v;
    state.stash = state.stash.filter((x) => x.id !== w.id);
    scene.selectedId = state.stash[0]?.id || null;
    logLine(state, `Broke down a ${weaponLabel(w)}.`);
    Sfx.hammerBad();
  }
}

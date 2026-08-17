// Blueprints: spend salvage to permanently widen what the workshop can make.

import { keyPressed } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, row } from '../ui/widgets.js';
import { RESEARCH, RESEARCH_ORDER, researchAvailable } from '../data/progression.js';
import { MATERIALS } from '../data/materials.js';
import { canAfford, pay, unlock } from '../core/state.js';

const CATEGORIES = ['Weapons', 'Materials', 'Mods', 'Automation', 'Workshop'];

export function makeResearchScene(state, onDone) {
  return {
    name: 'research',
    /** Part of the preparation phase: the daylight clock runs here. */
    prep: true,
    hovered: null,

    update() {
      if (keyPressed('Escape')) onDone();
    },

    render(ctx) {
      beginUI();
      ctx.fillStyle = Theme.bg;
      ctx.fillRect(0, 0, W, H);

      label(ctx, 'BLUEPRINTS', 40, 28, { size: 26, weight: 800, color: Theme.text });
      const owned = state.unlocks.length;
      label(ctx, `${owned} of ${RESEARCH_ORDER.length} worked out. Blueprints also turn up in wall safes.`, 40, 60, {
        size: 13, color: Theme.textDim,
      });
      if (button(ctx, W - 180, 30, 140, 36, 'BACK', { hotkey: 'Escape' })) onDone();

      const colW = 232;
      const gap = 12;
      CATEGORIES.forEach((cat, ci) => {
        const x = 40 + ci * (colW + gap);
        panel(ctx, x, 92, colW, 596, { title: cat });

        const items = RESEARCH_ORDER.filter((k) => RESEARCH[k].cat === cat);
        let y = 132;
        for (const key of items) {
          const r = RESEARCH[key];
          const have = state.unlocks.includes(key);
          const open = researchAvailable(key, state.unlocks);
          const afford = canAfford(state, r.cost);

          const cardH = 112;
          const res = row(ctx, x + 12, y, colW - 24, cardH, {
            selected: have,
            fill: have ? '#16211a' : open ? '#131820' : '#101319',
            tooltip: open ? r.desc : `Needs: ${r.req.map((q) => RESEARCH[q].name).join(', ')}`,
          });

          label(ctx, r.name, x + 24, y + 10, {
            size: 13, weight: 700,
            color: have ? Theme.good : open ? Theme.text : Theme.textFaint,
          });

          // Description, wrapped to two lines.
          ctx.font = Theme.font(11);
          const words = r.desc.split(' ');
          let line = '';
          let ly = y + 30;
          let lines = 0;
          for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > colW - 48) {
              label(ctx, line, x + 24, ly, { size: 11, color: Theme.textFaint });
              line = word;
              ly += 15;
              if (++lines >= 2) break;
            } else {
              line = test;
            }
          }
          if (lines < 3 && line) label(ctx, line, x + 24, ly, { size: 11, color: Theme.textFaint });

          // Cost.
          let cx = x + 24;
          ctx.font = Theme.font(10.5, 700);
          for (const [k, v] of Object.entries(r.cost)) {
            const ok = (state.resources[k] || 0) >= v;
            ctx.fillStyle = have ? Theme.textFaint : ok ? Theme.textDim : Theme.bad;
            const txt = `${v} ${MATERIALS[k].short}`;
            ctx.fillText(txt, cx, y + 78);
            cx += ctx.measureText(txt).width + 10;
          }

          if (have) {
            label(ctx, 'WORKED OUT', x + 24, y + 94, { size: 10.5, weight: 800, color: Theme.good });
          } else if (!open) {
            label(ctx, `needs ${r.req.map((q) => RESEARCH[q].name).join(' + ')}`, x + 24, y + 94, {
              size: 10, color: Theme.bad,
            });
          } else {
            label(ctx, afford ? 'CLICK TO UNLOCK' : 'NOT ENOUGH SALVAGE', x + 24, y + 94, {
              size: 10.5, weight: 700, color: afford ? Theme.accent : Theme.textFaint,
            });
          }

          if (res === 'click' && !have && open && afford) {
            pay(state, r.cost);
            unlock(state, key);
            Sfx.craftDone();
          } else if (res === 'click' && !have) {
            Sfx.deny();
          }

          y += cardH + 10;
        }
      });

      endUI(ctx);
    },
  };
}

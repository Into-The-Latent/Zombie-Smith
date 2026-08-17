// Post-run summary. Also the point at which a day ticks over: machines run,
// the wounded mend, rations get eaten.

import { Game } from '../core/loop.js';
import { Theme, W, H } from '../ui/theme.js';
import { beginUI, endUI, panel, button, label, roundRect } from '../ui/widgets.js';
import { backdrop as roomBackdrop, engraved } from '../ui/ornament.js';
import { advanceDay } from '../core/state.js';
import { saveGame } from '../core/save.js';
import { MATERIALS } from '../data/materials.js';
import { AMMO } from '../data/materials.js';
import { RESEARCH } from '../data/progression.js';

const OUTCOMES = {
  extracted: { title: 'EXTRACTED', color: '#4fb477', blurb: 'Clean exit. The cache at the pad was worth the walk.' },
  fellback: { title: 'FELL BACK', color: '#e0b23c', blurb: 'You got out the way you came in. Everything you carried came with you.' },
  wiped: { title: 'SQUAD LOST', color: '#d7443e', blurb: 'Nobody came back. Everything they carried is out there now.' },
};

export function makeDebriefScene(state, report, battle) {
  return {
    name: 'debrief',
    report,
    machineNotes: [],
    gameOver: false,

    enter() {
      this.machineNotes = advanceDay(state);
      this.gameOver = state.survivors.every((s) => s.status === 'dead');
      saveGame();
    },

    update() {},

    render(ctx) {
      beginUI();
      roomBackdrop(ctx, W, H);
      backdrop(ctx, report.outcome);

      const o = OUTCOMES[report.outcome];
      engraved(ctx, o.title, W / 2, 44, { size: 46, spacing: 6, align: 'center', color: o.color });
      label(ctx, `${report.site} -- day ${report.day}`, W / 2, 98, {
        size: 14, color: Theme.textDim, align: 'center',
      });
      label(ctx, o.blurb, W / 2, 120, { size: 13, color: Theme.textFaint, align: 'center' });

      // ---- haul -----------------------------------------------------------
      panel(ctx, 40, 154, 400, 372, { title: 'Haul' });
      let y = 194;
      const loot = report.loot;
      const entries = Object.entries(loot.resources).filter(([, v]) => v > 0);

      if (report.outcome === 'wiped') {
        label(ctx, 'Lost with the squad.', 60, y, { size: 14, color: Theme.bad });
        y += 30;
      } else if (!entries.length && !loot.weapons.length && !Object.keys(loot.ammo).length) {
        label(ctx, 'Nothing worth carrying.', 60, y, { size: 14, color: Theme.textFaint });
        y += 30;
      } else {
        for (const [k, v] of entries) {
          const m = MATERIALS[k];
          ctx.fillStyle = m ? m.color : Theme.text;
          roundRect(ctx, 60, y + 3, 9, 9, 2);
          ctx.fill();
          label(ctx, m ? m.name : k, 78, y, { size: 13, color: Theme.text });
          label(ctx, `+${v}`, 410, y, { size: 13, weight: 700, color: Theme.good, align: 'right' });
          y += 21;
        }
        for (const [k, v] of Object.entries(loot.ammo)) {
          if (!v) continue;
          label(ctx, AMMO[k].name, 78, y, { size: 13, color: Theme.text });
          label(ctx, `+${v}`, 410, y, { size: 13, weight: 700, color: Theme.good, align: 'right' });
          y += 21;
        }
        if (loot.medipacks) {
          label(ctx, 'Medipacks', 78, y, { size: 13, color: Theme.text });
          label(ctx, `+${loot.medipacks}`, 410, y, { size: 13, weight: 700, color: Theme.good, align: 'right' });
          y += 21;
        }
        for (const w of loot.weapons) {
          label(ctx, w.name, 78, y, { size: 13, color: Theme.info });
          label(ctx, 'salvaged', 410, y, { size: 11, color: Theme.textFaint, align: 'right' });
          y += 21;
        }
        for (const bp of loot.blueprints) {
          label(ctx, `Blueprint: ${RESEARCH[bp]?.name || bp}`, 78, y, { size: 13, weight: 700, color: Theme.accent });
          y += 21;
        }
      }

      if (report.bonus) {
        y += 6;
        label(ctx, 'Extraction cache included.', 60, y, { size: 12, color: Theme.good });
        y += 22;
      }

      y = 470;
      label(ctx, 'SALVAGE VALUE', 60, y, { size: 11, weight: 700, color: Theme.textFaint });
      label(ctx, String(report.outcome === 'wiped' ? 0 : report.value), 410, y - 6, {
        size: 24, weight: 800, color: Theme.accent, align: 'right',
      });

      // ---- squad ----------------------------------------------------------
      panel(ctx, 460, 154, 400, 372, { title: 'The squad' });
      y = 194;
      for (const x of report.xp) {
        label(ctx, x.name, 480, y, { size: 13, color: Theme.text });
        label(ctx, `+${x.xp} xp`, 780, y, { size: 12, color: Theme.info, align: 'right' });
        y += 20;
        if (x.levels) {
          label(ctx, `  levelled up x${x.levels} -- pick a perk in the roster`, 480, y, {
            size: 11, weight: 700, color: Theme.accent,
          });
          y += 18;
        }
      }
      if (report.injuries.length) {
        y += 8;
        label(ctx, 'Injured', 480, y, { size: 12, weight: 700, color: Theme.warn });
        y += 18;
        label(ctx, report.injuries.join(', '), 480, y, { size: 12, color: Theme.text });
        y += 22;
      }
      if (report.casualties.length) {
        y += 8;
        label(ctx, 'Killed', 480, y, { size: 12, weight: 700, color: Theme.bad });
        y += 18;
        label(ctx, report.casualties.join(', '), 480, y, { size: 12, color: Theme.bad });
        y += 22;
      }

      y = 440;
      const facts = [
        ['Rounds fought', report.rounds],
        ['Zombies put down', report.kills],
        ['Containers opened', report.containers],
      ];
      for (const [k, v] of facts) {
        label(ctx, k, 480, y, { size: 12, color: Theme.textDim });
        label(ctx, String(v), 840, y, { size: 12, weight: 700, color: Theme.text, align: 'right' });
        y += 20;
      }

      // ---- overnight -------------------------------------------------------
      panel(ctx, 880, 154, 360, 372, { title: `Overnight -- day ${state.day} begins` });
      y = 194;
      if (!this.machineNotes.length) {
        label(ctx, 'A quiet night. Nothing running.', 900, y, { size: 12, color: Theme.textFaint });
        y += 22;
      }
      for (const note of this.machineNotes) {
        const good = !note.includes('idle') && !note.includes('slowed');
        label(ctx, note, 900, y, { size: 12, color: good ? Theme.good : Theme.textFaint });
        y += 20;
      }

      y = 400;
      label(ctx, 'STOCK', 900, y, { size: 11, weight: 700, color: Theme.textFaint });
      y += 20;
      const res = Object.entries(state.resources).filter(([, v]) => v > 0);
      let col = 0;
      for (const [k, v] of res) {
        const cx = 900 + (col % 2) * 170;
        const cy = y + Math.floor(col / 2) * 19;
        label(ctx, MATERIALS[k]?.short || k, cx, cy, { size: 12, color: Theme.textDim });
        label(ctx, String(v), cx + 140, cy, { size: 12, weight: 700, color: Theme.text, align: 'right' });
        col += 1;
      }

      // ---- continue --------------------------------------------------------
      if (this.gameOver) {
        label(ctx, 'Everyone is gone. The workshop goes quiet.', W / 2, H - 92, {
          size: 15, weight: 700, color: Theme.bad, align: 'center',
        });
        if (button(ctx, W / 2 - 110, H - 62, 220, 42, 'START OVER', { tone: 'danger', size: 15 })) {
          import('./title.js').then((m) => Game.replace(m.makeTitleScene()));
        }
      } else if (button(ctx, W / 2 - 110, H - 68, 220, 44, 'BACK TO THE WORKSHOP', {
        tone: 'primary', size: 14, hotkey: ' ',
      })) {
        import('./workshop.js').then((m) => Game.replace(m.makeWorkshopScene(state)));
      }

      endUI(ctx);
    },
  };
}

function backdrop(ctx, outcome) {
  const g = ctx.createRadialGradient(W / 2, 60, 20, W / 2, 60, 700);
  const tint = outcome === 'wiped' ? '90,25,22' : outcome === 'extracted' ? '30,80,55' : '80,70,30';
  g.addColorStop(0, `rgba(${tint},0.5)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 400);
}

// The two phase-clock bars.
//
// Drawn as one overlay over whatever screen is up, rather than by each screen in
// turn -- a clock some stations forget to show is worse than no clock at all.
// A scene opts in by flagging itself `prep` (daylight) or `night` (nightfall).

import { Theme, W } from './theme.js';
import { Base, mix } from './palette.js';
import { State } from '../core/state.js';
import {
  daylightFraction, daylightColor, daylightLeft, formatClock, tickDaylight,
  nightFraction, nightLeft, nightBonus, nightBonusMark, nightPerRound,
  nightRoundsLeft,
} from '../game/clocks.js';

/** The strip owns the top of the screen. Every screen leaves it free. */
export const CLOCK_H = 18;

/**
 * Tick and draw whichever clock the current phase runs.
 *
 * Installed on `Game.overlay` and called once per frame after every scene has
 * rendered.
 */
export function phaseClockOverlay(ctx, dt, stack) {
  if (!State) return;
  const prep = stack.find((s) => s.prep);
  const night = stack.find((s) => s.night);
  if (prep) {
    tickDaylight(State, dt);
    drawDaylightBar(ctx, State);
  } else if (night) {
    // Deliberately no tick. The run is turn-based, so the night is charged by
    // the round rather than by the wall clock -- see NIGHT_PER_SURVIVOR.
    drawNightfallBar(ctx, State, night.squadStanding?.() ?? 0);
  }
}

export function drawDaylightBar(ctx, state) {
  const left = daylightLeft(state);
  drawClockBar(ctx, {
    frac: daylightFraction(state),
    label: left > 0 ? 'WE ARE LOSING DAYLIGHT' : 'DAYLIGHT GONE',
    clock: formatClock(left),
    spent: left <= 0,
  });
}

export function drawNightfallBar(ctx, state, standing = 0) {
  const left = nightLeft(state);
  const bonus = nightBonus(state);
  const perRound = nightPerRound(standing);
  const rounds = nightRoundsLeft(state, standing);
  // Rounds, not seconds, because rounds are what the player spends. The clock
  // is still shown, since that is the deposit the bonus was paid into.
  const note = [
    bonus > 0 ? `+${formatClock(bonus)} EARNED` : '',
    perRound > 0 && left > 0 ? `${rounds} ROUNDS LEFT AT ${perRound}s/ROUND` : '',
  ].filter(Boolean).join('   ');
  drawClockBar(ctx, {
    frac: nightFraction(state),
    label: left > 0 ? 'NIGHTFALL IS COMING' : 'NIGHT HAS FALLEN',
    clock: formatClock(left),
    spent: left <= 0,
    // The saved daylight is spent first, so this marks the moment the player
    // has used up what being quick at the bench earned them.
    mark: bonus > 0 ? nightBonusMark(state) : 0,
    note,
  });
}

function drawClockBar(ctx, { frac, label, clock, spent, mark = 0, note = '' }) {
  const color = daylightColor(frac);

  // The spent part of the phase is a dimmed version of the same colour, not a
  // neutral dark track. Otherwise the red the bar is heading for is only ever a
  // thin sliver, and at the end there is no bar left to be red at all -- so a
  // finished phase reads as a full red strip rather than an empty one.
  ctx.fillStyle = mix(color, Base.ink, spent ? 0.42 : 0.7);
  ctx.fillRect(0, 0, W, CLOCK_H);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W * frac, CLOCK_H);

  // A brighter leading edge, so the drain is visible without reading the clock.
  if (!spent) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(Math.max(0, W * frac - 2), 0, 2, CLOCK_H);
  }

  if (mark > 0 && mark < 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(W * mark, 0, 1, CLOCK_H);
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CLOCK_H + 0.5);
  ctx.lineTo(W, CLOCK_H + 0.5);
  ctx.stroke();

  // The text straddles fill and track as the bar drains, so it is shadowed
  // rather than coloured to suit one background.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 3;
  const mid = CLOCK_H / 2 + 1;
  ctx.fillStyle = spent ? '#ffd7d3' : '#ffffff';
  ctx.font = Theme.font(11, 800);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 14, mid);
  const labelW = ctx.measureText(label).width; // measured in the label's own font

  if (note) {
    ctx.font = Theme.mono(9.5, 700);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(note, 14 + labelW + 16, mid);
  }

  ctx.font = Theme.mono(11, 700);
  ctx.textAlign = 'right';
  ctx.fillStyle = spent ? '#ffd7d3' : '#ffffff';
  ctx.fillText(clock, W - 14, mid);
  ctx.restore();
}

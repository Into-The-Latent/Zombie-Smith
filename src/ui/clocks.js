// The two phase-clock bars.
//
// Drawn as one overlay over whatever screen is up, rather than by each screen in
// turn -- a clock some stations forget to show is worse than no clock at all.
// A scene opts in by flagging itself `prep` (daylight) or `night` (nightfall).

import { Theme, W, Brass, Ink } from './theme.js';
import { Base, mix } from './palette.js';
import { tracked, withAlpha } from './ornament.js';
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

/**
 * The bar is a channel cut across the top of the frame, not a strip laid over it.
 *
 * Same materials as everything else: a dark slot, brass along the bottom edge,
 * engraved lettering. The colour ramp still does the talking -- it is just no
 * longer the only thing on screen made of pure light.
 */
function drawClockBar(ctx, { frac, label, clock, spent, mark = 0, note = '' }) {
  const color = daylightColor(frac);

  // The spent part of the phase is a dimmed version of the same colour, not a
  // neutral dark track. Otherwise the red the bar is heading for is only ever a
  // thin sliver, and at the end there is no bar left to be red at all -- so a
  // finished phase reads as a full red strip rather than an empty one.
  ctx.fillStyle = mix(color, Base.ink, spent ? 0.5 : 0.76);
  ctx.fillRect(0, 0, W, CLOCK_H);

  const fw = W * frac;
  if (fw > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, fw, CLOCK_H);
    // Lit along the top, shadowed at the bottom: the same one candle as the rest
    // of the interface, so the fill sits in the channel instead of on it.
    const g = ctx.createLinearGradient(0, 0, 0, CLOCK_H);
    g.addColorStop(0, 'rgba(255,235,200,0.12)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, fw, CLOCK_H);
  }

  // A brighter leading edge, so the drain is visible without reading the clock.
  if (!spent) {
    ctx.fillStyle = 'rgba(255,240,214,0.55)';
    ctx.fillRect(Math.max(0, fw - 2), 0, 2, CLOCK_H);
  }

  if (mark > 0 && mark < 1) {
    // The earned-time mark is a brass pin, so it reads as a fitting rather than
    // as a glitch in the fill.
    ctx.fillStyle = withAlpha(Brass.hi, 0.8);
    ctx.fillRect(W * mark, 0, 1.4, CLOCK_H);
  }

  // Brass along the bottom, ink under it: the lip of the channel.
  ctx.fillStyle = withAlpha(Brass.dark, 0.9);
  ctx.fillRect(0, CLOCK_H - 1.5, W, 1.5);
  ctx.fillStyle = Ink.line;
  ctx.fillRect(0, CLOCK_H, W, 1.5);

  // The text straddles fill and track as the bar drains, so it is shadowed
  // rather than coloured to suit one background.
  const mid = CLOCK_H / 2 + 1;
  const labelW = tracked(ctx, label, 14, mid, {
    font: Theme.display(10.5, 700),
    color: spent ? '#f3d9d2' : '#fdf3e2',
    spacing: 1.7,
    baseline: 'middle',
    shadow: true,
  });

  if (note) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 3;
    ctx.font = Theme.mono(9.5, 700);
    ctx.fillStyle = 'rgba(255,244,222,0.72)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(note, 14 + labelW + 18, mid);
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 3;
  ctx.font = Theme.mono(11, 700);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = spent ? '#f3d9d2' : '#fdf3e2';
  ctx.fillText(clock, W - 14, mid);
  ctx.restore();
}

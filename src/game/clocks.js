// The two phase clocks.
//
// The day is split in two, and each half runs against a five-minute budget:
//
//   daylight   the whole preparation phase -- the workshop and every station
//              share one budget, so time at the forge is time not spent at the
//              chem bench
//   nightfall  the scavenging run, five minutes plus whatever daylight the
//              player did not use up preparing
//
// Neither takes anything away when it expires. The daylight clock exists to
// reward moving fast: what is left is banked at the door and handed straight
// back as night. The consequence of the night clock running out is still to be
// designed, so for now it is a readout and nothing more.

import { clamp } from '../core/util.js';
import { mix } from '../ui/palette.js';

/** The preparation phase, in seconds. */
export const PREP_SECONDS = 300;
/** The base run, before anything earned in preparation is added. */
export const NIGHT_SECONDS = 300;

/**
 * Night spent per survivor, per round.
 *
 * The run is turn-based, so the night is *not* charged in real time. A
 * wall-clock timer over a turn-based fight punishes thinking, which is the one
 * thing turn-based combat exists to allow -- the preparation phase can have a
 * real clock because its stages are dexterity minigames, but a tactical decision
 * should cost nothing to make and only cost something to carry out.
 *
 * So the night is a deposit drawn against by *actions*: every survivor still
 * with the squad burns this much of it each round. The unit is person-time, not
 * elapsed time -- each body moving through a dark building forces lockers, checks
 * corners and covers the others, and the squad only moves as fast as its slowest
 * member. That makes squad size a real decision at the door: three guns burn the
 * night half again as fast as two.
 *
 * Five seconds, not ten, because it was measured. A run takes 13-25 rounds
 * (median 21, occasionally the full 40): at ten seconds a three-hander would get
 * ten rounds and the night would expire before most runs reached an exit. At five
 * the base night covers 20 rounds, and a preparation that banks the lot buys
 * exactly 40 -- the longest a run can be.
 */
export const NIGHT_PER_SURVIVOR = 5;

/**
 * The ramp, first light to dusk. Shared by both clocks: they never appear at
 * the same time, and one bar the player has learned to read beats two.
 * Colour is interpolated along it rather than stepped through it, so a bar
 * drains visibly instead of snapping between four flat states.
 */
export const DAYLIGHT_RAMP = ['#4fb477', '#d9c93c', '#e07a2f', '#d7443e'];

/** Where along the ramp a given fraction of time remaining sits. */
export function daylightColor(frac) {
  const f = clamp(frac, 0, 1);
  const last = DAYLIGHT_RAMP.length - 1;
  const p = (1 - f) * last;
  const i = Math.min(last - 1, Math.floor(p));
  return mix(DAYLIGHT_RAMP[i], DAYLIGHT_RAMP[i + 1], p - i);
}

/** m:ss, rounded up so a bar never reads 0:00 while there is time left. */
export function formatClock(seconds) {
  const t = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Daylight -- the preparation phase
// ---------------------------------------------------------------------------

export function resetDaylight(s) {
  s.prepLeft = PREP_SECONDS;
  return s;
}

/** Seconds left, tolerant of a save written before the clock existed. */
export function daylightLeft(s) {
  return clamp(s.prepLeft ?? PREP_SECONDS, 0, PREP_SECONDS);
}

export function tickDaylight(s, dt) {
  s.prepLeft = clamp(daylightLeft(s) - dt, 0, PREP_SECONDS);
  return s.prepLeft;
}

/** 1 at first light, 0 at dusk. */
export function daylightFraction(s) {
  return daylightLeft(s) / PREP_SECONDS;
}

/**
 * Freeze what is left as the squad heads out.
 *
 * Kept separate from starting the night so the figure survives even if the run
 * is set up somewhere else later.
 */
export function bankDaylight(s) {
  s.daylightBanked = daylightLeft(s);
  return s.daylightBanked;
}

export function daylightBanked(s) {
  return clamp(s.daylightBanked ?? PREP_SECONDS, 0, PREP_SECONDS);
}

// ---------------------------------------------------------------------------
// Nightfall -- the run
// ---------------------------------------------------------------------------

/** How long tonight lasts: the base run plus the daylight the player saved. */
export function nightSpan(s) {
  return NIGHT_SECONDS + daylightBanked(s);
}

/**
 * Start the night. Called once as the run is built, so the span is fixed for
 * the whole run even though the bank keeps living on the campaign state.
 */
export function startNight(s) {
  s.nightSpan = nightSpan(s);
  s.nightBonus = daylightBanked(s);
  s.nightLeft = s.nightSpan;
  return s.nightLeft;
}

/** The span this run was started with, not what the bank says now. */
export function nightTotal(s) {
  const span = s.nightSpan;
  return Number.isFinite(span) && span > 0 ? span : nightSpan(s);
}

export function nightLeft(s) {
  return clamp(s.nightLeft ?? nightTotal(s), 0, nightTotal(s));
}

/**
 * Charge a round to the night.
 *
 * @param {number} survivors how many are still with the squad
 * @returns {number} what it cost, which is less than asked for if the night ran
 *   out partway through -- the deposit cannot go overdrawn.
 */
export function spendNight(s, survivors) {
  const want = Math.max(0, survivors) * NIGHT_PER_SURVIVOR;
  const before = nightLeft(s);
  s.nightLeft = clamp(before - want, 0, nightTotal(s));
  return before - s.nightLeft;
}

/** What the next round will cost, at this squad strength. */
export function nightPerRound(survivors) {
  return Math.max(0, survivors) * NIGHT_PER_SURVIVOR;
}

/** Rounds the remaining night will pay for, at this squad strength. */
export function nightRoundsLeft(s, survivors) {
  const cost = nightPerRound(survivors);
  if (cost <= 0) return Infinity;
  return Math.floor(nightLeft(s) / cost);
}

/** 1 at nightfall, 0 when the night is spent. */
export function nightFraction(s) {
  const total = nightTotal(s);
  return total > 0 ? nightLeft(s) / total : 0;
}

/**
 * Where on the bar the earned time ends and the base five minutes begins.
 *
 * The bonus is spent first, so this is the mark the fill crosses at the moment
 * the player has used up what they saved by being quick.
 */
export function nightBonusMark(s) {
  const total = nightTotal(s);
  return total > 0 ? clamp(NIGHT_SECONDS / total, 0, 1) : 0;
}

export function nightBonus(s) {
  const b = s.nightBonus;
  return Number.isFinite(b) ? clamp(b, 0, PREP_SECONDS) : daylightBanked(s);
}

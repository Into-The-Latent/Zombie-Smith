// Small math / helper grab bag used everywhere.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const round2 = (v) => Math.round(v * 100) / 100;

/** Smooth approach that is stable across variable frame times. */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function rect(x, y, w, h) {
  return { x, y, w, h };
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Chebyshev distance -- our grid allows diagonal movement. */
export const gridDist = (ax, ay, bx, by) =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export const euclid = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 1234 -> "1,234" */
export function commas(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function signed(n) {
  return (n >= 0 ? '+' : '') + Math.round(n);
}

export function pct(v) {
  return Math.round(v * 100) + '%';
}

/** Deep-ish clone good enough for our plain-data game state. */
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

let idCounter = 1;
export function uid(prefix = 'id') {
  return `${prefix}_${(idCounter++).toString(36)}_${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`;
}

/** Wrap text to a pixel width. Returns an array of lines. */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

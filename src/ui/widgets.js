// Immediate-mode widgets. Every call both draws and reports interaction for
// this frame; there is no retained widget tree to keep in sync.
//
// These are the only things most screens draw, which is why the art direction
// lives here rather than in each scene: re-materialising a button changes every
// button in the game at once. The materials themselves are in `ui/ornament.js`
// -- a widget picks *what* something is made of and never mixes its own colour.

import { Input, takeClick, keyPressed } from '../core/input.js';
import { Theme, Ink, Wood, Parch, Brass } from './theme.js';
import { pointInRect, wrapText, clamp } from '../core/util.js';
import { Sfx } from '../core/audio.js';
import {
  woodPanel, parchmentCard, carvedRect, inkContour, brassPlate, brassRule,
  rivet, tracked, trackedWidth, withAlpha, Wash,
} from './ornament.js';

let tooltip = null;
let lastHover = null;

export function beginUI() {
  tooltip = null;
}

/** Draws deferred overlays (tooltips) -- call last in a scene's render. */
export function endUI(ctx) {
  if (!tooltip) return;
  const pad = 10;
  ctx.font = Theme.font(13);
  const maxW = 260;
  const lines = wrapText(ctx, tooltip.text, maxW);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  const boxW = w + pad * 2;
  const boxH = lines.length * 18 + pad * 2;
  let x = clamp(tooltip.x + 14, 6, 1280 - boxW - 6);
  let y = tooltip.y + 18;
  if (y + boxH > 714) y = tooltip.y - boxH - 10;

  // A tooltip is something written down, so it is paper with ink on it rather
  // than another panel. That is also what keeps it legible over a busy screen.
  parchmentCard(ctx, x, y, boxW, boxH, { amp: 1.2 });
  ctx.fillStyle = Parch.ink;
  ctx.font = Theme.font(13);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * 18));
}

export function setTooltip(text) {
  if (text) tooltip = { text, x: Input.x, y: Input.y };
}

/**
 * Kept for the handful of callers that want a plain rounded path.
 *
 * New drawing should prefer `ornament.carvedRect`: this interface is carved,
 * and a 6px fillet is the one shape that reads as software.
 */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * A panel is a stained plank surface with brass at the corners.
 *
 * `material: 'parchment'` makes it a document instead -- use that for anything
 * the player reads as written rather than as structure.
 *
 * The old `fill` option is honoured as a *tint* over the wood rather than as a
 * replacement for it, so a caller asking for a status colour still gets one
 * without punching a flat rectangle through the material.
 */
export function panel(ctx, x, y, w, h, opts = {}) {
  const tint = opts.tint || (opts.fill && opts.fill !== Theme.panel ? withAlpha(opts.fill, 0.35) : null);
  if (opts.material === 'parchment') {
    parchmentCard(ctx, x, y, w, h, { ...opts, tint });
    return;
  }
  woodPanel(ctx, x, y, w, h, {
    ...opts,
    tint,
    titleColor: opts.titleColor || Brass.hi,
  });
}

/**
 * Draw text, trimming it with an ellipsis if it would run past `maxWidth`.
 * Measured in pixels, because character counts lie at proportional sizes.
 */
export function labelClipped(ctx, text, x, y, maxWidth, opts = {}) {
  ctx.font = opts.font || Theme.font(opts.size || 14, opts.weight || 400);
  let t = String(text);
  if (ctx.measureText(t).width > maxWidth) {
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    t = `${t}…`;
  }
  label(ctx, t, x, y, opts);
  return t;
}

export function label(ctx, text, x, y, opts = {}) {
  ctx.fillStyle = opts.color || Theme.text;
  ctx.font = opts.font || Theme.font(opts.size || 14, opts.weight || 400);
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'top';
  ctx.fillText(text, x, y);
}

/**
 * Buttons are fittings: carved wood for ordinary ones, a brass plate for the
 * one the player is meant to press.
 *
 * Labels are uppercased and letterspaced, and shrunk to fit rather than clipped
 * -- tracking makes overflow much easier to hit than it was with plain sans, and
 * a button whose text runs off the edge is worse than a slightly smaller one.
 *
 * @returns {boolean} true on the frame it is clicked
 */
export function button(ctx, x, y, w, h, text, opts = {}) {
  const r = { x, y, w, h };
  const hot = pointInRect(Input.x, Input.y, r) && !Input.clickConsumed;
  const disabled = !!opts.disabled;
  const tone = opts.tone || 'default';
  const lit = (hot && !disabled) || opts.active;

  const path = () => carvedRect(ctx, x, y, w, h, opts.radius ?? 2);

  if (tone === 'primary' && !disabled) {
    // Brass, and the only thing on screen made of it at this size.
    brassPlate(ctx, x, y, w, h, {
      hi: lit ? '#f4d693' : Brass.hi,
      base: lit ? '#c2953f' : Brass.base,
      dark: Brass.dark,
      rivets: w > 90 && h > 26,
      radius: opts.radius ?? 2,
    });
    drawButtonLabel(ctx, text, x, y, w, h, opts, '#2a1c08', true);
    return finishButton(ctx, text, hot, disabled, opts);
  }

  // Stained wood. The stain is what carries the tone, so a dangerous button is
  // the same object in a different finish rather than a differently shaped one.
  const stain = {
    default: null,
    danger: withAlpha(Theme.bad, lit ? 0.34 : 0.24),
    good: withAlpha(Theme.good, lit ? 0.3 : 0.2),
    primary: withAlpha(Theme.accent, 0.24),
    ghost: null,
  }[tone] ?? null;

  if (tone === 'ghost') {
    if (lit) {
      ctx.fillStyle = 'rgba(230,192,121,0.09)';
      path();
      ctx.fill();
    }
  } else {
    woodPanel(ctx, x, y, w, h, {
      raise: disabled ? 0 : 4,
      brackets: false,
      contour: 2,
      radius: opts.radius ?? 2,
      tint: disabled ? 'rgba(0,0,0,0.42)' : lit ? withAlpha('#ffe2b4', 0.13) : null,
    });
    if (!disabled) {
      // A button has to be *lighter* than the plaque it sits on or it reads as a
      // hole rather than a fitting -- same wood, planed and waxed. Graded top to
      // bottom, so it is the one candle doing it and not a coat of paint.
      ctx.save();
      path();
      ctx.clip();
      const face = ctx.createLinearGradient(x, y, x, y + h);
      face.addColorStop(0, withAlpha('#ffdda8', lit ? 0.2 : 0.13));
      face.addColorStop(0.6, withAlpha('#ffdda8', 0.03));
      face.addColorStop(1, 'rgba(0,0,0,0.24)');
      ctx.fillStyle = face;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    if (stain) {
      ctx.save();
      path();
      ctx.clip();
      ctx.fillStyle = stain;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    // Brass edge, brighter when the button is live. This is the whole hover
    // affordance: the fitting catches the light, the wood does not change.
    inkContour(ctx, path, {
      color: disabled ? withAlpha(Ink.line, 0.8) : opts.active ? Brass.hi : lit ? Brass.base : Ink.line,
      width: opts.active ? 2.2 : 1.8,
      inner: false,
    });
  }

  const textColor = disabled
    ? Theme.textFaint
    : tone === 'danger' ? '#f0c9c4'
      : tone === 'good' ? '#d9e8c0'
        : opts.active ? Brass.hi : lit ? '#fff4dd' : Theme.text;
  drawButtonLabel(ctx, text, x, y, w, h, opts, textColor, false);
  return finishButton(ctx, text, hot, disabled, opts);
}

function drawButtonLabel(ctx, text, x, y, w, h, opts, color, onBrass) {
  const upper = String(text).toUpperCase();
  const spacing = opts.spacing ?? 1.4;
  // Shrink to fit. Two points of size buys a surprising amount of room once
  // tracking is included, and the alternative is an ellipsis on a verb.
  let size = opts.size || 13;
  const room = w - 16;
  for (; size > 8.5; size -= 0.5) {
    ctx.font = Theme.display(size, opts.weight || 700);
    if (trackedWidth(ctx, upper, spacing) <= room) break;
  }
  tracked(ctx, upper, x + w / 2, y + h / 2 + 0.5, {
    font: Theme.display(size, opts.weight || 700),
    color,
    spacing,
    align: 'center',
    baseline: 'middle',
    shadow: !onBrass,
  });

  // `hotkeyBadge: false` keeps the binding but drops the corner label, for
  // buttons too small to carry one without sitting on their own text.
  if (opts.hotkey && opts.hotkeyBadge !== false) {
    const cap = KEY_CAPS[opts.hotkey] || opts.hotkey.toUpperCase();
    ctx.font = Theme.mono(9, 700);
    // Only if it fits inside the fitting. `ESCAPE` set at the old inset hung off
    // the edge of every brass plate in the game, which looked like a defect
    // rather than a label.
    if (ctx.measureText(cap).width <= w * 0.42) {
      ctx.fillStyle = opts.disabled
        ? withAlpha(Ink.line, 0.9)
        : onBrass ? 'rgba(42,28,8,0.62)' : withAlpha(Brass.hi, 0.6);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      // Clear of the corner rivet on a brass plate, which it used to sit on.
      ctx.fillText(cap, x + w - (onBrass ? 12 : 7), y + (onBrass ? 6 : 5));
    }
  }
}

/** Long key names, shortened the way a keycap is actually printed. */
const KEY_CAPS = {
  Escape: 'ESC',
  ' ': 'SPC',
  Enter: 'RET',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

function finishButton(ctx, text, hot, disabled, opts) {
  if (hot && !disabled) {
    if (lastHover !== text) {
      lastHover = text;
      Sfx.hover();
    }
    if (opts.tooltip) setTooltip(opts.tooltip);
  }
  const keyed = opts.hotkey && !disabled && keyPressed(opts.hotkey);
  const clicked = (hot && !disabled && takeClick()) || keyed;
  if (clicked) Sfx.click();
  return !!clicked;
}

/**
 * A bar is a slot cut into the surface with something poured into it.
 *
 * Square-ended and ink-outlined rather than a pill: the rounded capsule is the
 * other shape, along with the 6px fillet, that reads as an interface widget
 * instead of an object.
 */
export function bar(ctx, x, y, w, h, value, max, color, opts = {}) {
  const frac = max > 0 ? clamp(value / max, 0, 1) : 0;
  const path = () => carvedRect(ctx, x, y, w, h, 1);

  ctx.fillStyle = opts.bg || '#0d0906';
  path();
  ctx.fill();
  // Inside of the slot: dark at the top, where the light cannot reach.
  const inner = ctx.createLinearGradient(x, y, x, y + h);
  inner.addColorStop(0, 'rgba(0,0,0,0.55)');
  inner.addColorStop(1, 'rgba(255,220,170,0.06)');
  ctx.fillStyle = inner;
  ctx.fill();

  if (frac > 0) {
    const fw = Math.max(2, w * frac);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, withAlpha('#ffffff', 0.26));
    g.addColorStop(0.35, color);
    g.addColorStop(1, withAlpha('#000000', 0.34));
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, fw, h);
    // The wet edge at the head of the fill.
    ctx.fillStyle = 'rgba(255,240,214,0.4)';
    ctx.fillRect(x + fw - 1.4, y, 1.4, h);
    ctx.restore();
  }

  inkContour(ctx, path, { width: 1.6, inner: false, color: opts.border || Ink.line });

  if (opts.text) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 2;
    ctx.fillStyle = opts.textColor || Theme.text;
    ctx.font = Theme.mono(Math.min(11, h - 2), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.text, x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
  }
}

/** Segmented pip bar -- used for action points. Brass studs in dark sockets. */
export function pips(ctx, x, y, count, filled, opts = {}) {
  const size = opts.size || 10;
  const gap = opts.gap || 4;
  for (let i = 0; i < count; i++) {
    const cx = x + i * (size + gap) + size / 2;
    const cy = y + size / 2;
    if (i < filled) {
      if (opts.color && opts.color !== Theme.accent) {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = opts.color;
        ctx.fill();
        ctx.strokeStyle = Ink.line;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        rivet(ctx, cx, cy, size / 2);
      }
    } else {
      // An empty socket, not a grey dot: the hole is still there.
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#100b07';
      ctx.fill();
      ctx.strokeStyle = withAlpha(Wood.light, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 - 0.8, Math.PI * 1.1, Math.PI * 1.9);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }
}

/**
 * A row of keycaps and what each one does.
 *
 * Any stage that expects a keypress should draw one. A binding that only
 * exists in a tooltip, or in the README, is a binding the player never finds.
 *
 * @param {Array<{key:string, text:string, tone?:string}>} hints
 * @param {object} [opts] `align: 'left'` anchors at `x`; otherwise centred on it
 * @returns {number} the height drawn, so callers can stack rows
 */
export function hintBar(ctx, x, y, hints, opts = {}) {
  const size = opts.size || 11.5;
  const capFont = Theme.mono(size, 700);
  const textFont = Theme.font(size, 500);
  const capH = size + 10;
  const gap = 7; // cap to its own text
  const between = 22; // one hint to the next

  // Measure the whole row first so it can be centred as a unit.
  const items = hints.map((h) => {
    ctx.font = capFont;
    const capW = Math.max(capH, ctx.measureText(h.key).width + 12);
    ctx.font = textFont;
    return { ...h, capW, textW: ctx.measureText(h.text).width };
  });
  const total = items.reduce((a, it) => a + it.capW + gap + it.textW, 0)
    + between * Math.max(0, items.length - 1);

  let cx = opts.align === 'left' ? x : x - total / 2;
  for (const it of items) {
    // A keycap is a small brass plate, so the keys read as part of the machine.
    const face = ctx.createLinearGradient(cx, y, cx, y + capH);
    face.addColorStop(0, withAlpha(Wood.light, 1));
    face.addColorStop(1, withAlpha(Wood.deep, 1));
    ctx.fillStyle = face;
    carvedRect(ctx, cx, y, it.capW, capH, 2);
    ctx.fill();
    inkContour(ctx, () => carvedRect(ctx, cx, y, it.capW, capH, 2), {
      width: 1.6, inner: false, color: it.tone || withAlpha(Brass.base, 0.85),
    });
    label(ctx, it.key, cx + it.capW / 2, y + capH / 2, {
      font: capFont, color: it.tone || Brass.hi, align: 'center', baseline: 'middle',
    });
    cx += it.capW + gap;
    label(ctx, it.text, cx, y + capH / 2, {
      font: textFont, color: it.tone || Theme.textDim, baseline: 'middle',
    });
    cx += it.textW + between;
  }
  return capH;
}

export function checkbox(ctx, x, y, size, checked, text, opts = {}) {
  const r = { x, y, w: size + 8 + (text ? ctx.measureText(text).width : 0), h: size };
  const hot = pointInRect(Input.x, Input.y, r) && !Input.clickConsumed;
  const path = () => carvedRect(ctx, x, y, size, size, 2);
  ctx.fillStyle = '#120c08';
  path();
  ctx.fill();
  inkContour(ctx, path, {
    width: 1.6, inner: false, color: hot ? Brass.hi : withAlpha(Brass.base, 0.8),
  });
  if (checked) {
    ctx.strokeStyle = Brass.hi;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 3.5, y + size / 2);
    ctx.lineTo(x + size * 0.45, y + size - 4);
    ctx.lineTo(x + size - 3.5, y + 4);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (text) {
    label(ctx, text, x + size + 8, y + size / 2 - 7, { color: opts.color || Theme.text, size: 13 });
  }
  const clicked = hot && takeClick();
  if (clicked) Sfx.click();
  return clicked;
}

/** Clickable row used in lists. Returns 'click' | 'hover' | null. */
export function row(ctx, x, y, w, h, opts = {}) {
  const r = { x, y, w, h };
  const hot = pointInRect(Input.x, Input.y, r) && !Input.clickConsumed;
  const path = () => carvedRect(ctx, x, y, w, h, 2);

  // Rows sit *in* the panel behind them, so they are darker than it rather than
  // lighter -- a recess, not a card floating on top of another card.
  ctx.fillStyle = opts.selected ? withAlpha(Wood.light, 0.95) : hot ? withAlpha(Wood.mid, 0.9) : '#180f09';
  path();
  ctx.fill();
  if (opts.fill) {
    ctx.fillStyle = withAlpha(opts.fill, 0.4);
    path();
    ctx.fill();
  }
  // Top-inside shadow: the one cue that says recessed instead of raised.
  const g = ctx.createLinearGradient(x, y, x, y + Math.min(10, h));
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  path();
  ctx.fill();

  inkContour(ctx, path, {
    width: opts.selected ? 2.2 : 1.5,
    inner: false,
    color: opts.selected ? Brass.hi : hot ? withAlpha(Brass.base, 0.9) : Ink.line,
  });
  if (opts.selected) {
    // A stud on each end of a selected row, so selection survives being seen
    // out of the corner of the eye.
    rivet(ctx, x + 6, y + h / 2, 2.4);
    rivet(ctx, x + w - 6, y + h / 2, 2.4);
  }

  if (hot && opts.tooltip) setTooltip(opts.tooltip);
  if (hot && takeClick()) {
    Sfx.click();
    return 'click';
  }
  return hot ? 'hover' : null;
}

/** Screen-dimming backdrop for modals. */
export function dim(ctx, alpha = 0.72) {
  ctx.fillStyle = `rgba(6,4,2,${alpha})`;
  ctx.fillRect(0, 0, 1280, 720);
}

export function iconResource(ctx, x, y, size, color) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.lineTo(x + size * 0.5, y);
  ctx.lineTo(x + size, y + size * 0.3);
  ctx.lineTo(x + size, y + size * 0.75);
  ctx.lineTo(x + size * 0.5, y + size);
  ctx.lineTo(x, y + size * 0.75);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // Inked, like everything else, and lit from the upper left.
  ctx.strokeStyle = Ink.line;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.lineTo(x + size * 0.5, y);
  ctx.lineTo(x + size, y + size * 0.3);
  ctx.strokeStyle = 'rgba(255,240,214,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Cost line like "3 Scrap  1 Parts", red where the player is short. */
export function costLine(ctx, cost, x, y, resources, opts = {}) {
  const size = opts.size || 12;
  ctx.font = Theme.font(size, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let cx = x;
  for (const [k, v] of Object.entries(cost || {})) {
    const have = (resources[k] || 0) >= v;
    ctx.fillStyle = have ? Theme.textDim : Theme.bad;
    const t = `${v} ${k}`;
    ctx.fillText(t, cx, y);
    cx += ctx.measureText(t).width + 12;
  }
  return cx - x;
}

// Re-exported so scenes can reach the materials without importing two modules
// for what is, from their point of view, one drawing vocabulary.
export { brassRule, tracked, trackedWidth, withAlpha, Wash, carvedRect, inkContour, rivet };

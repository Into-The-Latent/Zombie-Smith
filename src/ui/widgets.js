// Immediate-mode widgets. Every call both draws and reports interaction for
// this frame; there is no retained widget tree to keep in sync.

import { Input, takeClick, keyPressed } from '../core/input.js';
import { Theme } from './theme.js';
import { pointInRect, wrapText, clamp } from '../core/util.js';
import { Sfx } from '../core/audio.js';

let tooltip = null;
let lastHover = null;

export function beginUI() {
  tooltip = null;
}

/** Draws deferred overlays (tooltips) -- call last in a scene's render. */
export function endUI(ctx) {
  if (!tooltip) return;
  const pad = 8;
  ctx.font = Theme.font(13);
  const maxW = 260;
  const lines = wrapText(ctx, tooltip.text, maxW);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  const boxW = w + pad * 2;
  const boxH = lines.length * 17 + pad * 2;
  let x = clamp(tooltip.x + 14, 4, 1280 - boxW - 4);
  let y = tooltip.y + 18;
  if (y + boxH > 716) y = tooltip.y - boxH - 10;

  ctx.fillStyle = 'rgba(6,9,13,0.96)';
  ctx.strokeStyle = Theme.borderHi;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, boxW, boxH, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = Theme.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * 17));
}

export function setTooltip(text) {
  if (text) tooltip = { text, x: Input.x, y: Input.y };
}

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

export function panel(ctx, x, y, w, h, opts = {}) {
  const fill = opts.fill || Theme.panel;
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, opts.radius ?? 6);
  ctx.fill();
  if (opts.border !== false) {
    ctx.strokeStyle = opts.borderColor || Theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (opts.title) {
    ctx.fillStyle = opts.titleColor || Theme.textDim;
    ctx.font = Theme.font(12, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.title.toUpperCase(), x + 12, y + 10);
    ctx.strokeStyle = Theme.border;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 28);
    ctx.lineTo(x + w - 12, y + 28);
    ctx.stroke();
  }
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
 * @returns {boolean} true on the frame it is clicked
 */
export function button(ctx, x, y, w, h, text, opts = {}) {
  const r = { x, y, w, h };
  const hot = pointInRect(Input.x, Input.y, r) && !Input.clickConsumed;
  const disabled = !!opts.disabled;
  const tone = opts.tone || 'default';

  const tones = {
    default: { base: Theme.panelLight, hi: Theme.panelHi, edge: Theme.border, text: Theme.text },
    primary: { base: '#8a5f1c', hi: '#b57c23', edge: Theme.accent, text: '#fff3dd' },
    danger: { base: '#6d221e', hi: '#9c302a', edge: Theme.bad, text: '#ffe2e0' },
    good: { base: '#255c3d', hi: '#318054', edge: Theme.good, text: '#dff5e8' },
    ghost: { base: 'rgba(0,0,0,0)', hi: 'rgba(255,255,255,0.06)', edge: 'rgba(0,0,0,0)', text: Theme.textDim },
  };
  const t = tones[tone] || tones.default;

  let fill = t.base;
  if (disabled) fill = '#151a22';
  else if (hot) fill = t.hi;
  if (opts.active) fill = t.hi;

  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, opts.radius ?? 5);
  ctx.fill();
  ctx.strokeStyle = disabled ? '#232a35' : opts.active ? Theme.accent : t.edge;
  ctx.lineWidth = opts.active ? 2 : 1;
  ctx.stroke();

  ctx.fillStyle = disabled ? Theme.textFaint : t.text;
  ctx.font = Theme.font(opts.size || 14, opts.weight || 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);

  if (opts.hotkey) {
    ctx.font = Theme.mono(10, 700);
    ctx.fillStyle = disabled ? '#2c3542' : 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.hotkey.toUpperCase(), x + w - 5, y + 4);
  }

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

export function bar(ctx, x, y, w, h, value, max, color, opts = {}) {
  const frac = max > 0 ? clamp(value / max, 0, 1) : 0;
  ctx.fillStyle = opts.bg || '#0d1219';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (frac > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2);
    ctx.fill();
  }
  ctx.strokeStyle = opts.border || 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.stroke();
  if (opts.text) {
    ctx.fillStyle = opts.textColor || Theme.text;
    ctx.font = Theme.mono(Math.min(11, h - 2), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.text, x + w / 2, y + h / 2 + 0.5);
  }
}

/** Segmented pip bar -- used for action points. */
export function pips(ctx, x, y, count, filled, opts = {}) {
  const size = opts.size || 10;
  const gap = opts.gap || 4;
  for (let i = 0; i < count; i++) {
    const px = x + i * (size + gap);
    ctx.beginPath();
    ctx.arc(px + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = i < filled ? opts.color || Theme.accent : '#20272f';
    ctx.fill();
    ctx.strokeStyle = i < filled ? 'rgba(255,255,255,0.25)' : '#2c3542';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function checkbox(ctx, x, y, size, checked, text, opts = {}) {
  const r = { x, y, w: size + 8 + (text ? ctx.measureText(text).width : 0), h: size };
  const hot = pointInRect(Input.x, Input.y, r) && !Input.clickConsumed;
  ctx.fillStyle = checked ? Theme.good : '#161b24';
  roundRect(ctx, x, y, size, size, 3);
  ctx.fill();
  ctx.strokeStyle = hot ? Theme.borderHi : Theme.border;
  ctx.stroke();
  if (checked) {
    ctx.strokeStyle = '#0b0e13';
    ctx.lineWidth = 2;
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
  ctx.fillStyle = opts.selected ? Theme.panelHi : hot ? Theme.panelLight : opts.fill || '#131820';
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = opts.selected ? Theme.accent : hot ? Theme.borderHi : Theme.border;
  ctx.lineWidth = opts.selected ? 2 : 1;
  ctx.stroke();
  if (hot && opts.tooltip) setTooltip(opts.tooltip);
  if (hot && takeClick()) {
    Sfx.click();
    return 'click';
  }
  return hot ? 'hover' : null;
}

/** Screen-dimming backdrop for modals. */
export function dim(ctx, alpha = 0.72) {
  ctx.fillStyle = `rgba(4,6,9,${alpha})`;
  ctx.fillRect(0, 0, 1280, 720);
}

export function iconResource(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.lineTo(x + size * 0.5, y);
  ctx.lineTo(x + size, y + size * 0.3);
  ctx.lineTo(x + size, y + size * 0.75);
  ctx.lineTo(x + size * 0.5, y + size);
  ctx.lineTo(x, y + size * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
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

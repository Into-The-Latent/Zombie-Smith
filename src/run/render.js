// Isometric renderer. All art is procedural canvas drawing -- no assets.
//
// Draw order is painter's algorithm along the (x + y) diagonal: floors first
// (they are flat and occlude nothing), then every standing thing sorted back
// to front so walls correctly hide what is behind them.

import {
  TILE_W, TILE_H, WALL_H, project, tilePath,
} from './iso.js';
import {
  tileAt, WALL, CRATE, CAR, EXIT, ENTRY, VOID,
} from './map.js';
import { CONTAINERS } from '../game/loot.js';
import { CLASSES } from '../data/progression.js';
import { ENEMIES } from '../data/enemies.js';
import { Theme } from '../ui/theme.js';
import { clamp } from '../core/util.js';

const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
};

export function drawWorld(ctx, battle, view, cam, opts = {}) {
  const { map } = battle;
  const { x: vx, y: vy, w: vw, h: vh } = view;
  const t = opts.time || 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(vx, vy, vw, vh);
  ctx.clip();

  // Sky / void behind the level.
  const g = ctx.createLinearGradient(0, vy, 0, vy + vh);
  g.addColorStop(0, '#0a0d12');
  g.addColorStop(1, '#05070a');
  ctx.fillStyle = g;
  ctx.fillRect(vx, vy, vw, vh);

  const P = (gx, gy) => project(cam, gx, gy, vw, vh, vx, vy);

  // Cull to what can actually land on screen.
  const margin = 3;
  const corners = [
    unprojectCorner(cam, vx, vy, view),
    unprojectCorner(cam, vx + vw, vy, view),
    unprojectCorner(cam, vx, vy + vh, view),
    unprojectCorner(cam, vx + vw, vy + vh, view),
  ];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.gx); maxX = Math.max(maxX, c.gx);
    minY = Math.min(minY, c.gy); maxY = Math.max(maxY, c.gy);
  }
  minX = Math.max(0, Math.floor(minX) - margin);
  minY = Math.max(0, Math.floor(minY) - margin);
  maxX = Math.min(map.w - 1, Math.ceil(maxX) + margin);
  maxY = Math.min(map.h - 1, Math.ceil(maxY) + margin);

  // ---- floors -------------------------------------------------------------
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = tileAt(map, x, y);
      if (tile === VOID || tile === WALL) continue;
      const i = y * map.w + x;
      if (!battle.seen[i]) continue;
      const lit = battle.visible[i] === 1;
      const p = P(x, y);
      drawFloor(ctx, p.x, p.y, cam.zoom, map, x, y, tile, lit, t);
    }
  }

  // Blood decals sit on top of the floor but under everything else.
  for (const d of map.decals) {
    const i = d.y * map.w + d.x;
    if (!battle.seen[i]) continue;
    const p = P(d.x, d.y);
    ctx.fillStyle = `rgba(90,20,18,${battle.visible[i] ? d.a : d.a * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, d.r * cam.zoom, d.r * 0.5 * cam.zoom, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- overlays painted onto the floor (range, path, targeting) -----------
  if (opts.overlay) opts.overlay(ctx, P, cam.zoom);

  // ---- standing things, back to front -------------------------------------
  const sprites = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * map.w + x;
      if (!battle.seen[i]) continue;
      const tile = tileAt(map, x, y);
      if (tile === WALL) sprites.push({ x, y, z: 0, kind: 'wall' });
      else if (tile === CRATE) sprites.push({ x, y, z: 1, kind: 'crate' });
      else if (tile === CAR) sprites.push({ x, y, z: 1, kind: 'car' });
    }
  }
  for (const c of map.containers) {
    const i = c.y * map.w + c.x;
    if (!battle.seen[i]) continue;
    sprites.push({ x: c.x, y: c.y, z: 2, kind: 'container', data: c });
  }
  for (const u of battle.units) {
    if (u.state === 'dead' && !u.corpseFade) continue;
    const ax = u.anim ? u.anim.x : u.x;
    const ay = u.anim ? u.anim.y : u.y;
    const i = Math.round(ay) * map.w + Math.round(ax);
    if (u.side === 'zombie' && battle.visible[i] !== 1) continue;
    sprites.push({ x: ax, y: ay, z: 3, kind: 'unit', data: u });
  }

  sprites.sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);

  for (const s of sprites) {
    const p = P(s.x, s.y);
    const i = Math.round(s.y) * map.w + Math.round(s.x);
    const lit = battle.visible[i] === 1;
    switch (s.kind) {
      case 'wall': drawWall(ctx, p.x, p.y, cam.zoom, map, s.x, s.y, lit); break;
      case 'crate': drawCrate(ctx, p.x, p.y, cam.zoom, lit); break;
      case 'car': drawCar(ctx, p.x, p.y, cam.zoom, lit, s.x + s.y); break;
      case 'container': drawContainer(ctx, p.x, p.y, cam.zoom, s.data, lit, t); break;
      case 'unit': drawUnit(ctx, p.x, p.y, cam.zoom, s.data, t, battle, opts); break;
    }
  }

  // ---- transient effects ---------------------------------------------------
  for (const ping of battle.noisePings) {
    const p = P(ping.x, ping.y);
    const a = 1 - ping.t;
    if (a <= 0) continue;
    ctx.strokeStyle = `rgba(232,163,61,${a * 0.5})`;
    ctx.lineWidth = 2;
    const rr = ping.r * ping.t;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rr * (TILE_W / 2) * cam.zoom, rr * (TILE_H / 2) * cam.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (opts.tracers) {
    for (const tr of opts.tracers) {
      const a = P(tr.from.x, tr.from.y);
      const b = P(tr.to.x, tr.to.y);
      const alpha = 1 - tr.t;
      ctx.strokeStyle = tr.hit ? `rgba(255,226,160,${alpha})` : `rgba(160,175,200,${alpha * 0.7})`;
      ctx.lineWidth = tr.hit ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 18 * cam.zoom);
      ctx.lineTo(b.x, b.y - 16 * cam.zoom);
      ctx.stroke();
    }
  }

  for (const f of battle.floaters) {
    const p = P(f.x, f.y);
    const a = clamp(1 - f.t / f.life, 0, 1);
    ctx.font = Theme.font(f.size || 15, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const yy = p.y - 34 * cam.zoom - f.t * 34;
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(0,0,0,${a * 0.8})`;
    ctx.strokeText(f.text, p.x, yy);
    ctx.fillStyle = f.color.replace('ALPHA', a.toFixed(2));
    ctx.fillText(f.text, p.x, yy);
  }

  ctx.restore();
}

function unprojectCorner(cam, px, py, view) {
  const sx = (px - view.x - view.w / 2) / cam.zoom + cam.x;
  const sy = (py - view.y - view.h / 2) / cam.zoom + cam.y;
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function drawFloor(ctx, cx, cy, zoom, map, x, y, tile, lit, t) {
  const site = map.site;
  let base = (x + y) % 2 === 0 ? site.floor : site.floorAlt;

  if (tile === EXIT || tile === ENTRY) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + (tile === EXIT ? 0 : Math.PI));
    base = tile === EXIT ? '#2c4a35' : '#3a3a4e';
    tilePath(ctx, cx, cy, zoom);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = tile === EXIT
      ? `rgba(79,180,119,${0.45 + pulse * 0.45})`
      : `rgba(120,140,190,${0.3 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!lit) {
      tilePath(ctx, cx, cy, zoom);
      ctx.fillStyle = 'rgba(6,9,14,0.55)';
      ctx.fill();
    }
    return;
  }

  tilePath(ctx, cx, cy, zoom);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!lit) {
    tilePath(ctx, cx, cy, zoom);
    ctx.fillStyle = 'rgba(6,9,14,0.6)';
    ctx.fill();
  }
}

function drawWall(ctx, cx, cy, zoom, map, x, y, lit) {
  const site = map.site;
  const hw = (TILE_W / 2) * zoom;
  const hh = (TILE_H / 2) * zoom;
  const wh = WALL_H * zoom;

  const rightHidden = tileAt(map, x + 1, y) === WALL;
  const leftHidden = tileAt(map, x, y + 1) === WALL;

  // Right face (toward +x).
  if (!rightHidden) {
    ctx.fillStyle = shade(site.wall, -18);
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw, cy - wh);
    ctx.lineTo(cx, cy + hh - wh);
    ctx.closePath();
    ctx.fill();
  }
  // Left face (toward +y).
  if (!leftHidden) {
    ctx.fillStyle = shade(site.wall, -40);
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.lineTo(cx - hw, cy - wh);
    ctx.lineTo(cx, cy + hh - wh);
    ctx.closePath();
    ctx.fill();
  }
  // Top.
  tilePath(ctx, cx, cy - wh, zoom);
  ctx.fillStyle = site.wallTop;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!lit) {
    ctx.fillStyle = 'rgba(6,9,14,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw, cy - wh);
    ctx.lineTo(cx, cy - wh - hh);
    ctx.lineTo(cx - hw, cy - wh);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCrate(ctx, cx, cy, zoom, lit) {
  const s = 0.62;
  const hw = (TILE_W / 2) * zoom * s;
  const hh = (TILE_H / 2) * zoom * s;
  const h = 20 * zoom;
  shadowBlob(ctx, cx, cy, zoom, 0.7);

  ctx.fillStyle = '#7a5a34';
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy + hh - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5f4527';
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.lineTo(cx - hw, cy - h); ctx.lineTo(cx, cy + hh - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8f6b3e';
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - hh); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy - h + hh); ctx.lineTo(cx - hw, cy - h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();

  if (!lit) dimBox(ctx, cx, cy, hw, hh, h);
}

function drawCar(ctx, cx, cy, zoom, lit, seed) {
  const hues = ['#6b3f3a', '#3f4d6b', '#4b5b45', '#5c5348'];
  const body = hues[Math.abs(Math.round(seed)) % hues.length];
  const hw = (TILE_W / 2) * zoom * 0.92;
  const hh = (TILE_H / 2) * zoom * 0.92;
  const h = 15 * zoom;
  shadowBlob(ctx, cx, cy, zoom, 1.05);

  ctx.fillStyle = shade(body, -22);
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy + hh - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(body, -44);
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.lineTo(cx - hw, cy - h); ctx.lineTo(cx, cy + hh - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - hh); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy - h + hh); ctx.lineTo(cx - hw, cy - h);
  ctx.closePath(); ctx.fill();
  // Cabin.
  ctx.fillStyle = 'rgba(20,30,40,0.85)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - hh * 0.45);
  ctx.lineTo(cx + hw * 0.5, cy - h - hh * 0.05);
  ctx.lineTo(cx, cy - h + hh * 0.4);
  ctx.lineTo(cx - hw * 0.5, cy - h - hh * 0.05);
  ctx.closePath(); ctx.fill();

  if (!lit) dimBox(ctx, cx, cy, hw, hh, h);
}

function drawContainer(ctx, cx, cy, zoom, c, lit, t) {
  const def = CONTAINERS[c.kind];
  const hw = 13 * zoom;
  const hh = 8 * zoom;
  const h = (c.opened ? 8 : 15) * zoom;
  shadowBlob(ctx, cx, cy, zoom, 0.55);

  const col = c.opened ? '#4a4f57' : def.color;
  ctx.fillStyle = shade(col, -25);
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy + hh - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(col, -45);
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.lineTo(cx - hw, cy - h); ctx.lineTo(cx, cy + hh - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - hh); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy - h + hh); ctx.lineTo(cx - hw, cy - h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();

  if (!c.opened && lit) {
    // A little glint so the eye finds lootables.
    const a = 0.35 + 0.35 * Math.sin(t * 3 + cx * 0.05);
    ctx.fillStyle = `rgba(255,235,180,${a})`;
    ctx.beginPath();
    ctx.arc(cx, cy - h - hh * 0.4, 2.2 * zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!lit) dimBox(ctx, cx, cy, hw, hh, h);
}

function dimBox(ctx, cx, cy, hw, hh, h) {
  ctx.fillStyle = 'rgba(6,9,14,0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy - h - hh); ctx.lineTo(cx - hw, cy - h);
  ctx.closePath(); ctx.fill();
}

function shadowBlob(ctx, cx, cy, zoom, scale = 1) {
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2 * zoom, 17 * zoom * scale, 8 * zoom * scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function drawUnit(ctx, cx, cy, zoom, u, t, battle, opts) {
  const isPlayer = u.side === 'player';
  const bob = Math.sin(t * (isPlayer ? 2.4 : 1.5) + u.bob) * 1.4 * zoom;
  const down = u.state === 'down';

  shadowBlob(ctx, cx, cy, zoom, down ? 1.1 : 0.85);

  // Selection / turn rings.
  if (opts.selectedId === u.id) {
    ctx.strokeStyle = Theme.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 20 * zoom, 10 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (opts.targetId === u.id) {
    ctx.strokeStyle = Theme.bad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 20 * zoom, 10 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isPlayer && u.state === 'idle' && u.ap > 0 && battle.phase === 'player') {
    ctx.strokeStyle = 'rgba(232,163,61,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, 18 * zoom, 9 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const hurt = u.flash > 0;
  ctx.save();
  ctx.translate(cx, cy - bob);
  if (down) ctx.rotate(-0.9);
  const s = zoom;

  if (isPlayer) {
    const cls = CLASSES[u.cls];
    drawHumanoid(ctx, s, {
      body: cls.color,
      dark: shade(cls.color, -55),
      head: '#e0c19a',
      hurt,
      lean: 0,
      weapon: u.active === 'melee' || !u.primary ? 'melee' : 'gun',
      overwatch: u.overwatch,
    });
  } else {
    const def = ENEMIES[u.key];
    drawHumanoid(ctx, s, {
      body: def.color,
      dark: def.dark,
      head: shade(def.color, 25),
      hurt,
      lean: 0.18,
      zombie: true,
      big: u.key === 'brute',
      weapon: null,
    });
  }
  ctx.restore();

  // ---- overhead info -------------------------------------------------------
  const topY = cy - (u.key === 'brute' ? 52 : 44) * zoom - bob;

  if (!down || isPlayer) {
    const bw = 30 * zoom;
    const bh = 4 * zoom;
    const frac = clamp(u.hp / u.hpMax, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(cx - bw / 2 - 1, topY - 1, bw + 2, bh + 2);
    ctx.fillStyle = isPlayer
      ? frac > 0.5 ? Theme.good : frac > 0.25 ? Theme.warn : Theme.bad
      : '#b6533f';
    ctx.fillRect(cx - bw / 2, topY, bw * frac, bh);
  }

  if (isPlayer && battle.phase === 'player' && u.state === 'idle') {
    const n = Math.min(u.apMax, 8);
    const pw = 5 * zoom;
    const gap = 2 * zoom;
    const total = n * pw + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < u.ap ? Theme.accent : 'rgba(255,255,255,0.16)';
      ctx.fillRect(cx - total / 2 + i * (pw + gap), topY - 7 * zoom, pw, 3 * zoom);
    }
  }

  if (u.overwatch) {
    ctx.fillStyle = Theme.info;
    ctx.font = Theme.font(11 * zoom, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('OW', cx, topY - 11 * zoom);
  }
  if (down) {
    ctx.fillStyle = Theme.bad;
    ctx.font = Theme.font(11 * zoom, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`DOWN ${u.bleed}`, cx, topY - 4 * zoom);
  }
  if (!isPlayer && u.alerted) {
    ctx.fillStyle = Theme.bad;
    ctx.font = Theme.font(14 * zoom, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('!', cx, topY - 6 * zoom);
  }
}

/** A chunky little iso figure built from four quads. */
function drawHumanoid(ctx, s, o) {
  const scale = o.big ? 1.28 : 1;
  ctx.save();
  ctx.scale(s * scale, s * scale);
  if (o.lean) ctx.rotate(o.lean);

  const body = o.hurt ? '#ffffff' : o.body;
  const dark = o.hurt ? '#ffd8d8' : o.dark;

  // Legs
  ctx.fillStyle = dark;
  ctx.fillRect(-6, -12, 4.5, 12);
  ctx.fillRect(1.5, -12, 4.5, 12);
  // Torso
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-7, -30);
  ctx.lineTo(7, -30);
  ctx.lineTo(6, -11);
  ctx.lineTo(-6, -11);
  ctx.closePath();
  ctx.fill();
  // Shoulders / arms
  ctx.fillStyle = dark;
  ctx.fillRect(-9.5, -29, 3.5, 15);
  ctx.fillRect(6, -29, 3.5, 15);
  // Head
  ctx.fillStyle = o.hurt ? '#ffffff' : o.head;
  ctx.beginPath();
  ctx.arc(0, -36, 6.2, 0, Math.PI * 2);
  ctx.fill();

  if (o.zombie) {
    // Slack jaw + dead eyes.
    ctx.fillStyle = 'rgba(20,10,10,0.75)';
    ctx.fillRect(-3.4, -37.6, 1.8, 2.2);
    ctx.fillRect(1.6, -37.6, 1.8, 2.2);
    ctx.fillStyle = 'rgba(40,10,10,0.8)';
    ctx.fillRect(-2.2, -33.4, 4.4, 2.4);
    // Ragged shirt hem.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(-6, -13); ctx.lineTo(-3, -10); ctx.lineTo(0, -13); ctx.lineTo(3, -10); ctx.lineTo(6, -13);
    ctx.lineTo(6, -16); ctx.lineTo(-6, -16); ctx.closePath();
    ctx.fill();
  } else {
    // Face plate so survivors read as "alive" at a glance.
    ctx.fillStyle = 'rgba(30,35,45,0.85)';
    ctx.fillRect(-5.4, -38.5, 10.8, 3.4);
  }

  if (o.weapon === 'gun') {
    ctx.fillStyle = '#2c3340';
    ctx.fillRect(6, -25, 15, 3);
    ctx.fillRect(9, -22, 4, 4);
  } else if (o.weapon === 'melee') {
    ctx.strokeStyle = '#9aa5b1';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(8, -26);
    ctx.lineTo(17, -36);
    ctx.stroke();
  }

  if (o.overwatch) {
    ctx.strokeStyle = 'rgba(74,159,216,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, -26, 15, -0.9, 0.9);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Floor overlays
// ---------------------------------------------------------------------------

export function paintTile(ctx, P, zoom, x, y, fill, stroke, inset = 2) {
  const p = P(x, y);
  tilePath(ctx, p.x, p.y, zoom, inset);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

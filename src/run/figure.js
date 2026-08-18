// Figures, built from the same boxes as everything else.
//
// The world was already simple 3D and the people in it were not: two flat
// rects for legs, a quad torso, two rects for arms and a circle head, in two
// flat colours. They read as cardboard standees propped up in a 3D scene, and
// worse, all four survivor classes were byte-identical -- the draw call passed
// no shape at all, so the Heavy was exactly as broad as the Scout.
//
// A figure is now a list of boxes in its own frame:
//
//   fwd   along the way it is facing, in grid units
//   lat   across, to its own right
//   z     height above the floor, in pixels
//
// The frame is turned by the figure's *screen* facing -- its grid facing plus
// the camera's rotation -- and then projected. Boxes stay axis-aligned to the
// screen rather than turning with the figure: at this size the difference is
// a pixel or two on the silhouette, and it keeps every box under the same
// lighting rule as the walls. What actually reads as a turn is where the
// limbs land, and that is exact at all eight facings.

import { TILE_W, TILE_H } from './iso.js';
import { isoBox, boxShadow } from './box.js';
import { shadeHex } from '../ui/palette.js';

/** Pixels of height that make one grid unit, for laying a body flat. */
const FALL = 1 / 26;

/**
 * Proportions. Everything is measured from the floor up, so a build reads in
 * the order a body is stacked, and the total height of any figure is the sum
 * of the four heights below.
 *
 * Widths are grid units (1 = one whole floor tile); heights are pixels.
 */
export const BASE_BUILD = {
  scale: 1,
  legLen: 13, legW: 0.095, stance: 0.075,
  hipH: 4.5, waistW: 0.24,
  chestH: 13, chestW: 0.3, bodyD: 0.19,
  neckH: 2,
  headW: 0.165, headD: 0.15, headH: 8.5,
  armLen: 14, armW: 0.08, armOut: 0.03, armDrop: 0, armSkew: 0,
  /**
   * Forward pitch, in grid units of lean per grid unit of height -- so the
   * higher up the body a part sits, the further forward it goes, which is
   * what leaning is. Measured against height rather than applied flat,
   * because a flat offset just slides the whole figure off its own feet.
   */
  lean: 0,
};

const build = (over) => ({ ...BASE_BUILD, ...over });

/**
 * The four survivor classes, which until now were one silhouette.
 *
 * Each also carries one piece of kit, because proportions alone do not
 * survive being twenty pixels tall: the Medic's satchel and the Scout's pack
 * are what actually name them across a room.
 */
export const CLASS_BUILD = {
  gunsmith: build({ kit: 'bandolier' }),
  medic: build({ chestW: 0.28, armW: 0.074, kit: 'satchel' }),
  scout: build({
    scale: 0.95, legLen: 15, chestW: 0.26, bodyD: 0.17, armW: 0.07, kit: 'pack',
  }),
  heavy: build({
    scale: 1.06, legLen: 12, legW: 0.11, chestW: 0.4, waistW: 0.3,
    bodyD: 0.24, chestH: 12.5, armW: 0.1, armOut: 0.038, headW: 0.17, kit: 'pads',
  }),
};

/**
 * Body shape per zombie archetype.
 *
 * These are the readability workhorses. A tactical turn depends on telling a
 * Runner from a Brute at a glance, and at low zoom colour alone does not carry
 * that -- the *outline* has to. Each entry is a deliberate silhouette:
 * proportions, stance and one exaggerated feature. They are the same five
 * silhouettes the flat figures had, rebuilt with volume.
 */
export const ZOMBIE_BUILD = {
  // Uneven, arms hanging past the knees, head sagging forward.
  shambler: build({
    legLen: 12.5, chestW: 0.27, armLen: 17, armDrop: 2, armSkew: 4,
    lean: 0.1, feature: 'slack',
  }),
  // Pitched forward with its arms trailing behind: reads as motion standing still.
  runner: build({
    scale: 0.94, legLen: 14.5, chestW: 0.26, bodyD: 0.17, armLen: 13, armDrop: -3,
    lean: 0.22, feature: 'lean',
  }),
  // Enormous shoulders, head sunk between them, stubby limbs.
  brute: build({
    scale: 1.24, legLen: 11, legW: 0.125, chestW: 0.48, waistW: 0.34, bodyD: 0.28,
    chestH: 12, armLen: 11.5, armW: 0.12, armOut: 0.042, headW: 0.15, headD: 0.14,
    headH: 7, lean: 0.06, neckH: 0, feature: 'hulk',
  }),
  // Distended middle, thin limbs, head tipped back to lob.
  spitter: build({
    chestW: 0.24, waistW: 0.38, bodyD: 0.24, armW: 0.062, armLen: 15,
    armDrop: 2, lean: -0.12, feature: 'bloat',
  }),
  // Head thrown back, arms splayed wide, jaw open.
  screamer: build({
    chestW: 0.26, armOut: 0.07, armLen: 13, armDrop: -4, legLen: 14,
    lean: -0.2, feature: 'scream',
  }),
};

/** Kit boxes, in the figure's own frame. Small, and worth their pixels. */
const KIT = {
  satchel: (b) => [{ fwd: -b.bodyD * 0.5, lat: b.chestW * 0.42, z: 'waist', up: -3, w: 0.1, d: 0.12, h: 7, m: 'kit' }],
  pack: (b) => [{ fwd: -b.bodyD * 0.72, lat: 0, z: 'chest', up: -4, w: 0.13, d: 0.17, h: 10, m: 'kit' }],
  bandolier: (b) => [{ fwd: b.bodyD * 0.42, lat: 0, z: 'chest', up: -3, w: 0.05, d: b.chestW * 0.95, h: 4, m: 'kit' }],
  pads: (b) => [
    { fwd: 0, lat: -b.chestW * 0.5, z: 'chest', up: 1, w: b.bodyD * 1.1, d: 0.1, h: 3.5, m: 'kit' },
    { fwd: 0, lat: b.chestW * 0.5, z: 'chest', up: 1, w: b.bodyD * 1.1, d: 0.1, h: 3.5, m: 'kit' },
  ],
};

/** Where the parts of a body sit, in pixels above the floor. */
function levels(b) {
  const hip = b.legLen;
  const waist = hip + b.hipH;
  const chest = waist + b.chestH;
  const head = chest + b.neckH;
  return { hip, waist, chest, head, top: head + b.headH };
}

/**
 * Assemble one figure's boxes. Pure, and separate from drawing them, so the
 * pose can be inspected without a canvas.
 */
export function figureParts(b, pose = {}) {
  const L = levels(b);
  const walk = pose.walk || 0; // radians of gait, 0 when standing still
  const swing = pose.swing || 0; // 0..1 attack follow-through
  const gait = walk ? Math.sin(walk) : 0;
  const parts = [];

  // Legs: a swing fore and aft, opposed. Standing still they are simply apart.
  for (const side of [-1, 1]) {
    parts.push({
      fwd: gait * 0.055 * side, lat: b.stance * side, z: 0,
      w: b.legW, d: b.legW, h: b.legLen, m: 'dark',
    });
  }

  // Hips, then chest. Two boxes rather than one tapered quad -- the step from
  // waist to chest is what gives a build its shape.
  const pitch = (z) => b.lean * z * FALL;
  parts.push({
    fwd: pitch(L.waist), lat: 0, z: L.hip,
    w: b.bodyD, d: b.waistW, h: b.hipH + 0.5, m: 'body',
  });
  parts.push({
    fwd: pitch(L.chest) + swing * 0.04, lat: 0, z: L.waist,
    w: b.bodyD, d: b.chestW, h: b.chestH, m: 'body', rim: 0.22,
  });

  // Arms hang from the shoulder. The weapon arm comes up on an attack.
  const shoulder = L.chest - 1;
  for (const side of [-1, 1]) {
    const armed = side === 1;
    const raise = armed ? swing : 0;
    parts.push({
      fwd: pitch(shoulder) - gait * 0.045 * side + raise * 0.09,
      lat: (b.chestW / 2 + b.armW / 2 + b.armOut) * side,
      // armSkew hangs one arm lower than the other. A body that is exactly
      // symmetrical reads as a mannequin; a shambler should not.
      z: shoulder - b.armLen + b.armDrop + (side === 1 ? b.armSkew : 0) + raise * 5,
      w: b.armW, d: b.armW, h: b.armLen + (side === 1 ? b.armSkew : 0) * 0.5, m: 'dark',
    });
  }

  // A neck, narrow and skin-coloured. Without it the head is just the next
  // box up the stack and the figure reads as a totem pole.
  if (b.neckH > 0) {
    parts.push({
      fwd: pitch(L.chest), lat: 0, z: L.chest - 0.5,
      w: b.headD * 0.5, d: b.headW * 0.5, h: b.neckH + 1, m: 'skin',
    });
  }
  parts.push({
    fwd: pitch(L.top), lat: 0, z: L.head - 0.4,
    w: b.headD, d: b.headW, h: b.headH, m: 'skin', rim: 0.26,
  });

  if (b.kit && KIT[b.kit]) {
    for (const k of KIT[b.kit](b)) {
      parts.push({ ...k, z: (k.z === 'chest' ? L.chest : L.waist) + (k.up || 0) });
    }
  }

  if (b.feature) addFeature(parts, b, L, pose);
  if (pose.weapon) addWeapon(parts, b, L, pose);
  return parts;
}

/**
 * The one exaggerated detail that names each archetype.
 *
 * Face marks are boxes standing a hair proud of the head's front. That is not
 * a trick: a figure looking away has them behind its own skull, and the depth
 * sort hides them without anybody having to ask which way it is facing.
 */
function addFeature(parts, b, L, pose) {
  const eye = L.head + b.headH * 0.5;
  const front = b.headD * 0.5 + b.lean * L.top * FALL;
  for (const side of [-1, 1]) {
    parts.push({
      fwd: front, lat: b.headW * 0.22 * side, z: eye,
      w: 0.012, d: 0.035, h: 2.4, m: 'eye',
    });
  }

  switch (b.feature) {
    case 'scream': {
      // A jaw hanging open, pulsing, and the head thrown back.
      const open = 3 + Math.sin((pose.t || 0) * 9 + (pose.bob || 0)) * 1.4;
      parts.push({
        fwd: front, lat: 0, z: L.head + b.headH * 0.08,
        w: 0.014, d: 0.06, h: open, m: 'maw',
      });
      break;
    }
    case 'bloat':
      // The sac it throws, slung under the belly.
      parts.push({
        fwd: b.bodyD * 0.35 + b.lean * L.hip * FALL, lat: 0, z: L.hip + 1,
        w: 0.1, d: b.waistW * 0.8, h: 7, m: 'sac',
      });
      break;
    case 'hulk':
      // Slabs of dead muscle over the shoulders.
      for (const side of [-1, 1]) {
        parts.push({
          fwd: b.lean * L.chest * FALL, lat: b.chestW * 0.42 * side, z: L.chest - 3,
          w: b.bodyD * 0.9, d: 0.12, h: 4, m: 'dark',
        });
      }
      break;
    default:
      parts.push({
        fwd: front, lat: 0, z: L.head + b.headH * 0.2,
        w: 0.012, d: 0.05, h: 2, m: 'maw',
      });
      break;
  }
}

/**
 * How long a weapon looks, taken from the pattern it was forged to.
 *
 * Base stats rather than modified ones: a scope does not make a rifle longer,
 * and the question this answers is "sidearm or long gun", which the template
 * settles. Two-handed weapons cost three action points -- the closest thing
 * in the data to "you need both hands for this".
 */
export function weaponLen(w) {
  const st = w.baseStats || {};
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  return w.kind === 'gun'
    ? clamp((st.ap >= 3 ? 0.26 : 0.17) + (st.range || 4) * 0.004, 0.15, 0.34)
    : clamp(0.13 + (st.dmg || 12) * 0.004, 0.15, 0.28);
}

/** What they are carrying, sized from the weapon they actually hold. */
function addWeapon(parts, b, L, pose) {
  const w = pose.weapon;
  const hand = (b.chestW / 2 + b.armW / 2 + b.armOut);
  const swing = pose.swing || 0;
  if (w.kind === 'gun') {
    parts.push({
      fwd: b.lean * L.chest * FALL + w.len * 0.5 + 0.02 + swing * 0.09,
      lat: hand * 0.8,
      z: L.chest - 4 + swing * 5,
      w: w.len, d: 0.05, h: 3.5, m: 'steel',
    });
  } else {
    // Held out ahead and lifted on the swing, which is the only frame of a
    // melee attack there has ever been -- before this it was a camera shake.
    parts.push({
      fwd: b.lean * L.chest * FALL + w.len * 0.5 + 0.04 + swing * 0.14,
      lat: hand * 0.9,
      z: L.chest - 6 + swing * 9,
      w: w.len, d: 0.035, h: 3, m: 'steel',
    });
  }
}

/** Screen-space depth of a part, once the figure has been turned to face. */
function place(p, cos, sin) {
  const vx = p.fwd * cos - p.lat * sin;
  const vy = p.fwd * sin + p.lat * cos;
  return {
    vx,
    vy,
    // The rotated box's extent along each screen axis. At 45 degrees this is
    // a little wider than the box, which is also what a turned box looks like.
    w: Math.abs(p.w * cos) + Math.abs(p.d * sin),
    d: Math.abs(p.w * sin) + Math.abs(p.d * cos),
  };
}

/**
 * Draw one figure at a screen position.
 *
 * `facing` is a *screen* angle: the unit's grid facing plus the camera's
 * rotation, worked out by the caller, because facing is a fact about the
 * simulation and the camera is not.
 */
export function drawFigure(ctx, cx, cy, zoom, b, pose, colours) {
  const s = zoom * (b.scale || 1);
  const topple = pose.topple || 0;
  const parts = figureParts(b, pose);

  // Eight facings, snapped: between them a figure would slide rather than
  // turn, and the limbs are what carry the direction.
  const a = Math.round((pose.facing || 0) / (Math.PI / 4)) * (Math.PI / 4);
  const cos = Math.cos(a);
  const sin = Math.sin(a);

  // Toppling is a quarter turn about the feet, done part by part in the
  // figure's own frame rather than by rotating the canvas: what was height
  // becomes distance along the way it was facing, and what was depth becomes
  // height. Boxes stay boxes, so a body on the floor is lit like everything
  // else on the floor.
  const lerp = (a, c) => a + (c - a) * topple;
  const placed = parts.map((p) => {
    const laid = {
      ...p,
      fwd: lerp(p.fwd, p.fwd + (p.z + p.h / 2) * FALL),
      z: lerp(p.z, 0),
      w: lerp(p.w, p.h * FALL),
      h: lerp(p.h, p.w / FALL),
    };
    const q = place(laid, cos, sin);
    return { p, w: q.w, d: q.d, vx: q.vx, vy: q.vy, z: laid.z, h: laid.h };
  });
  placed.sort((m, n) => (m.vx + m.vy) - (n.vx + n.vy) || m.z - n.z);

  const bob = pose.bob2 || 0;
  for (const m of placed) {
    const sx = cx + (m.vx - m.vy) * (TILE_W / 2) * s;
    const sy = cy + (m.vx + m.vy) * (TILE_H / 2) * s - bob;
    isoBox(ctx, sx, sy, s, m.w, m.d, m.h, colours[m.p.m] || m.p.m, {
      z: m.z, rim: topple ? 0 : m.p.rim, outline: null,
    });
  }
}

/** The contact shadow under a figure, sized to its build. */
export function figureShadow(ctx, cx, cy, zoom, b, topple = 0) {
  const s = zoom * (b.scale || 1);
  const span = b.chestW + 0.06 + topple * 0.3;
  boxShadow(ctx, cx, cy, s, span, span, topple > 0.5 ? 8 : 34, {
    reach: topple > 0.5 ? 0.5 : 0.75,
    alpha: 0.3,
  });
}

/** The palette one figure is painted in. */
export function figureColours(body, dark, skin, hurt) {
  if (hurt) {
    return {
      body: '#ffffff', dark: '#ffd8d8', skin: '#ffffff', kit: '#ffe4e4',
      steel: '#ffffff', eye: '#c08080', maw: '#e0a0a0', sac: '#ffd8d8',
    };
  }
  return {
    body, dark, skin,
    kit: shadeHex(dark, -12),
    steel: '#8b939e',
    eye: '#140c0c',
    maw: '#3c0e12',
    sac: '#7d9c62',
  };
}

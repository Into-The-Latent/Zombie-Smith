// Art direction for the world view.
//
// The identity is sodium and steel: a dead city lit by cold ambient, with the
// only warm light coming from the few things still burning -- the squad's
// lamps, the forge, a muzzle flash. Every colour here is derived from that
// opposition rather than picked ad hoc, and every site biases the same cold
// ramp toward its own hue so the game reads as one place.
//
// Light comes from screen upper-left, which in grid terms is the -x direction.
// That single decision drives wall face shading and which way shadows fall;
// nothing should shade against it.

/** The system. Neutrals carry a blue bias so they read as chosen, not default. */
export const Base = {
  ink: '#070a0d',
  steelDark: '#1b222b',
  steel: '#2e3742',
  steelLight: '#454f5d',
  bone: '#c9cfd6',
  sodium: '#e8a33d',
  ember: '#d2603a',
  rot: '#6f8f5f',
  blood: '#8f2a24',
};

/** Grid offset toward the light. A caster here shadows the tile in question. */
export const LIGHT_DIR = { x: -1, y: 0 };

/** How much darker each surface is than the lit top face. */
export const FACE_SHADE = {
  top: 0,
  /** Screen-left face, pointing along +y: glancing light. */
  left: -20,
  /** Screen-right face, pointing along +x: turned away from the light. */
  right: -46,
};

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp255(((n >> 16) & 255) + amt);
  const g = clamp255(((n >> 8) & 255) + amt);
  const b = clamp255((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

/** Blend two hex colours. `t` of 0 gives `a`, 1 gives `b`. */
export function mix(a, b, t) {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const r = Math.round(((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t);
  const g = Math.round(((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t);
  const bl = Math.round((na & 255) * (1 - t) + (nb & 255) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Per-site palettes, each a hue bias applied to the shared cold ramp.
 *
 * The bias values are high on purpose. At a subtle 0.25 the shared steel base
 * swamped every tint and all five floors measured within 6 RGB units of each
 * other -- five sites that all look identical are not worth having. They are
 * still grim, because the tints themselves are muted.
 * `texture` names the surface so the renderer can mark it appropriately --
 * grit and cracks read as concrete, patches as asphalt, grout as tile.
 * `lift` shifts brightness, because hue alone could not separate the two warm
 * sites: a dusty warehouse under bare bulbs is lighter than an oil-dark pit.
 */
export const SITE_PALETTE = {
  transit: {
    tint: '#3d5670', // blue steel: buses, glass, sodium lamps outside
    bias: 0.58,
    texture: 'asphalt',
    haze: 'rgba(70,96,128,0.05)',
  },
  clinic: {
    tint: '#4a7052', // institutional green, gone grey -- kept clear of transit's blue
    bias: 0.52,
    texture: 'tile',
    haze: 'rgba(96,128,120,0.055)',
  },
  warehouse: {
    tint: '#6b563a', // ochre dust and bare bulbs
    bias: 0.56,
    lift: 9,
    texture: 'concrete',
    haze: 'rgba(128,104,68,0.05)',
  },
  suburb: {
    // Dusty mauve: faded paint and dead hedges in low light. Olive sat between
    // the clinic's green and the warehouse's ochre, and a bluer violet was too
    // near the transit depot, so it lands warm of both.
    tint: '#5a3f55',
    bias: 0.54,
    texture: 'concrete',
    haze: 'rgba(88,104,72,0.05)',
  },
  garage: {
    // Rust, pushed red so it separates from the warehouse's yellower ochre.
    tint: '#6b3a2f',
    bias: 0.5,
    lift: -11,
    texture: 'oil',
    haze: 'rgba(104,76,56,0.055)',
  },
};

/**
 * What things are made of, as opposed to where they are standing.
 *
 * Site palettes tint the architecture -- floors and walls belong to a place.
 * A wooden pallet does not: it is the same pallet in the clinic and in the
 * garage, and letting the site tint it too would wash every prop toward the
 * floor it sits on until the room read as one colour. These are the base
 * colours only; `isoBox` derives each face from them, so nothing downstream
 * gets to pick its own idea of where the light is.
 */
export const Material = {
  wood: '#8f6b3e',
  crate: '#8a6238',
  steel: '#6a727e',
  paintedSteel: '#4e5f6b',
  rust: '#7a4c39',
  plastic: '#5d6a63',
  fabric: '#6a5a4e',
};

/** Cars are the one prop that wants variety, so their paint is a small set. */
export const CAR_PAINT = ['#6b3f3a', '#3f4d6b', '#4b5b45', '#5c5348'];

const DEFAULT_SITE = SITE_PALETTE.transit;

/** Resolve one site's drawing colours from the shared system. */
export function sitePalette(siteKey) {
  const p = SITE_PALETTE[siteKey] || DEFAULT_SITE;
  const floor = shadeHex(mix(Base.steel, p.tint, p.bias), p.lift || 0);
  // Wall tops carry the site's hue too. Left untinted they were byte-identical
  // across all five sites, so the geometry belonged to no location at all.
  const tintedLight = mix(Base.steelLight, p.tint, p.bias * 0.5);
  return {
    floor,
    floorAlt: shadeHex(floor, -6),
    wall: mix(Base.steelLight, p.tint, p.bias * 0.7),
    wallTop: mix(tintedLight, Base.bone, 0.2),
    grout: shadeHex(floor, -22),
    grit: shadeHex(floor, 14),
    texture: p.texture,
    haze: p.haze,
  };
}

/** Like `shade`, but keeps a hex string so it can be mixed again. */
export function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp255(((n >> 16) & 255) + amt);
  const g = clamp255(((n >> 8) & 255) + amt);
  const b = clamp255((n & 255) + amt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Warm light the survivors carry, and the cold it pushes back. */
export const Lighting = {
  warmCore: 'rgba(255,186,110,',
  warmEdge: 'rgba(206,132,74,',
  coldFog: 'rgba(8,12,18,',
  rim: 'rgba(255,206,150,',
};

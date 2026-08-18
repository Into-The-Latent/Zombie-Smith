// Photograph one of everything.
//
// The renderer is the one part of this project with no unit coverage, and
// reasonably so -- there is no assertion that says a crate looks like a crate.
// What there can be is a fixed scene containing every prop, every zombie
// archetype and every survivor class, lit and unlit, so a change to the art
// is judged against the whole catalogue instead of against whatever the map
// generator happened to deal.
//
//   node tools/gallery.mjs [outdir]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(root, 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href);
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium || pw.default?.chromium;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
let PAGE = '';
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  const full = path.join(root, url.replace(/^\/+/, ''));
  if (!full.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(full, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));

// The scene is built straight out of the modules rather than by playing the
// game to it: a fixed cast in fixed places is the only way two screenshots
// taken a week apart differ solely by the code between them.
PAGE = `<body style="margin:0;background:#05070a">
<canvas id="c" width="1280" height="720"></canvas>
<script type="module">
import { drawWorld } from '/src/run/render.js';
import { makeCamera, cameraLookAt } from '/src/run/iso.js';
import { FLOOR, WALL, PROP, BLOCK } from '/src/run/map.js';
import { PROPS, PROP_KEYS, FULL } from '/src/data/props.js';
import { ENEMIES } from '/src/data/enemies.js';
import { CLASSES } from '/src/data/progression.js';
import {
  CLASS_BUILD, ZOMBIE_BUILD, drawFigure, figureShadow, figureColours,
} from '/src/run/figure.js';
import { shadeHex } from '/src/ui/palette.js';

const W = 26, H = 26;
const map = {
  w: W, h: H, tiles: new Uint8Array(W * H).fill(FLOOR),
  site: { key: 'transit', name: 'Gallery' },
  rooms: [], decals: [], containers: [], spawns: [],
  entry: { x: 2, y: 2 }, exit: { x: 20, y: 20 },
};
const set = (x, y, t) => { map.tiles[y * W + x] = t; };

// A wall run to shade against, and a short return so both faces are visible.
for (let x = 4; x <= 20; x++) set(x, 4, WALL);
for (let y = 4; y <= 9; y++) set(4, y, WALL);

// Every catalogue row, in order, two tiles apart.
map.props = new Uint8Array(W * H);
const putProp = (x, y, key) => {
  set(x, y, PROPS[key].cover === FULL ? BLOCK : PROP);
  map.props[y * W + x] = PROP_KEYS.indexOf(key) + 1;
};
PROP_KEYS.forEach((key, i) => putProp(5 + i * 2, 7, key));
// The same rows again in the dark, so the veil is judged on them too.
['crate', 'shelving', 'car', 'railing'].forEach((key, i) => putProp(7 + i * 2, 22, key));
const kinds = ['crate', 'toolbox', 'locker', 'medcab', 'ammobox', 'cartrunk', 'safe'];
kinds.forEach((kind, i) => map.containers.push({ x: 7 + i * 2, y: 10, kind, opened: i === 6 }));

const units = [];
let n = 0;
Object.keys(ENEMIES).forEach((key, i) => {
  const d = ENEMIES[key];
  units.push({
    id: 'z' + n++, side: 'zombie', key, x: 7 + i * 2, y: 14,
    hp: d.hp, hpMax: d.hp, state: 'idle', bob: i * 1.1, facing: 0,
    flash: 0, alerted: i === 4,
  });
});
Object.keys(CLASSES).forEach((key, i) => {
  units.push({
    id: 'p' + n++, side: 'player', cls: key, name: CLASSES[key].name,
    x: 7 + i * 2, y: 18, hp: 30, hpMax: 30, ap: 3, apMax: 3,
    state: 'idle', bob: i * 0.7, facing: 0, flash: 0,
    primary: i % 2 ? { kind: 'gun' } : null, melee: { kind: 'melee' },
    active: i % 2 ? 'primary' : 'melee', overwatch: i === 3, sight: 8,
  });
});

const battle = {
  map, units, round: 1, phase: 'player',
  visible: new Uint8Array(W * H).fill(1),
  seen: new Uint8Array(W * H).fill(1),
  noisePings: [], floaters: [], heat: 0, heatMax: 100,
};
// The bottom of the map is left unlit, so the cold veil is in shot too.
for (let y = 21; y < H; y++) for (let x = 0; x < W; x++) battle.visible[y * W + x] = 0;

const ctx = document.getElementById('c').getContext('2d');
const cam = makeCamera();
const view = { x: 0, y: 0, w: 1280, h: 720 };
window.shoot = (opts = {}) => {
  // Rotation first: cameraLookAt projects through the camera's current
  // rotation, so setting it afterwards points the camera at a different tile.
  cam.rot = opts.rot ?? 0;
  cam.turn = 0;
  cameraLookAt(cam, opts.at?.x ?? 12, opts.at?.y ?? 12);
  cam.zoom = opts.zoom ?? 1;
  ctx.clearRect(0, 0, 1280, 720);
  drawWorld(ctx, battle, view, cam, { time: 1.2, selectedId: 'p' + (units.length - 4) });
  return true;
};
/**
 * Every build, in every facing, on a plain ground. Drawn straight rather
 * than through a battle, because what is being judged here is whether a
 * Heavy reads as a Heavy and whether a figure turning still looks like the
 * same figure.
 */
window.shootFigures = (opts = {}) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2b3646';
  ctx.fillRect(0, 0, 1280, 720);
  const rows = [
    ...Object.keys(CLASS_BUILD).map((k) => ({
      key: k, build: CLASS_BUILD[k],
      col: figureColours(CLASSES[k].color, shadeHex(CLASSES[k].color, -55), '#e0c19a'),
      weapon: k === 'heavy' || k === 'gunsmith'
        ? { kind: 'gun', len: k === 'heavy' ? 0.3 : 0.19 }
        : { kind: 'melee', len: 0.19 },
    })),
    ...Object.keys(ZOMBIE_BUILD).map((k) => ({
      key: k, build: ZOMBIE_BUILD[k],
      col: figureColours(ENEMIES[k].color, ENEMIES[k].dark, shadeHex(ENEMIES[k].color, 25)),
      weapon: null,
    })),
  ];
  const zoom = opts.zoom ?? 1.7;
  ctx.font = '11px monospace';
  rows.forEach((r, i) => {
    const y = 108 + i * 68;
    ctx.fillStyle = '#cdd5e0';
    ctx.fillText(r.key, 6, y - 6);
    for (let f = 0; f < 8; f++) {
      const x = 116 + f * 108;
      figureShadow(ctx, x, y, zoom, r.build, 0);
      drawFigure(ctx, x, y, zoom, r.build, {
        facing: f * Math.PI / 4, walk: opts.walk ? 1.1 : 0, swing: opts.swing || 0,
        topple: opts.topple || 0, t: 1.2, bob: 0, weapon: r.weapon,
      }, r.col);
    }
  });
  ctx.fillStyle = '#cdd5e0';
  ctx.fillText('facing ->', 6, 40);
  for (let f = 0; f < 8; f++) ctx.fillText(String(f * 45), 110 + f * 108, 40);
  return true;
};

window.ready = true;
</script></body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.ready, null, { timeout: 5000 });

const shots = [
  ['gallery', {}],
  ...[0, 1, 2, 3].map((rot) => [`gallery-rot${rot}`, { rot, zoom: 1.3, at: { x: 10, y: 9 } }]),
  ['gallery-close', { zoom: 1.9, at: { x: 11, y: 15 } }],
  ['gallery-props', { zoom: 1.7, at: { x: 9, y: 7 } }],
  ['gallery-props-far', { zoom: 1.7, at: { x: 19, y: 7 } }],
  ['gallery-dark', { zoom: 1.7, at: { x: 11, y: 22 } }],
];
for (const [name, opts] of shots) {
  await page.evaluate((o) => window.shoot(o), opts);
  await page.locator('#c').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

const poses = [
  ['figures', {}],
  ['figures-walk', { walk: true }],
  ['figures-swing', { swing: 1 }],
  ['figures-down', { topple: 1 }],
];
for (const [name, opts] of poses) {
  await page.evaluate((o) => window.shootFigures(o), opts);
  await page.locator('#c').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

if (errors.length) {
  console.error('\n' + errors.join('\n'));
  await browser.close(); server.close();
  process.exit(1);
}
console.log(`\nwrote ${shots.length} shots to ${OUT}`);
await browser.close();
server.close();

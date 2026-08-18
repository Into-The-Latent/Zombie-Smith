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
import { FLOOR, WALL, CRATE, CAR } from '/src/run/map.js';
import { ENEMIES } from '/src/data/enemies.js';
import { CLASSES } from '/src/data/progression.js';

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

// Row of props.
set(7, 7, CRATE); set(9, 7, CRATE); set(12, 7, CAR); set(15, 7, CAR);
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
// A block of the far corner left unlit, so the cold veil is in shot too.
for (let y = 0; y < H; y++) for (let x = 18; x < W; x++) battle.visible[y * W + x] = 0;

const ctx = document.getElementById('c').getContext('2d');
const cam = makeCamera();
const view = { x: 0, y: 0, w: 1280, h: 720 };
window.shoot = (opts = {}) => {
  cameraLookAt(cam, opts.at?.x ?? 12, opts.at?.y ?? 12);
  cam.zoom = opts.zoom ?? 1;
  if (opts.rot !== undefined) cam.rot = opts.rot;
  ctx.clearRect(0, 0, 1280, 720);
  drawWorld(ctx, battle, view, cam, { time: 1.2, selectedId: 'p' + (units.length - 4) });
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
  ['gallery-close', { zoom: 1.9, at: { x: 11, y: 15 } }],
  ['gallery-props', { zoom: 1.9, at: { x: 11, y: 8 } }],
];
for (const [name, opts] of shots) {
  await page.evaluate((o) => window.shoot(o), opts);
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

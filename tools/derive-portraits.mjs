// Derive the portraits the game actually ships from the 1024px masters.
//
//   node tools/derive-portraits.mjs
//
// The masters in `art/` are the artist's originals and stay untouched. What the
// game loads is `assets/portraits/`, generated here and committed, because a
// static server has no build step to generate it on the fly.
//
// 512 is not a guess. The largest a portrait is ever drawn is the roster's
// detail panel at roughly 200 logical pixels, and the canvas backs at up to 2x
// device pixel ratio, so 400 real pixels is the ceiling. A 1024 master is four
// times the pixels of its largest consumer -- measured, that is 2.81 MB of
// base64 in the single-file build against 793 KB at 512, for detail no one can
// see.
//
// Chromium does the resampling because it is already in the toolchain for the
// smoke test; this script is the only thing that needs it, and only when the
// art changes.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** Playwright may only be installed globally; ESM will not search NODE_PATH. */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const entry = path.join(globalRoot, 'playwright', 'index.js');
    if (!fs.existsSync(entry)) {
      throw new Error('playwright is not installed (npm i -D playwright)');
    }
    return import(pathToFileURL(entry).href);
  }
}

const SIZE = 512;
const QUALITY = 0.86;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'art/portraits');
const outDir = path.join(root, 'assets/portraits');

const files = fs.readdirSync(srcDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (!files.length) throw new Error(`no portraits in ${srcDir}`);

const pw = await loadPlaywright();
const chromium = pw.chromium || pw.default?.chromium;
if (!chromium) throw new Error('could not find chromium in the playwright module');

// Served rather than read as file:// URLs, so the canvas is not tainted and
// `toDataURL` is allowed to read the pixels back.
let page = '';
const srv = http.createServer((q, s) => {
  const u = decodeURIComponent((q.url || '/').split('?')[0]);
  if (u === '/') {
    s.writeHead(200, { 'content-type': 'text/html' });
    s.end(page);
    return;
  }
  fs.readFile(path.join(root, u.slice(1)), (err, data) => {
    if (err) { s.writeHead(404).end(); return; }
    s.writeHead(200, { 'content-type': 'image/jpeg' });
    s.end(data);
  });
});
await new Promise((r) => srv.listen(0, r));
page = `<body>${files.map((f) => `<img src="/art/portraits/${f}">`).join('')}</body>`;

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'networkidle' });

const encoded = await tab.evaluate(async ({ size, quality }) => {
  const out = [];
  for (const el of document.querySelectorAll('img')) {
    await el.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    // Square in, square out: the art is composed as a 1:1 shot and cropping it
    // here would throw away a decision the artist already made. The frames the
    // game draws crop to fit their own aperture instead.
    cx.drawImage(el, 0, 0, size, size);
    out.push({ src: el.src, data: c.toDataURL('image/jpeg', quality) });
  }
  return out;
}, { size: SIZE, quality: QUALITY });

fs.mkdirSync(outDir, { recursive: true });
let before = 0;
let after = 0;
for (let i = 0; i < files.length; i++) {
  const name = `${path.basename(files[i], path.extname(files[i]))}.jpg`;
  const buf = Buffer.from(encoded[i].data.split(',')[1], 'base64');
  fs.writeFileSync(path.join(outDir, name), buf);
  before += fs.statSync(path.join(srcDir, files[i])).size;
  after += buf.length;
  console.log(`  ${name.padEnd(14)} ${(buf.length / 1024).toFixed(0)} KB`);
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`\n${files.length} portraits at ${SIZE}px: ${kb(before)} -> ${kb(after)}`
  + `  (${kb(after * 4 / 3)} once base64'd into the single-file build)`);

await browser.close();
srv.close();

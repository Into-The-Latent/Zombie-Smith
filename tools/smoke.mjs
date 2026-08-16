// Headless smoke test: boot the game, walk through the real screens, and
// fail loudly on any console error or uncaught exception.
//
//   node tools/smoke.mjs [--shots outdir]

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

// Playwright is CommonJS, so an ESM import of it may nest everything under
// `default` depending on how it was resolved.
const pw = await loadPlaywright();
const chromium = pw.chromium || pw.default?.chromium;
if (!chromium) throw new Error('could not find chromium in the playwright module');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > -1 ? process.argv[shotsIdx + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const full = path.join(root, rel);
  if (!full.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(full, (err, data) => {
    if (err) return res.writeHead(404).end('nope');
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));

let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.screenshot({ path: path.join(shotsDir, `${String(++step).padStart(2, '0')}-${name}.png`) });
};

/** Canvas coordinates are logical 1280x720; convert to page coordinates. */
async function clickGame(lx, ly) {
  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + (lx / 1280) * box.width, box.y + (ly / 720) * box.height);
  await page.waitForTimeout(140);
}
async function moveGame(lx, ly) {
  const box = await page.locator('#game').boundingBox();
  await page.mouse.move(box.x + (lx / 1280) * box.width, box.y + (ly / 720) * box.height);
}
const key = async (k) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(140);
};

/** Scenes carry a `name`; stations also expose their current `phase`. */
const sceneName = () =>
  page.evaluate(() => {
    const s = window.ZS.Game.current();
    if (!s) return 'none';
    return s.phase ? `${s.name}:${s.phase}` : s.name || 'unnamed';
  });

function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`  ✓ ${msg}`);
}

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.ZS, null, { timeout: 5000 });
  await page.waitForTimeout(400);

  console.log('\ntitle screen');
  check(await page.evaluate(() => window.ZS.Game.stack.length === 1), 'a scene is on the stack');
  await shot('title');

  // START (no save present in a fresh profile).
  await clickGame(640, 400);
  await page.waitForTimeout(400);
  const inWorkshop = (await sceneName()) === 'workshop';
  check(inWorkshop, 'reached the workshop');
  await shot('workshop');

  console.log('\ncrafting');
  await key('f'); // forge
  await page.waitForTimeout(300);
  check((await sceneName()).includes('select'), 'forge opened on the pattern picker');
  await shot('forge-select');

  // Light the forge -> shape stage.
  await clickGame(892, 599);
  await page.waitForTimeout(300);
  check((await sceneName()).includes('shape'), 'shape stage started');
  for (let i = 0; i < 8; i++) await key('Space');
  await page.waitForTimeout(200);
  const afterShape = await sceneName();
  check(afterShape.includes('grind') || afterShape.includes('fit'), `shape stage completed (now ${afterShape})`);
  await shot('forge-stage');

  // Grind: sweep the mouse along the traced path.
  if (afterShape.includes('grind')) {
    for (let i = 0; i <= 30; i++) {
      await moveGame(390 + i * 17, 400 - Math.sin(i / 30 * Math.PI) * 40);
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(600);
  }
  const afterGrind = await sceneName();
  check(afterGrind.includes('fit') || afterGrind.includes('result'), `grind stage completed (now ${afterGrind})`);

  for (let i = 0; i < 6; i++) await key('Space');
  await page.waitForTimeout(300);
  check((await sceneName()).includes('result'), 'a finished weapon came off the bench');
  const made = await page.evaluate(() => {
    const w = window.ZS.Game.current().result;
    return { name: w.name, quality: w.quality, dmg: w.baseStats.dmg };
  });
  check(made.dmg > 0 && made.quality >= 0 && made.quality <= 1, `made a ${made.name} (quality ${made.quality})`);
  await shot('forge-result');

  // Back to the workshop -- the result card is 560 wide, centred, so its
  // right-hand button sits at x 660..880, y 534..574.
  await clickGame(770, 554);
  await page.waitForTimeout(300);
  check((await sceneName()) === 'workshop', 'returned to the workshop');

  console.log('\nother stations');
  for (const [k, expect, label] of [
    ['a', 'ammo', 'ammo press'],
    ['c', 'med', 'chem bench'],
    ['w', 'armory', 'armoury'],
    ['r', 'roster', 'roster'],
    ['b', 'research', 'blueprints'],
  ]) {
    await key(k);
    await page.waitForTimeout(250);
    const got = await sceneName();
    check(got.startsWith(expect), `${label} opened (${got})`);
    await shot(label.replace(/\s+/g, '-'));
    await key('Escape');
    await page.waitForTimeout(250);
    check((await sceneName()) === 'workshop', `${label} closed back to the workshop`);
  }

  console.log('\nthe run');
  await key('Space'); // deploy
  await page.waitForTimeout(300);
  check((await sceneName()) === 'deploy', 'deploy screen opened');
  check(
    await page.evaluate(() => window.ZS.Game.current().squad.length > 0),
    'a squad was pre-selected',
  );
  await shot('deploy');
  await key('Space'); // move out
  await page.waitForTimeout(700);

  const runState = await page.evaluate(() => {
    const b = window.ZS.Game.current().battle;
    return b ? {
      units: b.units.length,
      players: b.units.filter((u) => u.side === 'player').length,
      zombies: b.units.filter((u) => u.side === 'zombie').length,
      round: b.round,
      site: b.map.site.name,
      w: b.map.w,
    } : null;
  });
  check(runState !== null, 'the run scene is live');
  check(runState.players === 3, `three survivors deployed to the ${runState.site}`);
  check(runState.zombies > 0, `${runState.zombies} zombies on the map`);
  await shot('run');

  // Camera + hover + a real move order.
  await page.mouse.wheel(0, -120);
  await moveGame(640, 400);
  await page.waitForTimeout(200);
  await shot('run-hover');

  const before = await page.evaluate(() => {
    const u = window.ZS.Game.current().unit();
    return { x: u.x, y: u.y, ap: u.ap };
  });
  // Click a handful of nearby tiles until one is a legal move.
  let moved = false;
  for (const [dx, dy] of [[80, 40], [-80, 40], [80, -30], [-80, -30], [140, 0], [0, 70]]) {
    await moveGame(640 + dx, 380 + dy);
    await page.waitForTimeout(120);
    const hasPath = await page.evaluate(() => !!window.ZS.Game.current().path);
    if (!hasPath) continue;
    await clickGame(640 + dx, 380 + dy);
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => {
      const u = window.ZS.Game.current().unit();
      return { x: u.x, y: u.y, ap: u.ap };
    });
    if (after.x !== before.x || after.y !== before.y) {
      moved = true;
      check(after.ap < before.ap, `moved and spent action points (${before.ap} -> ${after.ap})`);
      break;
    }
  }
  check(moved, 'a survivor walked where it was told');
  await shot('run-moved');

  // End a couple of turns so the enemy AI, vision and heat all tick.
  for (let i = 0; i < 3; i++) {
    await key('Space');
    await page.waitForTimeout(1800);
  }
  const turnState = await page.evaluate(() => {
    const b = window.ZS.Game.current().battle;
    return { round: b.round, phase: b.phase, heat: b.heat, alerted: b.units.filter((u) => u.alerted).length };
  });
  check(turnState.round > 1, `rounds advanced to ${turnState.round}`);
  check(turnState.phase === 'player', 'control came back to the player');
  await shot('run-turns');

  // Help overlay.
  await key('h');
  await page.waitForTimeout(200);
  await shot('run-help');
  await key('Escape');

  console.log('\nsettlement');
  // Force an extraction to exercise the debrief and the day rollover.
  await page.evaluate(() => {
    const s = window.ZS.Game.current();
    const b = s.battle;
    for (const u of b.units.filter((x) => x.side === 'player' && x.state !== 'dead')) {
      u.x = b.map.exit.x;
      u.y = b.map.exit.y;
    }
  });
  await key('x');
  await page.waitForTimeout(600);
  const debrief = await page.evaluate(() => {
    const s = window.ZS.Game.current();
    return s.report ? { outcome: s.report.outcome, day: s.report.day, value: s.report.value } : null;
  });
  check(debrief !== null, `debrief shown (${debrief?.outcome})`);
  await shot('debrief');

  await clickGame(640, 674);
  await page.waitForTimeout(500);
  const day = await page.evaluate(() => JSON.parse(localStorage.getItem('zombiesmith.save.v1')).day);
  check(day === 2, `the day rolled over and saved (day ${day})`);

  // Reload and make sure the save comes back.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await clickGame(640, 400); // CONTINUE
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => {
    const s = window.ZS.Game.current();
    return !!s.render;
  });
  check(restored, 'a saved campaign reloads from disk');
  await shot('reloaded');

  if (errors.length) {
    console.log(`\n\x1b[31m${errors.length} runtime error(s):\x1b[0m`);
    for (const e of errors.slice(0, 12)) console.log(`  ${e}`);
    throw new Error('runtime errors during the smoke test');
  }

  console.log('\n\x1b[32msmoke test passed with no console errors\x1b[0m\n');
} catch (err) {
  console.error(`\n\x1b[31mSMOKE TEST FAILED\x1b[0m\n${err.message}`);
  if (errors.length) {
    console.error('\ncollected runtime errors:');
    for (const e of errors.slice(0, 12)) console.error(`  ${e}`);
  }
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, 'FAILURE.png') });
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

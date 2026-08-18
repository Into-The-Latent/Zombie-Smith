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
/** Press and hold, for the stages that are held rather than clicked. */
async function holdGame(lx, ly, ms) {
  await moveGame(lx, ly);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
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

  // Start a campaign from a fixed seed so the whole run is reproducible.
  // Clicking START would pick a random one and the map would differ each time.
  await page.evaluate(() => window.ZS.startCampaign(202));
  await page.waitForTimeout(400);
  const inWorkshop = (await sceneName()) === 'workshop';
  check(inWorkshop, 'reached the workshop from a seeded campaign');
  await shot('workshop');

  console.log('\ncrafting');
  await key('f'); // forge
  await page.waitForTimeout(300);
  check((await sceneName()).includes('select'), 'forge opened on the pattern picker');
  await shot('forge-select');

  // Pick the machete rather than the default club: it is the cheapest pattern
  // that runs all three stages, and crafting a two-stage weapon here is what let
  // a bug where grinding was skipped entirely go unnoticed.
  await clickGame(220, 235);
  const picked = await page.evaluate(() => window.ZS.Game.current().tplKey);
  check(picked === 'machete', `picked a three-stage pattern (${picked})`);

  // Light the forge -> shape stage.
  await clickGame(892, 599);
  await page.waitForTimeout(300);
  check((await sceneName()).includes('shape'), 'shape stage started');
  await shot('forge-select');

  // Shape: hold the hammer over whatever stands proudest of the pattern, and
  // go back to the fire when the steel under it goes cold. Held, not clicked --
  // a smith works a bar in a rhythm rather than in fifty separate presses.
  for (let i = 0; i < 45; i++) {
    const st = await page.evaluate(() => {
      const b = window.ZS.Game.current().blank;
      if (!b) return null;
      let cell = -1;
      let worst = 0.004;
      for (let k = 0; k < b.cells; k++) {
        const over = b.thickness[k] - b.target[k];
        if (over > worst) { worst = over; cell = k; }
      }
      return { cell, cells: b.cells, heat: cell < 0 ? 1 : b.heat[cell], err: b.error };
    });
    if (!st || st.cell < 0 || st.err < 0.04) break;
    if (st.heat < 0.38) await key('r');
    await holdGame(316 + ((st.cell + 0.5) / st.cells) * 648, 372, 220);
  }
  await key('Space');
  await page.waitForTimeout(400);
  const afterShape = await sceneName();
  check(afterShape.includes('grind'), `shape led into grinding, not past it (now ${afterShape})`);
  await shot('forge-stage');

  // Grind: hold the edge to the wheel and sweep along it. Vertical position is
  // pressure, so this sweeps at a safe two thirds rather than leaning on it.
  if (afterShape.includes('grind')) {
    const box = await page.locator('#game').boundingBox();
    const at = (lx, ly) => ({ x: box.x + (lx / 1280) * box.width, y: box.y + (ly / 720) * box.height });
    for (let pass = 0; pass < 3; pass++) {
      const start = at(330, 372);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (let i = 0; i <= 24; i++) {
        const q = at(330 + i * 26, 372);
        await page.mouse.move(q.x, q.y);
        await page.waitForTimeout(22);
      }
      await page.mouse.up();
      await page.waitForTimeout(60);
    }
    await key('Space');
    await page.waitForTimeout(400);
  }
  const afterGrind = await sceneName();
  check(afterGrind.includes('fit'), `grind stage completed (now ${afterGrind})`);

  for (let i = 0; i < 4; i++) {
    if (!(await sceneName()).includes('fit')) break;
    const box = await page.locator('#game').boundingBox();
    await page.mouse.move(box.x + (640 / 1280) * box.width, box.y + (300 / 720) * box.height);
    await page.mouse.down();
    for (let t = 0; t < 80; t++) {
      const done = await page.evaluate(() => {
        const sc = window.ZS.Game.current();
        const b = sc.bolts && sc.bolts[sc.boltIndex];
        // Each bolt has its own mark now, so stop on that rather than on a
        // number that used to be the same for all four.
        return !b || b.torque >= b.target - b.band * 0.4;
      });
      if (done) break;
      await page.waitForTimeout(35);
    }
    await page.mouse.up();
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(300);
  check((await sceneName()).includes('result'), 'a finished weapon came off the bench');
  const made = await page.evaluate(() => {
    const w = window.ZS.Game.current().result;
    return { name: w.name, quality: w.quality, dmg: w.baseStats.dmg, profile: w.profile };
  });
  check(made.dmg > 0 && made.quality >= 0 && made.quality <= 1, `made a ${made.name} (quality ${made.quality})`);
  const shares = made.profile.edge + made.profile.core + made.profile.haft;
  check(Math.abs(shares - 1) < 0.05, `strike allocation recorded (${JSON.stringify(made.profile)})`);
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

  console.log('\nsemi-auto scavenging');
  const snap = () => page.evaluate(() => {
    const s = window.ZS.Game.current();
    const b = s.battle;
    return {
      auto: s.auto,
      halt: s.haltNotice,
      round: b.round,
      opened: b.map.containers.filter((c) => c.opened).length,
      total: b.map.containers.length,
      pos: b.units.filter((u) => u.side === 'player').map((u) => `${u.x},${u.y}`).join('|'),
    };
  });

  const autoStart = await snap();
  await key('v');
  // Sample quickly: the autopilot moves at ~18 tiles a second and may already
  // have found something and handed back before a slower poll would notice.
  await page.waitForTimeout(250);
  const early = await snap();
  const ran = early.auto || early.pos !== autoStart.pos || early.opened > autoStart.opened;
  check(ran || (early.halt && early.halt !== 'Stopped.'),
    ran ? 'autopilot took over and started moving' : `autopilot refused for cause (${early.halt})`);

  if (ran) {
    await page.waitForTimeout(5000);
    const late = await snap();
    check(late.pos !== autoStart.pos, 'the squad walked on its own');
    // Stopping almost immediately is a correct outcome, not a failure: if a
    // zombie is a few tiles away the right thing to do is hand back control.
    const progressed = late.opened > autoStart.opened || late.round > autoStart.round;
    const haltedForCause = !late.auto && !!late.halt && late.halt !== 'Stopped.';
    check(progressed || haltedForCause,
      progressed
        ? `it made progress (${late.opened}/${late.total} looted, round ${late.round})`
        : `it stopped early for cause (${late.halt})`);
    await shot('run-autopilot');

    if (late.auto) {
      await key('Escape');
      await page.waitForTimeout(250);
      check(!(await page.evaluate(() => window.ZS.Game.current().auto)),
        'a keypress takes control back');
    } else {
      check(!!late.halt && late.halt !== 'Stopped.',
        `it handed control back on its own (${late.halt})`);
    }
  }

  // Camera + hover + a real move order.
  await page.mouse.wheel(0, -120);
  await moveGame(640, 400);
  await page.waitForTimeout(200);
  await shot('run-hover');

  // Make sure somebody actually has action points to spend first -- the
  // autopilot above may have used the whole turn.
  for (let attempt = 0; attempt < 6; attempt++) {
    const ready = await page.evaluate(() => {
      const s = window.ZS.Game.current();
      const u = s.battle.units.find((x) => x.side === 'player' && x.state === 'idle' && x.ap >= 2);
      if (u) s.select(u.id);
      return !!u && s.battle.phase === 'player' && !s.job;
    });
    if (ready) break;
    await key('Space');
    await page.waitForTimeout(2200);
  }

  const before = await page.evaluate(() => {
    const u = window.ZS.Game.current().unit();
    return { x: u.x, y: u.y, ap: u.ap };
  });

  /**
   * Ask the game for a tile the selected survivor can legally reach, then
   * convert it to canvas coordinates with the same projection the renderer
   * uses. Probing blind offsets was fragile once cover got dense.
   */
  const targetPoint = await page.evaluate(() => {
    const s = window.ZS.Game.current();
    const cam = s.cam;
    const u = s.unit();
    if (!s.reach) s.recomputeReach();
    if (!s.reach) return null;
    const w = s.battle.map.w;
    // Furthest reachable tile makes the strongest assertion.
    let best = null;
    for (const [key, cost] of s.reach) {
      if (cost < 1) continue;
      if (!best || cost > best.cost) best = { key, cost };
    }
    if (!best) return null;
    const gx = best.key % w;
    const gy = Math.floor(best.key / w);
    const worldX = (gx - gy) * 32;
    const worldY = (gx + gy) * 16;
    const viewH = 720 - 46;
    return {
      gx,
      gy,
      cost: best.cost,
      lx: 1280 / 2 + (worldX - cam.x) * cam.zoom,
      ly: 46 + viewH / 2 + (worldY - cam.y) * cam.zoom,
      startAp: u.ap,
    };
  });
  check(targetPoint !== null, 'the game offered a reachable tile');

  await moveGame(targetPoint.lx, targetPoint.ly);
  await page.waitForTimeout(160);
  await clickGame(targetPoint.lx, targetPoint.ly);
  await page.waitForTimeout(200 + targetPoint.cost * 200);

  const after = await page.evaluate(() => {
    const u = window.ZS.Game.current().unit();
    return { x: u.x, y: u.y, ap: u.ap };
  });
  check(after.x !== before.x || after.y !== before.y,
    `a survivor walked where it was told (${before.x},${before.y} -> ${after.x},${after.y})`);
  check(after.ap < before.ap, `and spent action points (${before.ap} -> ${after.ap})`);
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

// The scavenging run: isometric, turn based, one squad against a dead street.

import { Game } from '../core/loop.js';
import { Input, keyPressed, takeClick } from '../core/input.js';
import { Sfx } from '../core/audio.js';
import { Theme, W, H } from '../ui/theme.js';
import {
  beginUI, endUI, panel, button, label, labelClipped, bar, pips, roundRect, setTooltip, dim,
} from '../ui/widgets.js';
import { clamp, pointInRect, gridDist } from '../core/util.js';
import { makeCamera, cameraLookAt, cameraPanTo, updateCamera, unproject } from '../run/iso.js';
import { drawWorld, paintTile } from '../run/render.js';
import { findPath, reachable } from '../run/pathfind.js';
import {
  createBattle, beginRound, checkHeat, openContainer, dropFromCorpse,
  canExtract, canFallBack, squadWiped, finishRun, livingPlayers, unitAt,
} from '../run/battle.js';
import { refreshVision, isVisible } from '../run/fov.js';
import { hitChance, canAttack, resolveAttack, activeWeapon, makeNoise } from '../run/combat.js';
import { nextEnemyAction, overwatchTriggers, isBlockedFor } from '../run/ai.js';
import {
  nextAutoAction, haltReason, completionReason, snapshotHp, progressSignature, HALT,
} from '../run/autopilot.js';
import { weaponStats, weaponLabel } from '../game/craft.js';
import { CLASSES } from '../data/progression.js';
import { ENEMIES } from '../data/enemies.js';
import { AMMO } from '../data/materials.js';
import { makeDebriefScene } from './debrief.js';

const TOP_H = 46;
const BOTTOM_H = 138;
const MOVE_STEP_TIME = 0.11;
const AUTO_STEP_TIME = 0.055;

export function makeRunScene(state, squadIds, siteKey, rand) {
  const battle = createBattle(state, squadIds, rand, siteKey);
  const cam = makeCamera();
  cameraLookAt(cam, battle.map.entry.x, battle.map.entry.y);

  const scene = {
    name: 'run',
    battle,
    cam,
    stateRef: state,
    selectedId: null,
    hover: { x: -1, y: -1 },
    path: null,
    pathCost: 0,
    reach: null,
    mode: 'move', // move | medic
    jobs: [],
    job: null,
    tracers: [],
    enemyIdx: 0,
    enemyQueue: [],
    time: 0,
    showHelp: false,
    ended: false,
    hudRects: [],
    lastTargetInfo: null,

    // Semi-auto scavenging.
    auto: false,
    autoHp: null,
    autoSignature: null,
    autoStalls: 0,
    haltNotice: null,
    haltTimer: 0,

    enter() {
      const first = livingPlayers(battle)[0];
      if (first) this.select(first.id);
      pushLog(battle, 'Objective: reach the extraction pad. Fall back any time from where you came in.', 'info');
    },

    select(id) {
      this.selectedId = id;
      this.mode = 'move';
      const u = this.unit();
      if (u) {
        cameraPanTo(cam, u.x, u.y);
        this.recomputeReach();
      }
    },

    unit() {
      return battle.units.find((u) => u.id === this.selectedId) || null;
    },

    recomputeReach() {
      const u = this.unit();
      if (!u || u.state !== 'idle' || battle.phase !== 'player') {
        this.reach = null;
        return;
      }
      this.reach = reachable(battle.map, u.x, u.y, u.ap, isBlockedFor(battle, u));
    },

    update(dt) {
      this.time += dt;
      updateCamera(cam, dt);
      stepEffects(battle, this.tracers, dt);
      if (this.haltTimer > 0) this.haltTimer = Math.max(0, this.haltTimer - dt);

      if (this.showHelp) {
        if (keyPressed('Escape') || keyPressed('h')) this.showHelp = false;
        return;
      }

      // Animations own the clock while they run.
      if (this.job) {
        if (advanceJob(this, dt)) this.job = null;
        return;
      }
      if (this.jobs.length) {
        this.job = this.jobs.shift();
        startJob(this, this.job);
        return;
      }

      if (this.ended) return;

      if (battle.phase === 'enemy') {
        driveEnemyTurn(this);
        return;
      }

      handleCamera(this, dt);

      // Any input at all takes the wheel back -- except the toggle key, which
      // the ADVANCE / TAKE CONTROL button owns. Handling it here as well would
      // stop the autopilot and let the button restart it in the same frame.
      if (this.auto) {
        if (Input.pressed.has('v')) {
          // Deliberately idle this frame; the button acts during render.
        } else if (Input.clicked || Input.pressed.size > 0) {
          // The click that takes control should not also issue an order.
          Input.clickConsumed = true;
          stopAuto(this, HALT.MANUAL);
        } else {
          driveAutopilot(this);
          return;
        }
      }

      handleHover(this);
      handleKeys(this);
    },

    render(ctx) {
      beginUI();
      this.hudRects = [];
      const view = { x: 0, y: TOP_H, w: W, h: H - TOP_H };

      drawWorld(ctx, battle, view, cam, {
        time: this.time,
        selectedId: this.selectedId,
        targetId: this.hoverUnit?.id,
        tracers: this.tracers,
        overlay: (c, P, zoom) => drawOverlays(this, c, P, zoom),
      });

      drawTopBar(this, ctx);
      // The bottom panel's backdrop must land before anything that sits on it.
      drawBottomBackdrop(this, ctx);
      drawSquadBar(this, ctx);
      drawActionBar(this, ctx);
      drawLogPanel(this, ctx);
      drawAutoBanner(this, ctx);
      if (this.hoverUnit && this.hoverUnit.side === 'zombie') drawTargetPanel(this, ctx);
      if (this.showHelp) drawHelp(this, ctx);
      endUI(ctx);
    },
  };

  return scene;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function handleCamera(scene, dt) {
  const { cam } = scene;
  const speed = 620 * dt / cam.zoom;
  if (Input.keys.has('ArrowLeft') || Input.keys.has('a')) { cam.targetX -= speed; cam.x -= speed; }
  if (Input.keys.has('ArrowRight') || Input.keys.has('d')) { cam.targetX += speed; cam.x += speed; }
  if (Input.keys.has('ArrowUp') || Input.keys.has('w')) { cam.targetY -= speed; cam.y -= speed; }
  if (Input.keys.has('ArrowDown') || Input.keys.has('s')) { cam.targetY += speed; cam.y += speed; }
  if (Input.wheel) {
    cam.zoom = clamp(cam.zoom * (Input.wheel > 0 ? 0.88 : 1.14), 0.55, 1.9);
  }
}

function mouseOverHud(scene) {
  return scene.hudRects.some((r) => pointInRect(Input.x, Input.y, r));
}

function handleHover(scene) {
  const { battle, cam } = scene;
  scene.hoverUnit = null;
  scene.path = null;

  if (mouseOverHud(scene) || Input.y < TOP_H) return;

  const view = { x: 0, y: TOP_H, w: W, h: H - TOP_H };
  const g = unproject(cam, Input.x, Input.y, view.w, view.h, view.x, view.y);
  const hx = Math.round(g.gx);
  const hy = Math.round(g.gy);
  scene.hover = { x: hx, y: hy };

  const u = scene.unit();
  if (!u || u.state !== 'idle') return;

  const target = unitAt(battle, hx, hy);
  if (target && target.side === 'zombie' && isVisible(battle, hx, hy)) {
    scene.hoverUnit = target;
    scene.lastTargetInfo = canAttack(battle, u, target);
    if (Input.clicked && !Input.clickConsumed) {
      takeClick();
      tryAttack(scene, u, target);
    }
    return;
  }
  if (target && target.side === 'player') {
    scene.hoverUnit = target;
    if (Input.clicked && !Input.clickConsumed) {
      takeClick();
      if (scene.mode === 'medic') useMedipack(scene, u, target);
      else if (target.state === 'idle') scene.select(target.id);
    }
    return;
  }

  if (scene.mode === 'medic') return;

  // Movement preview.
  if (scene.reach) {
    const key = hy * battle.map.w + hx;
    if (scene.reach.has(key)) {
      const p = findPath(battle.map, u.x, u.y, hx, hy, isBlockedFor(battle, u), { maxCost: u.ap });
      if (p && p.length <= u.ap) {
        scene.path = p;
        scene.pathCost = p.length;
        if (Input.clicked && !Input.clickConsumed) {
          takeClick();
          startMove(scene, u, p);
        }
      }
    }
  }
}

/**
 * Only keys that have no on-screen button live here.
 *
 * Everything with a button (reload, swap, brace, overwatch, medipack, end
 * turn, leave, advance, help) is driven by that button's `hotkey`. Handling
 * them in both places fired every action twice in a single frame, which cost
 * double action points on a weapon swap and made ADVANCE start the autopilot
 * and immediately stop it again.
 */
function handleKeys(scene) {
  const { battle } = scene;

  if (keyPressed('Escape')) {
    if (scene.mode !== 'move') scene.mode = 'move';
    else scene.showHelp = true;
  }
  if (keyPressed('Tab')) cycleSquad(scene);
  for (let i = 1; i <= 3; i++) {
    if (keyPressed(String(i))) {
      const list = battle.units.filter((x) => x.side === 'player');
      const t = list[i - 1];
      if (t && t.state === 'idle') scene.select(t.id);
    }
  }
}

function cycleSquad(scene) {
  const list = scene.battle.units.filter((u) => u.side === 'player' && u.state === 'idle');
  if (!list.length) return;
  const i = list.findIndex((u) => u.id === scene.selectedId);
  scene.select(list[(i + 1) % list.length].id);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function startMove(scene, unit, path) {
  scene.jobs.push({ t: 'move', unit, path, idx: 0, timer: 0 });
  scene.reach = null;
}

function tryAttack(scene, unit, target) {
  const chk = canAttack(scene.battle, unit, target);
  if (!chk.ok) {
    Sfx.deny();
    pushLog(scene.battle, chk.why, 'warn');
    return;
  }
  scene.jobs.push({ t: 'attack', attacker: unit, target, timer: 0 });
}

function doReload(scene, u) {
  const w = activeWeapon(u);
  const { battle } = scene;
  if (!w || w.kind !== 'gun') return Sfx.deny();
  const st = weaponStats(w);
  const cost = u.fastReload ? 1 : 2;
  if (u.ap < cost) return Sfx.deny();
  const need = st.mag - w.loaded;
  if (need <= 0) return Sfx.deny();
  const have = battle.ammoReserve[w.ammo] || 0;
  if (have <= 0) {
    Sfx.deny();
    pushLog(battle, `Out of ${AMMO[w.ammo].short}.`, 'warn');
    return;
  }
  const take = Math.min(need, have);
  w.loaded += take;
  battle.ammoReserve[w.ammo] -= take;
  u.ap -= cost;
  u.braced = false;
  Sfx.press();
  pushLog(battle, `${u.name} reloads (+${take}).`);
  scene.recomputeReach();
}

function doSwap(scene, u) {
  if (u.ap < 1) return Sfx.deny();
  if (!u.primary || !u.melee) return Sfx.deny();
  u.active = u.active === 'melee' ? 'primary' : 'melee';
  u.ap -= 1;
  u.braced = false;
  Sfx.click();
  scene.recomputeReach();
}

function doOverwatch(scene, u) {
  if (u.ap < 2) return Sfx.deny();
  const w = activeWeapon(u);
  if (!w) return Sfx.deny();
  if (w.kind === 'gun' && w.loaded <= 0) {
    Sfx.deny();
    pushLog(scene.battle, 'Nothing in the magazine to overwatch with.', 'warn');
    return;
  }
  u.overwatch = true;
  u.ap = 0;
  Sfx.click();
  pushLog(scene.battle, `${u.name} covers the approach.`);
  scene.recomputeReach();
  autoAdvance(scene);
}

function doBrace(scene, u) {
  if (u.ap < 1 || u.braced) return Sfx.deny();
  u.braced = true;
  u.ap -= 1;
  Sfx.click();
  pushLog(scene.battle, `${u.name} braces. +15 to hit.`);
  scene.recomputeReach();
}

function useMedipack(scene, healer, target) {
  const { battle } = scene;
  if (battle.medipacks <= 0) {
    Sfx.deny();
    pushLog(battle, 'No medipacks left.', 'warn');
    return;
  }
  if (healer.ap < 2) return Sfx.deny();
  if (gridDist(healer.x, healer.y, target.x, target.y) > 1 && target !== healer) {
    Sfx.deny();
    pushLog(battle, 'Too far away to treat.', 'warn');
    return;
  }
  battle.medipacks -= 1;
  healer.ap -= 2;
  const power = Math.round(18 * (1 + (healer.healBonus || 0)));

  if (target.state === 'down') {
    target.state = 'idle';
    target.hp = Math.max(1, Math.round(target.hpMax * 0.3));
    target.bleed = 0;
    target.ap = 0;
    pushLog(battle, `${healer.name} stabilises ${target.name}.`, 'good');
    addFloater(battle, target.x, target.y, 'STABLE', 'rgba(120,220,160,ALPHA)');
  } else {
    const before = target.hp;
    target.hp = Math.min(target.hpMax, target.hp + power);
    pushLog(battle, `${healer.name} patches ${target.name} for ${target.hp - before}.`, 'good');
    addFloater(battle, target.x, target.y, `+${target.hp - before}`, 'rgba(120,220,160,ALPHA)');
  }
  Sfx.heal();
  scene.mode = 'move';
  scene.recomputeReach();
}

function tryLeave(scene) {
  const { battle } = scene;
  if (canExtract(battle)) return endRun(scene, 'extracted');
  if (canFallBack(battle)) return endRun(scene, 'fellback');
  Sfx.deny();
  pushLog(battle, 'Everyone still standing has to be on the same pad.', 'warn');
}

function endRun(scene, outcome) {
  if (scene.ended) return;
  scene.ended = true;
  scene.battle.outcome = outcome;
  if (outcome === 'wiped') Sfx.death();
  else Sfx.extract();
  const report = finishRun(scene.stateRef, scene.battle, outcome);
  Game.replace(makeDebriefScene(scene.stateRef, report, scene.battle));
}

function endPlayerPhase(scene) {
  const { battle } = scene;
  battle.phase = 'enemy';
  scene.reach = null;
  scene.path = null;
  scene.mode = 'move';
  scene.enemyIdx = 0;
  scene.enemyQueue = battle.units.filter((u) => u.side === 'zombie' && u.state !== 'dead');
  for (const u of battle.units) {
    if (u.side === 'zombie') u.ap = u.apMax;
  }
}

// ---------------------------------------------------------------------------
// Semi-auto scavenging
// ---------------------------------------------------------------------------

function startAuto(scene) {
  const { battle } = scene;
  const reason = haltReason(battle);
  if (reason) {
    Sfx.deny();
    flashHalt(scene, reason);
    return;
  }
  scene.auto = true;
  scene.autoHp = snapshotHp(battle);
  scene.autoSignature = null;
  scene.autoStalls = 0;
  scene.mode = 'move';
  scene.path = null;
  scene.reach = null;
  pushLog(battle, 'Squad advancing on its own.', 'info');
}

function stopAuto(scene, reason) {
  if (!scene.auto) return;
  scene.auto = false;
  flashHalt(scene, reason);
  if (reason !== HALT.MANUAL) {
    pushLog(scene.battle, reason, reason === HALT.CONTACT ? 'warn' : 'info');
    Sfx.deny();
  }
  scene.recomputeReach();
  autoAdvance(scene);
}

function flashHalt(scene, reason) {
  scene.haltNotice = reason;
  scene.haltTimer = 2.4;
}

/** One autopilot decision per idle frame; the job queue animates the rest. */
function driveAutopilot(scene) {
  const { battle } = scene;

  const danger = haltReason(battle, { hpSnapshot: scene.autoHp });
  if (danger) return stopAuto(scene, danger);

  const done = completionReason(battle);
  if (done === HALT.ARRIVED) return stopAuto(scene, done);

  const action = nextAutoAction(battle);

  if (!action) {
    return stopAuto(scene, done || HALT.STUCK);
  }
  if (action.type === 'endTurn') {
    // If a whole turn passed with nobody moving and nothing looted, the squad
    // is wedged; ending turns forever would hang the game.
    const signature = progressSignature(battle);
    scene.autoStalls = signature === scene.autoSignature ? scene.autoStalls + 1 : 0;
    scene.autoSignature = signature;
    if (scene.autoStalls >= 2) return stopAuto(scene, HALT.STUCK);
    endPlayerPhase(scene);
    return;
  }
  if (action.type === 'reload') {
    doReload(scene, action.unit);
    return;
  }
  if (action.type === 'move') {
    if (!action.path.length) return stopAuto(scene, HALT.STUCK);
    scene.select(action.unit.id);
    scene.jobs.push({ t: 'move', unit: action.unit, path: action.path, idx: 0, timer: 0, auto: true });
  }
}

/** Jump to the next survivor who still has something to do. */
function autoAdvance(scene) {
  const list = scene.battle.units.filter((u) => u.side === 'player' && u.state === 'idle' && u.ap > 0);
  if (!list.length) return;
  const cur = scene.unit();
  if (cur && cur.state === 'idle' && cur.ap > 0) return;
  scene.select(list[0].id);
}

// ---------------------------------------------------------------------------
// Job runner (animation)
// ---------------------------------------------------------------------------

function startJob(scene, job) {
  if (job.t === 'move') {
    job.unit.anim = { x: job.unit.x, y: job.unit.y };
    job.unit.braced = false;
  }
  if (job.t === 'attack') {
    const a = job.attacker;
    const target = job.target;
    a.facing = Math.atan2(target.y - a.y, target.x - a.x);
  }
}

/** @returns true when the job is finished */
function advanceJob(scene, dt) {
  const job = scene.job;
  const { battle } = scene;

  switch (job.t) {
    case 'pause':
      job.timer = (job.timer || 0) + dt;
      return job.timer >= job.dur;

    case 'fn':
      job.fn();
      return true;

    case 'move': {
      const u = job.unit;
      if (u.state === 'dead') return true;
      job.timer += dt;
      const from = job.idx === 0 ? { x: u.x, y: u.y } : { x: job.path[job.idx - 1][0], y: job.path[job.idx - 1][1] };
      const to = { x: job.path[job.idx][0], y: job.path[job.idx][1] };
      const k = clamp(job.timer / (job.auto ? AUTO_STEP_TIME : MOVE_STEP_TIME), 0, 1);
      u.anim = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };

      if (k < 1) return false;

      // Landed on the next tile.
      job.timer = 0;
      u.facing = Math.atan2(to.y - from.y, to.x - from.x);
      u.x = to.x;
      u.y = to.y;
      u.anim = null;
      job.idx += 1;
      if (u.side === 'player') u.ap = Math.max(0, u.ap - 1);

      const beforeVisible = u.side === 'player' ? snapshotVisibleEnemies(battle) : null;
      refreshVision(battle);

      if (u.side === 'player') {
        cameraPanTo(scene.cam, u.x, u.y);
        pickUpLoot(scene, u);
        // Spotting something new stops you in your tracks.
        const after = snapshotVisibleEnemies(battle);
        const fresh = after.filter((id) => !beforeVisible.includes(id));
        if (fresh.length) {
          const z = battle.units.find((x) => x.id === fresh[0]);
          pushLog(battle, `Contact -- ${z ? ENEMIES[z.key].name : 'something'} spotted.`, 'warn');
          Sfx.zombieGroan();
          scene.cam.shake = Math.max(scene.cam.shake, 0.25);
          job.idx = job.path.length; // cancel the rest of the move
          if (scene.auto) stopAuto(scene, HALT.CONTACT);
        }
      } else {
        // Overwatch punishes movement through a covered lane.
        const triggers = overwatchTriggers(battle, u);
        for (const tr of triggers) {
          tr.shooter.overwatch = false;
          scene.jobs.unshift({ t: 'attack', attacker: tr.shooter, target: tr.target, reaction: true, timer: 0 });
        }
        if (triggers.length) {
          scene.jobs.unshift({ t: 'pause', dur: 0.12 });
          return true;
        }
      }

      if (job.idx >= job.path.length) {
        if (u.side === 'player') scene.recomputeReach();
        return true;
      }
      return false;
    }

    case 'attack': {
      const a = job.attacker;
      const target = job.target;
      if (a.state === 'dead' || target.state === 'dead') return true;

      job.timer += dt;
      if (job.timer < 0.14) return false; // wind-up
      if (job.fired) return job.timer > 0.42;

      job.fired = true;
      const res = resolveAttack(battle, a, target, battle.rand, { free: !!job.reaction });
      if (job.reaction) pushLog(battle, `${a.name} fires on overwatch.`, 'info');

      const w = a.side === 'player' ? activeWeapon(a) : null;
      const isGun = w ? w.kind === 'gun' : ENEMIES[a.key].range > 1;

      if (isGun) {
        scene.tracers.push({ from: { x: a.x, y: a.y }, to: { x: target.x, y: target.y }, t: 0, hit: res.shots.some((s) => s.hit) });
        if (w && weaponStats(w).noise > 11) Sfx.gunShotgun();
        else if (w && weaponStats(w).range > 8) Sfx.gunRifle();
        else Sfx.gunLight();
      } else {
        Sfx.melee();
      }

      for (const s of res.shots) {
        if (s.hit) {
          addFloater(battle, target.x, target.y, s.crit ? `${s.damage}!` : `${s.damage}`,
            s.crit ? 'rgba(255,205,90,ALPHA)' : 'rgba(255,110,95,ALPHA)', s.crit ? 20 : 16);
        } else {
          addFloater(battle, target.x, target.y, 'miss', 'rgba(190,200,215,ALPHA)', 13);
          Sfx.miss();
        }
      }

      if (a.side === 'player') {
        scene.cam.shake = Math.max(scene.cam.shake, isGun ? 0.4 : 0.25);
      } else {
        scene.cam.shake = Math.max(scene.cam.shake, 0.3);
        if (res.totalDamage > 0) Sfx.hurt();
      }

      if (target.state === 'dead') {
        Sfx.zombieDie();
        if (target.side === 'zombie') {
          const drop = dropFromCorpse(battle, target);
          const bits = Object.entries(drop.resources).map(([k, v]) => `+${v} ${k}`);
          if (bits.length) addFloater(battle, target.x, target.y, bits.join(' '), 'rgba(200,220,140,ALPHA)', 12);
          pushLog(battle, `${a.name} put down a ${ENEMIES[target.key].name}.`, 'good');
        }
      }

      // Gunfire carries.
      if (res.noise > 0) {
        const woke = makeNoise(battle, a.x, a.y, res.noise);
        if (woke > 0 && a.side === 'player') {
          pushLog(battle, `That noise woke ${woke} of them.`, 'warn');
        }
      }

      refreshVision(battle);
      if (a.side === 'player') scene.recomputeReach();
      return false;
    }

    case 'scream': {
      job.timer += dt;
      if (!job.done) {
        job.done = true;
        Sfx.alarm();
        const z = job.unit;
        addFloater(battle, z.x, z.y, 'SCREECH', 'rgba(220,140,230,ALPHA)', 20);
        makeNoise(battle, z.x, z.y, 16);
        battle.heat = Math.min(battle.heatMax, battle.heat + 35);
        pushLog(battle, 'A Screamer calls the street in.', 'bad');
        scene.cam.shake = 0.6;
        z.ap = Math.max(0, z.ap - 1);
      }
      return job.timer > 0.5;
    }

    default:
      return true;
  }
}

function snapshotVisibleEnemies(battle) {
  return battle.units
    .filter((u) => u.side === 'zombie' && u.state !== 'dead' && isVisible(battle, u.x, u.y))
    .map((u) => u.id);
}

function pickUpLoot(scene, u) {
  const { battle } = scene;
  const c = battle.map.containers.find((k) => k.x === u.x && k.y === u.y && !k.opened);
  if (!c) return;
  const bundle = openContainer(battle, u, c);
  if (!bundle) return;
  Sfx.loot();
  const bits = [];
  for (const [k, v] of Object.entries(bundle.resources)) bits.push(`+${v} ${k}`);
  for (const [k, v] of Object.entries(bundle.ammo)) bits.push(`+${v} ${AMMO[k].short}`);
  if (bundle.medipacks) bits.push(`+${bundle.medipacks} medipack`);
  if (bundle.weapon) bits.push(bundle.weapon.name);
  if (bundle.blueprint) bits.push('BLUEPRINT');
  addFloater(battle, u.x, u.y, bits.join(' ') || 'empty', 'rgba(230,200,120,ALPHA)', 13);
  pushLog(battle, `${u.name} opens a ${bundle.kind}: ${bits.join(', ') || 'nothing useful'}.`, bundle.blueprint ? 'good' : 'info');
}

// ---------------------------------------------------------------------------
// Enemy turn
// ---------------------------------------------------------------------------

function driveEnemyTurn(scene) {
  const { battle } = scene;

  if (squadWiped(battle)) return endRun(scene, 'wiped');

  while (scene.enemyIdx < scene.enemyQueue.length) {
    const z = scene.enemyQueue[scene.enemyIdx];
    if (z.state === 'dead' || z.ap <= 0) {
      scene.enemyIdx += 1;
      continue;
    }

    const action = nextEnemyAction(battle, z, battle.rand);
    if (!action) {
      scene.enemyIdx += 1;
      continue;
    }

    const visible = isVisible(battle, z.x, z.y);

    if (action.type === 'wait') {
      z.ap = 0;
      scene.enemyIdx += 1;
      continue;
    }

    if (action.type === 'scream') {
      scene.jobs.push({ t: 'scream', unit: z, timer: 0 });
      return;
    }

    if (action.type === 'move') {
      z.ap -= 1;
      if (visible) {
        cameraPanTo(scene.cam, z.x, z.y);
        scene.jobs.push({ t: 'move', unit: z, path: [action.to], idx: 0, timer: 0 });
        return;
      }
      // Off-screen movement resolves instantly so turns stay brisk.
      z.x = action.to[0];
      z.y = action.to[1];
      refreshVision(battle);
      const triggers = overwatchTriggers(battle, z);
      if (triggers.length) {
        for (const tr of triggers) {
          tr.shooter.overwatch = false;
          scene.jobs.push({ t: 'attack', attacker: tr.shooter, target: tr.target, reaction: true, timer: 0 });
        }
        return;
      }
      continue;
    }

    if (action.type === 'attack') {
      cameraPanTo(scene.cam, z.x, z.y);
      scene.jobs.push({ t: 'attack', attacker: z, target: action.target, timer: 0 });
      scene.jobs.push({ t: 'pause', dur: 0.1 });
      return;
    }
  }

  finishEnemyTurn(scene);
}

function finishEnemyTurn(scene) {
  const { battle } = scene;
  if (squadWiped(battle)) return endRun(scene, 'wiped');

  const spawned = checkHeat(battle);
  if (spawned.length) {
    Sfx.alarm();
    scene.cam.shake = 0.5;
  }

  battle.phase = 'player';
  beginRound(battle);
  for (const u of battle.units) {
    if (u.side === 'player') u.overwatch = false;
  }

  if (squadWiped(battle)) return endRun(scene, 'wiped');

  const alive = battle.units.filter((u) => u.side === 'player' && u.state === 'idle');
  if (alive.length) scene.select(alive[0].id);
  scene.recomputeReach();
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function stepEffects(battle, tracers, dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t += dt * 4;
    if (tracers[i].t >= 1) tracers.splice(i, 1);
  }
  for (let i = battle.floaters.length - 1; i >= 0; i--) {
    battle.floaters[i].t += dt;
    if (battle.floaters[i].t >= battle.floaters[i].life) battle.floaters.splice(i, 1);
  }
  for (let i = battle.noisePings.length - 1; i >= 0; i--) {
    battle.noisePings[i].t += dt * 1.6;
    if (battle.noisePings[i].t >= 1) battle.noisePings.splice(i, 1);
  }
  for (const u of battle.units) {
    if (u.flash > 0) u.flash = Math.max(0, u.flash - dt * 2.4);
  }
}

export function addFloater(battle, x, y, text, color, size = 15) {
  battle.floaters.push({ x, y, text, color, size, t: 0, life: 1.1 });
}

export function pushLog(battle, text, tone = 'info') {
  battle.log.unshift({ text, tone });
  if (battle.log.length > 40) battle.log.length = 40;
}

// ---------------------------------------------------------------------------
// World overlays
// ---------------------------------------------------------------------------

function drawOverlays(scene, ctx, P, zoom) {
  const { battle } = scene;
  const u = scene.unit();

  // Reachable tiles.
  if (scene.reach && u && battle.phase === 'player' && !scene.job) {
    for (const [key, cost] of scene.reach) {
      if (cost === 0) continue;
      const x = key % battle.map.w;
      const y = Math.floor(key / battle.map.w);
      const a = 0.10 + 0.05 * (1 - cost / Math.max(1, u.ap));
      paintTile(ctx, P, zoom, x, y, `rgba(120,180,255,${a})`, null, 3);
    }
  }

  // Extraction / fallback pads always readable.
  const pads = [
    { x: battle.map.exit.x, y: battle.map.exit.y, c: 'rgba(79,180,119,0.35)' },
    { x: battle.map.entry.x, y: battle.map.entry.y, c: 'rgba(120,140,200,0.3)' },
  ];
  for (const pad of pads) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (!battle.seen[(pad.y + dy) * battle.map.w + pad.x + dx]) continue;
        paintTile(ctx, P, zoom, pad.x + dx, pad.y + dy, pad.c, null, 4);
      }
    }
  }

  // Path preview.
  if (scene.path && scene.path.length) {
    scene.path.forEach(([x, y], i) => {
      const last = i === scene.path.length - 1;
      paintTile(ctx, P, zoom, x, y,
        last ? 'rgba(232,163,61,0.45)' : 'rgba(232,163,61,0.22)',
        last ? Theme.accent : null, 4);
    });
    const end = scene.path[scene.path.length - 1];
    const p = P(end[0], end[1]);
    ctx.font = Theme.mono(13, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(`${scene.pathCost} AP`, p.x, p.y - 8);
    ctx.fillStyle = Theme.accent;
    ctx.fillText(`${scene.pathCost} AP`, p.x, p.y - 8);
  }

  // Medic mode highlights valid patients.
  if (scene.mode === 'medic' && u) {
    for (const other of battle.units) {
      if (other.side !== 'player' || other.state === 'dead') continue;
      if (other !== u && gridDist(u.x, u.y, other.x, other.y) > 1) continue;
      paintTile(ctx, P, zoom, other.x, other.y, 'rgba(79,180,119,0.3)', Theme.good, 3);
    }
  }

  // Hovered tile.
  if (scene.hover.x >= 0 && !scene.path) {
    paintTile(ctx, P, zoom, scene.hover.x, scene.hover.y, null, 'rgba(255,255,255,0.25)', 3);
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function drawTopBar(scene, ctx) {
  const { battle } = scene;
  ctx.fillStyle = 'rgba(10,13,18,0.94)';
  ctx.fillRect(0, 0, W, TOP_H);
  ctx.strokeStyle = Theme.border;
  ctx.beginPath();
  ctx.moveTo(0, TOP_H + 0.5);
  ctx.lineTo(W, TOP_H + 0.5);
  ctx.stroke();
  scene.hudRects.push({ x: 0, y: 0, w: W, h: TOP_H });

  label(ctx, battle.map.site.name.toUpperCase(), 16, 9, { size: 15, weight: 700, color: Theme.text });
  label(ctx, `DAY ${battle.day}`, 16, 28, { size: 11, weight: 600, color: Theme.textDim });

  const phaseText = battle.phase === 'player' ? 'YOUR MOVE' : 'THEIR MOVE';
  label(ctx, `ROUND ${battle.round}`, 200, 9, { size: 13, weight: 700, color: Theme.textDim });
  label(ctx, phaseText, 200, 27, {
    size: 12, weight: 800,
    color: battle.phase === 'player' ? Theme.good : Theme.bad,
  });

  // Heat / horde pressure.
  const hx = 330;
  label(ctx, 'HORDE PRESSURE', hx, 8, { size: 10, weight: 700, color: Theme.textDim });
  const frac = battle.heat / battle.heatMax;
  bar(ctx, hx, 22, 190, 12, battle.heat, battle.heatMax,
    frac > 0.75 ? Theme.bad : frac > 0.45 ? Theme.warn : Theme.info,
    { text: frac > 0.75 ? 'THEY KNOW' : `${Math.round(frac * 100)}%` });
  if (pointInRect(Input.x, Input.y, { x: hx, y: 8, w: 190, h: 28 })) {
    setTooltip('Gunfire and time raise this. At 100% a fresh pack arrives. Melee and suppressors keep it down.');
  }

  const stats = [
    ['KILLS', battle.kills, Theme.text],
    ['SALVAGE', Object.values(battle.loot.resources).reduce((a, b) => a + b, 0), Theme.accent],
    ['MEDIPACKS', battle.medipacks, Theme.good],
    ['WAVES', battle.waves, battle.waves ? Theme.bad : Theme.textDim],
  ];
  let sx = 560;
  for (const [name, val, col] of stats) {
    label(ctx, name, sx, 9, { size: 10, weight: 700, color: Theme.textFaint });
    label(ctx, String(val), sx, 24, { size: 16, weight: 800, color: col });
    sx += 92;
  }

  if (button(ctx, W - 176, 9, 78, 28, 'HELP', { size: 12, hotkey: 'h' })) scene.showHelp = true;

  const leaveOk = canExtract(battle) || canFallBack(battle);
  const leaveLabel = canExtract(battle) ? 'EXTRACT' : 'FALL BACK';
  if (button(ctx, W - 92, 9, 80, 28, leaveLabel, {
    size: 12, tone: canExtract(battle) ? 'good' : 'primary', disabled: !leaveOk, hotkey: 'x',
    tooltip: leaveOk
      ? canExtract(battle) ? 'Leave through the far pad. Bonus cache and extra XP.' : 'Retreat the way you came with whatever you carry.'
      : 'Every survivor still standing must be on the same pad.',
  })) {
    tryLeave(scene);
  }
}

function drawSquadBar(scene, ctx) {
  const { battle } = scene;
  const squad = battle.units.filter((u) => u.side === 'player');
  const cardW = 176;
  const cardH = 62;
  const y = H - BOTTOM_H + 6;

  squad.forEach((u, i) => {
    const x = 12 + i * (cardW + 8);
    const r = { x, y, w: cardW, h: cardH };
    scene.hudRects.push(r);
    const sel = u.id === scene.selectedId;
    const dead = u.state === 'dead';
    const down = u.state === 'down';

    ctx.fillStyle = sel ? Theme.panelHi : '#121720';
    roundRect(ctx, x, y, cardW, cardH, 5);
    ctx.fill();
    ctx.strokeStyle = dead ? '#3a2626' : sel ? Theme.accent : Theme.border;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.stroke();

    const cls = CLASSES[u.cls];
    ctx.fillStyle = dead ? '#4a3535' : cls.color;
    roundRect(ctx, x + 6, y + 6, 5, cardH - 12, 2);
    ctx.fill();

    label(ctx, u.name, x + 17, y + 7, {
      size: 13, weight: 700,
      color: dead ? Theme.textFaint : down ? Theme.bad : Theme.text,
    });
    label(ctx, dead ? 'DEAD' : down ? `BLEEDING ${u.bleed}` : cls.name, x + 17, y + 23, {
      size: 10, weight: 600, color: dead || down ? Theme.bad : Theme.textDim,
    });

    if (!dead) {
      bar(ctx, x + 17, y + 38, 88, 8, u.hp, u.hpMax,
        u.hp / u.hpMax > 0.5 ? Theme.good : u.hp / u.hpMax > 0.25 ? Theme.warn : Theme.bad,
        { text: `${u.hp}` });
      pips(ctx, x + 112, y + 38, Math.min(u.apMax, 6), u.ap, { size: 8, gap: 2 });
    }

    if (!dead && pointInRect(Input.x, Input.y, r) && takeClick()) {
      if (scene.mode === 'medic') {
        const healer = scene.unit();
        if (healer) useMedipack(scene, healer, u);
      } else if (!down) {
        scene.select(u.id);
      }
    }
  });
}

function drawBottomBackdrop(scene, ctx) {
  ctx.fillStyle = 'rgba(10,13,18,0.94)';
  ctx.fillRect(0, H - BOTTOM_H, W, BOTTOM_H);
  ctx.strokeStyle = Theme.border;
  ctx.beginPath();
  ctx.moveTo(0, H - BOTTOM_H + 0.5);
  ctx.lineTo(W, H - BOTTOM_H + 0.5);
  ctx.stroke();
  scene.hudRects.push({ x: 0, y: H - BOTTOM_H, w: W, h: BOTTOM_H });
}

function drawActionBar(scene, ctx) {
  const { battle } = scene;
  const u = scene.unit();
  const barY = H - BOTTOM_H + 74;

  // Weapon readout for the selected survivor.
  if (u && u.state === 'idle') {
    const w = activeWeapon(u);
    const wx = 12;
    if (w) {
      const st = weaponStats(w);
      label(ctx, weaponLabel(w).toUpperCase(), wx, barY - 2, { size: 12, weight: 700, color: Theme.accent });
      const line = w.kind === 'gun'
        ? `${st.dmg} dmg  ${st.acc}% acc  ${st.range} rng  ${st.ap} AP  ${w.loaded}/${st.mag}`
        : `${st.dmg} dmg  ${st.acc}% acc  reach 1  ${st.ap} AP`;
      label(ctx, line, wx, barY + 15, { size: 12, color: Theme.textDim, font: Theme.mono(12) });
      const durFrac = w.dur / w.durMax;
      label(ctx, `condition ${Math.round(durFrac * 100)}%`, wx, barY + 33, {
        size: 11, color: durFrac < 0.25 ? Theme.bad : Theme.textFaint,
      });
      if (w.kind === 'gun') {
        label(ctx, `reserve ${battle.ammoReserve[w.ammo] || 0} ${AMMO[w.ammo].short}`, wx + 120, barY + 33, {
          size: 11, color: Theme.textFaint,
        });
      }
    } else {
      label(ctx, 'UNARMED', wx, barY - 2, { size: 12, weight: 700, color: Theme.bad });
      label(ctx, 'Fists only: 4 damage, 60% accuracy.', wx, barY + 15, { size: 12, color: Theme.textDim });
    }
  }

  // Action buttons.
  const bw = 104;
  const bh = 34;
  const gap = 7;
  let bx = 330;
  const by = barY + 4;
  const active = u && u.state === 'idle' && battle.phase === 'player' && !scene.job;
  const w = u ? activeWeapon(u) : null;
  const st = w ? weaponStats(w) : null;

  const acts = [
    {
      key: 'r', text: 'RELOAD',
      ok: active && w && w.kind === 'gun' && u.ap >= (u.fastReload ? 1 : 2) && w.loaded < st.mag && (battle.ammoReserve[w.ammo] || 0) > 0,
      fn: () => doReload(scene, u),
      tip: `Refill the magazine. ${u && u.fastReload ? 1 : 2} AP.`,
    },
    {
      key: 'q', text: 'SWAP',
      ok: active && u.primary && u.melee && u.ap >= 1,
      fn: () => doSwap(scene, u),
      tip: 'Switch between your firearm and your melee weapon. 1 AP.',
    },
    {
      key: 'b', text: 'BRACE',
      ok: active && u.ap >= 1 && !u.braced,
      fn: () => doBrace(scene, u),
      tip: 'Steady yourself: +15 to hit until you move or attack. 1 AP.',
    },
    {
      key: 'e', text: 'OVERWATCH',
      ok: active && u.ap >= 2 && w && (w.kind !== 'gun' || w.loaded > 0),
      fn: () => doOverwatch(scene, u),
      tip: 'Spend the rest of your turn covering: fire at the first thing that moves into view.',
    },
    {
      key: 'f', text: `MEDIPACK ${battle.medipacks}`,
      ok: active && battle.medipacks > 0 && u.ap >= 2,
      fn: () => { scene.mode = scene.mode === 'medic' ? 'move' : 'medic'; },
      tip: 'Heal yourself or an adjacent survivor, or stabilise one who is down. 2 AP.',
      activeState: scene.mode === 'medic',
    },
  ];

  for (const a of acts) {
    if (button(ctx, bx, by, bw, bh, a.text, {
      size: 11, disabled: !a.ok, hotkey: a.key, tooltip: a.tip, active: a.activeState,
    })) a.fn();
    bx += bw + gap;
  }

  // Semi-auto: hand the walking and looting to the squad until something
  // happens that is worth a decision.
  const autoBlocked = haltReason(battle);
  if (button(ctx, W - 342, by, 166, bh, scene.auto ? 'TAKE CONTROL' : 'ADVANCE', {
    size: 13, tone: scene.auto ? 'danger' : 'good', hotkey: 'v',
    active: scene.auto,
    disabled: battle.phase !== 'player' || (!scene.auto && !!autoBlocked),
    tooltip: scene.auto
      ? 'Stop the squad and take over. Any click or key does this too.'
      : autoBlocked
        ? `Cannot advance: ${autoBlocked.toLowerCase()}`
        : 'The squad walks, loots and heads for extraction on its own, and stops the moment anything happens.',
  })) {
    if (scene.auto) stopAuto(scene, HALT.MANUAL);
    else startAuto(scene);
  }

  if (button(ctx, W - 168, by, 156, bh, 'END TURN', {
    size: 14, tone: 'primary', hotkey: ' ',
    disabled: battle.phase !== 'player' || !!scene.job,
    tooltip: 'Hand the street over to them. (Space)',
  })) {
    endPlayerPhase(scene);
  }

  if (scene.mode === 'medic') {
    label(ctx, 'Choose who to treat -- Esc to cancel', 330, by + bh + 6, {
      size: 11, weight: 600, color: Theme.good,
    });
  }
}

function drawAutoBanner(scene, ctx) {
  const y = TOP_H + 14;

  if (scene.auto) {
    const pulse = 0.55 + 0.45 * Math.sin(scene.time * 4);
    const w = 300;
    const x = W / 2 - w / 2;
    ctx.fillStyle = 'rgba(12,26,18,0.9)';
    roundRect(ctx, x, y, w, 40, 6);
    ctx.fill();
    ctx.strokeStyle = `rgba(79,180,119,${0.5 + pulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // A small marching indicator, so it reads as "running" at a glance.
    for (let i = 0; i < 3; i++) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(scene.time * 5 - i * 0.6));
      ctx.fillStyle = `rgba(79,180,119,${a})`;
      ctx.beginPath();
      ctx.arc(x + 22 + i * 11, y + 20, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    label(ctx, 'SQUAD ADVANCING', x + 66, y + 8, { size: 13, weight: 800, color: Theme.good });
    label(ctx, 'any click or key takes over', x + 66, y + 24, { size: 10.5, color: Theme.textDim });
    return;
  }

  if (scene.haltTimer > 0 && scene.haltNotice && scene.haltNotice !== HALT.MANUAL) {
    const a = clamp(scene.haltTimer / 0.6, 0, 1);
    ctx.font = Theme.font(15, 800);
    const w = ctx.measureText(scene.haltNotice).width + 44;
    const x = W / 2 - w / 2;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(30,12,12,0.92)';
    roundRect(ctx, x, y, w, 36, 6);
    ctx.fill();
    ctx.strokeStyle = Theme.bad;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    label(ctx, scene.haltNotice, W / 2, y + 18, {
      size: 14, weight: 800, color: Theme.bad, align: 'center', baseline: 'middle',
    });
    ctx.globalAlpha = 1;
  }
}

function drawLogPanel(scene, ctx) {
  const { battle } = scene;
  const pw = 300;
  const ph = 128;
  const px = W - pw - 12;
  const py = TOP_H + 12;
  scene.hudRects.push({ x: px, y: py, w: pw, h: ph });

  ctx.fillStyle = 'rgba(10,13,18,0.82)';
  roundRect(ctx, px, py, pw, ph, 6);
  ctx.fill();
  ctx.strokeStyle = Theme.border;
  ctx.stroke();

  const tones = { info: Theme.textDim, good: Theme.good, bad: Theme.bad, warn: Theme.warn };
  let ly = py + 9;
  for (let i = 0; i < 6 && i < battle.log.length; i++) {
    const e = battle.log[i];
    ctx.globalAlpha = 1 - i * 0.12;
    labelClipped(ctx, e.text, px + 10, ly, pw - 20, {
      size: 11.5, color: tones[e.tone] || Theme.textDim,
    });
    ly += 19;
  }
  ctx.globalAlpha = 1;
}

function drawTargetPanel(scene, ctx) {
  const t = scene.hoverUnit;
  const u = scene.unit();
  if (!t || !u || u.state !== 'idle') return;

  const def = ENEMIES[t.key];
  const pw = 250;
  const info = hitChance(scene.battle, u, t);
  const chk = scene.lastTargetInfo;
  const rows = info.breakdown.length;
  const ph = 112 + rows * 15;
  const px = clamp(Input.x + 20, 8, W - pw - 8);
  const py = clamp(Input.y - ph / 2, TOP_H + 8, H - BOTTOM_H - ph - 8);

  ctx.fillStyle = 'rgba(8,11,16,0.96)';
  roundRect(ctx, px, py, pw, ph, 6);
  ctx.fill();
  ctx.strokeStyle = Theme.bad;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  label(ctx, def.name.toUpperCase(), px + 12, py + 10, { size: 14, weight: 800, color: Theme.bad });
  label(ctx, `${t.hp}/${t.hpMax} HP${def.armor ? `   ${def.armor} armour` : ''}`, px + 12, py + 28, {
    size: 11, color: Theme.textDim, font: Theme.mono(11),
  });

  const w = activeWeapon(u);
  const st = w ? weaponStats(w) : null;
  const ok = chk && chk.ok;

  label(ctx, ok ? `${info.chance}%` : '--', px + pw - 12, py + 8, {
    size: 26, weight: 800, align: 'right',
    color: !ok ? Theme.textFaint : info.chance >= 70 ? Theme.good : info.chance >= 40 ? Theme.warn : Theme.bad,
  });
  label(ctx, 'to hit', px + pw - 12, py + 36, { size: 10, align: 'right', color: Theme.textFaint });

  let ly = py + 52;
  ctx.font = Theme.font(11);
  for (const b of info.breakdown) {
    ctx.textAlign = 'left';
    ctx.fillStyle = Theme.textFaint;
    ctx.fillText(b.label, px + 12, ly);
    ctx.textAlign = 'right';
    ctx.fillStyle = b.value >= 0 ? Theme.good : Theme.bad;
    ctx.fillText(`${b.value >= 0 ? '+' : ''}${b.value}`, px + pw - 12, ly);
    ly += 15;
  }

  ly += 4;
  if (st) {
    const lo = Math.round(st.dmg * 0.85);
    const hi = Math.round(st.dmg * 1.15);
    label(ctx, `Damage ${lo}-${hi}   Crit ${Math.round((st.crit + (u.critBonus || 0)) * 100)}%`, px + 12, ly, {
      size: 11, color: Theme.text, font: Theme.mono(11),
    });
    ly += 16;
  }
  if (!ok && chk) {
    label(ctx, chk.why, px + 12, ly, { size: 11, weight: 700, color: Theme.bad });
  } else {
    label(ctx, 'Click to attack', px + 12, ly, { size: 11, weight: 700, color: Theme.accent });
  }
}

function drawHelp(scene, ctx) {
  dim(ctx, 0.8);
  const pw = 640;
  const ph = 470;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  scene.hudRects.push({ x: px, y: py, w: pw, h: ph });
  panel(ctx, px, py, pw, ph, { title: 'How a run works', fill: Theme.panel });

  const lines = [
    ['V, or ADVANCE', 'Semi-auto: the squad walks, loots and heads for extraction by itself.'],
    ['', 'It stops the instant anything is spotted, anyone is hurt, or a wave lands.'],
    ['Left click a lit tile', 'Move there. Each tile costs one action point.'],
    ['Left click a zombie', 'Attack with the weapon in hand. Hover first to see the odds.'],
    ['1 / 2 / 3, Tab', 'Select a survivor.'],
    ['R / Q / B / E / F', 'Reload, swap weapon, brace, overwatch, medipack.'],
    ['Space', 'End the squad turn.'],
    ['X', 'Leave, once everyone still standing is on the same pad.'],
    ['WASD or arrows, wheel', 'Pan and zoom the camera.'],
    ['', ''],
    ['Cover', 'Standing behind a crate or a wall takes 20 or 40 off an attacker\'s roll.'],
    ['Noise', 'Guns are loud. Loud wakes the street and fills the horde meter.'],
    ['Going down', 'At zero health a survivor bleeds for three rounds. A medipack saves them.'],
    ['Falling back', 'Retreating from the entry pad is a real option -- you keep everything you carry.'],
    ['Extraction', 'The green pad pays a bonus cache and better experience. Worth the walk, usually.'],
  ];

  let ly = py + 46;
  for (const [k, v] of lines) {
    if (k) {
      label(ctx, k, px + 20, ly, { size: 12, weight: 700, color: Theme.accent });
      label(ctx, v, px + 210, ly, { size: 12, color: Theme.text });
    }
    ly += 26;
  }

  if (button(ctx, px + pw / 2 - 70, py + ph - 48, 140, 34, 'BACK', { tone: 'primary', hotkey: 'Escape' })) {
    scene.showHelp = false;
  }
}

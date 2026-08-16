// Procedural audio -- no asset files. Everything is oscillators and noise
// bursts shaped by gain envelopes.

let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

/** Browsers block audio until a user gesture; call this from a click handler. */
export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(m) {
  enabled = !m;
  if (master) master.gain.value = enabled ? 0.35 : 0;
}

export function isMuted() {
  return !enabled;
}

function envGain(t0, attack, decay, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(master);
  return g;
}

function tone(freq, dur, type = 'sine', peak = 0.5, slideTo = null) {
  if (!ensure() || !enabled) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = envGain(t0, 0.005, dur, peak);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

let noiseBuf = null;
function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate * 1.0;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noise(dur, peak = 0.4, filterHz = 1200, type = 'lowpass') {
  if (!ensure() || !enabled) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(filterHz, t0);
  const g = envGain(t0, 0.004, dur, peak);
  src.connect(filt);
  filt.connect(g);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export const Sfx = {
  click: () => tone(520, 0.05, 'square', 0.12),
  hover: () => tone(760, 0.025, 'sine', 0.05),
  deny: () => tone(180, 0.14, 'sawtooth', 0.16, 110),
  // Crafting
  hammerGood: () => {
    tone(340, 0.09, 'triangle', 0.35, 180);
    noise(0.1, 0.3, 2600, 'highpass');
  },
  hammerPerfect: () => {
    tone(680, 0.14, 'triangle', 0.4, 300);
    noise(0.12, 0.35, 3400, 'highpass');
  },
  hammerBad: () => {
    tone(120, 0.16, 'sawtooth', 0.3, 70);
    noise(0.14, 0.2, 500);
  },
  grind: () => noise(0.06, 0.12, 4200, 'highpass'),
  press: () => tone(240, 0.08, 'square', 0.28, 160),
  craftDone: () => {
    tone(523, 0.1, 'triangle', 0.3);
    setTimeout(() => tone(659, 0.1, 'triangle', 0.3), 90);
    setTimeout(() => tone(784, 0.22, 'triangle', 0.32), 180);
  },
  // Combat
  gunLight: () => {
    noise(0.13, 0.5, 2200, 'highpass');
    tone(160, 0.09, 'square', 0.3, 60);
  },
  gunShotgun: () => {
    noise(0.26, 0.6, 1100);
    tone(90, 0.2, 'sawtooth', 0.4, 45);
  },
  gunRifle: () => {
    noise(0.2, 0.55, 3000, 'highpass');
    tone(220, 0.14, 'square', 0.35, 70);
  },
  melee: () => {
    noise(0.1, 0.35, 900);
    tone(200, 0.09, 'triangle', 0.25, 110);
  },
  miss: () => noise(0.09, 0.16, 5200, 'highpass'),
  hurt: () => tone(150, 0.18, 'sawtooth', 0.3, 90),
  zombieDie: () => tone(190, 0.3, 'sawtooth', 0.28, 60),
  zombieGroan: () => tone(110, 0.4, 'sawtooth', 0.16, 82),
  heal: () => {
    tone(440, 0.12, 'sine', 0.25);
    setTimeout(() => tone(660, 0.16, 'sine', 0.25), 100);
  },
  loot: () => {
    tone(700, 0.07, 'square', 0.2);
    setTimeout(() => tone(950, 0.1, 'square', 0.2), 70);
  },
  alarm: () => {
    tone(300, 0.5, 'sawtooth', 0.3, 520);
  },
  extract: () => {
    tone(392, 0.14, 'triangle', 0.3);
    setTimeout(() => tone(523, 0.14, 'triangle', 0.3), 130);
    setTimeout(() => tone(784, 0.3, 'triangle', 0.34), 260);
  },
  death: () => {
    tone(220, 0.6, 'sawtooth', 0.35, 60);
    noise(0.5, 0.2, 400);
  },
};

// The cast.
//
// Portraits are the first thing in this project where a list in code has to
// agree with files on disk, so the first test here is the one that stops those
// two drifting apart. The rest cover the promises the roster makes: everyone
// gets a face, nobody shares one, and a campaign saved before any of this
// existed is dealt a hand rather than left blank.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assert, equal } from './harness.js';
import {
  PORTRAITS, PORTRAIT_KEYS, PORTRAIT_DIR, portraitSrc, pickPortrait, validPortrait,
} from '../src/data/portraits.js';
import { makeRng } from '../src/core/rng.js';
import { makeSurvivor } from '../src/game/survivors.js';
import { newGame, rehydrate } from '../src/core/state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the portrait manifest', () => {
  test('every listed portrait is a file, and every file is listed', () => {
    // The one invariant that cannot be checked by looking at the screen: a
    // manifest entry with no file is an empty frame, and a file with no entry
    // is art nobody will ever see.
    const dir = path.join(root, PORTRAIT_DIR);
    assert(fs.existsSync(dir), `${PORTRAIT_DIR} must exist -- run tools/derive-portraits.mjs`);
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'))
      .map((f) => path.basename(f, '.jpg')).sort();
    const listed = [...PORTRAIT_KEYS].sort();
    equal(listed.join(','), onDisk.join(','),
      'src/data/portraits.js and assets/portraits/ must agree');
  });

  test('the shipped copies are small enough to ship', () => {
    // 1024px masters are four times the pixels of the largest consumer. If the
    // derive step is ever skipped, this is what says so.
    const dir = path.join(root, PORTRAIT_DIR);
    let total = 0;
    for (const key of PORTRAIT_KEYS) {
      const bytes = fs.statSync(path.join(dir, `${key}.jpg`)).size;
      assert(bytes < 140 * 1024,
        `${key}.jpg is ${(bytes / 1024).toFixed(0)} KB -- masters were not downscaled`);
      total += bytes;
    }
    // Base64 is what the single-file build actually pays.
    assert(total * 4 / 3 < 1.4 * 1024 * 1024,
      `the set costs ${(total * 4 / 3 / 1048576).toFixed(2)} MB base64`);
  });

  test('keys are unique', () => {
    equal(new Set(PORTRAIT_KEYS).size, PORTRAITS.length);
  });

  test('a source is a path normally and the inlined data URI when there is one', () => {
    equal(portraitSrc('ch1_f'), `${PORTRAIT_DIR}/ch1_f.jpg`);
    globalThis.__PORTRAIT_URLS__ = { ch1_f: 'data:image/jpeg;base64,AAAA' };
    try {
      equal(portraitSrc('ch1_f'), 'data:image/jpeg;base64,AAAA',
        'the single-file build hands these in on the global');
      equal(portraitSrc('ch2_f'), `${PORTRAIT_DIR}/ch2_f.jpg`,
        'and anything it did not inline still resolves to a path');
    } finally {
      delete globalThis.__PORTRAIT_URLS__;
    }
  });
});

describe('dealing out faces', () => {
  test('a face is never reused while an unused one is left', () => {
    const rand = makeRng(7);
    const taken = [];
    for (let i = 0; i < PORTRAITS.length; i++) {
      const key = pickPortrait(rand, taken);
      assert(!taken.includes(key), `${key} was dealt twice`);
      assert(validPortrait(key));
      taken.push(key);
    }
    equal(taken.length, PORTRAITS.length, 'the whole set gets used before any repeat');
  });

  test('once they are all taken it repeats rather than failing', () => {
    // A roster can outgrow ten, and a duplicate face beats no face.
    const rand = makeRng(7);
    const key = pickPortrait(rand, [...PORTRAIT_KEYS]);
    assert(validPortrait(key), 'still a real portrait');
  });

  test('a new campaign starts with distinct names and distinct faces', () => {
    // Names could collide before portraits existed: 20 first names and 16
    // surnames is 320 pairs, so a starting trio matched about once in a
    // hundred campaigns. Swept rather than spot-checked.
    for (let seed = 1; seed <= 120; seed++) {
      const s = newGame(seed);
      const names = s.survivors.map((v) => v.name);
      const faces = s.survivors.map((v) => v.portrait);
      equal(new Set(names).size, names.length, `seed ${seed} dealt a duplicate name`);
      equal(new Set(faces).size, faces.length, `seed ${seed} dealt a duplicate face`);
      for (const f of faces) assert(validPortrait(f), `seed ${seed} dealt ${f}`);
    }
  });

  test('a recruit avoids the faces and names already at the workshop', () => {
    const s = newGame(3);
    const rand = makeRng(99);
    const sv = makeSurvivor('scout', rand, null, s.survivors);
    assert(!s.survivors.some((o) => o.portrait === sv.portrait), 'took a used face');
    assert(!s.survivors.some((o) => o.name === sv.name), 'took a used name');
  });
});

describe('saves written before the portraits existed', () => {
  test('get faces, without disturbing anything else', () => {
    const s = newGame(21);
    const names = s.survivors.map((v) => v.name);
    for (const sv of s.survivors) delete sv.portrait;

    rehydrate(s);
    const faces = s.survivors.map((v) => v.portrait);
    for (const f of faces) assert(validPortrait(f), `dealt ${f}`);
    equal(new Set(faces).size, faces.length, 'and they are distinct');
    equal(s.survivors.map((v) => v.name).join(','), names.join(','),
      'names are left alone -- this is a repair, not a reroll');
  });

  test('the same save always produces the same roster', () => {
    // Seeded from the campaign, so opening a save twice does not reshuffle
    // everyone's face.
    const faces = [];
    for (let i = 0; i < 2; i++) {
      const s = newGame(44);
      for (const sv of s.survivors) delete sv.portrait;
      rehydrate(s);
      faces.push(s.survivors.map((v) => v.portrait).join(','));
    }
    equal(faces[0], faces[1]);
  });

  test('a face already on a survivor is kept', () => {
    const s = newGame(5);
    const before = s.survivors.map((v) => v.portrait).join(',');
    rehydrate(s);
    equal(s.survivors.map((v) => v.portrait).join(','), before);
  });

  test('a portrait naming a file that no longer exists is replaced', () => {
    const s = newGame(6);
    s.survivors[0].portrait = 'ch99_x';
    rehydrate(s);
    assert(validPortrait(s.survivors[0].portrait), 'a stale key must not survive');
  });
});

// localStorage persistence. The whole campaign state is plain JSON by design.

import { State, rehydrate, SAVE_VERSION } from './state.js';

// Deliberately not renamed with the game. The key is a storage address, not a
// label, and changing it would silently orphan every campaign already in a
// browser -- a rename is not worth wiping saves over.
const KEY = 'zombiesmith.save.v1';

export function saveGame() {
  if (!State) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(State));
    return true;
  } catch (err) {
    console.warn('Save failed:', err);
    return false;
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    return rehydrate(data);
  } catch (err) {
    console.warn('Load failed:', err);
    return null;
  }
}

export function deleteSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing sensible to do */
  }
}

export function peekSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      day: d.day,
      alive: (d.survivors || []).filter((s) => s.status !== 'dead').length,
      runs: d.stats?.runs ?? 0,
    };
  } catch {
    return null;
  }
}

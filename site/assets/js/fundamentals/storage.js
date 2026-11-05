// Where your checklist settings are kept: one JSON file, ".dashboard/fundamentals-settings.json",
// in the notes store (IndexedDB in this browser). If notes sync is on, it travels with your notes to
// the same private repo, with no new token. If it's off, it stays in this browser only.
// Conflicts are merged by content and anything both sides changed is kept for you to review.
import * as store from '../notes/store.js';
import { getConfig } from '../notes/sync.js';
import { FUNDAMENTALS_SETTINGS, CONFLICT_DIR, stringify } from '../notes/system-files.js';
import { normalizeUser, setUserInMemory, getUser } from './settings.js';

let started = null;
let readError = null;

function readStored() {
  const f = store.getSystem(FUNDAMENTALS_SETTINGS);
  if (!f) { readError = null; return normalizeUser(null); }
  try { readError = null; return normalizeUser(JSON.parse(f.body)); } catch (e) {
    // never crash: fall back to the defaults and say so (the stored file is left as it is)
    readError = `Your saved checklist settings couldn’t be read (${e.message}), so the defaults are in use. Saving in Settings replaces them.`;
    return normalizeUser(null);
  }
}

/** Load your settings once and keep them current when another tab or a sync changes them. */
export function startSettings() {
  if (!started) {
    started = store.init().then(() => {
      setUserInMemory(readStored());
      let last = store.getSystem(FUNDAMENTALS_SETTINGS)?.body ?? null;
      store.subscribe(() => {
        const now = store.getSystem(FUNDAMENTALS_SETTINGS)?.body ?? null;
        if (now !== last) { last = now; setUserInMemory(readStored()); }
      });
    }).catch((e) => { readError = `Settings storage is unavailable (${e.message}); the defaults are in use.`; });
  }
  return started;
}
export const storageError = () => readError;

/** Save your settings (validated by the caller). */
export async function saveUser(next) {
  await store.init();
  const clean = { ...normalizeUser(next), updatedAt: new Date().toISOString() };
  await store.putSystem(FUNDAMENTALS_SETTINGS, stringify(clean));
  setUserInMemory(clean);
  return clean;
}

/** Where your settings live right now, in plain words. */
export function storageStatus() {
  const cfg = getConfig();
  return {
    persistent: store.isPersistent(),
    synced: Boolean(cfg),
    repo: cfg?.repo || null,
    last: store.getMeta('sync-last', null),
  };
}

/** Settings conflicts recorded by sync (both devices changed the same setting). */
export function settingsConflicts() {
  return store.allSystem().filter((f) => f.path.startsWith(`${CONFLICT_DIR}/fundamentals-settings`)).map((f) => {
    try { return { path: f.path, ...JSON.parse(f.body) }; } catch { return { path: f.path, conflicts: [], unreadable: true }; }
  });
}
export const dismissConflict = (path) => store.deleteSystem(path);

/** Export: your overrides as a JSON file's text. */
export function exportText() {
  return stringify({ kind: 'defi-dashboard/fundamentals-settings', exportedAt: new Date().toISOString(), ...getUser() });
}

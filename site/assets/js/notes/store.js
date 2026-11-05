// Notes storage: IndexedDB in this browser (nothing is sent anywhere unless sync is set up).
// Keeps everything in memory too, so reads are instant; writes go to IndexedDB.
// If IndexedDB is unavailable (some private windows), notes live in memory for this tab only.
import {
  normalizePath, basename, dirname, joinPath, isTrashed, TRASH, trashPathFor, restorePathFor, uniquePath,
  applyMoves, parseFrontmatter, setFrontmatter, composeNote,
} from './model.js';

const DB = 'defi-dashboard-notes';
const VERSION = 1;
let db = null;
let ready = null;
let persistent = true;
const notes = new Map(); // path → { path, body, created, updated }
const folders = new Set(); // explicit (possibly empty) folders
const meta = new Map();
const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('defi-dashboard-notes') : null;

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function tx(stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}

async function openDb() {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Notes storage is blocked by another tab'));
  });
}

async function loadAll() {
  notes.clear(); folders.clear(); meta.clear();
  if (!db) return;
  const t = tx(['notes', 'folders', 'meta']);
  const [ns, fs, ms] = await Promise.all([req(t.objectStore('notes').getAll()), req(t.objectStore('folders').getAll()), req(t.objectStore('meta').getAll())]);
  for (const n of ns) notes.set(n.path, n);
  for (const f of fs) folders.add(f.path);
  for (const m of ms) meta.set(m.key, m.value);
}

/** Open storage once. Resolves to { persistent }. */
export function init() {
  if (!ready) {
    ready = (async () => {
      try {
        db = await openDb();
        await loadAll();
      } catch (e) {
        console.warn('Notes: IndexedDB unavailable, keeping notes in memory for this tab', e);
        db = null;
        persistent = false;
      }
      if (channel) channel.onmessage = async () => { await loadAll(); emit({ remote: true }); };
      return { persistent };
    })();
  }
  return ready;
}
export const isPersistent = () => persistent;

function emit(detail = {}) {
  for (const fn of listeners) { try { fn(detail); } catch (e) { console.error(e); } }
}
/** Call `fn` after any change (here or in another tab). Returns an unsubscribe function. */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function write(ops) {
  if (db) {
    const t = tx(['notes', 'folders', 'meta'], 'readwrite');
    for (const [store, op, val] of ops) {
      const s = t.objectStore(store);
      if (op === 'put') s.put(val); else s.delete(val);
    }
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  channel?.postMessage('changed');
  emit();
}

// ---------- reads ----------
export const allNotes = () => [...notes.values()];
export const liveNotes = () => allNotes().filter((n) => !isTrashed(n.path));
export const trashedNotes = () => allNotes().filter((n) => isTrashed(n.path));
export const getNote = (path) => notes.get(path) || null;
export const hasPath = (path) => [...notes.keys()].some((p) => p.toLowerCase() === String(path).toLowerCase());
/** Every folder: explicit ones plus those implied by note paths (trash excluded). */
export function allFolders() {
  const set = new Set([...folders].filter((f) => !isTrashed(f)));
  for (const n of liveNotes()) { let d = dirname(n.path); while (d) { set.add(d); d = dirname(d); } }
  return [...set].sort((a, b) => a.localeCompare(b));
}
export const getMeta = (key, dflt = null) => (meta.has(key) ? meta.get(key) : dflt);
export async function setMeta(key, value) {
  meta.set(key, value);
  if (db) { const t = tx(['meta'], 'readwrite'); t.objectStore('meta').put({ key, value }); await new Promise((r) => { t.oncomplete = r; t.onerror = r; }); }
}

// ---------- writes ----------
const nowIso = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

/** Create a note. Returns its (possibly de-duplicated) path. */
export async function createNote(folder, name, content = '', { frontmatter = true, extra = {} } = {}) {
  const path = uniquePath(joinPath(folder, name), notes.keys());
  const t = Date.now();
  const body = frontmatter ? composeNote(content, {}, { created: nowIso(), updated: nowIso(), ...extra }) : content;
  const note = { path, body, created: t, updated: t };
  notes.set(path, note);
  await write([['notes', 'put', note]]);
  await touchRecent(path);
  return path;
}

/** Save a note's text. If its frontmatter has `updated`, that is refreshed too. */
export async function saveNote(path, body) {
  const old = notes.get(path);
  if (!old) throw new Error(`No note at ${path}`);
  if (old.body === body) return old;
  const fm = parseFrontmatter(body);
  const finalBody = fm.hasFrontmatter && 'updated' in fm.data ? setFrontmatter(body, { updated: nowIso() }) : body;
  const note = { ...old, body: finalBody, updated: Date.now() };
  notes.set(path, note);
  await write([['notes', 'put', note]]);
  return note;
}

/** Write raw bodies (sync and import use this; timestamps come from the caller). */
export async function putRaw(list) {
  const ops = [];
  for (const n of list) {
    const prev = notes.get(n.path);
    const note = { path: n.path, body: n.body, created: n.created || prev?.created || Date.now(), updated: n.updated || Date.now() };
    notes.set(n.path, note);
    ops.push(['notes', 'put', note]);
  }
  if (ops.length) await write(ops);
}
export async function deleteRaw(paths) {
  const ops = [];
  for (const p of paths) if (notes.delete(p)) ops.push(['notes', 'delete', p]);
  if (ops.length) await write(ops);
}

/** Move notes (and update links to them everywhere). `moves`: Map old → new path. */
export async function moveNotes(moves) {
  const clean = new Map([...moves].filter(([a, b]) => a !== b && notes.has(a)));
  if (!clean.size) return;
  const { changed } = applyMoves(allNotes(), clean);
  const ops = [];
  for (const [oldPath, newPath] of clean) {
    const n = notes.get(oldPath);
    notes.delete(oldPath);
    ops.push(['notes', 'delete', oldPath]);
    const moved = { ...n, path: newPath, body: changed.get(newPath) ?? n.body, updated: Date.now() };
    notes.set(newPath, moved);
    ops.push(['notes', 'put', moved]);
  }
  for (const [p, body] of changed) {
    if ([...clean.values()].includes(p)) continue;
    const n = notes.get(p);
    if (!n) continue;
    const upd = { ...n, body, updated: Date.now() };
    notes.set(p, upd);
    ops.push(['notes', 'put', upd]);
  }
  await write(ops);
  const recent = getMeta('recent', []).map((p) => clean.get(p) || p);
  await setMeta('recent', recent);
}

export async function renameNote(path, newName) {
  const target = uniquePath(joinPath(dirname(path), newName), [...notes.keys()].filter((p) => p !== path));
  await moveNotes(new Map([[path, target]]));
  return target;
}
export async function moveNoteToFolder(path, folder) {
  const target = uniquePath(joinPath(folder, basename(path)), [...notes.keys()].filter((p) => p !== path));
  await moveNotes(new Map([[path, target]]));
  return target;
}

/** Deleting moves to `.trash/` (keeping the folder structure) so it can be restored. */
export async function trashNote(path) {
  const target = uniquePath(trashPathFor(path), notes.keys());
  await moveNotes(new Map([[path, target]]));
  return target;
}
export async function restoreNote(trashedPath) {
  const target = restorePathFor(trashedPath, [...notes.keys()].filter((p) => p !== trashedPath));
  await moveNotes(new Map([[trashedPath, target]]));
  return target;
}
export async function deleteForever(paths) { await deleteRaw(paths.filter(isTrashed)); }
export async function emptyTrash() { await deleteForever(trashedNotes().map((n) => n.path)); }

// ---------- folders ----------
export async function createFolder(path) {
  const p = normalizePath(path).replace(/\.md$/i, '');
  if (!p || isTrashed(p)) return null;
  folders.add(p);
  await write([['folders', 'put', { path: p }]]);
  return p;
}
const under = (p, folder) => p === folder || p.startsWith(`${folder}/`);
/** Rename or move a folder: every note inside moves, and links follow. */
export async function moveFolder(folder, newFolder) {
  const nf = normalizePath(newFolder).replace(/\.md$/i, '');
  if (!nf || nf === folder || under(nf, folder)) return folder;
  const moves = new Map();
  for (const p of notes.keys()) if (p.startsWith(`${folder}/`)) moves.set(p, `${nf}/${p.slice(folder.length + 1)}`);
  await moveNotes(moves);
  const ops = [];
  for (const f of [...folders]) {
    if (under(f, folder)) { folders.delete(f); ops.push(['folders', 'delete', f]); const g = nf + f.slice(folder.length); folders.add(g); ops.push(['folders', 'put', { path: g }]); }
  }
  if (!folders.has(nf)) { folders.add(nf); ops.push(['folders', 'put', { path: nf }]); }
  await write(ops);
  return nf;
}
/** Deleting a folder sends its notes to the trash and forgets the folder. */
export async function deleteFolder(folder) {
  const moves = new Map();
  for (const p of notes.keys()) if (p.startsWith(`${folder}/`) && !isTrashed(p)) moves.set(p, uniquePath(trashPathFor(p), notes.keys()));
  await moveNotes(moves);
  const ops = [];
  for (const f of [...folders]) if (under(f, folder)) { folders.delete(f); ops.push(['folders', 'delete', f]); }
  await write(ops);
}

// ---------- pins (in frontmatter, so they sync) and recents (this browser only) ----------
export const isPinned = (path) => parseFrontmatter(getNote(path)?.body || '').data.pinned === true;
export async function setPinned(path, on) {
  const n = getNote(path);
  if (!n) return;
  const note = { ...n, body: setFrontmatter(n.body, { pinned: on ? true : null }), updated: Date.now() };
  notes.set(path, note);
  await write([['notes', 'put', note]]);
}
export const pinnedNotes = () => liveNotes().filter((n) => isPinned(n.path)).sort((a, b) => a.path.localeCompare(b.path));
export async function touchRecent(path) {
  const r = [path, ...getMeta('recent', []).filter((p) => p !== path)].slice(0, 12);
  await setMeta('recent', r);
}
export const recentNotes = () => getMeta('recent', []).map(getNote).filter((n) => n && !isTrashed(n.path));

export { TRASH };

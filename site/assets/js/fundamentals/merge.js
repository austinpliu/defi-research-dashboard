// Pure merge rules for the checklist settings (unit-tested in tests/fundamentals-settings.test.mjs).
// Defaults live in the public repo; your edits are stored as overrides on top of them:
//   thresholds: { key: value } for the ones you changed
//   lists:      { entries: [your added or edited entries], deleted: [ids of defaults you removed] }
// So defaults added to the repo later still show up for you, unless you deleted that id.

export const isHttpUrl = (u) => {
  if (typeof u !== 'string') return false;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
};
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const slugOk = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(s);

/** A stable id for an entry: its own id, or protocol + first source. */
export function entryId(e) {
  if (e?.id) return String(e.id);
  const src = e?.source || (Array.isArray(e?.sources) ? e.sources[0] : '') || '';
  return `${e?.protocol || '?'}|${src}`;
}

/** Problems with one entry, as plain sentences (empty when it's fine). */
export function validateEntry(kind, e) {
  const out = [];
  if (!slugOk(e?.protocol)) out.push('Choose the protocol it’s about.');
  if (kind === 'valueAccrual') {
    if (!e?.what || !String(e.what).trim()) out.push('Say in one sentence what was announced.');
    if (!isHttpUrl(e?.source)) out.push('Add a source link starting with http:// or https://.');
    if (e?.status && !['proposed', 'approved', 'live'].includes(e.status)) out.push('Status must be proposed, approved or live.');
    if (e?.date && !isDate(e.date)) out.push('The announcement date must look like 2026-11-05.');
  } else {
    if (!e?.text || !String(e.text).trim()) out.push('Write the note.');
    const srcs = Array.isArray(e?.sources) ? e.sources : [];
    if (!srcs.length) out.push('Add at least one source link.');
    if (srcs.some((u) => !isHttpUrl(u))) out.push('Every source link must start with http:// or https://.');
  }
  if (!isDate(e?.lastChecked)) out.push('Add the date you last checked it, like 2026-11-05.');
  return out;
}

/**
 * Defaults with your overrides applied. Invalid entries are left out with a message (never thrown).
 * Returns { entries (each with id and origin 'default' | 'yours' | 'edited'), errors, custom }.
 */
export function effectiveEntries(defaults, over, kind) {
  const errors = [];
  const deleted = new Set(over?.deleted || []);
  const mine = new Map();
  for (const e of over?.entries || []) mine.set(entryId(e), e);
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(defaults) ? defaults : []) {
    const id = entryId(d);
    seen.add(id);
    if (deleted.has(id)) continue;
    const e = mine.has(id) ? { ...mine.get(id), id, origin: 'edited' } : { ...d, id, origin: 'default' };
    const bad = validateEntry(kind, e);
    if (bad.length) { errors.push(`${label(kind)} for “${e.protocol || '?'}” was skipped: ${bad.join(' ')}`); continue; }
    out.push(e);
  }
  for (const [id, e] of mine) {
    if (seen.has(id) || deleted.has(id)) continue;
    const bad = validateEntry(kind, e);
    if (bad.length) { errors.push(`${label(kind)} for “${e.protocol || '?'}” was skipped: ${bad.join(' ')}`); continue; }
    out.push({ ...e, id, origin: 'yours' });
  }
  return { entries: out, errors, custom: deleted.size > 0 || mine.size > 0 };
}
const label = (kind) => (kind === 'valueAccrual' ? 'A value-accrual entry' : 'A team note');

/** Save an entry edit into the overrides (returns new overrides; never mutates). */
export function upsertEntry(over, entry, { replacing } = {}) {
  const entries = (over?.entries || []).filter((e) => entryId(e) !== (replacing || entryId(entry)) && entryId(e) !== entryId(entry));
  const id = entry.id || replacing || entryId(entry);
  const deleted = (over?.deleted || []).filter((d) => d !== id);
  const clean = { ...entry, id };
  delete clean.origin;
  return { entries: [...entries, clean], deleted };
}

/** Remove an entry: yours are dropped; a default is remembered as deleted. */
export function removeEntry(over, id, isDefault) {
  const entries = (over?.entries || []).filter((e) => entryId(e) !== id);
  const deleted = new Set(over?.deleted || []);
  if (isDefault) deleted.add(id);
  return { entries, deleted: [...deleted] };
}

/**
 * Three-way merge of two versions of the settings file (this browser vs the synced repo),
 * given the last version both agreed on. Used by sync so neither side is silently overwritten.
 * Per threshold key and per entry id: a change on one side wins; the same change on both is fine;
 * different changes on both sides are a conflict, and the result keeps *yours* while reporting it.
 * Returns { merged, conflicts: [{ kind, key, mine, theirs }] }.
 */
export function mergeSettings(base, mine, theirs) {
  const b = base || {};
  const conflicts = [];
  const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const pick = (kind, key, bv, mv, tv) => {
    if (same(mv, tv)) return mv;
    if (same(mv, bv)) return tv;
    if (same(tv, bv)) return mv;
    conflicts.push({ kind, key, mine: mv ?? null, theirs: tv ?? null });
    return mv;
  };
  const thresholds = {};
  const tKeys = new Set([...Object.keys(b.thresholds || {}), ...Object.keys(mine?.thresholds || {}), ...Object.keys(theirs?.thresholds || {})]);
  for (const k of tKeys) {
    const v = pick('threshold', k, b.thresholds?.[k], mine?.thresholds?.[k], theirs?.thresholds?.[k]);
    if (v !== undefined && v !== null) thresholds[k] = v;
  }
  const list = (name) => {
    const byId = (x) => new Map((x?.[name]?.entries || []).map((e) => [entryId(e), e]));
    const del = (x) => new Set(x?.[name]?.deleted || []);
    const [bm, mm, tm] = [byId(b), byId(mine), byId(theirs)];
    const [bd, md, td] = [del(b), del(mine), del(theirs)];
    const entries = [];
    const deleted = [];
    for (const id of new Set([...bm.keys(), ...mm.keys(), ...tm.keys(), ...bd, ...md, ...td])) {
      const state = (m, d) => (d.has(id) ? { deleted: true } : m.get(id) ?? null);
      const v = pick(name, id, state(bm, bd), state(mm, md), state(tm, td));
      if (v?.deleted) deleted.push(id);
      else if (v) entries.push(v);
    }
    return { entries, deleted };
  };
  return { merged: { version: 1, thresholds, valueAccrual: list('valueAccrual'), teamNotes: list('teamNotes') }, conflicts };
}

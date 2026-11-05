// Fundamentals Checklist settings: the public defaults (site/config/*.json) plus your own
// overrides, which apply only to you. The merge rules are pure and unit-tested (merge.js);
// this file loads the defaults and holds the current user settings in memory.
import { effectiveThresholds } from './rules.js';
import { effectiveEntries } from './merge.js';

const FILES = { thresholds: 'fundamentals-thresholds.json', valueAccrual: 'value-accrual.json', teamNotes: 'team-notes.json' };
let defaultsP = null;

async function loadConfig(name) {
  const r = await fetch(`config/${name}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`config/${name}: HTTP ${r.status}`);
  return r.json();
}

/** The defaults from the public repo. Never throws: a file that fails to load is reported in `errors`. */
export function loadDefaults() {
  if (!defaultsP) {
    defaultsP = Promise.all(Object.entries(FILES).map(async ([k, f]) => {
      try { return [k, await loadConfig(f)]; } catch (e) { return [k, null, `Couldn’t load the default ${f} (${e.message}).`]; }
    })).then((list) => {
      const out = { errors: [] };
      for (const [k, v, err] of list) { out[k] = v; if (err) out.errors.push(err); }
      if (!out.thresholds) defaultsP = null; // try again next time
      return out;
    });
  }
  return defaultsP;
}

// ---------- your overrides (in memory here; stored and synced by storage.js) ----------
let user = { version: 1, thresholds: {}, valueAccrual: { entries: [], deleted: [] }, teamNotes: { entries: [], deleted: [] } };
const listeners = new Set();
export const getUser = () => user;
export function setUserInMemory(next) { user = normalizeUser(next); listeners.forEach((fn) => fn(user)); }
export function onUserChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Shape-check a user settings object; anything unusable becomes empty rather than throwing. */
export function normalizeUser(u) {
  const list = (x) => ({
    entries: Array.isArray(x?.entries) ? x.entries.filter((e) => e && typeof e === 'object') : [],
    deleted: Array.isArray(x?.deleted) ? x.deleted.filter((d) => typeof d === 'string') : [],
  });
  const th = u && typeof u.thresholds === 'object' && !Array.isArray(u.thresholds) ? u.thresholds : {};
  return { version: 1, thresholds: { ...th }, valueAccrual: list(u?.valueAccrual), teamNotes: list(u?.teamNotes), ...(u?.updatedAt ? { updatedAt: u.updatedAt } : {}) };
}

/**
 * Everything the checklist needs: threshold values (validated, with fallbacks), the merged
 * value-accrual plans and team notes, and what to tell you (errors, what you changed).
 */
export function effective(defaults, u = user) {
  const th = effectiveThresholds(defaults?.thresholds, u.thresholds);
  const va = effectiveEntries(defaults?.valueAccrual?.entries, u.valueAccrual, 'valueAccrual');
  const tn = effectiveEntries(defaults?.teamNotes?.entries, u.teamNotes, 'teamNotes');
  return {
    values: th.values,
    changed: th.changed,
    errors: [...(defaults?.errors || []), ...th.errors.map((e) => e.message), ...va.errors, ...tn.errors],
    valueAccrual: va.entries,
    teamNotes: tn.entries,
    custom: th.changed.length > 0 || va.custom || tn.custom,
  };
}

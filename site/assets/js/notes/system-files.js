// Dashboard settings files synced alongside the notes, in a ".dashboard/" folder of the same
// private repo (no extra token). They are JSON, so a conflict is resolved by a three-way merge
// of their contents instead of a "(conflict …)" note. Pure and unit-tested.
import { mergeSettings } from '../fundamentals/merge.js';

export const SYSTEM_DIR = '.dashboard';
/** ".dashboard/name.json" or ".dashboard/conflicts/name.json" */
export const isSystemPath = (p) => /^\.dashboard\/(?:conflicts\/)?[^/]+\.json$/.test(String(p));
export const FUNDAMENTALS_SETTINGS = '.dashboard/fundamentals-settings.json';
export const CONFLICT_DIR = '.dashboard/conflicts';

// which merge to use for which file
const MERGERS = { 'fundamentals-settings.json': mergeSettings };

const parse = (text) => { if (text == null) return null; try { return JSON.parse(text); } catch { return undefined; } };
export const stringify = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

/**
 * Both this browser and the repo changed a settings file since the last sync.
 * Returns { text: merged file (yours wins where both changed the same thing),
 *           conflict: null | { path, text } a record of what the other side had, to show you }.
 */
export function resolveSystemConflict(path, baseText, mineText, theirsText, stamp, taken = new Set()) {
  const name = path.split('/').pop();
  const merge = MERGERS[name];
  const [b, m, t] = [parse(baseText), parse(mineText), parse(theirsText)];
  const recordPath = () => {
    let p = `${CONFLICT_DIR}/${name.replace(/\.json$/, '')} ${stamp}.json`;
    for (let i = 2; taken.has(p.toLowerCase()); i += 1) p = `${CONFLICT_DIR}/${name.replace(/\.json$/, '')} ${stamp} ${i}.json`;
    return p;
  };
  if (!merge || m === undefined || t === undefined) {
    // unknown file or unreadable JSON: keep yours, keep theirs whole in the record
    return { text: mineText, conflict: { path: recordPath(), text: stringify({ file: path, at: stamp, whole: true, theirs: t === undefined ? theirsText : t, conflicts: [] }) } };
  }
  const { merged, conflicts } = merge(b === undefined ? null : b, m, t);
  return {
    text: stringify({ ...merged, updatedAt: new Date().toISOString() }),
    conflict: conflicts.length ? { path: recordPath(), text: stringify({ file: path, at: stamp, conflicts }) } : null,
  };
}

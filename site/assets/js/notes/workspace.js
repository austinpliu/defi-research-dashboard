// Shared notes actions used by the notes page, the side panel and quick capture.
import * as store from './store.js';
import { TEMPLATES, fillTemplate, joinPath, uniquePath, basename, invalidNameReason, dirname } from './model.js';
import { askText } from './dialog.js';

export const noteHref = (path) => `#/notes/${encodeURIComponent(path)}`;
const pad = (n) => String(n).padStart(2, '0');
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Templates: the built-in ones plus any note in a "Templates" folder (Obsidian's convention). */
export function allTemplates() {
  const user = store.liveNotes().filter((n) => /^templates\//i.test(n.path)).map((n) => ({ id: `user:${n.path}`, label: basename(n.path), folder: '', body: n.body.replace(/^---[\s\S]*?---\n/, ''), user: true }));
  return [...TEMPLATES, ...user];
}

/**
 * Create a note and return its path.
 * opts: { name, folder, template (id), vars: { link, tag, title, name, symbol }, ask }
 */
export async function newNote(opts = {}) {
  await store.init();
  const tpl = allTemplates().find((t) => t.id === (opts.template || 'blank')) || TEMPLATES[0];
  const folder = opts.folder ?? tpl.folder ?? '';
  let name = opts.name || (opts.vars?.title ? `${opts.vars.title}${tpl.id === 'blank' ? '' : ` ${tpl.label.toLowerCase()}`}` : tpl.id === 'blank' ? 'Untitled' : tpl.label);
  name = name.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'Untitled';
  if (opts.ask) {
    const v = await askText({ title: 'New note', label: 'Name', value: name, ok: 'Create', validate: invalidNameReason });
    if (v === null) return null;
    name = v;
  }
  const d = new Date();
  const content = fillTemplate(tpl.body, { date: d.toISOString().slice(0, 10), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, title: name, ...(opts.vars || {}) });
  return store.createNote(folder, name, content);
}

/** Create the note a [[link]] points at (from the preview), next to the note it came from. */
export async function createLinked(target, fromPath) {
  await store.init();
  const clean = target.replace(/[\\:*?"<>|#^[\]]/g, '-');
  const folder = clean.includes('/') ? dirname(clean) : dirname(fromPath || '');
  const existing = store.liveNotes().find((n) => n.path.toLowerCase() === joinPath(folder, basename(clean)).toLowerCase());
  if (existing) return existing.path;
  return store.createNote(folder, basename(clean), '');
}

/** Quick capture: a blank note in Inbox/, named by date and time. */
export async function quickNote(content = '') {
  await store.init();
  const path = uniquePath(joinPath('Inbox', stamp()), store.allNotes().map((n) => n.path));
  return store.createNote('Inbox', basename(path), content);
}

/** Markdown link back to the dashboard page being looked at. */
export function pageLink(title = document.title) {
  const hash = location.hash || '#/';
  const label = String(title || 'Dashboard page').replace(/\s*[|·–-]\s*DeFi Research Dashboard$/, '').replace(/[[\]]/g, '') || 'Dashboard page';
  return `[${label}](${hash.replace(/\)/g, '%29').replace(/\s/g, '%20')})`;
}

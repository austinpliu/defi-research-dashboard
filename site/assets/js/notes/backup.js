// Export (zip of markdown, opens as an Obsidian vault), import (zip or .md files), and the
// sync settings dialog. Nothing here sends notes anywhere except, if you set up sync,
// to your own private GitHub repository.
import { h, svgIcon } from '../ui.js';
import * as store from './store.js';
import { writeZip, readZip } from './zip.js';
import { normalizePath, uniquePath, joinPath, dirname, basename } from './model.js';
import { getConfig, setConfig, checkConfig, syncNow, turnOff, startAutoSync } from './sync.js';
import { toast, confirmBox } from './dialog.js';
import { relative } from '../format.js';

export function exportAll() {
  const notes = store.allNotes();
  const folders = store.allFolders().filter((f) => !notes.some((n) => n.path.startsWith(`${f}/`)));
  const zip = writeZip([...folders.map((f) => ({ name: `${f}/`, data: '' })), ...notes.map((n) => ({ name: n.path, data: n.body, date: n.updated }))]);
  const blob = new Blob([zip], { type: 'application/zip' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `defi-notes-${new Date().toISOString().slice(0, 10)}.zip` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Exported ${notes.length} note${notes.length === 1 ? '' : 's'}`);
}

/** Import .md files or zips. Never overwrites: a different note at the same path is saved as "(imported)". */
export async function importFiles(fileList) {
  await store.init();
  const entries = [];
  for (const f of fileList) {
    if (/\.zip$/i.test(f.name)) for (const e of await readZip(await f.arrayBuffer())) entries.push({ name: e.name, text: new TextDecoder().decode(e.data) });
    else if (/\.md$/i.test(f.name)) entries.push({ name: f.webkitRelativePath || f.name, text: await f.text() });
  }
  let md = entries.filter((e) => /\.md$/i.test(e.name) && !/(^|\/)\.obsidian\//.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name));
  const skipped = entries.length - md.length;
  // a zip of "MyVault/…" imports as the vault's contents, not into a MyVault folder
  const tops = new Set(md.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')));
  if (tops.size === 1 && [...tops][0] && md.every((e) => e.name.includes('/'))) md = md.map((e) => ({ ...e, name: e.name.slice(e.name.indexOf('/') + 1) }));
  const taken = new Set(store.allNotes().map((n) => n.path.toLowerCase()));
  const list = [];
  let same = 0;
  let renamed = 0;
  for (const e of md) {
    let path = normalizePath(e.name);
    if (!path) continue;
    const existing = store.allNotes().find((n) => n.path.toLowerCase() === path.toLowerCase());
    if (existing && existing.body === e.text) { same += 1; continue; }
    if (existing || taken.has(path.toLowerCase())) { path = uniquePath(joinPath(dirname(path), `${basename(path)} (imported)`), taken); renamed += 1; }
    taken.add(path.toLowerCase());
    list.push({ path, body: e.text, updated: Date.now() });
  }
  await store.putRaw(list);
  toast(`Imported ${list.length} note${list.length === 1 ? '' : 's'}${renamed ? `, ${renamed} saved as “(imported)” next to a different note of the same name` : ''}${same ? `, ${same} already here` : ''}${skipped ? `, ${skipped} non-note file${skipped === 1 ? '' : 's'} skipped` : ''}`);
  return { imported: list.length, renamed, same, skipped };
}

export function importButton() {
  const input = h('input', { type: 'file', accept: '.zip,.md,application/zip,text/markdown', multiple: true, hidden: true });
  input.addEventListener('change', async () => { try { await importFiles([...input.files]); } catch (e) { toast(e.message, { error: true }); } input.value = ''; });
  return h('span', {}, input, h('button', { type: 'button', class: 'tool', onclick: () => input.click(), title: 'Import a zip (e.g. an Obsidian vault) or .md files' }, 'Import'));
}
export const exportButton = () => h('button', { type: 'button', class: 'tool', onclick: exportAll, title: 'Download every note as a zip of markdown files' }, svgIcon('csv'), 'Export');

/** Header chip: sync state; opens the settings. */
export function syncButton() {
  const cfg = getConfig();
  const last = store.getMeta('sync-last');
  const label = !cfg ? 'Sync: off' : last?.error ? 'Sync problem' : last?.at ? `Synced ${relative(last.at)}` : 'Sync';
  const b = h('button', { type: 'button', class: `tool${cfg && last?.error ? ' danger' : ''}`, onclick: openSyncSettings, title: cfg ? `Syncing with ${cfg.repo}` : 'Keep notes in step across devices through your own private GitHub repository' }, svgIcon('sync'), label);
  return b;
}

/** Banner on the notes page when sync kept two versions of a note. */
export function conflictBanner() {
  const list = (store.getMeta('sync-conflicts', []) || []).filter((c) => store.getNote(c.copy));
  if (!list.length) return null;
  return h('div', { class: 'notice', style: { marginBottom: '12px' } },
    h('b', {}, `Sync kept two versions of ${list.length} note${list.length === 1 ? '' : 's'}. `),
    'Both copies are safe. Open each “(conflict …)” note, merge what you need into the original, then delete the copy: ',
    ...list.flatMap((c, i) => [i ? ', ' : '', h('a', { href: `#/notes/${encodeURIComponent(c.copy)}` }, basename(c.copy))]));
}

export function openSyncSettings() {
  const cfg = getConfig() || {};
  const repo = h('input', { class: 'nd-input', value: cfg.repo || '', placeholder: 'yourname/research-notes', 'aria-label': 'Private repository', autocomplete: 'off' });
  const token = h('input', { class: 'nd-input', type: 'password', value: cfg.token || '', placeholder: 'github_pat_…', 'aria-label': 'Fine-grained personal access token', autocomplete: 'off' });
  const branch = h('input', { class: 'nd-input', value: cfg.branch || '', placeholder: 'default branch', 'aria-label': 'Branch (optional)' });
  const dir = h('input', { class: 'nd-input', value: cfg.dir || '', placeholder: 'whole repository', 'aria-label': 'Folder in the repository (optional)' });
  const err = h('div', { class: 'nd-err', role: 'alert' });
  const last = store.getMeta('sync-last');
  const close = () => dlg.remove();
  const save = async () => {
    err.textContent = 'Checking…';
    try {
      const ok = await checkConfig({ repo: repo.value, token: token.value.trim(), branch: branch.value.trim(), dir: dir.value.trim() });
      setConfig(ok);
      err.textContent = '';
      close();
      toast(`Syncing with ${ok.repo}…`);
      startAutoSync();
      const r = await syncNow();
      toast(r.error ? `Sync problem: ${r.error}` : `Synced: ${r.pulled} down, ${r.pushed} up${r.conflicts.length ? `, ${r.conflicts.length} conflict${r.conflicts.length === 1 ? '' : 's'} kept as copies` : ''}`, { error: Boolean(r.error) });
    } catch (e) { err.textContent = e.message; }
  };
  const dlg = h('div', { class: 'nd-backdrop', onclick: (e) => { if (e.target === dlg) close(); } },
    h('div', { class: 'nd card nd-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sync settings' },
      h('h3', { class: 'nd-title' }, 'Sync notes through your private GitHub repository'),
      h('p', { class: 'nd-text' }, 'Optional. Your notes are copied as markdown files to a private repository you own, so the same notes appear on your phone and laptop. The token stays in this browser and is only ever sent to api.github.com. The README (“Notes › Sync”) has the setup steps.'),
      h('ol', { class: 'nd-steps' },
        h('li', {}, 'Create a new ', h('b', {}, 'private'), ' repository on GitHub (e.g. research-notes).'),
        h('li', {}, 'GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: ', h('b', {}, 'Only select repositories'), ' → that repository. Permissions: ', h('b', {}, 'Contents: Read and write'), ' (nothing else).'),
        h('li', {}, 'Paste the repository and token below. Do the same on your other device.')),
      h('label', { class: 'nd-label' }, 'Private repository (owner/name)'), repo,
      h('label', { class: 'nd-label' }, 'Token'), token,
      h('details', { class: 'nd-more' }, h('summary', {}, 'Advanced'),
        h('label', { class: 'nd-label' }, 'Branch'), branch,
        h('label', { class: 'nd-label' }, 'Folder inside the repository'), dir),
      last ? h('p', { class: 'nd-hint' }, last.error ? `Last sync failed ${relative(last.at)}: ${last.error}` : `Last sync ${relative(last.at)}: ${last.pulled} down, ${last.pushed} up, ${last.deletedLocal + last.deletedRemote} deleted.`) : null,
      err,
      h('div', { class: 'nd-actions' },
        cfg.repo ? h('button', { type: 'button', class: 'tool danger', onclick: async () => { if (await confirmBox({ title: 'Turn off sync', text: 'Forget the token and sync settings in this browser? Your notes stay here and in the repository. Revoke the token on GitHub too if you no longer need it.', ok: 'Turn off', danger: true })) { await turnOff(); close(); toast('Sync is off in this browser'); } } }, 'Turn off') : null,
        h('span', { class: 'ne-spacer' }),
        h('button', { type: 'button', class: 'tool', onclick: close }, 'Cancel'),
        cfg.repo ? h('button', { type: 'button', class: 'tool', onclick: async () => { close(); const r = await syncNow(); toast(r.error ? `Sync problem: ${r.error}` : `Synced: ${r.pulled} down, ${r.pushed} up`, { error: Boolean(r.error) }); } }, 'Sync now') : null,
        h('button', { type: 'button', class: 'tool primary', onclick: save }, 'Save and sync'))));
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(dlg);
  repo.focus();
}

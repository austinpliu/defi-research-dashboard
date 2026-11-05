// 09 — Notes: an Obsidian-style workspace stored in this browser (optionally synced to a private repo).
import { h, svgIcon } from '../ui.js';
import * as store from '../notes/store.js';
import { createEditor, MOD } from '../notes/editor.js';
import { buildIndex, basename, dirname, parseLinks, parseFrontmatter, parseTags, searchNotes, invalidNameReason, isTrashed, TRASH, joinPath } from '../notes/model.js';
import { askText, confirmBox, choose, popMenu, toast } from '../notes/dialog.js';
import { newNote, createLinked, noteHref, allTemplates } from '../notes/workspace.js';
import { relative } from '../format.js';

const EXP_KEY = 'notes-expanded';
let expanded;
try { expanded = new Set(JSON.parse(localStorage.getItem(EXP_KEY) || '[]')); } catch { expanded = new Set(); }
const saveExpanded = () => { try { localStorage.setItem(EXP_KEY, JSON.stringify([...expanded])); } catch { /* private mode */ } };
// native append/replaceChildren print null as text; drop empty parts first
const clean = (...xs) => xs.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);
const go = (hash, replace = false) => { if (replace) { history.replaceState(null, '', hash); dispatchEvent(new HashChangeEvent('hashchange')); } else location.hash = hash; };

// optional parts added by later modules (graph view, sync/export)
export const hooks = { graph: null, headerActions: [] };

export async function render(root, { params, query }) {
  const { persistent } = await store.init();
  // links to notes that don't exist yet create them on first click
  if (query.get('create')) {
    const p = await createLinked(query.get('create'), query.get('from'));
    go(noteHref(p), true);
    return;
  }
  const path = params[0] || null;
  const view = query.get('view') || (path ? 'note' : 'home');
  const state = { q: query.get('q') || '', tag: query.get('tag') || '', folder: query.get('folder') || '' };
  if (path && store.getNote(path)) store.touchRecent(path);

  const side = h('aside', { class: 'nw-side', 'aria-label': 'Notes' });
  const main = h('section', { class: 'nw-main' });
  const app = h('div', { class: `nw${view === 'graph' ? ' graph-mode' : ''}` }, side, main);
  const sideToggle = h('button', { type: 'button', class: 'tool nw-side-toggle', onclick: () => app.classList.toggle('side-open'), 'aria-label': 'Show files' }, svgIcon('folder'), 'Files');

  root.append(...clean(
    h('header', { class: 'nw-head' },
      h('div', {},
        h('div', { class: 'kicker' }, 'Section 09 · Notes'),
        h('h1', { class: 'nw-title' }, 'Notes'),
        h('p', { class: 'nw-sub' }, persistent
          ? 'Your research notes, saved in this browser. They are never added to the dashboard’s repository or the published site.'
          : 'This browser won’t let the site store data (private window?), so notes last only until this tab closes. Export them before leaving.')),
      h('div', { class: 'nw-actions' },
        sideToggle,
        h('button', { type: 'button', class: 'tool primary', onclick: () => createFlow() }, svgIcon('plus'), 'New note'),
        h('button', { type: 'button', class: 'tool', onclick: (e) => templateMenu(e.currentTarget) }, 'From template'),
        h('a', { class: `tool${view === 'graph' ? ' active' : ''}`, href: view === 'graph' ? '#/notes' : '#/notes?view=graph', 'aria-pressed': String(view === 'graph') }, svgIcon('graph'), view === 'graph' ? 'Back to notes' : 'Graph'),
        ...hooks.headerActions.map((fn) => fn()))),
    persistent ? null : h('div', { class: 'notice bad', style: { marginBottom: '12px' } }, h('b', {}, 'Notes aren’t being saved. '), 'Storage is blocked in this window. Use Export to keep a copy.'),
    app));

  async function createFlow(opts = {}) {
    const p = await newNote({ ask: true, folder: opts.folder ?? (path ? dirname(path) : ''), template: opts.template });
    if (p) go(noteHref(p));
  }
  function templateMenu(anchor) {
    popMenu(anchor, allTemplates().filter((t) => t.id !== 'blank').map((t) => ({ label: t.user ? `${t.label} (your template)` : t.label, onClick: () => createFlow({ template: t.id, folder: t.folder }) })));
  }

  // ---------- sidebar ----------
  function renderSide() {
    const all = store.liveNotes();
    const tags = [...new Set(all.flatMap((n) => parseTags(n.body)))].sort();
    const folders = store.allFolders();
    const search = h('input', { type: 'search', class: 'nw-search', placeholder: 'Search notes', value: state.q, 'aria-label': 'Search all notes' });
    const tagSel = h('select', { class: 'nw-filter', 'aria-label': 'Filter by tag' }, h('option', { value: '' }, 'All tags'), tags.map((t) => h('option', { value: t, selected: t === state.tag }, `#${t}`)));
    const folderSel = h('select', { class: 'nw-filter', 'aria-label': 'Filter by folder' }, h('option', { value: '' }, 'All folders'), folders.map((f) => h('option', { value: f, selected: f === state.folder }, f)));
    const results = h('div', { class: 'nw-results' });
    const showResults = () => {
      const active = state.q.trim() || state.tag || state.folder;
      results.hidden = !active;
      tree.hidden = Boolean(active);
      if (!active) return;
      const r = searchNotes(all, state.q, { tag: state.tag || null, folder: state.folder || null });
      results.replaceChildren(h('div', { class: 'nw-sec-title' }, `${r.length} result${r.length === 1 ? '' : 's'}`), ...r.map(({ note, snippet }) =>
        h('a', { class: `nw-result${note.path === path ? ' current' : ''}`, href: noteHref(note.path) }, h('b', {}, basename(note.path)), h('small', {}, dirname(note.path) || 'Top level'), snippet ? h('span', { class: 'nw-snippet' }, snippet) : null)));
      if (!r.length) results.append(h('p', { class: 'muted', style: { fontSize: '13px' } }, 'No notes match.'));
    };
    search.addEventListener('input', () => { state.q = search.value; showResults(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = results.querySelector('a'); if (first) location.hash = first.getAttribute('href'); } });
    tagSel.addEventListener('change', () => { state.tag = tagSel.value; showResults(); });
    folderSel.addEventListener('change', () => { state.folder = folderSel.value; showResults(); });

    const listOf = (title, ns) => (ns.length ? h('div', { class: 'nw-sec' }, h('div', { class: 'nw-sec-title' }, title), ns.map((n) => noteRow(n, 0, false))) : null);
    const tree = h('div', { class: 'nw-tree', role: 'tree', 'aria-label': 'Folders and notes' });
    renderTree(tree, all, folders);
    const trashed = store.trashedNotes();
    side.replaceChildren(...clean(
      h('div', { class: 'nw-searchbox' }, search, h('div', { class: 'nw-filters' }, tagSel, folderSel)),
      results,
      listOf('Pinned', store.pinnedNotes()),
      listOf('Recent', store.recentNotes().slice(0, 6)),
      h('div', { class: 'nw-sec' },
        h('div', { class: 'nw-sec-title row' }, 'Files',
          h('span', { class: 'nw-sec-btns' },
            h('button', { type: 'button', class: 'icon-btn sm', title: 'New note', 'aria-label': 'New note', onclick: () => createFlow({ folder: '' }) }, svgIcon('plus')),
            h('button', { type: 'button', class: 'icon-btn sm', title: 'New folder', 'aria-label': 'New folder', onclick: () => newFolder('') }, svgIcon('folder')))),
        tree),
      trashed.length ? trashSection(trashed) : null));
    showResults();
  }

  function renderTree(el, all, folders) {
    const kids = (folder) => ({
      folders: folders.filter((f) => dirname(f) === folder),
      notes: all.filter((n) => dirname(n.path) === folder).sort((a, b) => basename(a.path).localeCompare(basename(b.path))),
    });
    const draw = (folder, depth) => {
      const { folders: fs, notes: ns } = kids(folder);
      const out = [];
      for (const f of fs) {
        const open = expanded.has(f) || (path && path.startsWith(`${f}/`));
        const row = h('div', { class: 'nw-row folder', role: 'treeitem', 'aria-expanded': String(open), tabindex: 0, draggable: 'true', style: { paddingLeft: `${8 + depth * 14}px` }, 'data-folder': f },
          h('span', { class: 'nw-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'), svgIcon('folder'), h('span', { class: 'nw-name' }, basename(f)),
          h('button', { type: 'button', class: 'icon-btn sm nw-more', 'aria-label': `Folder actions: ${f}`, onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f); } }, svgIcon('menu')));
        const toggle = () => { if (open) expanded.delete(f); else expanded.add(f); saveExpanded(); renderSide(); };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        dragSource(row, 'folder', f);
        dropTarget(row, f);
        out.push(row);
        if (open) out.push(...draw(f, depth + 1));
      }
      for (const n of ns) out.push(noteRow(n, depth, true));
      return out;
    };
    el.replaceChildren(...draw('', 0));
    if (!all.length && !folders.length) el.append(h('p', { class: 'muted nw-empty-tree' }, 'No notes yet.'));
    dropTarget(el, '');
  }

  function noteRow(n, depth, draggable) {
    const pinned = store.isPinned(n.path);
    const row = h('a', { class: `nw-row note${n.path === path ? ' current' : ''}`, href: noteHref(n.path), role: 'treeitem', draggable: draggable ? 'true' : 'false', style: { paddingLeft: `${22 + depth * 14}px` }, title: n.path.replace(/\.md$/, '') },
      svgIcon('note'), h('span', { class: 'nw-name' }, basename(n.path)), pinned ? h('span', { class: 'nw-pin', title: 'Pinned' }, '•') : null,
      h('button', { type: 'button', class: 'icon-btn sm nw-more', 'aria-label': `Note actions: ${basename(n.path)}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); noteMenu(e.currentTarget, n.path); } }, svgIcon('menu')));
    if (draggable) dragSource(row, 'note', n.path);
    return row;
  }

  // drag and drop: notes and folders onto folders (or the empty tree area for the top level)
  function dragSource(el, kind, value) {
    el.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData(`application/x-${kind}`, value); e.dataTransfer.setData('text/plain', value); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }
  function dropTarget(el, folder) {
    el.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].some((t) => t.startsWith('application/x-'))) return;
      e.preventDefault(); e.stopPropagation(); el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); el.classList.remove('drop');
      const notePath = e.dataTransfer.getData('application/x-note');
      const f = e.dataTransfer.getData('application/x-folder');
      if (notePath && dirname(notePath) !== folder) {
        const np = await store.moveNoteToFolder(notePath, folder);
        toast(`Moved to ${folder || 'the top level'}`);
        if (notePath === path) go(noteHref(np), true);
      } else if (f && f !== folder && !folder.startsWith(`${f}/`)) {
        const nf = await store.moveFolder(f, joinPath(folder, basename(f)).replace(/\.md$/, ''));
        if (path && path.startsWith(`${f}/`)) go(noteHref(nf + path.slice(f.length)), true);
      }
    });
  }

  async function newFolder(parent) {
    const name = await askText({ title: 'New folder', label: 'Folder name', ok: 'Create', validate: invalidNameReason, hint: parent ? `Inside ${parent}` : '' });
    if (!name) return;
    const p = await store.createFolder(parent ? `${parent}/${name}` : name);
    if (p) { expanded.add(p); if (parent) expanded.add(parent); saveExpanded(); }
  }
  const folderOptions = (exclude) => [{ value: '', label: 'Top level' }, ...store.allFolders().filter((f) => !exclude || (f !== exclude && !f.startsWith(`${exclude}/`))).map((f) => ({ value: f, label: f }))];
  function folderMenu(anchor, f) {
    popMenu(anchor, [
      { label: 'New note here', onClick: () => createFlow({ folder: f }) },
      { label: 'New folder inside', onClick: () => newFolder(f) },
      null,
      { label: 'Rename…', onClick: async () => { const v = await askText({ title: 'Rename folder', label: 'Folder name', value: basename(f), ok: 'Rename', validate: invalidNameReason }); if (v) { const nf = await store.moveFolder(f, dirname(f) ? `${dirname(f)}/${v}` : v); if (path?.startsWith(`${f}/`)) go(noteHref(nf + path.slice(f.length)), true); } } },
      { label: 'Move to…', onClick: async () => { const to = await choose({ title: 'Move folder', label: 'Move into', options: folderOptions(f), value: dirname(f) }); if (to !== null) { const nf = await store.moveFolder(f, to ? `${to}/${basename(f)}` : basename(f)); if (path?.startsWith(`${f}/`)) go(noteHref(nf + path.slice(f.length)), true); } } },
      null,
      { label: 'Delete folder…', danger: true, onClick: async () => { const n = store.liveNotes().filter((x) => x.path.startsWith(`${f}/`)).length; if (await confirmBox({ title: 'Delete folder', text: `Move “${f}” and its ${n} note${n === 1 ? '' : 's'} to the trash? You can restore them from the trash.`, ok: 'Move to trash', danger: true })) { await store.deleteFolder(f); if (path?.startsWith(`${f}/`)) go('#/notes', true); } } },
    ]);
  }
  function noteMenu(anchor, p) {
    const pinned = store.isPinned(p);
    popMenu(anchor, [
      { label: pinned ? 'Unpin' : 'Pin', onClick: () => store.setPinned(p, !pinned) },
      { label: 'Rename…', onClick: () => renameFlow(p) },
      { label: 'Move to…', onClick: async () => { const to = await choose({ title: 'Move note', label: 'Move to folder', options: folderOptions(), value: dirname(p) }); if (to !== null) { const np = await store.moveNoteToFolder(p, to); if (p === path) go(noteHref(np), true); } } },
      { label: 'Show in graph', onClick: () => go(`#/notes?view=graph&focus=${encodeURIComponent(p)}`) },
      null,
      { label: 'Delete', danger: true, onClick: () => trashFlow(p) },
    ]);
  }
  async function renameFlow(p) {
    const v = await askText({ title: 'Rename note', label: 'Name', value: basename(p), ok: 'Rename', validate: invalidNameReason, hint: 'Links to this note are updated everywhere.' });
    if (!v || v === basename(p)) return;
    const np = await store.renameNote(p, v);
    if (p === path) go(noteHref(np), true);
  }
  async function trashFlow(p) {
    await store.trashNote(p);
    toast('Moved to the trash');
    if (p === path) go('#/notes', true);
  }
  function trashSection(trashed) {
    const open = expanded.has(TRASH);
    return h('div', { class: 'nw-sec nw-trash' },
      h('button', { type: 'button', class: 'nw-sec-title row trash-toggle', 'aria-expanded': String(open), onclick: () => { if (open) expanded.delete(TRASH); else expanded.add(TRASH); saveExpanded(); renderSide(); } },
        h('span', {}, svgIcon('trash'), ` Trash (${trashed.length})`), h('span', { 'aria-hidden': 'true' }, open ? '▾' : '▸')),
      open ? h('div', {},
        trashed.map((n) => h('div', { class: 'nw-row trashed' }, h('span', { class: 'nw-name', title: n.path.slice(TRASH.length + 1) }, basename(n.path)),
          h('button', { type: 'button', class: 'tool sm', onclick: async () => { const np = await store.restoreNote(n.path); toast(`Restored to ${dirname(np) || 'the top level'}`); } }, 'Restore'),
          h('button', { type: 'button', class: 'tool sm danger', onclick: async () => { if (await confirmBox({ title: 'Delete forever', text: `Delete “${basename(n.path)}” permanently? This can’t be undone.`, ok: 'Delete forever', danger: true })) await store.deleteForever([n.path]); } }, 'Delete'))),
        h('button', { type: 'button', class: 'tool sm danger', style: { marginTop: '6px' }, onclick: async () => { if (await confirmBox({ title: 'Empty the trash', text: `Delete all ${trashed.length} notes in the trash permanently?`, ok: 'Empty trash', danger: true })) await store.emptyTrash(); } }, 'Empty trash')) : null);
  }

  // ---------- main area ----------
  let editor = null;
  function renderMain() {
    if (view === 'graph') {
      if (hooks.graph) hooks.graph(main, { focus: query.get('focus'), tag: state.tag, folder: state.folder });
      else main.replaceChildren(h('p', { class: 'muted' }, 'Graph view isn’t available.'));
      return;
    }
    const note = path ? store.getNote(path) : null;
    if (!note) { main.replaceChildren(path ? missing(path) : welcome()); return; }
    if (isTrashed(note.path)) { main.replaceChildren(h('div', { class: 'notice' }, h('b', {}, 'This note is in the trash. '), h('button', { type: 'button', class: 'tool', onclick: async () => go(noteHref(await store.restoreNote(note.path)), true) }, 'Restore it'))); return; }
    const title = h('input', { class: 'nw-note-title', value: basename(note.path), 'aria-label': 'Note name (renaming updates links to it)' });
    const commitTitle = async () => {
      const v = title.value.trim();
      if (v === basename(note.path)) return;
      const err = invalidNameReason(v);
      if (err) { toast(err, { error: true }); title.value = basename(note.path); return; }
      await editor.save();
      const np = await store.renameNote(note.path, v);
      toast('Renamed; links updated');
      go(noteHref(np), true);
    };
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.value = basename(note.path); title.blur(); } });
    title.addEventListener('blur', commitTitle);
    const pinned = store.isPinned(note.path);
    editor = createEditor({
      notes: store.allNotes,
      onSave: (p, body) => store.saveNote(p, body),
      onOpen: async (target, p) => go(noteHref(p || await createLinked(target, note.path))),
    });
    editor.setNote(note);
    const links = h('div', { class: 'nw-links' });
    main.replaceChildren(
      h('div', { class: 'nw-note-head' },
        h('div', { class: 'nw-crumb' }, dirname(note.path) || 'Top level'),
        title,
        h('div', { class: 'nw-note-actions' },
          h('button', { type: 'button', class: `icon-btn${pinned ? ' on' : ''}`, title: pinned ? 'Unpin' : 'Pin to the sidebar', 'aria-pressed': String(pinned), onclick: () => store.setPinned(note.path, !pinned) }, svgIcon('pin')),
          h('button', { type: 'button', class: 'icon-btn', title: 'More', 'aria-label': 'More actions', onclick: (e) => noteMenu(e.currentTarget, note.path) }, svgIcon('menu')))),
      editor.el,
      links);
    renderLinks(links, note);
  }

  function renderLinks(el, note) {
    const idx = buildIndex(store.allNotes());
    const out = idx.outgoing.get(note.path) || [];
    const back = idx.backlinks.get(note.path) || [];
    const seen = new Set();
    const outRows = out.filter((l) => { const k = (l.to || l.target).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const context = (from) => {
      const text = parseFrontmatter(store.getNote(from)?.body || '').content;
      const l = parseLinks(text).find((x) => idx.resolve(x.target, from)?.path === note.path);
      if (!l) return '';
      const s = text.lastIndexOf('\n', l.index) + 1;
      const e = text.indexOf('\n', l.index);
      return text.slice(s, e < 0 ? undefined : e).trim().slice(0, 160);
    };
    const appLinks = [...parseFrontmatter(note.body).content.matchAll(/\]\((#\/(?:protocol|token|compare|catalysts|screener)[^)\s]*)\)/g)].map((m) => m[1]);
    el.replaceChildren(
      h('div', { class: 'nw-links-col' },
        h('div', { class: 'nw-sec-title' }, `Links (${outRows.length})`),
        outRows.length ? h('ul', { class: 'nw-linklist' }, outRows.map((l) => h('li', {}, l.to
          ? h('a', { href: noteHref(l.to) }, basename(l.to))
          : h('a', { href: `#/notes?create=${encodeURIComponent(l.target)}&from=${encodeURIComponent(note.path)}`, class: 'unresolved', title: 'Doesn’t exist yet; click to create it' }, `${l.target} (create)`)))) : h('p', { class: 'muted' }, `No links yet. Type [[ to link a note.`),
        appLinks.length ? h('div', { style: { marginTop: '8px' } }, h('div', { class: 'nw-sec-title' }, 'Dashboard pages'), h('ul', { class: 'nw-linklist' }, [...new Set(appLinks)].map((a) => h('li', {}, h('a', { href: a }, a.replace(/^#\//, '')))))) : null),
      h('div', { class: 'nw-links-col' },
        h('div', { class: 'nw-sec-title' }, `Backlinks (${back.length})`),
        back.length ? h('ul', { class: 'nw-linklist' }, back.map((b) => h('li', {}, h('a', { href: noteHref(b.from) }, basename(b.from)), h('div', { class: 'nw-ctx' }, context(b.from))))) : h('p', { class: 'muted' }, 'No notes link here yet.')));
  }

  function missing(p) {
    return h('div', { class: 'nw-welcome card' }, h('h2', {}, 'Note not found'), h('p', {}, `There’s no note at “${p.replace(/\.md$/, '')}”. It may have been renamed or deleted.`), h('a', { class: 'tool', href: '#/notes' }, 'All notes'));
  }
  function welcome() {
    const n = store.liveNotes().length;
    return h('div', { class: 'nw-welcome card acc-yellow' },
      h('h2', { class: 'takeaway' }, n ? h('span', {}, 'You have ', h('span', { class: 'hl' }, `${n} note${n === 1 ? '' : 's'}`), '. Pick one on the left, or start a new one.') : h('span', {}, 'Start your ', h('span', { class: 'hl' }, 'research notes'))),
      h('p', {}, 'Notes are markdown files, compatible with Obsidian: link notes with [[Note name]], tag them with #tags, and organise them in folders. Everything stays in this browser unless you turn on sync to your own private GitHub repository.'),
      h('div', { class: 'nw-start' },
        h('button', { type: 'button', class: 'tool primary', onclick: () => createFlow() }, svgIcon('plus'), 'Blank note'),
        ...allTemplates().filter((t) => !t.user && t.id !== 'blank').map((t) => h('button', { type: 'button', class: 'tool', onclick: () => createFlow({ template: t.id, folder: t.folder }) }, t.label))),
      h('div', { class: 'nw-keys' },
        h('div', { class: 'nw-sec-title' }, 'Shortcuts'),
        h('ul', {},
          h('li', {}, h('kbd', {}, 'Alt'), '+', h('kbd', {}, 'N'), ' quick note from any page'),
          h('li', {}, h('kbd', {}, 'Alt'), '+', h('kbd', {}, 'M'), ' open or close the notes panel'),
          h('li', {}, h('kbd', {}, '[['), ' link a note (pick with ↑ ↓, Enter)'),
          h('li', {}, h('kbd', {}, MOD), '+', h('kbd', {}, 'B'), ' / ', h('kbd', {}, 'I'), ' bold / italic, ', h('kbd', {}, MOD), '+', h('kbd', {}, 'K'), ' link, ', h('kbd', {}, MOD), '+', h('kbd', {}, 'E'), ' preview, ', h('kbd', {}, MOD), '+', h('kbd', {}, 'Z'), ' undo'))));
  }

  renderSide();
  renderMain();
  // refresh when notes change (here, in the panel, in another tab, or by sync)
  let mounted = false;
  const off = store.subscribe(() => {
    if (app.isConnected) mounted = true;
    else { if (mounted) off(); return; }
    renderSide();
    if (view === 'graph') return;
    const n = path ? store.getNote(path) : null;
    if (editor && n) { editor.setNote(n); editor.refresh(); renderLinks(main.querySelector('.nw-links'), n); } else if (!editor) renderMain();
  });
  if (path && view === 'note') setTimeout(() => editor?.focus(), 50);
}

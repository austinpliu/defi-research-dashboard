// The notes side panel: open from any page (header button, Alt+M), write while looking at a
// chart, link the current page, paste a chart reference, quick capture with Alt+N.
// Also the "Your notes" card on protocol and token pages.
import { h, svgIcon } from '../ui.js';
import * as store from './store.js';
import { createEditor, saveAllEditors } from './editor.js';
import { basename, dirname, searchNotes, notesMentioning } from './model.js';
import { newNote, quickNote, noteHref, pageLink, createLinked } from './workspace.js';
import { loadSafe } from '../data.js';

const KEY = 'notes-panel';
let panel = null;
let editor = null;
let current = null;
let pageCtx = null;
let body = null;
let ctxBar = null;
const remember = () => { try { localStorage.setItem(KEY, JSON.stringify({ path: current })); } catch { /* private mode */ } };
const recall = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}').path || null; } catch { return null; } };

/** What the current page is about (for "new note about this" and related notes). */
async function context() {
  const m = (location.hash || '').match(/^#\/(protocol|token)\/([^/?]+)/);
  if (!m) {
    const section = document.querySelector('[data-nav][aria-current="page"]')?.textContent?.trim();
    const t = document.title.replace(/\s*·\s*DeFi Research Dashboard$/, '');
    return { title: t && t !== 'DeFi Research Dashboard' ? t : section || 'Overview', hash: location.hash || '#/' };
  }
  const { data } = await loadSafe('index.json');
  const id = decodeURIComponent(m[2]);
  const p = data?.protocols?.find((x) => (m[1] === 'protocol' ? x.slug === id : x.tokenId === id));
  const name = m[1] === 'protocol' ? p?.name || id : p?.symbol || id.toUpperCase();
  return {
    kind: m[1], id, name, title: m[1] === 'protocol' ? `${name} (protocol)` : `${name} (token)`, hash: `#/${m[1]}/${m[2]}`,
    match: {
      names: [p?.name].filter(Boolean),
      symbols: [p?.symbol].filter(Boolean),
      slugs: [p?.slug, p?.tokenId].filter(Boolean),
      hrefs: [p?.slug ? `#/protocol/${p.slug}` : null, p?.tokenId ? `#/token/${p.tokenId}` : null].filter(Boolean),
    },
    slug: p?.slug || id,
    template: m[1] === 'protocol' ? 'protocol' : 'thesis',
  };
}

function build() {
  panel = h('aside', { class: 'np', id: 'notes-panel', 'aria-label': 'Notes panel', hidden: true });
  body = h('div', { class: 'np-body' });
  ctxBar = h('div', { class: 'np-ctx' });
  panel.append(
    h('div', { class: 'np-head acc-yellow' },
      h('div', { class: 'kicker' }, 'Notes'),
      h('div', { class: 'np-head-btns' },
        h('button', { type: 'button', class: 'tool sm', onclick: () => newBlank() }, svgIcon('plus'), 'New'),
        h('button', { type: 'button', class: 'icon-btn sm', title: 'All notes', 'aria-label': 'All notes', onclick: () => showList() }, svgIcon('search')),
        h('a', { class: 'icon-btn sm', href: '#/notes', title: 'Open the notes workspace', 'aria-label': 'Open the notes workspace', onclick: () => { if (current) setTimeout(() => { location.hash = noteHref(current); }, 0); } }, svgIcon('ext')),
        h('button', { type: 'button', class: 'icon-btn sm', title: 'Close (Esc)', 'aria-label': 'Close notes panel', onclick: () => toggle(false) }, svgIcon('close')))),
    ctxBar,
    body);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); toggle(false); } });
  document.body.append(panel);
}

async function renderCtx() {
  pageCtx = await context();
  const charts = [...document.querySelectorAll('#main .chart-card')];
  ctxBar.replaceChildren(
    h('span', { class: 'np-ctx-label' }, 'On this page: ', h('b', {}, pageCtx.title)),
    h('span', { class: 'np-ctx-btns' },
      h('button', { type: 'button', class: 'tool sm', title: 'Insert a link to this page', onclick: () => insert(`${pageLink(pageCtx.kind ? pageCtx.name : pageCtx.title)} `) }, svgIcon('link'), 'Link page'),
      pageCtx.kind ? h('button', { type: 'button', class: 'tool sm', onclick: () => aboutThis() }, `New note about ${pageCtx.name}`) : null,
      charts.length ? h('span', { class: 'np-hint' }, 'Use “Note” on any chart to paste it here') : null));
}

function showList() {
  current = null; remember(); editor = null;
  const q = h('input', { type: 'search', class: 'nw-search', placeholder: 'Search notes', 'aria-label': 'Search notes' });
  const list = h('div', { class: 'np-list' });
  const draw = () => {
    const all = store.liveNotes();
    const rows = q.value.trim() ? searchNotes(all, q.value).map((r) => r.note) : store.recentNotes().concat(all.filter((n) => !store.recentNotes().includes(n)).sort((a, b) => (b.updated || 0) - (a.updated || 0))).slice(0, 30);
    const related = pageCtx?.match ? notesMentioning(all, pageCtx.match) : [];
    list.replaceChildren(
      ...(related.length && !q.value.trim() ? [h('div', { class: 'nw-sec-title' }, `About ${pageCtx.name} (${related.length})`), ...related.slice(0, 6).map(row)] : []),
      h('div', { class: 'nw-sec-title' }, q.value.trim() ? 'Results' : 'Recent'),
      ...(rows.length ? rows.map(row) : [h('p', { class: 'muted', style: { fontSize: '13px', padding: '0 8px' } }, all.length ? 'No notes match.' : 'No notes yet. Press New, or Alt+N anywhere.')]));
  };
  const row = (n) => h('button', { type: 'button', class: 'nw-result np-row', onclick: () => open(n.path) }, h('b', {}, basename(n.path)), h('small', {}, dirname(n.path) || 'Top level'));
  q.addEventListener('input', draw);
  body.replaceChildren(h('div', { class: 'np-search' }, q), list);
  draw();
  setTimeout(() => q.focus(), 0);
}

function open(path) {
  const n = store.getNote(path);
  if (!n) { showList(); return; }
  current = path; remember();
  store.touchRecent(path);
  editor = createEditor({
    compact: true,
    notes: store.allNotes,
    onSave: (p, b) => store.saveNote(p, b),
    onOpen: async (target, p) => open(p || await createLinked(target, current)),
  });
  editor.setNote(n);
  body.replaceChildren(
    h('div', { class: 'np-note-head' },
      h('button', { type: 'button', class: 'icon-btn sm', title: 'All notes', 'aria-label': 'Back to all notes', onclick: () => { editor?.save(); showList(); } }, '‹'),
      h('a', { class: 'np-note-title', href: noteHref(path), title: 'Open in the notes workspace' }, basename(path)),
      h('span', { class: 'np-crumb' }, dirname(path))),
    editor.el);
  setTimeout(() => editor?.focus(), 0);
}

function insert(text) {
  if (!editor) { quickCapture(text); return; }
  editor.insert(text);
}

async function newBlank() { await store.init(); const p = await newNote({ ask: true }); if (p) open(p); }
async function aboutThis() {
  const c = pageCtx || await context();
  const p = await newNote({ template: c.template, vars: { title: c.name, name: c.name, link: pageLink(c.name), tag: `#${String(c.slug).replace(/[^\w/-]/g, '-')}` } });
  toggle(true);
  open(p);
}

/** Quick capture: a new note in Inbox/, opened in the panel. */
export async function quickCapture(text = '') {
  await store.init();
  const p = await quickNote(text);
  toggle(true);
  open(p);
}

export async function toggle(on) {
  if (!panel) build();
  if (on === undefined) on = panel.hidden; // no argument: flip open/closed
  await store.init();
  if (on) {
    panel.hidden = false;
    document.body.classList.add('np-open');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50); // charts re-fit beside the panel
    document.getElementById('notes-btn')?.setAttribute('aria-expanded', 'true');
    await renderCtx();
    const last = current || recall();
    if (!editor || editor.path !== last) { if (last && store.getNote(last)) open(last); else showList(); }
  } else {
    saveAllEditors();
    panel.hidden = true;
    document.body.classList.remove('np-open');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    document.getElementById('notes-btn')?.setAttribute('aria-expanded', 'false');
  }
}

/** Header button, shortcuts, chart references. Called once from app.js. */
export function initNotesPanel() {
  const btn = h('button', { type: 'button', class: 'icon-btn notes-btn', id: 'notes-btn', 'aria-controls': 'notes-panel', 'aria-expanded': 'false', title: 'Notes (Alt+M) · quick note: Alt+N', 'aria-label': 'Open notes panel' }, svgIcon('note'));
  btn.addEventListener('click', () => toggle());
  const theme = document.getElementById('theme-btn');
  theme?.parentNode?.insertBefore(btn, theme);
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyN') { e.preventDefault(); quickCapture(); }
    else if (e.code === 'KeyM') { e.preventDefault(); toggle(); }
  });
  // "Note" buttons on charts send a reference here
  window.addEventListener('notes:chart-ref', async (e) => {
    const { title, takeaway, source } = e.detail || {};
    const page = pageCtx?.title || document.title;
    const ref = `\n> [!chart] ${takeaway || title}\n> ${title} · ${pageLink(page)}${source ? ` · ${source}` : ''}\n\n`;
    if (panel?.hidden !== false) await toggle(true);
    insert(ref);
  });
  window.addEventListener('hashchange', () => { if (panel && !panel.hidden) setTimeout(renderCtx, 300); });
  store.subscribe(() => { if (!panel || panel.hidden) return; if (editor && current) { const n = store.getNote(current); if (n) { editor.setNote(n); editor.refresh(); } else showList(); } else if (!editor && body.querySelector('.np-list')) showList(); });
}

/** "Your notes" card for protocol and token pages. */
export function notesCard({ kind, name, symbol, slug, tokenId }) {
  const match = { names: [name].filter(Boolean), symbols: [symbol].filter(Boolean), slugs: [slug, tokenId].filter(Boolean), hrefs: [slug ? `#/protocol/${slug}` : null, tokenId ? `#/token/${tokenId}` : null].filter(Boolean) };
  const listEl = h('div', { class: 'nc-list' });
  const card = h('section', { class: 'card nc acc-yellow' },
    h('div', { class: 'card-top' }, h('div', { class: 'kicker' }, 'Your notes'),
      h('div', { class: 'card-tools' },
        h('button', { type: 'button', class: 'tool', onclick: async () => {
          const p = await newNote({ template: kind === 'protocol' ? 'protocol' : 'thesis', vars: { title: kind === 'protocol' ? name : symbol || name, name, symbol, link: pageLink(kind === 'protocol' ? name : symbol || name), tag: `#${String(slug || tokenId).replace(/[^\w/-]/g, '-')}` } });
          await toggle(true); open(p);
        } }, svgIcon('plus'), `New note about ${kind === 'protocol' ? name : symbol || name}`))),
    listEl);
  const draw = () => {
    const ns = notesMentioning(store.liveNotes(), match);
    listEl.replaceChildren(ns.length
      ? h('ul', { class: 'nc-ul' }, ns.slice(0, 8).map((n) => h('li', {},
        h('button', { type: 'button', class: 'nc-open', onclick: async () => { await toggle(true); open(n.path); } }, basename(n.path)),
        h('span', { class: 'muted' }, ` · ${dirname(n.path) || 'Top level'}`))))
      : h('p', { class: 'muted nc-empty' }, `No notes mention ${kind === 'protocol' ? name : symbol || name} yet. Notes that link to this page, use its name or ticker, or tag #${slug || tokenId} show up here. They stay in your browser.`));
  };
  store.init().then(() => {
    draw();
    let mounted = false;
    const off = store.subscribe(() => { if (card.isConnected) mounted = true; else if (mounted) { off(); return; } draw(); });
  });
  return card;
}

// Markdown editor with live preview, autosave, [[ autocomplete, shortcuts and undo.
// Edits go through document.execCommand('insertText') where possible, so the browser's own
// undo/redo (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z) covers toolbar and autocomplete changes too.
import { h, svgIcon } from '../ui.js';
import { renderMarkdown } from './markdown.js';
import { parseFrontmatter, composeNote, basename, buildIndex } from './model.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

// Save every editor still on the page when the tab is hidden or closed (one listener for all).
const LIVE = new Set();
const flushAll = () => { for (const e of [...LIVE]) { if (!e.root.isConnected) LIVE.delete(e); else e.save(); } };
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
}
/** Save any unsaved edits now (before navigating away). */
export const saveAllEditors = flushAll;

/** Position of the caret inside a textarea, in px relative to the textarea (mirror-div trick). */
function caretXY(ta) {
  const div = document.createElement('div');
  const cs = getComputedStyle(ta);
  for (const p of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'tabSize', 'whiteSpace', 'wordWrap', 'overflowWrap']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', top: '0', left: '-9999px' });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span');
  span.textContent = '​';
  div.append(span);
  document.body.append(div);
  const x = span.offsetLeft;
  const y = span.offsetTop + span.offsetHeight;
  div.remove();
  return { x, y: y - ta.scrollTop };
}

/** Replace the selection (or a range) with text, keeping the browser's undo history. */
export function insertAt(ta, text, from = ta.selectionStart, to = ta.selectionEnd, selectInner = null) {
  ta.focus();
  ta.setSelectionRange(from, to);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) { ta.setRangeText(text, from, to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  if (selectInner) ta.setSelectionRange(from + selectInner[0], from + selectInner[1]);
}

function wrap(ta, before, after = before, placeholder = 'text') {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || placeholder;
  insertAt(ta, `${before}${sel}${after}`, s, e, [before.length, before.length + sel.length]);
}
function linePrefix(ta, prefix) {
  const { selectionStart: s, value } = ta;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  insertAt(ta, prefix, start, start);
  ta.setSelectionRange(s + prefix.length, s + prefix.length);
}

/**
 * @param {object} o
 *   notes(): every note (for autocomplete and link resolution)
 *   onSave(path, body): persist (returns a promise)
 *   onOpen(target, path): follow a [[link]] (path null if it doesn't exist yet)
 *   compact: smaller layout for the side panel
 */
export function createEditor(o) {
  let note = null;
  let fm = { data: {}, entries: [] };
  let timer = null;
  let dirty = false;
  let mode = o.compact || matchMedia('(max-width: 760px)').matches ? 'edit' : 'split';

  const ta = h('textarea', { class: 'ne-text', spellcheck: 'true', 'aria-label': 'Note text (markdown)', placeholder: 'Write in markdown. Type [[ to link a note, # for a tag.' });
  const preview = h('div', { class: 'ne-preview md', 'aria-live': 'polite' });
  const status = h('span', { class: 'ne-status', role: 'status' }, '');
  const tags = h('input', { class: 'ne-tags', type: 'text', placeholder: 'tags, comma separated', 'aria-label': 'Tags (saved in the note’s frontmatter)' });
  const pop = h('div', { class: 'ne-pop', role: 'listbox', hidden: true });
  const modeBtns = {};
  const setMode = (m) => {
    mode = m;
    root.dataset.mode = m;
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', String(k === m));
    if (m !== 'edit') renderPreview();
  };
  const tool = (label, icon, fn, title) => h('button', { type: 'button', class: 'ne-tool', title: title || label, 'aria-label': title || label, onclick: fn }, icon ? svgIcon(icon) : label);
  const toolbar = h('div', { class: 'ne-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tool('B', null, () => wrap(ta, '**'), `Bold (${MOD}+B)`),
    tool('I', null, () => wrap(ta, '*'), `Italic (${MOD}+I)`),
    tool('H', null, () => linePrefix(ta, '## '), 'Heading'),
    tool('•', null, () => linePrefix(ta, '- '), 'Bulleted list'),
    tool('☐', null, () => linePrefix(ta, '- [ ] '), 'Task'),
    tool('<>', null, () => wrap(ta, '`'), 'Inline code'),
    tool('[[', 'link', () => { insertAt(ta, '[[]]', ta.selectionStart, ta.selectionEnd, [2, 2]); autocomplete(); }, `Link a note (${MOD}+K)`),
    h('span', { class: 'ne-spacer' }),
    ...['edit', 'split', 'preview'].map((m) => (modeBtns[m] = h('button', { type: 'button', class: `ne-mode mode-${m}`, 'aria-pressed': 'false', onclick: () => setMode(m) }, m === 'edit' ? 'Write' : m === 'split' ? 'Split' : 'Preview'))));
  const root = h('div', { class: `ne${o.compact ? ' compact' : ''}` },
    toolbar,
    h('div', { class: 'ne-props' }, h('span', { class: 'ne-props-label' }, '#'), tags, status),
    h('div', { class: 'ne-body' }, h('div', { class: 'ne-write' }, ta, pop), preview));

  const index = () => buildIndex(o.notes());
  function renderPreview() {
    const idx = index();
    preview.replaceChildren(renderMarkdown(ta.value, {
      resolve: (t) => idx.resolve(t, note?.path)?.path || null,
      noteHref: (path, target) => (path ? `#/notes/${encodeURIComponent(path)}` : `#/notes?create=${encodeURIComponent(target)}${note ? `&from=${encodeURIComponent(note.path)}` : ''}`),
    }));
    if (!ta.value.trim()) preview.append(h('p', { class: 'muted' }, 'Nothing to preview yet.'));
  }
  // following [[links]] in the preview without leaving the editor context
  preview.addEventListener('click', (e) => {
    const a = e.target.closest('a.wikilink');
    if (!a || !o.onOpen) return;
    e.preventDefault();
    const idx = index();
    o.onOpen(a.dataset.target, idx.resolve(a.dataset.target, note?.path)?.path || null);
  });

  const body = () => composeNote(ta.value, fm, { tags: tags.value.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean) });
  async function save() {
    clearTimeout(timer);
    if (!note || !dirty) return;
    dirty = false;
    status.textContent = 'Saving…';
    try {
      const saved = await o.onSave(note.path, body());
      if (saved) { note = saved; fm = parseFrontmatter(saved.body); }
      status.textContent = 'Saved';
      status.title = `Saved ${new Date().toLocaleTimeString()} in this browser`;
    } catch (e) {
      dirty = true;
      status.textContent = 'Not saved';
      status.title = e.message;
    }
  }
  const schedule = () => { dirty = true; status.textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(save, 700); };
  let previewTimer = null;
  ta.addEventListener('input', () => {
    schedule();
    if (mode !== 'edit') { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 150); }
    autocomplete();
  });
  tags.addEventListener('input', schedule);
  ta.addEventListener('blur', () => { setTimeout(() => { if (!root.contains(document.activeElement)) closePop(); }, 150); save(); });
  tags.addEventListener('blur', save);
  LIVE.add({ root, save });

  // ---------- [[ autocomplete ----------
  let items = [];
  let active = 0;
  let query = null;
  function closePop() { pop.hidden = true; query = null; }
  function autocomplete() {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/\[\[([^[\]\n|#]*)$/);
    if (!m) { closePop(); return; }
    query = m[1];
    const q = query.toLowerCase();
    const all = o.notes().filter((n) => !n.path.startsWith('.trash/') && n.path !== note?.path);
    items = all
      .map((n) => ({ n, name: basename(n.path), i: basename(n.path).toLowerCase().indexOf(q) }))
      .filter((x) => !q || x.i >= 0 || x.n.path.toLowerCase().includes(q))
      .sort((a, b) => (a.i === 0 ? -1 : 0) - (b.i === 0 ? -1 : 0) || (b.n.updated || 0) - (a.n.updated || 0))
      .slice(0, 8)
      .map((x) => ({ label: x.name, sub: x.n.path.includes('/') ? x.n.path.replace(/\/[^/]+$/, '') : '', text: x.name }));
    if (query.trim() && !items.some((x) => x.text.toLowerCase() === q)) items.push({ label: `Link to “${query.trim()}”`, sub: 'new note', text: query.trim() });
    if (!items.length) { closePop(); return; }
    active = Math.min(active, items.length - 1);
    pop.replaceChildren(...items.map((it, j) => h('div', { class: `ne-pop-item${j === active ? ' active' : ''}`, role: 'option', 'aria-selected': String(j === active), onmousedown: (e) => { e.preventDefault(); pick(j); } }, h('span', {}, it.label), it.sub ? h('small', {}, it.sub) : null)));
    const { x, y } = caretXY(ta);
    pop.style.left = `${Math.max(0, Math.min(x, ta.clientWidth - 220))}px`;
    pop.style.top = `${Math.min(y + 4, ta.clientHeight - 20)}px`;
    pop.hidden = false;
  }
  function pick(j) {
    const it = items[j];
    if (!it || query === null) return;
    const end = ta.selectionStart;
    const start = end - query.length;
    const closing = ta.value.slice(end, end + 2) === ']]';
    insertAt(ta, `${it.text}${closing ? '' : ']]'}`, start, end);
    if (closing) ta.setSelectionRange(start + it.text.length + 2, start + it.text.length + 2);
    closePop();
  }

  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!pop.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; autocomplete(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(active); return; }
      if (e.key === 'Escape') { e.preventDefault(); closePop(); return; }
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap(ta, '**'); }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap(ta, '*'); }
    else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); insertAt(ta, '[[]]', ta.selectionStart, ta.selectionEnd, [2, 2]); autocomplete(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); dirty = true; save(); }
    else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); setMode(mode === 'edit' ? (o.compact ? 'preview' : 'split') : 'edit'); }
    else if (e.key === 'Enter' && !mod && !e.shiftKey) {
      // continue lists and tasks on Enter
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const line = ta.value.slice(lineStart, s);
      const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
      if (lm) {
        e.preventDefault();
        if (!lm[4].trim()) { insertAt(ta, '', lineStart, s); return; } // empty item ends the list
        const bullet = /\d/.test(lm[2]) ? `${parseInt(lm[2], 10) + 1}${lm[2].slice(-1)}` : lm[2];
        insertAt(ta, `\n${lm[1]}${bullet} ${lm[3] ? '[ ] ' : ''}`);
      }
    } else if (e.key === 'Tab' && !mod) {
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      if (/^\s*([-*+]|\d+[.)])\s/.test(ta.value.slice(lineStart))) {
        e.preventDefault();
        if (e.shiftKey) { if (ta.value.startsWith('  ', lineStart)) insertAt(ta, '', lineStart, lineStart + 2); } else insertAt(ta, '  ', lineStart, lineStart);
      }
    }
  });

  return {
    el: root,
    textarea: ta,
    /** Load a note. If the same note changed elsewhere and there are no unsaved edits, reload it. */
    setNote(n, { force = false } = {}) {
      if (!n) { note = null; ta.value = ''; tags.value = ''; renderPreview(); return; }
      if (note && note.path === n.path && dirty && !force) return;
      if (note && note.path === n.path && note.body === n.body && !force) return;
      note = n;
      fm = parseFrontmatter(n.body);
      const pos = ta.selectionStart;
      ta.value = fm.content;
      const t = fm.data.tags;
      tags.value = (Array.isArray(t) ? t : t ? String(t).split(/[,\s]+/) : []).join(', ');
      if (document.activeElement === ta) ta.setSelectionRange(Math.min(pos, ta.value.length), Math.min(pos, ta.value.length));
      dirty = false;
      status.textContent = '';
      setMode(mode);
      renderPreview();
    },
    /** Re-draw the preview (other notes changed, so links may resolve differently). */
    refresh() { if (mode !== 'edit') renderPreview(); },
    get path() { return note?.path || null; },
    get dirty() { return dirty; },
    focus() { (mode === 'preview' ? preview : ta).focus(); },
    /** Insert text at the caret (used by "insert page link" and chart references). */
    insert(text) { if (mode === 'preview') setMode(o.compact ? 'edit' : 'split'); insertAt(ta, text); },
    save,
    setMode,
  };
}

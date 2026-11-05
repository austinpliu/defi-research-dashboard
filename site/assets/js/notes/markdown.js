// A small, safe markdown renderer for note previews. It builds DOM nodes (never innerHTML),
// so nothing in a note can inject markup or script. Links are http(s) or in-dashboard (#/…)
// only. Remote images are not loaded (that would tell third parties when a note is opened);
// they show as links. Obsidian extras: [[wiki links]], ![[embeds]] (as links), #tags, ==highlight==.
import { h } from '../ui.js';

const isWebUrl = (u) => /^https?:\/\//i.test(u);
const isAppUrl = (u) => /^#\//.test(u);

/**
 * @param {string} text markdown without frontmatter
 * @param {object} opts { resolve(target) → path|null, noteHref(path) → '#/notes/…', onTag(tag) }
 */
export function renderMarkdown(text, opts = {}) {
  const frag = document.createDocumentFragment();
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { frag.append(h('p', {}, inline(para.join('\n'), opts))); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^(\s*)(```|~~~)\s*([\w+-]*)\s*$/))) {
      flush();
      const fence = m[2];
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) { code.push(lines[i]); i += 1; }
      i += 1;
      frag.append(h('pre', { class: 'md-code' }, h('code', m[3] ? { 'data-lang': m[3] } : {}, code.join('\n'))));
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      flush();
      frag.append(h(`h${m[1].length}`, { class: 'md-h' }, inline(m[2], opts)));
      i += 1; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); frag.append(h('hr')); i += 1; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      const callout = q[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      const body = renderMarkdown((callout ? q.slice(1) : q).join('\n'), opts);
      frag.append(callout
        ? h('div', { class: `md-callout ${callout[1].toLowerCase()}` }, h('div', { class: 'md-callout-title' }, callout[2] || callout[1]), body)
        : h('blockquote', {}, body));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      frag.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data md-table' },
        h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, inline(c, opts))))),
        h('tbody', {}, rows.map((r) => h('tr', {}, head.map((_, j) => h('td', {}, inline(r[j] || '', opts)))))))));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const { node, next } = list(lines, i, opts);
      frag.append(node);
      i = next;
      continue;
    }
    if (!line.trim()) { flush(); i += 1; continue; }
    para.push(line);
    i += 1;
  }
  flush();
  return frag;
}

function list(lines, start, opts) {
  const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '  ').length;
  const base = indentOf(lines[start]);
  const ordered = /^\s*\d+[.)]/.test(lines[start]);
  const el = h(ordered ? 'ol' : 'ul', { class: 'md-list' });
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { if (i + 1 < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1]) && indentOf(lines[i + 1]) >= base) { i += 1; continue; } break; }
    const ind = indentOf(l);
    const m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (m && ind === base) {
      const task = m[2].match(/^\[([ xX])\]\s+(.*)$/);
      const li = task
        ? h('li', { class: 'md-task' }, h('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' }), ' ', inline(task[2], opts))
        : h('li', {}, inline(m[2], opts));
      el.append(li);
      i += 1;
    } else if (m && ind > base) {
      const sub = list(lines, i, opts);
      (el.lastElementChild || el).append(sub.node);
      i = sub.next;
    } else if (!m && ind > base && el.lastElementChild) {
      el.lastElementChild.append(' ', inline(l.trim(), opts));
      i += 1;
    } else break;
  }
  return { node: el, next: i };
}

const PATTERNS = [
  ['code', /`([^`\n]+)`/],
  ['wiki', /(!?)\[\[([^[\]\n]+?)\]\]/],
  ['image', /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/],
  ['link', /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/],
  ['auto', /<?(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])>?/],
  ['bold', /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/],
  ['strike', /~~([^~\n]+?)~~/],
  ['mark', /==([^=\n]+?)==/],
  ['italic', /\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/],
  ['tag', /(^|[\s(,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u],
  ['br', /\n/],
];

function inline(text, opts) {
  const out = [];
  let rest = String(text);
  while (rest) {
    let best = null;
    for (const [type, re] of PATTERNS) {
      const m = rest.match(re);
      if (m && (best === null || m.index < best.m.index)) best = { type, m };
    }
    if (!best) { out.push(rest); break; }
    const { type, m } = best;
    if (m.index) out.push(rest.slice(0, m.index));
    out.push(...node(type, m, opts));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function node(type, m, opts) {
  switch (type) {
    case 'code': return [h('code', { class: 'md-inline-code' }, m[1])];
    case 'br': return [h('br')];
    case 'bold': return [h('strong', {}, inline(m[1] ?? m[2], opts))];
    case 'italic': return [h('em', {}, inline(m[1] ?? m[2], opts))];
    case 'strike': return [h('s', {}, inline(m[1], opts))];
    case 'mark': return [h('mark', { class: 'md-mark' }, inline(m[1], opts))];
    case 'tag': return [m[1], h('a', { class: 'md-tag', href: `#/notes?tag=${encodeURIComponent(m[2].toLowerCase())}` }, `#${m[2]}`)];
    case 'wiki': {
      const inner = m[2];
      const bar = inner.indexOf('|');
      const ref = bar >= 0 ? inner.slice(0, bar) : inner;
      const label = bar >= 0 ? inner.slice(bar + 1) : ref;
      const target = ref.split(/[#^]/)[0].trim();
      const path = opts.resolve ? opts.resolve(target) : null;
      const href = path && opts.noteHref ? opts.noteHref(path) : opts.noteHref ? opts.noteHref(null, target) : '#/notes';
      return [h('a', { class: `wikilink${path ? '' : ' unresolved'}${m[1] ? ' embed' : ''}`, href, 'data-target': target, title: path ? path.replace(/\.md$/, '') : `“${target}” doesn’t exist yet — click to create it` }, m[1] ? `↳ ${label}` : label)];
    }
    case 'image': {
      const url = m[2];
      if (isWebUrl(url)) return [h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'md-image-link', title: 'Images aren’t loaded in notes (privacy); open it in a new tab' }, `🖼 ${m[1] || 'image'}`)];
      return [h('span', { class: 'md-image-link' }, `🖼 ${m[1] || url}`)];
    }
    case 'link': {
      const url = m[2];
      if (isWebUrl(url)) return [h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, inline(m[1], opts))];
      if (isAppUrl(url)) return [h('a', { href: url, class: 'app-link' }, inline(m[1], opts))];
      return [m[0]]; // javascript:, data: and anything else stays as plain text
    }
    case 'auto': return [h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1])];
    default: return [m[0]];
  }
}

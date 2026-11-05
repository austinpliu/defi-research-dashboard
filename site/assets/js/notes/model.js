// Notes: pure functions on markdown files (no DOM, no storage), Obsidian-compatible.
// A note is { path: 'Folder/Name.md', body: '<the whole file>', created, updated }.
// Links: [[Name]], [[Name|alias]], [[Folder/Name#Heading]], embeds ![[Name]]. Tags: #tag and
// frontmatter `tags:`. Notes in the `.trash/` folder are ignored by links, search and the graph.

export const TRASH = '.trash';
const MANAGED = ['tags', 'aliases', 'created', 'updated', 'pinned'];

// ---------- paths ----------
export function normalizePath(p) {
  let s = String(p || '').replace(/\\/g, '/').split('/').map((x) => x.trim()).filter((x) => x && x !== '.' && x !== '..').join('/');
  if (s && !/\.md$/i.test(s)) s += '.md';
  return s;
}
export const basename = (p) => String(p).split('/').pop().replace(/\.md$/i, '');
export const dirname = (p) => { const parts = String(p).split('/'); parts.pop(); return parts.join('/'); };
export const joinPath = (folder, name) => normalizePath(folder ? `${folder}/${name}` : name);
export const isTrashed = (p) => p === TRASH || String(p).startsWith(`${TRASH}/`);
/** Obsidian refuses these in file names; links can't point at them. */
export function invalidNameReason(name) {
  const n = String(name || '').trim();
  if (!n) return 'A name is needed.';
  if (/[\\/:*?"<>|#^[\]]/.test(n)) return 'Names can’t contain \\ / : * ? " < > | # ^ [ ]';
  if (n.startsWith('.')) return 'Names can’t start with a dot.';
  return null;
}

// ---------- frontmatter (a small YAML subset: scalars, [inline, lists] and - block lists) ----------
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseScalar(v) {
  const t = v.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).split(',').map((x) => parseScalar(x)).filter((x) => x !== '');
  return t;
}

/** { data, entries, content, hasFrontmatter }. `entries` keeps every key's raw lines in order. */
export function parseFrontmatter(body) {
  const text = String(body ?? '');
  const m = text.match(FM_RE);
  if (!m) return { data: {}, entries: [], content: text, hasFrontmatter: false };
  const entries = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z0-9_-][^:]*):(.*)$/);
    if (km && !/^\s/.test(line)) entries.push({ key: km[1].trim(), first: km[2], lines: [line] });
    else if (entries.length) entries[entries.length - 1].lines.push(line);
    else entries.push({ key: null, first: '', lines: [line] });
  }
  const data = {};
  for (const e of entries) {
    if (!e.key) continue;
    const rest = e.lines.slice(1).filter((l) => /^\s*-\s*/.test(l)).map((l) => parseScalar(l.replace(/^\s*-\s*/, '')));
    data[e.key] = e.first.trim() === '' && rest.length ? rest : e.first.trim() === '' ? '' : parseScalar(e.first);
  }
  return { data, entries, content: text.slice(m[0].length), hasFrontmatter: true };
}

const yamlValue = (v) => {
  if (Array.isArray(v)) return `[${v.map((x) => yamlValue(x)).join(', ')}]`;
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[\w ./+@-]*$/.test(s) && !/^(true|false|null)$/i.test(s) && s.trim() === s ? s : JSON.stringify(s);
};

/** Rebuild the file: `patch` sets managed keys (null removes them); other keys are kept verbatim. */
export function composeNote(content, { entries = [] } = {}, patch = {}) {
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    if (e.key && Object.prototype.hasOwnProperty.call(patch, e.key)) {
      seen.add(e.key);
      const v = patch[e.key];
      if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === false) continue;
      out.push(`${e.key}: ${yamlValue(v)}`);
    } else out.push(...e.lines);
  }
  for (const k of [...MANAGED, ...Object.keys(patch)]) {
    if (seen.has(k) || !Object.prototype.hasOwnProperty.call(patch, k)) continue;
    seen.add(k);
    const v = patch[k];
    if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === false) continue;
    out.push(`${k}: ${yamlValue(v)}`);
  }
  const body = String(content ?? '');
  return out.length ? `---\n${out.join('\n')}\n---\n${body}` : body;
}

/** Change frontmatter keys in a whole file, keeping everything else. */
export function setFrontmatter(body, patch) {
  const fm = parseFrontmatter(body);
  return composeNote(fm.content, fm, patch);
}

// ---------- links and tags ----------
/** Blank out code (fenced and inline) so links and tags inside code are ignored; keeps offsets. */
export function maskCode(text) {
  return String(text).replace(/```[\s\S]*?(```|$)|~~~[\s\S]*?(~~~|$)/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

const LINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
/** Every [[link]] in the text: { raw, embed, target, heading, alias, index }. */
export function parseLinks(text) {
  const masked = maskCode(text);
  const out = [];
  for (const m of masked.matchAll(LINK_RE)) {
    const inner = String(text).slice(m.index + m[1].length + 2, m.index + m[0].length - 2);
    const bar = inner.indexOf('|');
    const ref = bar >= 0 ? inner.slice(0, bar) : inner;
    const alias = bar >= 0 ? inner.slice(bar + 1).trim() : null;
    const hashAt = ref.search(/[#^]/);
    const target = (hashAt >= 0 ? ref.slice(0, hashAt) : ref).trim();
    const heading = hashAt >= 0 ? ref.slice(hashAt).trim() : null;
    out.push({ raw: String(text).slice(m.index, m.index + m[0].length), embed: m[1] === '!', target, heading, alias, index: m.index });
  }
  return out;
}

const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_/-]+)/gu;
/** Inline #tags (at least one non-digit, not headings) plus frontmatter tags, lower-cased, unique. */
export function parseTags(body) {
  const { data, content } = parseFrontmatter(body);
  const tags = new Set();
  const fmTags = Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(/[,\s]+/) : [];
  for (const t of fmTags) { const s = String(t).replace(/^#/, '').trim().toLowerCase(); if (s) tags.add(s); }
  const masked = maskCode(content).replace(/\[\[[^\]\n]*\]\]/g, (m) => ' '.repeat(m.length)).replace(/\]\([^)\n]*\)/g, (m) => ' '.repeat(m.length));
  for (const m of masked.matchAll(TAG_RE)) {
    const t = m[2].replace(/[/-]+$/, '');
    if (t && /[^\d]/.test(t)) tags.add(t.toLowerCase());
  }
  return [...tags].sort();
}

export function noteTitle(note) {
  return basename(note.path);
}

// ---------- the index: resolution, backlinks, unresolved ----------
/**
 * Build lookups for a set of notes (trash excluded). Resolution follows Obsidian:
 * a path match first (Folder/Name), then the note name, then aliases. With several
 * notes of the same name, the one in the linking note's folder wins, else the shortest path.
 */
export function buildIndex(notes) {
  const live = notes.filter((n) => !isTrashed(n.path));
  const byPath = new Map(live.map((n) => [n.path.toLowerCase(), n]));
  const byName = new Map();
  const add = (key, n) => { const k = key.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(n); };
  for (const n of live) {
    add(basename(n.path), n);
    const aliases = parseFrontmatter(n.body).data.aliases;
    for (const a of Array.isArray(aliases) ? aliases : aliases ? [aliases] : []) add(String(a), n);
  }
  const resolve = (target, fromPath = '') => {
    const t = normalizePath(target);
    if (!t) return null;
    const exact = byPath.get(t.toLowerCase());
    if (exact) return exact;
    const cands = byName.get(basename(t).toLowerCase()) || [];
    const inFolder = t.includes('/') ? cands.filter((c) => c.path.toLowerCase().endsWith(`/${t.toLowerCase()}`)) : cands;
    const pool = inFolder.length ? inFolder : t.includes('/') ? [] : cands;
    if (!pool.length) return null;
    const here = dirname(fromPath);
    return pool.find((c) => dirname(c.path) === here) || [...pool].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0];
  };
  const outgoing = new Map();
  const backlinks = new Map();
  const unresolved = new Map();
  for (const n of live) {
    const links = parseLinks(parseFrontmatter(n.body).content).map((l) => ({ ...l, to: resolve(l.target, n.path)?.path || null }));
    outgoing.set(n.path, links);
    for (const l of links) {
      if (l.to) {
        if (!backlinks.has(l.to)) backlinks.set(l.to, []);
        if (!backlinks.get(l.to).some((b) => b.from === n.path)) backlinks.get(l.to).push({ from: n.path, link: l });
      } else if (l.target) {
        if (!unresolved.has(l.target)) unresolved.set(l.target, []);
        unresolved.get(l.target).push(n.path);
      }
    }
  }
  return { notes: live, resolve, outgoing, backlinks, unresolved, byPath };
}

/** The shortest link text that resolves to `path` from anywhere: the name if unique, else the path. */
export function linkTextFor(path, notes) {
  const name = basename(path);
  const same = notes.filter((n) => !isTrashed(n.path) && basename(n.path).toLowerCase() === name.toLowerCase());
  return same.length > 1 ? path.replace(/\.md$/i, '') : name;
}

/**
 * Rename or move notes and update every link that pointed at them.
 * `moves` maps old path → new path. Returns { changed: Map(path → new body), notes: next list }.
 * Links keep their alias, heading and embed marker; a link that also matched a different note isn't touched.
 */
export function applyMoves(notes, moves) {
  const before = buildIndex(notes);
  const next = notes.map((n) => (moves.has(n.path) ? { ...n, path: moves.get(n.path) } : n));
  const changed = new Map();
  for (const n of notes) {
    if (isTrashed(n.path)) continue;
    const fm = parseFrontmatter(n.body);
    const links = parseLinks(fm.content);
    let content = fm.content;
    let shift = 0;
    for (const l of links) {
      const to = before.resolve(l.target, n.path)?.path;
      if (!to || !moves.has(to)) continue;
      const newPath = moves.get(to);
      if (isTrashed(newPath)) continue; // a link to a trashed note stays as written, so restoring brings it back
      const text = linkTextFor(newPath, next);
      const rep = `${l.embed ? '!' : ''}[[${text}${l.heading || ''}${l.alias ? `|${l.alias}` : ''}]]`;
      if (rep === l.raw) continue;
      const at = l.index + shift;
      content = content.slice(0, at) + rep + content.slice(at + l.raw.length);
      shift += rep.length - l.raw.length;
    }
    if (content !== fm.content) {
      const newPath = moves.get(n.path) || n.path;
      changed.set(newPath, fm.hasFrontmatter ? composeNote(content, fm, {}) : content);
    }
  }
  return { changed, notes: next.map((n) => (changed.has(n.path) ? { ...n, body: changed.get(n.path) } : n)) };
}

/** Add `[[target]]` to the end of a note (used when a link is drawn in the graph). */
export function appendLink(body, linkText) {
  const link = `[[${linkText}]]`;
  if (parseLinks(parseFrontmatter(body).content).some((l) => l.target.toLowerCase() === linkText.toLowerCase())) return body;
  const b = String(body).replace(/\s+$/, '');
  return `${b}${b ? '\n\n' : ''}${link}\n`;
}

// ---------- trash ----------
export const trashPathFor = (path) => `${TRASH}/${path}`;
export function restorePathFor(path, existing) {
  const orig = String(path).replace(new RegExp(`^${TRASH}/`), '');
  return uniquePath(orig, existing);
}
/** `Name.md`, or `Name (2).md` if taken. */
export function uniquePath(path, existing) {
  const taken = new Set([...existing].map((p) => p.toLowerCase()));
  if (!taken.has(path.toLowerCase())) return path;
  const dir = dirname(path);
  const name = basename(path);
  for (let i = 2; i < 1000; i += 1) {
    const p = joinPath(dir, `${name} (${i})`);
    if (!taken.has(p.toLowerCase())) return p;
  }
  return joinPath(dir, `${name} ${Date.now()}`);
}

// ---------- search ----------
export function plainText(body) {
  return parseFrontmatter(body).content.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[#*_>`~[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Full-text search: every word must appear in the name or text. Name matches rank first. */
export function searchNotes(notes, query, { tag = null, folder = null, limit = 50 } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const n of notes) {
    if (isTrashed(n.path)) continue;
    if (folder && !(n.path === folder || n.path.startsWith(`${folder}/`))) continue;
    if (tag && !parseTags(n.body).includes(tag.toLowerCase())) continue;
    const name = basename(n.path).toLowerCase();
    const text = plainText(n.body);
    const low = text.toLowerCase();
    if (!words.every((w) => name.includes(w) || low.includes(w))) continue;
    const score = words.reduce((s, w) => s + (name.includes(w) ? 10 : 0) + (low.split(w).length - 1), 0) + (n.updated || 0) / 1e15;
    const first = words.length ? Math.max(0, low.indexOf(words[0])) : 0;
    const snippet = text.slice(Math.max(0, first - 40), first + 120);
    out.push({ note: n, score, snippet: (first > 40 ? '…' : '') + snippet + (text.length > first + 120 ? '…' : '') });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- notes about a dashboard page ----------
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Notes that mention a protocol or token: a link to its page, a #tag with its slug or symbol,
 * its name (any case), or its ticker written in capitals.
 */
export function notesMentioning(notes, { names = [], symbols = [], slugs = [], hrefs = [] } = {}) {
  const res = [
    ...hrefs.filter(Boolean).map((h) => new RegExp(escRe(h) + '(?![\\w-])', 'i')),
    ...names.filter((x) => x && x.length >= 3).map((x) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(x)}(?![\\p{L}\\p{N}])`, 'iu')),
    ...symbols.filter((x) => x && x.length >= 2).map((x) => new RegExp(`(^|[^\\p{L}\\p{N}$])\\$?${escRe(x.toUpperCase())}(?![\\p{L}\\p{N}])`, 'u')),
  ];
  const tagSet = new Set([...slugs, ...symbols].filter(Boolean).map((x) => x.toLowerCase()));
  return notes.filter((n) => !isTrashed(n.path)).filter((n) => {
    const text = `${basename(n.path)}\n${parseFrontmatter(n.body).content}`;
    return res.some((re) => re.test(text)) || parseTags(n.body).some((t) => tagSet.has(t));
  }).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

// ---------- templates ----------
export const TEMPLATES = [
  {
    id: 'blank', label: 'Blank note', folder: '',
    body: '',
  },
  {
    id: 'protocol', label: 'Protocol research', folder: 'Protocols',
    body: `#protocol {{tag}}

Dashboard: {{link}}

## What it does

## Why it matters now

## Numbers to watch
- TVL:
- Fees (30d):
- Revenue (30d):
- Market cap ÷ fees:

## Risks

## Open questions

## Sources
`,
  },
  {
    id: 'thesis', label: 'Token thesis', folder: 'Theses',
    body: `#thesis {{tag}}

Dashboard: {{link}}

## Thesis in one sentence

## What has to be true
1.
2.
3.

## Valuation
- Price:
- Market cap / FDV:
- Upcoming unlocks:

## What would prove me wrong

## Review on
`,
  },
  {
    id: 'catalyst', label: 'Catalyst watch', folder: 'Catalysts',
    body: `#catalyst {{tag}}

Dashboard: {{link}}

## The event
- Date:
- Type: (vote / unlock / launch / other)
- Source:

## Expected impact

## What I'll check afterwards
`,
  },
  {
    id: 'daily', label: 'Daily log', folder: 'Daily',
    body: `#daily

## Markets

## Notes

## To do
- [ ]
`,
  },
];

/** Fill {{title}}, {{date}}, {{link}}, {{tag}} etc. Unknown placeholders become empty. */
export function fillTemplate(body, vars = {}) {
  return String(body).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/[ \t]+\n/g, '\n');
}

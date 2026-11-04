// DOM helpers and reusable components. Text is always inserted with
// textContent (never innerHTML) because names and titles come from APIs and feeds.
import { GLOSSARY } from './glossary.js';
import { dateTime, relative, pct, direction } from './format.js';

/** h('div', {class: 'x', onclick: fn}, child, 'text', [more]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function svgIcon(name) {
  const paths = {
    ext: 'M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
    img: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
    table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
    csv: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
    alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[name] || '');
  svg.append(p);
  return svg;
}

/** Only http(s) URLs become links; anything else (e.g. "javascript:") is shown as plain text. */
export function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}

export function openExternal(u) {
  const url = safeUrl(u);
  if (url) window.open(url, '_blank', 'noopener');
}

// Links that failed the last automatic link check (site/data/broken-links.json).
let BROKEN = new Map();
let BROKEN_AT = null;
export function setBrokenLinks(data) {
  BROKEN = new Map((data?.links || []).map((l) => [l.url, l]));
  BROKEN_AT = data?.checkedAt || null;
}

export function extLink(href, text, attrs = {}) {
  const url = safeUrl(href);
  if (!url) return text ? h('span', {}, text) : null;
  const bad = BROKEN.get(url);
  if (!bad) return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', ...attrs }, text);
  const when = BROKEN_AT ? new Date(BROKEN_AT).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'the last check';
  return h('span', { class: 'link-broken-wrap' },
    h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', ...attrs, class: `${attrs.class || ''} link-broken`.trim(), title: `This link didn't open when it was checked on ${when}${bad.status ? ` (HTTP ${bad.status})` : ''}.` }, text),
    h('span', { class: 'link-flag' }, ` (didn’t open on ${when})`));
}

// ---------- Glossary tooltips ----------
/** A label with a (?) button that explains the term on hover/focus/tap. */
export function term(text, key) {
  const g = GLOSSARY[key];
  if (!g) return h('span', {}, text);
  return h('span', { class: 'term-wrap', style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
    h('span', {}, text),
    h('button', { type: 'button', class: 'qmark', 'data-term': key, 'aria-label': `What is ${g.term}?` }, '?'));
}

let tipEl = null;
let tipFor = null;
function showTip(target) {
  const key = target.dataset.term;
  const g = GLOSSARY[key];
  if (!g) return;
  if (!tipEl) {
    tipEl = h('div', { class: 'tip', role: 'tooltip', id: 'glossary-tip' });
    document.body.append(tipEl);
  }
  tipEl.replaceChildren(h('b', {}, g.term), g.def);
  tipEl.hidden = false;
  target.setAttribute('aria-describedby', 'glossary-tip');
  const r = target.getBoundingClientRect();
  const tw = Math.min(300, window.innerWidth - 24);
  tipEl.style.maxWidth = `${tw}px`;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 12));
  tipEl.style.left = `${left}px`;
  const below = r.bottom + 8;
  tipEl.style.top = `${below}px`;
  requestAnimationFrame(() => {
    const th = tipEl.getBoundingClientRect().height;
    if (below + th > window.innerHeight - 8) tipEl.style.top = `${Math.max(8, r.top - th - 8)}px`;
  });
  tipFor = target;
}
function hideTip() {
  if (tipEl) tipEl.hidden = true;
  if (tipFor) tipFor.removeAttribute('aria-describedby');
  tipFor = null;
}
export function initTooltips() {
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-term]');
    if (t) showTip(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest?.('[data-term]');
    if (t && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-term]');
    if (t) showTip(t);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-term]');
    if (t) {
      e.preventDefault();
      if (tipFor === t) hideTip();
      else showTip(t);
    } else hideTip();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });
}

// ---------- Source lines ----------
function oneSource(p, s, sources, compact) {
  if (s.derived) {
    append(p, [h('span', { class: 'badge calc', 'data-term': 'calculated', tabindex: 0 }, 'Calculated'), `${s.formula}. Inputs: `]);
    (s.from || []).forEach((k, j) => {
      const inner = sources[k];
      if (j) append(p, [', ']);
      if (inner) append(p, [extLink(inner.page || inner.api, inner.name), inner.fetchedAt && !compact ? ` (${dateTime(inner.fetchedAt)})` : '']);
      else append(p, [k]);
    });
    return;
  }
  if (s.stale) append(p, [h('span', { class: 'badge stale', 'data-term': 'stale', tabindex: 0 }, 'Stale')]);
  if (!s.ok && !s.stale) append(p, [h('span', { class: 'badge fail' }, 'Failed')]);
  append(p, [s.page ? extLink(s.page, s.name, { title: s.label || s.name }) : s.name]);
  if (s.label && !compact) append(p, [` (${s.label})`]);
  if (s.api) {
    append(p, [h('span', { class: 'sep' }, '·')]);
    const apiHref = s.api.startsWith('http') ? s.api.split(' ')[0] : null;
    append(p, [apiHref ? extLink(apiHref, compact ? 'API' : 'API endpoint', { title: s.api }) : s.api]);
  }
  const when = s.stale ? s.stale.lastGoodAt : s.fetchedAt;
  if (when) {
    // compact form drops the date only when it's today (UTC), so old data is never ambiguous
    const sameDay = new Date(when).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    const t = h('time', { datetime: when, title: `${dateTime(when)} (${relative(when)})` }, compact && sameDay ? `${dateTime(when).split(', ')[1]}` : dateTime(when));
    append(p, [h('span', { class: 'sep' }, '·'), compact ? '' : 'fetched ', t, compact ? '' : ` (${relative(when)})`]);
  }
  if (s.stale) append(p, [`. Latest attempt failed: ${s.stale.reason}`]);
  if (!s.ok && !s.stale && s.error) append(p, [`: ${compact && s.error.length > 70 ? `${s.error.slice(0, 70)}…` : s.error}`]);
}

/**
 * "Source: DefiLlama ↗ · API endpoint ↗ · fetched 4 Nov 2026, 08:23 UTC (3h ago)"
 * compact: short form for stat tiles. More than two sources collapse into a
 * one-line summary with the full list (every endpoint) one click away.
 */
export function sourceLine(srcs, { sources = {}, prefix = 'Source', compact = false } = {}) {
  const list = (Array.isArray(srcs) ? srcs : [srcs]).filter(Boolean);
  const p = h('p', { class: 'src' });
  if (!list.length) return p;
  if (list.length > 2) {
    const names = [...new Set(list.map((s) => s.name))];
    const times = list.map((s) => (s.stale ? s.stale.lastGoodAt : s.fetchedAt)).filter(Boolean).sort();
    const det = h('details', { class: 'src-details' });
    const sum = h('summary', {}, `${prefix}s: ${names.join(', ')}`, times.length ? ` · fetched ${dateTime(times[times.length - 1])} (${relative(times[times.length - 1])})` : '', list.some((s) => s.stale) ? ' · some stale' : '', list.some((s) => !s.ok && !s.stale) ? ' · some failed' : '', ' — show links');
    det.append(sum, h('ul', {}, list.map((s) => { const li = h('li'); oneSource(li, s, sources, false); return li; })));
    p.append(det);
    return p;
  }
  append(p, [`${prefix}${list.length > 1 ? 's' : ''}: `]);
  list.forEach((s, i) => {
    if (i) append(p, [h('span', { class: 'sep' }, compact ? '·' : '|')]);
    oneSource(p, s, sources, compact);
  });
  return p;
}

export function unavailable(title, reason) {
  return h('div', { class: 'unavailable', role: 'note' }, svgIcon('alert'), h('div', {}, h('div', { class: 'u-title' }, title || 'Unavailable'), reason ? h('div', {}, reason) : null));
}

// ---------- Takeaway headline ----------
export function takeaway(t, fallback, { big = false, tag = 'h3' } = {}) {
  const el = h(tag, { class: `takeaway${big ? ' big' : ''}` });
  if (t && t.hl) append(el, [t.pre || '', h('span', { class: 'hl' }, t.hl), t.post || '']);
  else append(el, [fallback || '']);
  el.dataset.plain = el.textContent;
  return el;
}

// ---------- Delta + stat tile ----------
export function delta(v, per, { upIsGood = true } = {}) {
  const dir = direction(v);
  const good = dir === 'flat' ? 'flat' : (dir === 'up') === upIsGood ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  // long label on wide screens ("7d vs prior 7d"), short on phones ("7d")
  const short = per ? per.split(' ')[0] : null;
  const perEl = per ? h('span', { class: 'per' }, short !== per ? [h('span', { class: 'per-long' }, per), h('span', { class: 'per-short' }, short)] : per) : null;
  return h('span', { class: `delta ${v == null ? 'flat' : good}`, title: per ? `${pct(v)} ${per}` : pct(v) }, v == null ? '— ' : `${arrow} ${pct(v)}`, perEl);
}

/**
 * Stat tile. value: formatted string; raw: number (null → unavailable).
 * deltas: [{v, per}]; src: source record; spark: element.
 */
export function statTile({ label, termKey, value, raw, deltas = [], src, sources, spark, unavailableReason, note }) {
  const tile = h('div', { class: 'stat' });
  append(tile, [h('div', { class: 'stat-label' }, termKey ? term(label, termKey) : label)]);
  if (raw === null || raw === undefined) {
    append(tile, [h('div', { class: 'stat-value unavail' }, 'Unavailable'), h('div', { class: 'src' }, unavailableReason || src?.error || 'No data from the source this run')]);
    if (src) append(tile, [sourceLine(src, { sources, compact: true })]);
    return tile;
  }
  append(tile, [h('div', { class: 'stat-value', title: value }, value)]);
  if (deltas.length) append(tile, [h('div', { class: 'deltas' }, deltas.map((d) => delta(d.v, d.per, d)))]);
  if (note) append(tile, [h('div', { class: 'src', style: { marginTop: '4px' } }, note)]);
  if (spark) append(tile, [spark]);
  if (src) append(tile, [sourceLine(src, { sources, compact: true })]);
  return tile;
}

// ---------- Section band ----------
export function band({ n, tag, title, sub, chips = [] }) {
  return h('header', { class: 'band' },
    h('div', { class: 'band-tag' }, tag),
    h('div', {},
      h('h1', { class: 'band-title' }, title),
      sub ? h('p', { class: 'band-sub' }, sub) : null,
      chips.length ? h('div', { class: 'band-meta' }, chips) : null),
    h('div', { class: 'band-num', 'aria-hidden': 'true' }, h('span', { 'data-n': n }, n)));
}

export function subhead(kicker, title, right) {
  return h('div', { class: 'subhead' }, h('div', {}, h('div', { class: 'kicker' }, kicker), title ? h('h2', {}, title) : null), right || null);
}

/** Segmented control: options [{value, label}] */
export function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label || 'Options' });
  const render = (v) => {
    wrap.replaceChildren(...options.map((o) => h('button', { type: 'button', 'aria-pressed': String(o.value === v), onclick: () => { render(o.value); onChange(o.value); } }, o.label)));
  };
  render(value);
  return wrap;
}

// ---------- Sparkline (tiny inline SVG) ----------
export function sparkline(values, { color = 'var(--mark)', height = 34, fill = true } = {}) {
  const vals = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.width = '100%';
  svg.style.height = `${height}px`;
  if (vals.length < 2) return svg;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 100, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  if (fill) {
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', `${d} L100,${height} L0,${height} Z`);
    area.setAttribute('fill', color);
    area.setAttribute('opacity', '0.12');
    svg.append(area);
  }
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  return svg;
}

export function loadingBlock(lines = 3) {
  return h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { height: i ? '220px' : '120px' } })));
}

export function pageError(message) {
  return h('div', { class: 'card', style: { marginTop: '24px' } }, unavailable('This page could not load its data', message));
}

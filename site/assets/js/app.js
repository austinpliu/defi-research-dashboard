// App shell: header, ticker, search, theme, freshness, and a hash router.
import { h, append, svgIcon, initTooltips, pageError, setBrokenLinks } from './ui.js';
import { loadSafe } from './data.js';
import { disposeAll, rethemeAll } from './charts.js';
import { mountPending, clearPending } from './cards.js';
import { usd, pct, relative, dateTime, direction } from './format.js';
import { parseHash } from './route.js';
import * as home from './pages/home.js';
import * as protocols from './pages/protocols.js';
import * as protocol from './pages/protocol.js';
import * as tokens from './pages/tokens.js';
import * as token from './pages/token.js';
import * as compare from './pages/compare.js';
import * as catalysts from './pages/catalysts.js';
import * as screener from './pages/screener.js';
import * as glossary from './pages/glossary.js';
import * as sources from './pages/sources.js';
import * as notes from './pages/notes.js';
import * as fundamentals from './pages/fundamentals.js';
import { saveAllEditors } from './notes/editor.js';
import { initNotesPanel } from './notes/panel.js';

export const SECTIONS = {
  home: { label: 'Overview', accent: 'orange', n: '01', href: '#/' },
  protocols: { label: 'Protocols', accent: 'yellow', n: '02', href: '#/protocols' },
  tokens: { label: 'Tokens', accent: 'pink', n: '03', href: '#/tokens' },
  compare: { label: 'Compare', accent: 'green', n: '04', href: '#/compare' },
  catalysts: { label: 'Catalysts', accent: 'purple', n: '05', href: '#/catalysts' },
  screener: { label: 'Screener', accent: 'blue', n: '06', href: '#/screener' },
  fundamentals: { label: 'Fundamentals', accent: 'green', n: '10', href: '#/fundamentals' },
  glossary: { label: 'Glossary', accent: 'gray', n: '07', href: '#/glossary' },
  sources: { label: 'Sources', accent: 'gray', n: '08', href: '#/sources' },
  notes: { label: 'Notes', accent: 'yellow', n: '09', href: '#/notes' },
};

const ROUTES = [
  { re: /^\/?$/, mod: home, nav: 'home' },
  { re: /^\/protocols\/?$/, mod: protocols, nav: 'protocols' },
  { re: /^\/protocol\/([^/]+)\/?$/, mod: protocol, nav: 'protocols' },
  { re: /^\/tokens\/?$/, mod: tokens, nav: 'tokens' },
  { re: /^\/token\/([^/]+)\/?$/, mod: token, nav: 'tokens' },
  { re: /^\/compare\/?$/, mod: compare, nav: 'compare' },
  { re: /^\/catalysts\/?$/, mod: catalysts, nav: 'catalysts' },
  { re: /^\/screener\/?$/, mod: screener, nav: 'screener' },
  { re: /^\/glossary\/?$/, mod: glossary, nav: 'glossary' },
  { re: /^\/sources\/?$/, mod: sources, nav: 'sources' },
  { re: /^\/notes(?:\/(.+?))?\/?$/, mod: notes, nav: 'notes' },
  { re: /^\/fundamentals(?:\/([^/]+))?\/?$/, mod: fundamentals, nav: 'fundamentals' },
];

// ---------- theme ----------
function currentTheme() {
  const stored = document.documentElement.dataset.theme;
  if (stored) return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function syncThemeButton() {
  const theme = currentTheme();
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.replaceChildren(svgIcon(theme === 'dark' ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  syncThemeButton();
  requestAnimationFrame(rethemeAll);
}

// ---------- header ----------
function buildHeader() {
  const header = document.getElementById('topbar');
  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' },
    Object.entries(SECTIONS).map(([key, s]) => h('a', { href: s.href, 'data-nav': key, class: `acc-${s.accent}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), s.label)));
  const searchInput = h('input', { type: 'search', placeholder: matchMedia('(max-width: 600px)').matches ? 'Search' : 'Find a protocol or token', 'aria-label': 'Find a protocol or token', autocomplete: 'off', id: 'search' });
  const results = h('div', { class: 'search-results', hidden: true, role: 'listbox' });
  const search = h('div', { class: 'search' }, svgIcon('search'), searchInput, results);
  const fresh = h('a', { class: 'freshness', href: '#/sources', id: 'freshness', title: 'When the data was last fetched' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }), h('span', {}, 'Loading…'));
  const themeBtn = h('button', { type: 'button', class: 'icon-btn', id: 'theme-btn' });
  themeBtn.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  header.replaceChildren(
    h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#/', 'aria-label': 'DeFi Research Dashboard, home' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'D'), h('span', { class: 'brand-name' }, 'DeFi Research', h('small', {}, 'Dashboard'))),
      nav,
      h('div', { class: 'top-actions' }, search, fresh, themeBtn)),
    h('div', { class: 'ticker', id: 'ticker', 'aria-label': 'Watchlist prices' }));
  setupSearch(searchInput, results);
}

async function setupFreshness() {
  const { data: meta } = await loadSafe('meta.json');
  const el = document.getElementById('freshness');
  if (!el) return;
  if (!meta) {
    el.lastChild.textContent = 'No data yet';
    el.classList.add('stale');
    return;
  }
  const age = (Date.now() - Date.parse(meta.generatedAt)) / 36e5;
  el.classList.toggle('old', age > 8 && age <= 24);
  el.classList.toggle('stale', age > 24);
  el.title = `Data fetched ${dateTime(meta.generatedAt)}. ${meta.counts?.failed || 0} of ${meta.counts?.requests || 0} requests failed. Click for details.`;
  el.lastChild.replaceChildren(h('span', { class: 'label-long' }, 'Updated '), relative(meta.generatedAt));
}

async function setupTicker() {
  const { data: index } = await loadSafe('index.json');
  const el = document.getElementById('ticker');
  if (!el || !index) return;
  const items = index.protocols.filter((p) => p.price != null);
  if (!items.length) { el.hidden = true; return; }
  const row = () => items.map((p) => h('a', { class: 'ticker-item', href: p.tokenId ? `#/token/${p.tokenId}` : `#/protocol/${p.slug}` },
    h('b', {}, p.symbol || p.name), h('span', { class: 'num' }, usd(p.price)),
    h('span', { class: `chg delta ${direction(p.priceChange24h)}` }, `${direction(p.priceChange24h) === 'up' ? '▲' : direction(p.priceChange24h) === 'down' ? '▼' : '■'} ${pct(p.priceChange24h)}`),
    h('span', { class: 'muted' }, 'TVL ', usd(p.tvl))));
  const track = h('div', { class: 'ticker-track' }, row(), row().map((n) => { n.setAttribute('aria-hidden', 'true'); n.tabIndex = -1; return n; }));
  el.replaceChildren(track);
}

let searchIndex = null;
async function buildSearchIndex() {
  if (searchIndex) return searchIndex;
  const [{ data: index }, { data: scr }] = await Promise.all([loadSafe('index.json'), loadSafe('screener.json')]);
  const list = [];
  for (const p of index?.protocols || []) {
    list.push({ label: p.name, kind: p.group === 'peer' ? 'Protocol (peer)' : 'Protocol (watchlist)', href: `#/protocol/${p.slug}`, keys: `${p.name} ${p.slug} ${p.symbol || ''}`.toLowerCase(), rank: 0 });
    if (p.tokenId) list.push({ label: `${p.symbol || p.name} token`, kind: 'Token', href: `#/token/${p.tokenId}`, keys: `${p.symbol || ''} ${p.tokenId} ${p.name}`.toLowerCase(), rank: 1 });
  }
  const tracked = new Set((index?.protocols || []).map((p) => p.slug));
  for (const r of scr?.rows || []) {
    if (tracked.has(r.slug) || tracked.has(r.parent)) continue;
    list.push({ label: r.name, kind: `${r.category} · in Screener`, href: `#/screener?q=${encodeURIComponent(r.name)}`, keys: `${r.name} ${r.slug} ${r.symbol || ''}`.toLowerCase(), rank: 2 });
  }
  searchIndex = list;
  return list;
}
function setupSearch(input, results) {
  let active = 0;
  let current = [];
  const close = () => { results.hidden = true; };
  const render = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { close(); return; }
    const idx = await buildSearchIndex();
    current = idx.filter((x) => x.keys.includes(q)).sort((a, b) => a.rank - b.rank || (a.keys.startsWith(q) ? -1 : 1)).slice(0, 10);
    active = 0;
    results.replaceChildren(...(current.length ? current.map((x, i) => h('a', { href: x.href, role: 'option', class: i === active ? 'active' : '', onclick: () => { input.value = ''; close(); } }, h('span', {}, x.label), h('span', { class: 'kind' }, x.kind))) : [h('div', { class: 'muted', style: { padding: '8px 10px', fontSize: '13px' } }, 'No match. Add it to watchlist.json to get a full page.')]));
    results.hidden = false;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { buildSearchIndex(); if (input.value) render(); });
  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    const links = [...results.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('active', i === active));
    } else if (e.key === 'Enter' && links[active]) {
      e.preventDefault();
      location.hash = links[active].getAttribute('href');
      input.value = '';
      close();
    } else if (e.key === 'Escape') close();
  });
  document.addEventListener('click', (e) => { if (!results.contains(e.target) && e.target !== input) close(); });
}

// ---------- router ----------
let renderToken = 0;
async function route() {
  saveAllEditors();
  const { path, query } = parseHash();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  const main = document.getElementById('main');
  disposeAll();
  clearPending();
  const token = ++renderToken;
  if (!match) {
    main.className = 'acc-gray';
    main.replaceChildren(pageError(`There is no page at “${path}”.`));
    return;
  }
  const sec = SECTIONS[match.r.nav];
  main.className = `acc-${sec.accent}`;
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === match.r.nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = match.r.nav === 'home' ? 'DeFi Research Dashboard' : `${sec.label} · DeFi Research Dashboard`; // pages may set a more specific title
  const frag = h('div', { class: 'page' });
  main.replaceChildren(h('div', { class: 'loading', 'aria-busy': 'true' }, 'Loading data…'));
  try {
    await match.r.mod.render(frag, { params: match.m.slice(1), query, section: sec });
  } catch (e) {
    console.error(e);
    frag.replaceChildren(pageError(`Something went wrong while drawing this page: ${e.message}`));
  }
  if (token !== renderToken) return; // a newer navigation won
  main.replaceChildren(frag);
  mountPending();
  if (!history.state?.keepScroll) window.scrollTo({ top: 0 });
  main.focus({ preventScroll: true });
}

export function navigate(hash) {
  location.hash = hash;
}

function init() {
  let stored = null;
  try { stored = localStorage.getItem('theme'); } catch { /* ignore */ }
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  buildHeader();
  initNotesPanel();
  syncThemeButton();
  initTooltips();
  setupFreshness();
  setupTicker();
  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) { syncThemeButton(); rethemeAll(); }
  });
  // mark links that failed the last link check; never hold the page up for more than a moment
  Promise.race([loadSafe('broken-links.json'), new Promise((r) => setTimeout(r, 700))])
    .then((res) => { if (res?.data) setBrokenLinks(res.data); })
    .finally(route);
  const yr = document.getElementById('footer-meta');
  if (yr) loadSafe('meta.json').then(({ data }) => { if (data) append(yr, [`Data fetched ${dateTime(data.generatedAt)} by `, data.run?.url ? h('a', { href: data.run.url, target: '_blank', rel: 'noopener' }, 'this GitHub Actions run') : 'a local run', '.']); });
}

init();

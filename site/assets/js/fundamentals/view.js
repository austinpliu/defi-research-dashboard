// Rendering pieces shared by the Fundamentals page and the compact card on protocol/token pages.
import { h, extLink, term } from '../ui.js';
import { usd, pct, ratio, compact } from '../format.js';
import { CHECKS, STATUS, evaluateAll } from './rules.js';
import { loadSafe } from '../data.js';
import { loadDefaults, effective, getUser, onUserChange } from './settings.js';
import { startSettings, storageError } from './storage.js';

export const STATUS_WORD = { strong: 'strong', mixed: 'mixed', weak: 'weak', nodata: 'no data', na: 'doesn’t apply' };
export const RESEARCH_AID = 'A research aid, not a rating or a buy signal. Each check compares public data with thresholds you can change; read the numbers and sources before drawing conclusions.';

/** ✓ / ~ / ✗ / no data / — badge. Icon plus word, so it never relies on colour. */
export function statusBadge(status, { short = false } = {}) {
  const icon = STATUS[status] ?? 'no data';
  return h('span', { class: `fc-st st-${status}`, title: STATUS_WORD[status] || status },
    status === 'nodata' ? h('span', { class: 'fc-ico' }, 'no data') : h('span', { class: 'fc-ico', 'aria-hidden': 'true' }, icon),
    status === 'nodata' ? null : short ? h('span', { class: 'sr-only' }, STATUS_WORD[status]) : h('span', { class: 'fc-word' }, STATUS_WORD[status]));
}

const signed = (v, unit) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}${unit}`;
export function fmtNumber(n) {
  const v = n.value;
  if (v === null || v === undefined) return 'no data';
  switch (n.unit) {
    case 'usd': return usd(v);
    case 'pct': return pct(v, { signed: false });
    case 'pctChange': return pct(v);
    case 'x': return ratio(v);
    case 'tokens': return compact(v, 2);
    case 'years': return `${v.toFixed(1)} years`;
    case 'count': return String(v);
    case 'pts': return signed(v, ' pts');
    default: return String(v);
  }
}
export function csvNumber(n) { return n.value === null || n.value === undefined ? 'no data' : n.value; }

/** Source records behind a number (its src key or keys), looked up in the protocol's sources. */
export function sourcesOf(n, sources) {
  const keys = Array.isArray(n.src) ? n.src : n.src ? [n.src] : [];
  return keys.map((k) => sources?.[k]).filter(Boolean);
}
/** "DefiLlama ↗ · CoinGecko ↗" links (page first, else API), plus any hand-entered links. */
export function sourceLinks(n, sources) {
  const recs = sourcesOf(n, sources);
  const links = [];
  const seen = new Set();
  for (const r of recs) {
    const url = r.page || r.api;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(extLink(url, r.name, { title: `${r.name}${r.label ? `: ${r.label}` : ''}${r.api ? ` · API ${r.api}` : ''}` }));
  }
  (n.links || []).forEach((u, i) => { if (!seen.has(u)) { seen.add(u); links.push(extLink(u, n.links.length > 1 ? `source ${i + 1}` : 'source')); } });
  if (!links.length) return h('span', { class: 'muted' }, '—');
  return h('span', { class: 'fc-links' }, links.flatMap((l, i) => (i ? [' · ', l] : [l])));
}

/** The numbers behind a check, as a small table (label, value, sources). */
export function numbersTable(check, sources) {
  return h('table', { class: 'fc-nums' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Number'), h('th', { scope: 'col', class: 'num' }, 'Value'), h('th', { scope: 'col' }, 'Source'))),
    h('tbody', {}, check.numbers.map((n) => h('tr', {},
      h('th', { scope: 'row' }, n.label, n.note ? h('span', { class: 'fc-note' }, n.note) : null),
      h('td', { class: `num${n.value === null ? ' muted' : ''}` }, n.unit === 'text' && n.value && n.value.length > 40 ? h('span', { class: 'fc-text' }, n.value) : fmtNumber(n)),
      h('td', {}, sourceLinks(n, sources))))));
}

const TERMS = { holders: 'holdersRevenue', size: 'mcapToRevenue', call: 'feeSwitch', supply: 'overhang', liquidity: 'float', track: 'ath', narrative: 'narrative' };
/** One check as a card: number, label, status, the sentence, then the numbers. */
export function checkCard(def, check, sources) {
  return h('section', { class: `card fc-check st-${check.status}`, id: `check-${def.id}` },
    h('div', { class: 'card-top' }, h('div', { class: 'kicker' }, `Check ${def.n} · `, term(def.label, TERMS[def.id]))),
    h('div', { class: 'fc-head' }, statusBadge(check.status), h('p', { class: 'fc-why' }, check.why)),
    check.rank ? h('p', { class: 'fc-rank' }, `Rank ${check.rank} of ${check.of} on the watchlist (lowest market cap ÷ revenue first; ties share a rank).`) : null,
    numbersTable(check, sources));
}

/** Plain-text version of one protocol's checklist (for notes and CSV). */
export function checklistMarkdown(p, checks, { custom, link }) {
  const lines = [`# ${p.name} fundamentals checklist`, '', `${link} · ${new Date().toISOString().slice(0, 10)}${custom ? ' · using my custom thresholds' : ''}`, '', `> ${RESEARCH_AID}`, ''];
  for (const def of CHECKS) {
    const c = checks[def.id];
    lines.push(`## ${def.n}. ${def.label}: ${STATUS[c.status] === 'no data' ? 'no data' : `${STATUS[c.status]} ${STATUS_WORD[c.status]}`}`, '', c.why, '');
    for (const n of c.numbers) {
      const srcs = sourcesOf(n, p.sources).map((r) => `[${r.name}](${r.page || r.api})`).concat((n.links || []).map((u) => `[source](${u})`));
      lines.push(`- ${n.label}: ${fmtNumber(n)}${n.note ? ` (${n.note})` : ''}${srcs.length ? ` · ${srcs.join(', ')}` : ''}`);
    }
    lines.push('');
  }
  lines.push('## My take', '', '');
  return lines.join('\n');
}

/** Load data + defaults + your settings and evaluate every protocol. */
export async function loadChecklist() {
  const [{ data, error }, defaults] = await Promise.all([loadSafe('fundamentals.json'), loadDefaults(), startSettings()]);
  if (!data) return { error };
  if (!defaults.thresholds) return { error: defaults.errors.join(' ') };
  const eff = effective(defaults, getUser());
  if (storageError()) eff.errors.unshift(storageError());
  const now = Date.parse(data.generatedAt) / 1000 || Date.now() / 1000;
  const rows = evaluateAll(data.protocols, eff.values, { valueAccrual: eff.valueAccrual, teamNotes: eff.teamNotes, now });
  return { data, defaults, eff, rows, now };
}

/** "Using your custom settings" notice, plus any settings that were rejected. */
export function settingsNotice(eff) {
  const parts = [];
  if (eff.errors.length) parts.push(h('div', { class: 'notice bad fc-notice', role: 'status' }, h('b', {}, 'Some settings couldn’t be used, so the defaults apply there: '), h('ul', {}, eff.errors.map((e) => h('li', {}, e)))));
  if (eff.custom) parts.push(h('div', { class: 'notice fc-notice' }, h('b', {}, 'Using your custom settings. '), `${eff.changed.length ? `${eff.changed.length} threshold${eff.changed.length > 1 ? 's' : ''} changed from the defaults. ` : ''}`, h('a', { href: '#/fundamentals/settings' }, 'See or reset them')));
  return parts;
}

/** Compact checklist card for protocol and token pages. */
export function checklistCard({ slug, tokenId }) {
  const body = h('div', { class: 'fc-mini-body' }, h('p', { class: 'muted' }, 'Loading the checklist…'));
  const card = h('section', { class: 'card fc-mini acc-green' },
    h('div', { class: 'card-top' }, h('div', { class: 'kicker' }, 'Fundamentals Checklist'), h('div', { class: 'card-tools' }, h('a', { class: 'tool', href: '#/fundamentals' }, 'All protocols'))),
    body);
  const draw = async () => {
    const r = await loadChecklist();
    const row = r.rows?.find((x) => x.p.slug === slug || (tokenId && x.p.tokenId === tokenId));
    if (!row) { body.replaceChildren(h('p', { class: 'muted' }, r.error ? `Checklist unavailable: ${r.error}` : 'No checklist for this one: it covers watchlist protocols that have a token.')); return; }
    body.replaceChildren(
      h('ul', { class: 'fc-mini-list' }, CHECKS.map((def) => h('li', {}, h('a', { href: `#/fundamentals/${row.p.slug}`, title: row.checks[def.id].why }, statusBadge(row.checks[def.id].status, { short: true }), h('span', {}, def.label))))),
      h('p', { class: 'src' }, `${RESEARCH_AID.split('.')[0]}. `, r.eff.custom ? 'Using your custom settings. ' : '', h('a', { href: `#/fundamentals/${row.p.slug}` }, `See the numbers and sources for ${row.p.name} →`)));
  };
  draw();
  const off = onUserChange(() => { if (!card.isConnected) { off(); return; } draw(); });
  return card;
}

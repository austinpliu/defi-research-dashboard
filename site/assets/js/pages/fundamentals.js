// 10 — Fundamentals Checklist: a research aid, not a rating or a buy signal.
// #/fundamentals            overview table (checks as columns), takeaway, "How this works"
// #/fundamentals/<slug>     one protocol: seven check cards, four charts, "New note from this checklist"
// #/fundamentals/settings   your thresholds, value-accrual entries and team notes
import { h, band, takeaway, pageError, subhead } from '../ui.js';
import { chartCard } from '../cards.js';
import { dataTable } from '../table.js';
import { lineChart, hbarChart } from '../charts.js';
import { usd, ratio, compact, date, dateTime } from '../format.js';
import { weeklySum, rollingSum, indexTo100 } from '../series.js';
import { CHECKS, STATUS, statusRank, overviewTakeaway } from '../fundamentals/rules.js';
import { loadChecklist, statusBadge, checkCard, settingsNotice, checklistMarkdown, STATUS_WORD, RESEARCH_AID, fmtNumber } from '../fundamentals/view.js';
import { onUserChange } from '../fundamentals/settings.js';
import { quickCapture } from '../notes/panel.js';
import { pageLink } from '../notes/workspace.js';

const DAY = 86400;
const N = '10';

export async function render(root, ctx) {
  const slug = ctx.params?.[0] ? decodeURIComponent(ctx.params[0]) : null;
  if (slug === 'settings') {
    const settings = await import('../fundamentals/settings-page.js');
    return settings.render(root, ctx);
  }
  const draw = async () => {
    const r = await loadChecklist();
    const frag = h('div');
    if (r.error) frag.append(pageError(r.error));
    else if (slug) detail(frag, r, slug);
    else overview(frag, r);
    root.replaceChildren(...frag.childNodes);
    return r;
  };
  await draw();
  // deep links: ?check=<id> scrolls to that check, ?how=1 opens "How this works"
  const focus = ctx.query?.get('check') ? `check-${ctx.query.get('check')}` : ctx.query?.get('how') ? 'how' : null;
  if (focus) setTimeout(() => { const el = document.getElementById(focus); if (!el) return; if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ block: 'start' }); el.classList.add('fc-flash'); }, 60);
  // live preview: settings changed in another tab or by sync redraw this page
  const off = onUserChange(() => { if (!root.isConnected) { off(); return; } draw().then(() => import('../cards.js').then((m) => m.mountPending())); });
}

const aidNotice = () => h('div', { class: 'notice fc-aid', role: 'note' }, h('b', {}, 'Research aid, not a rating. '), RESEARCH_AID.replace(/^A research aid, not a rating or a buy signal\. /, ''), ' ', h('a', { href: '#/fundamentals?how=1' }, 'How this works'));

// ---------- overview ----------
function overview(root, r) {
  const { rows, eff, data, defaults } = r;
  root.append(band({
    n: N,
    tag: `Section ${N} · Fundamentals Checklist`,
    title: 'Fundamentals Checklist',
    sub: `Seven fundamentals-first checks for each of the ${rows.length} watchlist protocols with a token: does revenue reach holders, what the market pays for it, supply overhang, liquidity, track record and whether the price is running ahead of revenue.`,
    chips: [h('a', { class: 'band-chip', href: '#/fundamentals/settings' }, 'Settings'), h('a', { class: 'band-chip', href: '#/fundamentals?how=1' }, 'How this works'), h('a', { class: 'band-chip', href: '#/glossary' }, 'Glossary')],
  }));
  root.append(aidNotice(), ...settingsNotice(eff));

  const tableRows = rows.map((x) => {
    const row = { slug: x.p.slug, name: x.p.name, symbol: x.p.symbol, tokenId: x.p.tokenId, rank: x.checks.size.rank ?? null, yieldPct: x.holdersYield };
    for (const c of CHECKS) {
      row[c.id] = x.checks[c.id].status;
      row[`f_${c.id}`] = x.checks[c.id].status === 'nodata' ? 'no data' : `${STATUS[x.checks[c.id].status]} ${STATUS_WORD[x.checks[c.id].status]}`;
    }
    return row;
  });
  const columns = [
    { key: 'name', label: 'Protocol', fmt: (v, row) => h('a', { href: `#/fundamentals/${row.slug}`, class: 'name' }, v, row.symbol ? h('span', { class: 'sub' }, ` ${row.symbol}`) : null) },
    ...CHECKS.map((c) => ({
      key: c.id,
      label: `${c.n}. ${c.label}`,
      fmt: (v, row) => h('a', { href: `#/fundamentals/${row.slug}?check=${c.id}`, class: 'fc-cell', title: rows.find((x) => x.p.slug === row.slug)?.checks[c.id].why }, statusBadge(v, { short: true })),
      sortValue: (row) => statusRank(row[c.id]),
      csv: (row) => row[`f_${c.id}`],
    })),
    { key: 'rank', label: 'Mcap ÷ revenue rank', num: true, termKey: 'mcapToRevenue', fmt: (v) => (v ? `${v}` : '—'), sortValue: (row) => (row.rank == null ? -Infinity : -row.rank), title: 'Lowest market cap ÷ annualized revenue first; ties share a rank' },
    { key: 'yieldPct', label: 'Holders revenue ÷ mcap', num: true, fmt: (v) => (v == null ? 'no data' : `${v.toFixed(1)}%`), csv: (row) => row.yieldPct, title: 'Annualized holders revenue ÷ market cap' },
  ];
  const card = h('section', { class: 'card fc-overview' },
    h('div', { class: 'kicker' }, 'Watchlist · seven checks'),
    takeaway(overviewTakeaway(rows), 'The checklist for every watchlist protocol', { big: true }),
    h('p', { class: 'chart-note' }, 'Click a status to see the numbers and sources behind it. ✓ strong · ~ mixed · ✗ weak · no data (the reason is on the detail page) · — doesn’t apply. Sort by any column; filter by status below.'),
    dataTable({
      caption: 'Fundamentals Checklist', columns, rows: tableRows, sortKey: 'rank', sortDir: 'desc', search: true, pageSize: 50, csvName: 'fundamentals-checklist',
      filters: CHECKS.map((c) => ({ key: `f_${c.id}`, label: c.label, plural: `“${c.label}” statuses` })),
    }),
    h('p', { class: 'src' }, `Inputs gathered ${dateTime(data.generatedAt)} from DefiLlama, CoinGecko and DEX data (each detail page links every number to its source). Statuses are calculated in your browser from those inputs and the thresholds below.`));
  root.append(card);
  root.append(howItWorks(defaults.thresholds, eff));
}

// ---------- "How this works" ----------
const RULES = {
  holders: (v) => `✓ when at least ${v['holders.shareStrong']}% of revenue reaches holders and that is at least ${usd(v['holders.minAnnual'])} a year; ✗ under ${v['holders.shareWeak']}%, or no revenue at all. Uses DefiLlama’s holders revenue (buybacks, burns, staker payouts).`,
  size: (v) => `Market cap ÷ annualized revenue (last 30 days × 365 ÷ 30). ✓ at or under ${v['size.peStrong']}×, ✗ at or over ${v['size.peWeak']}× or with no revenue. Ranks the watchlist, lowest first; ties share a rank.`,
  call: (v) => `Spots a protocol earning at least ${usd(v['call.minRevenue'])} a year with ${v['call.maxHoldersShare']}% or less reaching holders: an option on a future fee switch. ~ when only the pattern is there; ✓ when an announced plan is recorded in value-accrual.json or your settings (with a source); — when it doesn’t apply.`,
  supply: (v) => `✓ when at least ${v['supply.circStrong']}% of max supply circulates and unlocks in the next 12 months are at most ${v['supply.unlockStrong']}% of circulating; ✗ under ${v['supply.circWeak']}% circulating or over ${v['supply.unlockWeak']}% unlocking. Also shows market cap ÷ FDV and how long the price has stayed inside a ${v['supply.rangeBand']}× band (context only).`,
  liquidity: (v) => `DEX liquidity and 24h volume as a share of market cap. ✗ when DEX liquidity is under ${v['liquidity.liqWeak']}% (thin); ✓ at ${v['liquidity.liqStrong']}% or more with daily volume of at least ${v['liquidity.volStrong']}%.`,
  track: (v) => `✓ after ${v['track.ageStrong']}+ years live, keeping at least ${v['track.retentionStrong']}% of peak TVL through its worst drawdown; ✗ under ${v['track.ageWeak']} year, a drawdown below ${v['track.retentionWeak']}%, or over ${usd(v['track.hackLossWeak'])} lost to hacks and not returned. Team notes are context only.`,
  narrative: (v) => `90-day price change minus the change in revenue (last 90 days vs the 90 before). ✗ when the price is more than ${v['narrative.aheadPts']} points ahead; ✓ when revenue is more than ${v['narrative.lagPts']} points ahead (possibly overlooked).`,
};
function howItWorks(config, eff) {
  const meta = config.thresholds;
  const det = h('details', { class: 'card fc-how', id: 'how' },
    h('summary', {}, h('span', { class: 'kicker' }, 'How this works'), h('span', { class: 'fc-how-t' }, 'The seven checks, their rules and every threshold')),
    h('p', {}, RESEARCH_AID, ' Missing numbers are shown as “no data” with the reason; nothing is estimated. Defaults live in ', h('a', { href: 'config/fundamentals-thresholds.json', target: '_blank', rel: 'noopener' }, 'config/fundamentals-thresholds.json'), '; your changes in ', h('a', { href: '#/fundamentals/settings' }, 'Settings'), ' apply only to you.'),
    h('ol', { class: 'fc-rules' }, CHECKS.map((c) => h('li', {}, h('b', {}, `${c.label}. `), RULES[c.id](eff.values)))),
    h('div', { class: 'table-wrap' }, h('table', { class: 'fc-thresholds' },
      h('thead', {}, h('tr', {}, ['Threshold', 'Now', 'Default', 'What it does'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, Object.entries(meta).map(([k, m]) => h('tr', { class: eff.changed.includes(k) ? 'fc-changed' : '' },
        h('th', { scope: 'row' }, m.label, eff.changed.includes(k) ? h('span', { class: 'fc-tag' }, 'changed') : null),
        h('td', { class: 'num' }, fmtThreshold(eff.values[k], m.unit)),
        h('td', { class: 'num muted' }, fmtThreshold(m.default, m.unit)),
        h('td', {}, m.help)))))));
  return det;
}
export function fmtThreshold(v, unit) {
  if (typeof v !== 'number') return '—';
  if (unit === 'usd') return usd(v);
  if (unit === '%') return `${v}%`;
  if (unit === 'x') return `${v}×`;
  if (unit === 'years') return `${v} yr`;
  if (unit === 'pts') return `${v} pts`;
  return String(v);
}

// ---------- detail ----------
function detail(root, r, slug) {
  const row = r.rows.find((x) => x.p.slug === slug || x.p.tokenId === slug);
  if (!row) { root.append(pageError(`No checklist for “${slug}”. It covers the watchlist protocols in watchlist.json.`)); return; }
  const { p, checks } = row;
  const S = p.sources || {};
  document.title = `${p.name} fundamentals · DeFi Research Dashboard`;
  root.append(band({
    n: N,
    tag: `Section ${N} · Fundamentals Checklist`,
    title: p.name,
    sub: `Seven fundamentals-first checks${p.symbol ? ` for ${p.name} and its ${p.symbol} token` : ''}, each with the numbers behind it and their sources.`,
    chips: [h('a', { class: 'band-chip', href: '#/fundamentals' }, '← All protocols'), h('a', { class: 'band-chip', href: `#/protocol/${p.slug}` }, 'Protocol page'), p.tokenId ? h('a', { class: 'band-chip', href: `#/token/${p.tokenId}` }, 'Token page') : null, h('a', { class: 'band-chip', href: '#/fundamentals/settings' }, 'Settings')].filter(Boolean),
  }));
  root.append(aidNotice(), ...settingsNotice(r.eff));

  // summary strip + note button
  const noteBtn = h('button', { type: 'button', class: 'tool primary', onclick: () => quickCapture(checklistMarkdown(p, checks, { custom: r.eff.custom, link: pageLink(`${p.name} fundamentals`) })) }, 'New note from this checklist');
  root.append(h('section', { class: 'card fc-strip' },
    h('ul', { class: 'fc-mini-list' }, CHECKS.map((c) => h('li', {}, h('a', { href: `#check-${c.id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`check-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, statusBadge(checks[c.id].status, { short: true }), h('span', {}, c.label))))),
    h('div', { class: 'fc-strip-tools' }, noteBtn, h('span', { class: 'muted' }, 'Opens a note in your notes panel with every status, number and source, plus a “My take” section. It stays in your browser.'))));

  const grid = h('div', { class: 'grid fc-grid' });
  CHECKS.forEach((c) => grid.append(h('div', { class: 'span-6' }, checkCard(c, checks[c.id], S))));
  root.append(grid);

  root.append(subhead('Charts', 'The numbers over time'));
  const charts = h('div', { class: 'grid' });
  root.append(charts);
  charts.append(h('div', { class: 'span-6' }, holdersChart(p, S)));
  charts.append(h('div', { class: 'span-6' }, peChart(p, S)));
  charts.append(h('div', { class: 'span-6' }, supplyChart(p, S, checks.supply)));
  charts.append(h('div', { class: 'span-6' }, priceRevenueChart(p, S, checks.narrative)));
}

const dateCol = { key: 'ts', label: 'Week ending', fmt: (v) => new Date(v * 1000).toISOString().slice(0, 10), csv: (row) => new Date(row.ts * 1000).toISOString().slice(0, 10) };

function holdersChart(p, S) {
  const rev = weeklySum(p.revenue?.daily || []);
  const hr = p.holdersRevenue?.unavailable ? [] : weeklySum(p.holdersRevenue?.daily || []);
  const src = [S[p.revenue?.src], S[p.holdersRevenue?.src]].filter(Boolean);
  if (!rev.length) return chartCard({ kicker: 'Revenue', fallback: 'Holders revenue vs total revenue', unavailableReason: p.revenue?.unavailable || 'No revenue history from DefiLlama.', src, sources: S });
  const series = [{ name: 'Revenue', data: rev }];
  if (hr.length) series.push({ name: 'Holders revenue', data: hr });
  const tot = rev.reduce((s, [, v]) => s + v, 0);
  const hTot = hr.reduce((s, [, v]) => s + v, 0);
  const byTs = new Map(hr);
  return chartCard({
    kicker: 'Check 1 · Revenue to holders',
    termKey: 'holdersRevenue',
    take: hr.length && tot > 0 ? { pre: `Over the last ${rev.length} weeks, `, hl: `${((hTot / tot) * 100).toFixed(0)}% of ${p.name}’s revenue reached token holders`, post: '' } : null,
    fallback: hr.length ? `${p.name} made no revenue in this period` : `No holders-revenue data for ${p.name}`,
    title: 'Weekly revenue and holders revenue (USD)',
    note: hr.length ? null : `Holders revenue unavailable: ${p.holdersRevenue?.unavailable || 'no data'}.`,
    build: lineChart({ series, minZero: true }),
    legend: series.length > 1 ? [{ name: 'Revenue', color: 'var(--s1)' }, { name: 'Holders revenue', color: 'var(--s2)' }] : [],
    src, sources: S,
    csvName: `${p.slug}-holders-revenue-weekly`,
    table: () => ({ columns: [dateCol, { key: 'rev', label: 'Revenue', num: true, fmt: (v) => usd(v), csv: (x) => x.rev }, { key: 'hr', label: 'Holders revenue', num: true, fmt: (v) => (v == null ? 'no data' : usd(v)), csv: (x) => x.hr ?? '' }], rows: rev.map(([ts, v]) => ({ ts, rev: v, hr: byTs.get(ts) ?? null })) }),
  });
}

function peChart(p, S) {
  const roll = rollingSum(p.revenue?.daily || [], 30).map(([t, v]) => [Math.floor(t / DAY), (v * 365) / 30]);
  const ann = new Map(roll);
  const pts = (p.mcapDaily || []).map(([t, m]) => { const a = ann.get(Math.floor(t / DAY)); return a > 0 && m > 0 ? [t, m / a] : null; }).filter(Boolean);
  const src = [S[p.market?.src] || S[p.seriesSrc], S[p.revenue?.src]].filter(Boolean);
  if (pts.length < 2) return chartCard({ kicker: 'Check 2 · Revenue vs size', fallback: 'Market cap ÷ annualized revenue over time', unavailableReason: !p.mcapDaily?.length ? 'No market-cap history for the token.' : 'No days with both a market cap and positive 30-day revenue.', src, sources: S });
  const last = pts[pts.length - 1][1];
  const first = pts[0][1];
  return chartCard({
    kicker: 'Check 2 · Revenue vs size',
    termKey: 'mcapToRevenue',
    take: { pre: `${p.name}’s market cap is `, hl: `${ratio(last)} its annualized revenue`, post: `, ${last < first ? 'down' : 'up'} from ${ratio(first)} on ${date(pts[0][0])}` },
    title: 'Market cap ÷ annualized revenue (rolling 30 days × 365 ÷ 30)',
    note: 'One line instead of two axes: market cap and revenue are on very different scales, so the chart shows their ratio. Lower means the market pays less per dollar of revenue.',
    build: lineChart({ series: [{ name: 'Market cap ÷ revenue', data: pts }], fmt: ratio, axisFmt: (v) => `${Math.round(v)}×` }),
    src, sources: S,
    csvName: `${p.slug}-mcap-to-revenue`,
    table: () => ({ columns: [{ ...dateCol, label: 'Day' }, { key: 'v', label: 'Market cap ÷ annualized revenue', num: true, fmt: (v) => ratio(v), csv: (x) => x.v }], rows: pts.map(([ts, v]) => ({ ts, v })) }),
  });
}

function supplyChart(p, S, check) {
  const s = p.supply || {};
  const src = [S[s.src], S[p.unlocks?.src]].filter(Boolean);
  if (s.circulating == null) return chartCard({ kicker: 'Check 4 · Supply', fallback: 'Circulating vs max supply', unavailableReason: s.unavailable || 'No circulating supply figure.', src, sources: S });
  const items = [{ name: 'Circulating', value: s.circulating }];
  if (s.total != null) items.push({ name: 'Total supply', value: s.total });
  if (s.max != null) items.push({ name: 'Max supply', value: s.max });
  if (p.unlocks?.next12mTokens != null) items.push({ name: 'Unlocking in 12 months', value: p.unlocks.next12mTokens });
  return chartCard({
    kicker: 'Check 4 · Supply & overhang',
    termKey: 'overhang',
    take: check.circShare != null ? { pre: `${check.circShare.toFixed(0)}% of ${p.symbol || p.name}’s `, hl: 'max supply already circulates', post: '' } : null,
    fallback: s.maxInfinite ? `${p.symbol || p.name} has no max supply` : `${p.symbol || p.name} has no published max supply`,
    title: 'Token supply (number of tokens)',
    note: p.unlocks?.next12mTokens == null ? `Unlocks over the next 12 months: ${p.unlocks?.status === 'unconfirmed' ? 'schedule unconfirmed' : p.unlocks?.status === 'none' ? 'none scheduled' : 'no published sizes'}.` : null,
    build: hbarChart({ items, fmt: (v) => compact(v, 2), name: 'Tokens' }),
    src, sources: S,
    csvName: `${p.slug}-supply`,
    table: () => ({ columns: [{ key: 'name', label: 'Measure' }, { key: 'value', label: 'Tokens', num: true, fmt: (v) => compact(v, 2), csv: (x) => x.value }], rows: items }),
  });
}

function priceRevenueChart(p, S, check) {
  const rev30 = rollingSum(p.revenue?.daily || [], 30);
  const byDay = new Map(rev30.map(([t, v]) => [Math.floor(t / DAY), v]));
  const price = (p.priceDaily || []).filter(([t]) => byDay.get(Math.floor(t / DAY)) > 0);
  const src = [S[p.seriesSrc], S[p.revenue?.src]].filter(Boolean);
  if (price.length < 2) return chartCard({ kicker: 'Check 7 · Narrative', fallback: 'Price vs revenue', unavailableReason: !p.priceDaily?.length ? 'No price history for the token.' : 'No days with both a price and positive 30-day revenue.', src, sources: S });
  const priceIdx = indexTo100(price);
  const revIdx = indexTo100(price.map(([t]) => [t, byDay.get(Math.floor(t / DAY))]));
  const gap = check.numbers.find((n) => n.unit === 'pts');
  return chartCard({
    kicker: 'Check 7 · Narrative vs fundamentals',
    termKey: 'narrative',
    take: check.status !== 'nodata' ? { pre: '', hl: check.why.replace(/:.*$/, '').replace(/\.$/, ''), post: check.status === 'mixed' || gap?.value == null ? '' : ` (${fmtNumber(gap)})` } : null,
    fallback: `${p.name}: price and rolling 30-day revenue, indexed`,
    title: 'Price vs rolling 30-day revenue, both indexed to 100',
    note: 'Both lines start at 100 so their growth can be compared on one axis.',
    build: lineChart({ series: [{ name: 'Price', data: priceIdx }, { name: '30-day revenue', data: revIdx }], fmt: (v) => v.toFixed(0), axisFmt: (v) => v.toFixed(0) }),
    legend: [{ name: 'Price', color: 'var(--s1)' }, { name: '30-day revenue', color: 'var(--s2)' }],
    src, sources: S,
    csvName: `${p.slug}-price-vs-revenue`,
    table: () => ({ columns: [{ ...dateCol, label: 'Day' }, { key: 'pr', label: 'Price (index)', num: true, fmt: (v) => v.toFixed(1), csv: (x) => x.pr }, { key: 'rv', label: '30-day revenue (index)', num: true, fmt: (v) => v.toFixed(1), csv: (x) => x.rv }], rows: priceIdx.map(([ts, v], i) => ({ ts, pr: v, rv: revIdx[i]?.[1] })) }),
  });
}


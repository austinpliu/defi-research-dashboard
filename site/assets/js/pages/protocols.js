// 02 — Watchlist protocols overview
import { h, band, sourceLine, subhead, extLink, pageError, sparkline, takeaway } from '../ui.js';
import { chartCard } from '../cards.js';
import { loadMany } from '../data.js';
import { hbarChart } from '../charts.js';
import { dataTable } from '../table.js';
import { usd, pct, ratio } from '../format.js';
import { leaderTakeaway, compareTakeaway } from '../takeaways.js';

export async function render(root) {
  const files = await loadMany(['index.json']);
  const idx = files['index.json'].data;
  if (!idx) { root.append(pageError(files['index.json'].error)); return; }
  const rows = idx.protocols.map((p) => ({
    ...p,
    mcapToFees: p.mcap && p.fees30d ? p.mcap / ((p.fees30d * 365) / 30) : null,
    groupLabel: p.group === 'peer' ? 'Peer' : 'Watchlist',
  }));
  const watch = rows.filter((r) => r.group === 'watchlist');
  root.append(band({
    n: '02',
    tag: 'Section 02 · Protocols',
    title: 'Your watchlist',
    sub: `${watch.length} protocols from watchlist.json, plus ${rows.length - watch.length} peers for comparison. Click a name for its full page.`,
    chips: [h('a', { class: 'band-chip', href: '#/compare' }, 'Compare them'), h('a', { class: 'band-chip', href: '#/screener' }, 'All DeFi protocols')],
  }));

  const columns = [
    { key: 'name', label: 'Protocol', fmt: (v, r) => h('a', { href: `#/protocol/${r.slug}`, class: 'name' }, v) },
    { key: 'groupLabel', label: 'List' },
    { key: 'category', label: 'Category' },
    { key: 'chains', label: 'Chains', fmt: (v) => h('span', { class: 'sub', title: (v || []).join(', ') }, `${(v || []).slice(0, 3).join(', ')}${(v || []).length > 3 ? ` +${v.length - 3}` : ''}`), sortValue: (r) => (r.chains || []).length },
    { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), termKey: 'tvl' },
    { key: 'tvlChange7d', label: 'TVL 7d', num: true, fmt: (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v)), csv: (r) => r.tvlChange7d },
    { key: 'tvlChange30d', label: 'TVL 30d', num: true, fmt: (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v)), csv: (r) => r.tvlChange30d },
    { key: 'tvlSpark', label: '30d trend', fmt: (v) => h('div', { style: { width: '90px' } }, sparkline(v, { height: 22, fill: false })), sortValue: (r) => r.tvlChange30d, csv: () => '' },
    { key: 'fees30d', label: 'Fees 30d', num: true, fmt: (v) => usd(v), termKey: 'fees' },
    { key: 'revenue30d', label: 'Revenue 30d', num: true, fmt: (v) => usd(v), termKey: 'revenue' },
    { key: 'symbol', label: 'Token', fmt: (v, r) => (r.tokenId ? h('a', { href: `#/token/${r.tokenId}` }, v || r.tokenId) : v || '—') },
    { key: 'price', label: 'Price', num: true, fmt: (v) => usd(v) },
    { key: 'priceChange7d', label: 'Price 7d', num: true, fmt: (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v)), csv: (r) => r.priceChange7d },
    { key: 'mcap', label: 'Market cap', num: true, fmt: (v) => usd(v), termKey: 'marketCap' },
    { key: 'mcapToFees', label: 'Mcap ÷ ann. fees', num: true, fmt: (v) => ratio(v), termKey: 'mcapToFees', title: 'Calculated: market cap ÷ (30-day fees × 365 ÷ 30)' },
  ];
  root.append(h('section', { class: 'card' },
    h('div', { class: 'kicker' }, 'Watchlist + peers'),
    takeaway(compareTakeaway(watch.filter((r) => r.tvlChange30d != null).map((r) => ({ name: r.name, change: r.tvlChange30d })), 'TVL', 'the last 30 days'), 'Every tracked protocol at a glance'),
    dataTable({ caption: 'Tracked protocols', columns, rows, sortKey: 'tvl', filters: [{ key: 'category', label: 'Category', plural: 'categories' }, { key: 'chains', label: 'Chain' }, { key: 'groupLabel', label: 'List', plural: 'lists' }], csvName: 'watchlist', rowClass: (r) => (r.group === 'watchlist' ? 'is-watch' : null), pageSize: 50 }),
    sourceLine([rows[0]?.srcTvl, rows.find((r) => r.srcPrice)?.srcPrice].filter(Boolean).map((s) => ({ ...s, label: `${s.label} (each protocol page links its exact endpoint)` }))),
    h('p', { class: 'src' }, 'Mcap ÷ annualized fees is calculated here: CoinGecko market cap ÷ (DefiLlama 30-day fees × 365 ÷ 30).')));

  const grid = h('div', { class: 'grid', style: { marginTop: '18px' } });
  root.append(grid);
  const byFees = rows.filter((r) => r.fees30d).sort((a, b) => b.fees30d - a.fees30d);
  if (byFees.length) {
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Fees',
      termKey: 'fees',
      take: leaderTakeaway(byFees.map((r) => ({ name: r.name, total30d: r.fees30d })), { metric: 'fees', scope: 'tracked protocol' }),
      title: 'Fees over the last 30 days, tracked protocols',
      build: hbarChart({ items: byFees.map((r) => ({ name: r.name, value: r.fees30d })), name: 'Fees 30d' }),
      src: rows[0]?.srcTvl ? { ...rows[0].srcTvl, label: 'fees (per-protocol endpoints on each page)' } : null,
      csvName: 'tracked-fees-30d',
      table: () => ({ columns: [{ key: 'name', label: 'Protocol' }, { key: 'fees30d', label: 'Fees 30d', num: true, fmt: (v) => usd(v), csv: (r) => r.fees30d }], rows: byFees }),
    })));
  }
  const byTvl = rows.filter((r) => r.tvl).sort((a, b) => b.tvl - a.tvl);
  if (byTvl.length) {
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'TVL',
      termKey: 'tvl',
      take: byTvl.length > 1 ? { pre: `${byTvl[0].name} holds `, hl: `${(byTvl[0].tvl / byTvl[1].tvl).toFixed(1)}x the TVL`, post: ` of ${byTvl[1].name}, the next largest tracked protocol` } : null,
      fallback: 'TVL, tracked protocols',
      title: 'TVL today, tracked protocols',
      build: hbarChart({ items: byTvl.map((r) => ({ name: r.name, value: r.tvl, sub: `7d ${pct(r.tvlChange7d)}` })), name: 'TVL' }),
      src: rows[0]?.srcTvl,
      csvName: 'tracked-tvl',
      table: () => ({ columns: [{ key: 'name', label: 'Protocol' }, { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }, { key: 'tvlChange7d', label: '7d', num: true, fmt: (v) => pct(v) }], rows: byTvl }),
    })));
  }
  root.append(h('p', { class: 'src', style: { marginTop: '18px' } }, 'To add or remove a protocol, edit ', h('code', {}, 'watchlist.json'), ' (see the README section “How to add a protocol”).'));
}

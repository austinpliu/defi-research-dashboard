// 06 — All protocols (screener)
import { h, band, sourceLine, extLink, pageError, takeaway } from '../ui.js';
import { loadMany } from '../data.js';
import { dataTable } from '../table.js';
import { usd, pct } from '../format.js';

export async function render(root, { query }) {
  const files = await loadMany(['screener.json']);
  const sc = files['screener.json'].data;
  if (!sc) { root.append(pageError(files['screener.json'].error)); return; }
  root.append(band({ n: '06', tag: 'Section 06 · Screener', title: 'Every DeFi protocol', sub: `The ${sc.rows.length} largest protocols on DefiLlama (TVL above $5M), with 30-day fees and revenue. Sort, filter by category or chain, search, and export.` }));
  const delta = (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v));
  const rows = sc.rows.map((r) => ({ ...r, mcapTvl: r.mcap && r.tvl ? r.mcap / r.tvl : null }));
  const table = dataTable({
    caption: 'All protocols', csvName: 'defi-protocols', sortKey: 'tvl', pageSize: 50,
    filters: [{ key: 'category', label: 'Category', plural: 'categories' }, { key: 'chains', label: 'Chain' }],
    rowClass: (r) => (r.watch ? 'is-watch' : null),
    searchKeys: ['name', 'slug', 'symbol', 'category'],
    columns: [
      { key: 'name', label: 'Protocol', fmt: (v, r) => h('span', {}, r.watch ? h('a', { href: `#/protocol/${r.parent || r.slug}`, class: 'name', title: 'In your watchlist' }, `★ ${v}`) : h('span', { class: 'name' }, v), ' ', extLink(`https://defillama.com/protocol/${r.slug}`, '↗', { title: 'Open on DefiLlama', 'aria-label': `${v} on DefiLlama` })) },
      { key: 'category', label: 'Category', termKey: 'category' },
      { key: 'chains', label: 'Chains', fmt: (v) => h('span', { class: 'sub', title: (v || []).join(', ') }, `${(v || []).slice(0, 3).join(', ')}${(v || []).length > 3 ? ` +${v.length - 3}` : ''}`), sortValue: (r) => (r.chains || []).length },
      { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), termKey: 'tvl' },
      { key: 'change1d', label: '1d', num: true, fmt: delta, csv: (r) => r.change1d },
      { key: 'change7d', label: '7d', num: true, fmt: delta, csv: (r) => r.change7d },
      { key: 'fees30d', label: 'Fees 30d', num: true, fmt: (v) => usd(v), termKey: 'fees' },
      { key: 'revenue30d', label: 'Revenue 30d', num: true, fmt: (v) => usd(v), termKey: 'revenue' },
      { key: 'mcap', label: 'Market cap', num: true, fmt: (v) => usd(v), termKey: 'marketCap' },
      { key: 'symbol', label: 'Token' },
    ],
    rows,
    csvExtra: [{ label: 'DefiLlama page', get: (r) => `https://defillama.com/protocol/${r.slug}` }],
  });
  const top10 = rows.slice().sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 10).reduce((s, r) => s + (r.tvl || 0), 0);
  const all = rows.reduce((s, r) => s + (r.tvl || 0), 0);
  const scrTake = all > 0 ? { pre: 'The 10 largest protocols here hold ', hl: `${Math.round((top10 / all) * 100)}% of the TVL`, post: ` of these ${rows.length}` } : null;
  root.append(h('section', { class: 'card' }, h('div', { class: 'kicker' }, 'Screener'), takeaway(scrTake, 'Sort, filter and search all large DeFi protocols'), table,
    h('p', { class: 'src' }, '★ = in your watchlist or peers (click for the full page). ↗ opens the protocol on DefiLlama. Market cap here is DefiLlama’s figure.'),
    sourceLine(Object.values(sc.sources || {}))));
  const q = query.get('q');
  if (q) {
    const input = table.querySelector('input[type="search"]');
    if (input) { input.value = q; input.dispatchEvent(new Event('input')); }
  }
}

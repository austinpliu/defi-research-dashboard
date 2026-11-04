// 03 — Tokens overview
import { h, band, sourceLine, pageError, sparkline } from '../ui.js';
import { chartCard } from '../cards.js';
import { loadMany } from '../data.js';
import { divergingChart } from '../charts.js';
import { dataTable } from '../table.js';
import { usd, pct } from '../format.js';

export async function render(root) {
  const files = await loadMany(['index.json']);
  const idx = files['index.json'].data;
  if (!idx) { root.append(pageError(files['index.json'].error)); return; }
  const rows = idx.protocols.filter((p) => p.tokenId).map((p) => ({ ...p, groupLabel: p.group === 'peer' ? 'Peer' : 'Watchlist' }));
  root.append(band({ n: '03', tag: 'Section 03 · Tokens', title: 'Tokens', sub: `${rows.length} tokens belonging to the protocols you track. Prices from CoinGecko’s public API.` }));
  const delta = (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v));
  root.append(h('section', { class: 'card' },
    h('div', { class: 'kicker' }, 'Prices'),
    h('h3', { class: 'takeaway' }, 'Token prices and market caps'),
    dataTable({
      caption: 'Tokens', csvName: 'tokens', sortKey: 'mcap', pageSize: 50,
      filters: [{ key: 'category', label: 'Category', plural: 'categories' }, { key: 'chains', label: 'Chain' }, { key: 'groupLabel', label: 'List', plural: 'lists' }],
      rowClass: (r) => (r.group === 'watchlist' ? 'is-watch' : null),
      columns: [
        { key: 'symbol', label: 'Token', fmt: (v, r) => h('a', { href: `#/token/${r.tokenId}`, class: 'name' }, v || r.tokenId) },
        { key: 'name', label: 'Protocol', fmt: (v, r) => h('a', { href: `#/protocol/${r.slug}` }, v) },
        { key: 'category', label: 'Category' },
        { key: 'price', label: 'Price', num: true, fmt: (v) => usd(v), termKey: 'price' },
        { key: 'priceChange24h', label: '24h', num: true, fmt: delta, csv: (r) => r.priceChange24h },
        { key: 'priceChange7d', label: '7d', num: true, fmt: delta, csv: (r) => r.priceChange7d },
        { key: 'priceSpark', label: '7-day price', fmt: (v) => h('div', { style: { width: '100px' } }, sparkline(v, { height: 22, fill: false })), sortValue: (r) => r.priceChange7d, csv: () => '' },
        { key: 'mcap', label: 'Market cap', num: true, fmt: (v) => usd(v), termKey: 'marketCap' },
        { key: 'tvl', label: 'Protocol TVL', num: true, fmt: (v) => usd(v), termKey: 'tvl' },
      ],
      rows,
    }),
    sourceLine([rows.find((r) => r.srcPrice)?.srcPrice].filter(Boolean).map((s) => ({ ...s, label: 'token prices (each token page links its exact endpoint)' })))));
  const withChg = rows.filter((r) => r.priceChange7d != null).sort((a, b) => b.priceChange7d - a.priceChange7d);
  if (withChg.length >= 2) {
    const best = withChg[0];
    const worst = withChg[withChg.length - 1];
    root.append(h('div', { style: { marginTop: '18px' } }, chartCard({
      kicker: 'Weekly moves',
      take: { pre: `${best.symbol} `, hl: `${best.priceChange7d >= 0 ? 'gained' : 'lost'} the most this week (${pct(best.priceChange7d, { digits: 0 })})`, post: worst.priceChange7d < 0 ? `; ${worst.symbol} fell ${pct(Math.abs(worst.priceChange7d), { signed: false, digits: 0 })}` : '' },
      title: '7-day price change, tracked tokens',
      build: divergingChart({ items: withChg.map((r) => ({ name: r.symbol, value: r.priceChange7d, sub: r.name })) }),
      src: withChg[0].srcPrice,
      csvName: 'token-7d-change',
      table: () => ({ columns: [{ key: 'symbol', label: 'Token' }, { key: 'priceChange7d', label: '7d change', num: true, fmt: (v) => pct(v) }], rows: withChg }),
    })));
  }
}

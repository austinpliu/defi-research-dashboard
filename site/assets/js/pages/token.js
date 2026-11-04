// 03 — One token
import { h, openExternal, band, statTile, sourceLine, subhead, segmented, extLink, pageError, term, unavailable, svgIcon } from '../ui.js';
import { chartCard, infoCard } from '../cards.js';
import { loadMany } from '../data.js';
import { lineChart, hbarChart, columnChart } from '../charts.js';
import { dataTable } from '../table.js';
import { usd, pct, ratio, date, dateTime, compact } from '../format.js';
import { trimDays, rangeLabel } from '../series.js';
import { priceTakeaway, supplyTakeaway, liquidityTakeaway, trendTakeaway } from '../takeaways.js';

export async function render(root, { params }) {
  const id = params[0];
  const files = await loadMany([`tokens/${id}.json`]);
  const t = files[`tokens/${id}.json`].data;
  if (!t) {
    root.append(pageError(`No data file for token “${id}”. Tokens get a page when their protocol is in watchlist.json. Details: ${files[`tokens/${id}.json`].error}`));
    return;
  }
  const S = t.sources || {};
  const sym = t.symbol || id.toUpperCase();
  const mk = t.market || {};
  const sup = t.supply || {};
  const pr = t.profile || {};
  const msrc = S[mk.src] || S['cg-coin'];
  document.title = `${sym} · DeFi Research Dashboard`;

  root.append(band({
    n: '03',
    tag: 'Section 03 · Token',
    title: `${sym}`,
    sub: `${t.name || ''}${t.protocol ? ` · the token of ${t.protocol.name}` : ''}${mk.rank ? ` · market-cap rank #${mk.rank}` : ''}`,
    chips: [t.protocol ? h('a', { class: 'band-chip', href: `#/protocol/${t.protocol.slug}` }, `${t.protocol.name} protocol page`) : null, h('a', { class: 'band-chip', href: `https://www.coingecko.com/en/coins/${id}`, target: '_blank', rel: 'noopener' }, 'CoinGecko ↗')].filter(Boolean),
  }));

  if (mk.partial) root.append(h('div', { class: 'notice warn', style: { marginBottom: '14px' } }, h('b', {}, 'Partial data: '), mk.partial));
  if (t.unavailable && !mk.price) root.append(h('div', { class: 'notice bad', style: { marginBottom: '14px' } }, h('b', {}, 'CoinGecko unavailable: '), t.unavailable));

  const volMcap = mk.volume24h && mk.marketCap ? (mk.volume24h / mk.marketCap) * 100 : null;
  root.append(h('div', { class: 'stats six' },
    statTile({ label: 'Price', termKey: 'price', raw: mk.price, value: usd(mk.price), deltas: [{ v: mk.change24h, per: '24h' }, { v: mk.change7d, per: '7d' }, { v: mk.change30d, per: '30d' }], src: msrc }),
    statTile({ label: 'Market cap', termKey: 'marketCap', raw: mk.marketCap, value: usd(mk.marketCap), note: mk.rank ? `Rank #${mk.rank}` : null, src: msrc, unavailableReason: mk.partial }),
    statTile({ label: 'Fully diluted value', termKey: 'fdv', raw: mk.fdv, value: usd(mk.fdv), note: mk.marketCap && mk.fdv ? `Market cap is ${pct((mk.marketCap / mk.fdv) * 100, { signed: false, digits: 0 })} of FDV` : null, src: msrc, unavailableReason: mk.partial }),
    statTile({ label: '24h volume', termKey: 'volume24h', raw: mk.volume24h, value: usd(mk.volume24h), note: volMcap != null ? `${pct(volMcap, { signed: false })} of market cap traded` : null, src: msrc, unavailableReason: mk.partial }),
    statTile({ label: 'All-time high', termKey: 'ath', raw: mk.ath, value: usd(mk.ath), deltas: [{ v: mk.athChange, per: 'from ATH' }], note: mk.athDate ? date(mk.athDate) : null, src: msrc, unavailableReason: mk.partial }),
    statTile({ label: 'DEX liquidity', termKey: 'liquidity', raw: t.dex?.totalLiquidity || null, value: usd(t.dex?.totalLiquidity), note: t.dex?.pools?.length ? `${t.dex.pools.length} largest pools` : null, src: (() => { const dexSrcs = Object.entries(S).filter(([k]) => k.startsWith('gt-') || k.startsWith('ds-')).map(([, v]) => v); return dexSrcs.find((x) => x.ok) || dexSrcs[0]; })(), unavailableReason: t.dex?.unavailable }),
  ));

  const grid = h('div', { class: 'grid', style: { marginTop: '18px' } });
  root.append(grid);
  const se = t.series || {};

  // price
  if (se.price?.length) {
    let range = 365;
    const build = () => lineChart({ series: [{ name: `${sym} price`, data: trimDays(se.price, range) }], area: true });
    const card = chartCard({
      kicker: 'Price',
      termKey: 'price',
      take: priceTakeaway(sym, mk, se.price),
      title: `${sym} price in USD, ${rangeLabel(range)}`,
      big: true,
      size: 'tall',
      controls: segmented([{ value: 30, label: '30D' }, { value: 90, label: '90D' }, { value: 365, label: '1Y' }], range, (v) => { range = v; card.update({ build: build(), title: `${sym} price in USD, ${rangeLabel(v)}` }); }, 'Time range'),
      build: build(),
      callouts: [
        mk.ath ? h('div', { class: 'callout' }, h('div', { class: 'c-label' }, 'All-time high'), h('div', { class: 'c-value' }, usd(mk.ath)), h('div', { class: 'c-note' }, `${mk.athDate ? date(mk.athDate) : ''} · now ${pct(mk.athChange, { digits: 0 })}`)) : null,
        mk.change1y != null ? h('div', { class: 'callout dark' }, h('div', { class: 'c-label' }, '1-year change'), h('div', { class: 'c-value' }, pct(mk.change1y, { digits: 0 })), h('div', { class: 'c-note' }, `30 days: ${pct(mk.change30d)}`)) : null,
      ].filter(Boolean),
      src: S[se.src],
      sources: S,
      csvName: `${sym}-price`,
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, { key: 'price', label: 'Price', num: true, fmt: (v) => usd(v), csv: (r) => r.price }, { key: 'mcap', label: 'Market cap', num: true, fmt: (v) => usd(v), csv: (r) => r.mcap }, { key: 'vol', label: 'Volume', num: true, fmt: (v) => usd(v), csv: (r) => r.vol }], rows: trimDays(se.price, range).slice().reverse().map(([ts, v]) => ({ date: date(ts), price: v, mcap: se.marketCap?.find((p) => p[0] === ts)?.[1] ?? null, vol: se.volume?.find((p) => p[0] === ts)?.[1] ?? null })) }),
    });
    grid.append(h('div', { class: 'span-12' }, card));
  } else {
    grid.append(h('div', { class: 'span-12' }, chartCard({ kicker: 'Price', fallback: `${sym} price`, unavailableReason: se.unavailable || 'No price history this run', src: S['cg-chart'], sources: S })));
  }

  // market cap + volume (separate charts — never two y-axes on one chart)
  if (se.marketCap?.length) {
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Market cap',
      termKey: 'marketCap',
      take: trendTakeaway(`${sym} market cap`, se.marketCap),
      title: `${sym} market cap, past year`,
      build: lineChart({ series: [{ name: 'Market cap', data: se.marketCap }], area: true }),
      src: S[se.src], sources: S, csvName: `${sym}-market-cap`,
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, { key: 'v', label: 'Market cap', num: true, fmt: (v) => usd(v), csv: (r) => r.v }], rows: se.marketCap.slice().reverse().map(([ts, v]) => ({ date: date(ts), v })) }),
    })));
  }
  if (se.volume?.length) {
    const last90 = trimDays(se.volume, 90);
    const avg = last90.reduce((s, p) => s + p[1], 0) / (last90.length || 1);
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Trading volume',
      termKey: 'volume24h',
      take: avg ? { pre: `${sym} trades about `, hl: `${usd(avg)} a day`, post: ' on average over the last 90 days' } : null,
      title: `${sym} daily trading volume (all exchanges), last 90 days`,
      build: columnChart({ data: last90, name: 'Volume' }),
      src: S[se.src], sources: S, csvName: `${sym}-volume`,
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, { key: 'v', label: 'Volume', num: true, fmt: (v) => usd(v), csv: (r) => r.v }], rows: se.volume.slice().reverse().map(([ts, v]) => ({ date: date(ts), v })) }),
    })));
  }

  // supply breakdown
  const cap = sup.max || sup.total;
  const segs = sup.circulating && cap ? [
    { label: 'Circulating', v: sup.circulating, color: 'var(--marker)', key: 'circulating' },
    sup.total && sup.max && sup.total > sup.circulating ? { label: 'Issued, not circulating', v: sup.total - sup.circulating, color: 'var(--gray-marker)', key: 'notCirculating' } : null,
    sup.max && sup.max > (sup.total || sup.circulating) ? { label: 'Not yet issued', v: sup.max - Math.max(sup.total || 0, sup.circulating), color: 'var(--surface-2)', key: 'maxSupply' } : (!sup.max && sup.total > sup.circulating ? { label: 'Not circulating', v: sup.total - sup.circulating, color: 'var(--gray-marker)', key: 'notCirculating' } : null),
  ].filter(Boolean) : [];
  grid.append(h('div', { class: 'span-6' }, infoCard({
    kicker: 'Supply',
    take: supplyTakeaway(sym, sup),
    fallback: `${sym} supply`,
    title: cap ? `Supply breakdown (share of ${sup.max ? 'max' : 'total'} supply: ${compact(cap, 2)} ${sym})` : null,
    body: segs.length
      ? [
        h('div', { class: 'segbar', role: 'img', 'aria-label': segs.map((s) => `${s.label} ${pct((s.v / cap) * 100, { signed: false })}`).join(', ') },
          segs.map((s) => { const w = (s.v / cap) * 100; return h('div', { style: { width: `${w}%`, background: s.color, border: s.color === 'var(--surface-2)' ? '1px solid var(--border-strong)' : null }, title: `${s.label}: ${compact(s.v, 2)}` }, w > 16 ? pct(w, { signed: false, digits: 0 }) : ''); })),
        h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Bucket'), h('th', { class: 'n' }, 'Tokens'), h('th', { class: 'n' }, 'Share'))),
          h('tbody', {},
            segs.map((s) => h('tr', {}, h('td', {}, h('span', { class: 'type-dot', style: { background: s.color, marginRight: '6px', border: '1px solid var(--border-strong)' } }), term(s.label, s.key)), h('td', { class: 'n' }, compact(s.v, 2)), h('td', { class: 'n' }, pct((s.v / cap) * 100, { signed: false })))),
            h('tr', {}, h('td', {}, term('Total supply', 'totalSupply')), h('td', { class: 'n' }, compact(sup.total, 2)), h('td', {}, '')),
            h('tr', {}, h('td', {}, term('Max supply', 'maxSupply')), h('td', { class: 'n' }, sup.max ? compact(sup.max, 2) : sup.maxInfinite ? 'no cap' : '—'), h('td', {}, ''))))),
        h('div', { style: { marginTop: '12px' } }, unavailable('Unlock schedule: unavailable', 'No free, keyless source publishes unlock dates (DefiLlama’s unlock data is Pro-only). The supply split above shows how much could still enter circulation.')),
      ]
      : unavailable('Supply unavailable', t.unavailable || 'CoinGecko returned no supply figures.'),
    src: msrc,
    sources: S,
  })));

  // contracts
  const plats = Object.entries(pr.platforms || {});
  grid.append(h('div', { class: 'span-6' }, infoCard({
    kicker: 'Contracts & links',
    take: plats.length ? { pre: `${sym} lives on `, hl: `${plats.length} chain${plats.length === 1 ? '' : 's'}`, post: '' } : null,
    fallback: `${sym} contracts and links`,
    body: [
      plats.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Chain (CoinGecko id)'), h('th', {}, 'Contract address'))), h('tbody', {}, plats.map(([p, addr]) => h('tr', {}, h('td', {}, p), h('td', { style: { fontFamily: 'ui-monospace, monospace', fontSize: '12px' } }, addr)))))) : h('p', { class: 'muted' }, 'CoinGecko lists no contract addresses (the token may be native to its own chain).'),
      h('div', { class: 'links' }, [['Website', pr.links?.homepage], ['Whitepaper / docs', pr.links?.whitepaper], ['X / Twitter', pr.links?.twitter], ['Forum', /forum|gov|discourse|commonwealth/i.test(pr.links?.forum || '') ? pr.links.forum : null], ['Snapshot', pr.links?.snapshot], ...(pr.links?.explorers || []).slice(0, 2).map((u, i) => [`Explorer ${i + 1}`, u])].filter((x) => x[1]).map(([l, u]) => extLink(u, [l, svgIcon('ext')]))),
      pr.description ? h('p', { class: 'p-desc', style: { fontSize: '14px' } }, pr.description) : null,
    ],
    src: S['cg-coin'],
    sources: S,
  })));

  // DEX liquidity
  const dx = t.dex || {};
  if (dx.pools?.length) {
    const top = dx.pools.slice(0, 10);
    grid.append(h('div', { class: 'span-12' }, chartCard({
      kicker: 'DEX liquidity',
      termKey: 'liquidity',
      take: liquidityTakeaway(sym, dx),
      title: `Largest ${sym} pools by liquidity`,
      note: dx.stale ? `Stale: from ${dateTime(dx.stale.lastGoodAt)} (latest attempt: ${dx.stale.reason})` : `Searched: ${(dx.attempted || []).map((a) => `${a.platform}${a.fallback ? ' (DexScreener)' : ''}${a.ok ? '' : ' ✗'}`).join(', ')}`,
      build: hbarChart({ items: top.map((p) => ({ name: `${p.name} · ${p.dex || ''}`.slice(0, 40), value: p.liquidity, sub: `${p.network} · 24h volume ${usd(p.volume24h)}` })), name: 'Liquidity' }),
      onClick: (p) => { const it = top[top.length - 1 - p.dataIndex]; if (it?.page) openExternal(it.page); },
      src: Object.entries(S).filter(([k]) => k.startsWith('gt-') || k.startsWith('ds-')).map(([, v]) => v).filter((x) => x.ok),
      sources: S,
      csvName: `${sym}-dex-pools`,
      table: () => ({ columns: [{ key: 'name', label: 'Pool', fmt: (v, r) => extLink(r.page, v) }, { key: 'dex', label: 'DEX' }, { key: 'network', label: 'Network' }, { key: 'liquidity', label: 'Liquidity', num: true, fmt: (v) => usd(v), csv: (r) => r.liquidity }, { key: 'volume24h', label: '24h volume', num: true, fmt: (v) => usd(v), csv: (r) => r.volume24h }, { key: 'priceUsd', label: 'Price', num: true, fmt: (v) => usd(v) }, { key: 'change24h', label: '24h', num: true, fmt: (v) => pct(v) }, { key: 'page', label: 'Link', csv: (r) => r.page, fmt: (v) => extLink(v, 'open') }], rows: dx.pools }),
    })));
  } else {
    grid.append(h('div', { class: 'span-12' }, chartCard({ kicker: 'DEX liquidity', fallback: `${sym} DEX liquidity`, unavailableReason: dx.unavailable || 'No pools found', src: Object.entries(S).filter(([k]) => k.startsWith('gt-') || k.startsWith('ds-')).map(([, v]) => v), sources: S })));
  }
}

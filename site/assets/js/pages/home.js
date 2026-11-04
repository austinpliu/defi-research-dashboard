// 01 — Market overview
import { h, append, band, statTile, sparkline, sourceLine, subhead, segmented, extLink, pageError, term, unavailable } from '../ui.js';
import { chartCard, infoCard } from '../cards.js';
import { loadMany } from '../data.js';
import { lineChart, hbarChart, divergingChart, columnChart, stackedColumns, themeOf } from '../charts.js';
import { usd, pct, dateTime, date, relative, shortDate, compact, monthYear } from '../format.js';
import { trimDays, indexTo100, weeklySum, monthlyLast, valueAt, RANGES, rangeLabel, changeOver } from '../series.js';
import {
  trendTakeaway, chainTakeaway, leaderTakeaway, stablecoinTakeaway, moversTakeaway, flowTakeaway, categoryTakeaway, compareTakeaway, catalystTakeaway,
} from '../takeaways.js';

const TYPE_LABEL = {
  'governance-vote': 'Governance vote', 'governance-forum': 'Forum post', 'launch-upgrade': 'Launch / upgrade', news: 'News', blog: 'Blog', unlock: 'Unlock', scheduled: 'Scheduled',
};

export async function render(root) {
  const files = await loadMany(['market.json', 'index.json', 'catalysts.json', 'meta.json']);
  const m = files['market.json'].data;
  const meta = files['meta.json'].data;
  if (!m) {
    root.append(pageError(files['market.json'].error));
    return;
  }
  const S = m.sources || {};
  const H = m.headline || {};
  const okCount = meta ? meta.counts.requests - meta.counts.failed : null;

  root.append(band({
    n: '01',
    tag: 'Section 01 · Market overview',
    title: 'The DeFi market, live',
    sub: meta ? `Fetched ${dateTime(meta.generatedAt)} (${relative(meta.generatedAt)}) from free public APIs. Every number links to the exact page or endpoint it came from.` : 'Every number links to the exact page or endpoint it came from.',
    chips: meta ? [h('a', { class: 'band-chip', href: '#/sources' }, `${okCount} of ${meta.counts.requests} requests succeeded`), h('a', { class: 'band-chip', href: '#/catalysts' }, `${files['catalysts.json'].data?.items?.length ?? 0} catalysts tracked`), h('a', { class: 'band-chip', href: '#/glossary' }, 'New to these terms? Glossary')] : [],
  }));

  // ---------- Headline strip ----------
  const spark = (series, days = 90) => sparkline((series ? trimDays(series, days) : []).map((p) => p[1]));
  const stats = h('div', { class: 'stats' },
    statTile({ label: 'Total DeFi TVL', termKey: 'defiTvl', raw: H.tvl?.value, value: usd(H.tvl?.value), deltas: [{ v: H.tvl?.change7d, per: '7d' }, { v: H.tvl?.change30d, per: '30d' }], spark: spark(H.tvl?.series), src: S[H.tvl?.src], unavailableReason: H.tvl?.unavailable }),
    statTile({ label: 'Stablecoin supply', termKey: 'stablecoins', raw: H.stablecoins?.value, value: usd(H.stablecoins?.value), deltas: [{ v: H.stablecoins?.change7d, per: '7d' }, { v: H.stablecoins?.change30d, per: '30d' }], spark: spark(H.stablecoins?.series), src: S[H.stablecoins?.src], unavailableReason: H.stablecoins?.unavailable }),
    statTile({ label: 'DEX volume, 24h', termKey: 'dexVolume', raw: H.dexVolume?.value, value: usd(H.dexVolume?.value), deltas: [{ v: H.dexVolume?.change7d, per: '7d vs prior 7d' }, { v: H.dexVolume?.change30d, per: '30d vs prior 30d' }], spark: spark(H.dexVolume?.series), src: S[H.dexVolume?.src], unavailableReason: H.dexVolume?.unavailable }),
    statTile({ label: 'Fees paid, 24h', termKey: 'fees', raw: H.fees?.value, value: usd(H.fees?.value), deltas: [{ v: H.fees?.change7d, per: '7d vs prior 7d' }, { v: H.fees?.change30d, per: '30d vs prior 30d' }], spark: spark(H.fees?.series), src: S[H.fees?.src], unavailableReason: H.fees?.unavailable }),
  );
  root.append(stats);

  const grid = h('div', { class: 'grid', style: { marginTop: '18px' } });
  root.append(grid);

  // ---------- Total TVL ----------
  if (H.tvl?.series?.length) {
    let range = 365;
    const full = H.tvl.series;
    const ath = H.tvl.ath;
    const athDraw = ath ? ((H.tvl.value - ath.value) / ath.value) * 100 : null;
    const build = () => lineChart({ series: [{ name: 'DeFi TVL', data: trimDays(full, range) }], area: true });
    const callouts = [
      ath ? h('div', { class: 'callout' }, h('div', { class: 'c-label' }, term('All-time high', 'ath')), h('div', { class: 'c-value' }, usd(ath.value)), h('div', { class: 'c-note' }, `${date(ath.ts)} · today ${pct(athDraw, { digits: 0 })} from the peak`)) : null,
      h('div', { class: 'callout dark' }, h('div', { class: 'c-label' }, 'Change over 1 year'), h('div', { class: 'c-value' }, pct(H.tvl.change1y, { digits: 0 })), h('div', { class: 'c-note' }, `30 days: ${pct(H.tvl.change30d)}`)),
    ];
    const card = chartCard({
      kicker: 'Total value locked',
      take: trendTakeaway('DeFi TVL', full),
      title: 'Total value locked in DeFi, all chains',
      big: true,
      size: 'tall',
      controls: segmented(RANGES, range, (v) => { range = v; card.update({ build: build(), title: `Total value locked in DeFi, ${rangeLabel(v)}` }); }, 'Time range'),
      build: build(),
      callouts,
      src: S[H.tvl.src],
      sources: S,
      csvName: 'defi-tvl',
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, { key: 'tvl', label: 'TVL (USD)', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }], rows: trimDays(full, range).slice().reverse().map(([ts, v]) => ({ date: date(ts), tvl: v })) }),
    });
    grid.append(h('div', { class: 'span-12' }, card));
  }

  // ---------- Watchlist strip ----------
  const idx = files['index.json'].data;
  if (idx?.protocols?.length) {
    const watch = idx.protocols.filter((p) => p.group === 'watchlist');
    const cards = watch.map((p) => h('a', { class: 'wcard acc-yellow', href: `#/protocol/${p.slug}` },
      h('div', { class: 'w-top' }, p.logo ? h('img', { src: p.logo, alt: '', loading: 'lazy', width: 26, height: 26, onerror: (e) => e.target.remove() }) : null, h('div', {}, h('div', { class: 'w-name' }, p.name), h('div', { class: 'w-sym' }, [p.symbol, p.category].filter(Boolean).join(' · ')))),
      h('div', { class: 'w-rows' },
        h('span', {}, 'TVL'), h('span', { class: 'v' }, usd(p.tvl), ' ', h('span', { class: `delta ${p.tvlChange7d > 0 ? 'up' : p.tvlChange7d < 0 ? 'down' : 'flat'}` }, pct(p.tvlChange7d))),
        h('span', {}, 'Fees 30d'), h('span', { class: 'v' }, usd(p.fees30d)),
        h('span', {}, p.symbol ? `${p.symbol} price` : 'Token'), h('span', { class: 'v' }, p.price != null ? usd(p.price) : '—', ' ', p.price != null ? h('span', { class: `delta ${p.priceChange7d > 0 ? 'up' : p.priceChange7d < 0 ? 'down' : 'flat'}` }, pct(p.priceChange7d)) : null)),
      h('div', { class: 'w-spark' }, sparkline(p.tvlSpark, { height: 36 })),
    ));
    const srcs = [watch[0]?.srcTvl ? { ...watch[0].srcTvl, label: 'TVL & fees (each protocol page links its own endpoint)', page: 'https://defillama.com/', api: null } : null, watch.find((p) => p.srcPrice)?.srcPrice ? { ...watch.find((p) => p.srcPrice).srcPrice, label: 'token prices', page: 'https://www.coingecko.com/', api: null } : null].filter(Boolean);
    grid.append(h('div', { class: 'span-12' },
      subhead('Your watchlist', 'The protocols you follow', h('a', { href: '#/protocols', class: 'tool' }, 'All protocol details →')),
      h('div', { class: 'watch-grid' }, cards),
      h('p', { class: 'src' }, 'Changes are 7-day. Sparkline: TVL over the last 30 days. '),
      sourceLine(srcs)));
  }

  // ---------- TVL by chain ----------
  const ch = m.chains;
  if (ch?.top?.length) {
    const top = ch.top.slice(0, 10);
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Chains',
      take: chainTakeaway(ch.top),
      title: `TVL by chain, top 10 of ${ch.count}`,
      build: hbarChart({ items: top.map((c) => ({ name: c.name, value: c.tvl, sub: `${pct(c.share, { signed: false })} of DeFi TVL · 30d ${pct(c.change30d)}` })), name: 'TVL' }),
      src: S[ch.src],
      sources: S,
      csvName: 'tvl-by-chain',
      onClick: (p) => { const c = top[top.length - 1 - p.dataIndex]; if (c?.page) window.open(c.page, '_blank', 'noopener'); },
      table: () => ({ columns: [{ key: 'name', label: 'Chain' }, { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }, { key: 'share', label: 'Share', num: true, fmt: (v) => pct(v, { signed: false }) }, { key: 'change7d', label: '7d', num: true, fmt: (v) => pct(v) }, { key: 'change30d', label: '30d', num: true, fmt: (v) => pct(v) }], rows: ch.top }),
    })));
  }

  // ---------- Chain growth (indexed) ----------
  if (ch?.history && Object.keys(ch.history).length >= 2) {
    const names = Object.keys(ch.history).slice(0, 5);
    let mode = 'index';
    // Canvas can't read CSS variables, so the palette is resolved from the theme each render.
    const resolved = (t) => lineChart({
        series: names.map((n, i) => ({ name: n, data: mode === 'index' ? indexTo100(ch.history[n]) : ch.history[n], color: t.s[i] })),
        fmt: mode === 'index' ? (v) => v.toFixed(0) : usd,
        axisFmt: mode === 'index' ? (v) => v.toFixed(0) : undefined,
      })(t);
    const rows = names.map((n) => ({ name: n, change: changeOver(ch.history[n], 365) ?? changeOver(ch.history[n], (ch.history[n].length - 1)) }));
    const legend = () => { const t = themeOf(document.querySelector('main')); return names.map((n, i) => ({ name: n, color: t.s[i] })); };
    const card = chartCard({
      kicker: 'Chains',
      take: compareTakeaway(rows, 'TVL', 'the past year'),
      title: 'TVL growth of the five largest chains, indexed to 100 one year ago',
      controls: segmented([{ value: 'index', label: 'Growth (=100)' }, { value: 'usd', label: 'Dollars' }], mode, (v) => { mode = v; card.update({ build: resolved, title: v === 'index' ? 'TVL growth of the five largest chains, indexed to 100 one year ago' : 'TVL of the five largest chains, past year' }); }, 'Units'),
      build: resolved,
      legend: [],
      src: S[ch.historySrc],
      sources: S,
      csvName: 'chain-tvl-history',
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, ...names.map((n) => ({ key: n, label: n, num: true, fmt: (v) => usd(v), csv: (r) => r[n] }))], rows: ch.history[names[0]].slice().reverse().map(([ts]) => ({ date: date(ts), ...Object.fromEntries(names.map((n) => [n, valueAt(ch.history[n], ts)])) })) }),
    });
    requestAnimationFrame(() => card.update({ legend: legend() }));
    grid.append(h('div', { class: 'span-6' }, card));
  }

  // ---------- Top protocols by fees / revenue ----------
  if (m.topFees?.list?.length || m.topRevenue?.list?.length) {
    let which = m.topFees?.list?.length ? 'fees' : 'revenue';
    const listFor = (w) => (w === 'fees' ? m.topFees : m.topRevenue);
    const items = (w) => listFor(w).list.slice(0, 12).map((p) => ({ name: p.name, value: p.total30d, sub: `${p.category || ''} · 7d ${usd(p.total7d)} · 30d vs prior ${pct(p.change30dOver30d)}` }));
    const card = chartCard({
      kicker: 'Protocols',
      take: leaderTakeaway(listFor(which).list, { metric: which }),
      title: `Top protocols by ${which}, last 30 days`,
      note: 'Child protocols are combined under their parent (e.g. Aave V2 + V3 → Aave). Chains and exchanges are excluded.',
      size: 'tall',
      controls: segmented([{ value: 'fees', label: 'Fees' }, { value: 'revenue', label: 'Revenue' }], which, (v) => {
        which = v;
        card.update({ build: hbarChart({ items: items(v), name: v }), take: leaderTakeaway(listFor(v).list, { metric: v }), title: `Top protocols by ${v}, last 30 days`, src: S[listFor(v).src] });
      }, 'Metric'),
      build: hbarChart({ items: items(which), name: which }),
      src: S[listFor(which).src],
      sources: S,
      csvName: 'top-protocols-fees',
      table: () => ({ columns: [{ key: 'name', label: 'Protocol' }, { key: 'category', label: 'Category' }, { key: 'total24h', label: '24h', num: true, fmt: (v) => usd(v), csv: (r) => r.total24h }, { key: 'total7d', label: '7d', num: true, fmt: (v) => usd(v), csv: (r) => r.total7d }, { key: 'total30d', label: '30d', num: true, fmt: (v) => usd(v), csv: (r) => r.total30d }, { key: 'change30dOver30d', label: '30d vs prior', num: true, fmt: (v) => pct(v) }], rows: listFor(which).list }),
    });
    grid.append(h('div', { class: 'span-6' }, card));
  }

  // ---------- Stablecoins by issuer ----------
  const st = m.stablecoins;
  if (st?.top?.length) {
    const hist = st.history || {};
    const coins = st.top.filter((c) => hist[c.symbol]).slice(0, 5);
    const total = H.stablecoins?.series || [];
    let card;
    if (coins.length >= 2 && total.length) {
      const months = monthlyLast(hist[coins[0].symbol]).filter(([ts]) => ts >= Date.now() / 1000 - 4 * 365 * 86400);
      const build = (t) => {
        const series = coins.map((c, i) => ({ name: c.symbol, data: months.map(([ts]) => [ts, valueAt(hist[c.symbol], ts) || 0]), color: t.s[i] }));
        const other = months.map(([ts]) => {
          const tv = valueAt(total, ts) || 0;
          const sum = coins.reduce((s, c) => s + (valueAt(hist[c.symbol], ts) || 0), 0);
          return [ts, Math.max(0, tv - sum)];
        });
        series.push({ name: 'Other', data: other, other: true });
        return stackedColumns({ series, period: 'month' })(t);
      };
      const legend = () => { const t = themeOf(document.querySelector('main')); return [...coins.map((c, i) => ({ name: `${c.symbol} (${c.name})`, color: t.s[i], box: true })), { name: 'Other', color: t.other, box: true }]; };
      card = chartCard({
        kicker: 'Stablecoins',
        take: stablecoinTakeaway(total, st),
        title: 'Stablecoin supply by issuer, month-end, last 4 years',
        build,
        callouts: [h('div', { class: 'callout' }, h('div', { class: 'c-label' }, 'Total supply today'), h('div', { class: 'c-value' }, usd(H.stablecoins?.value)), h('div', { class: 'c-note' }, `30d ${pct(H.stablecoins?.change30d)} · ${st.count} stablecoins`)), h('div', { class: 'callout dark' }, h('div', { class: 'c-label' }, `${st.top[0].name} share`), h('div', { class: 'c-value' }, pct(st.top[0].share, { signed: false, digits: 0 })), h('div', { class: 'c-note' }, `${usd(st.top[0].circulating)} in circulation`))],
        src: [S[st.historySrc], S[H.stablecoins?.src]].filter(Boolean),
        sources: S,
        csvName: 'stablecoins-by-issuer',
        table: () => ({ columns: [{ key: 'name', label: 'Stablecoin' }, { key: 'symbol', label: 'Symbol' }, { key: 'circulating', label: 'Supply', num: true, fmt: (v) => usd(v), csv: (r) => r.circulating }, { key: 'share', label: 'Share', num: true, fmt: (v) => pct(v, { signed: false }) }, { key: 'change7d', label: '7d', num: true, fmt: (v) => pct(v) }, { key: 'change30d', label: '30d', num: true, fmt: (v) => pct(v) }, { key: 'pegMechanism', label: 'Backing' }], rows: st.top }),
      });
      requestAnimationFrame(() => card.update({ legend: legend() }));
    } else {
      card = chartCard({
        kicker: 'Stablecoins',
        take: stablecoinTakeaway(total, st),
        title: 'Stablecoin supply by issuer today',
        build: hbarChart({ items: st.top.map((c) => ({ name: `${c.symbol}`, value: c.circulating, sub: `${c.name} · ${pct(c.share, { signed: false })}` })), name: 'Supply' }),
        src: S[st.src],
        sources: S,
        csvName: 'stablecoins-by-issuer',
        table: () => ({ columns: [{ key: 'name', label: 'Stablecoin' }, { key: 'circulating', label: 'Supply', num: true, fmt: (v) => usd(v), csv: (r) => r.circulating }, { key: 'share', label: 'Share', num: true, fmt: (v) => pct(v, { signed: false }) }], rows: st.top }),
      });
    }
    grid.append(h('div', { class: 'span-6' }, card));
  }

  // ---------- Biggest movers ----------
  const mv = m.movers;
  if (mv?.gainers?.length) {
    const g = mv.gainers.slice(0, 7);
    const l = mv.losers.slice(0, 7).reverse();
    const items = [...g, ...l.filter((x) => !g.includes(x))].map((x) => ({ name: x.name, value: x.change7d, sub: `TVL ${usd(x.tvl)} · ${x.category}` }));
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Movers',
      take: moversTakeaway(mv),
      title: `Biggest 7-day TVL moves, protocols over ${usd(mv.minTvl, { digits: 0 })}`,
      note: `${mv.eligibleCount} protocols qualify. Click a bar to open it on DefiLlama.`,
      size: 'tall',
      build: divergingChart({ items }),
      onClick: (p) => { const list = [...items].reverse(); const it = [...g, ...l].find((x) => x.name === list[p.dataIndex]?.name); if (it?.page) window.open(it.page, '_blank', 'noopener'); },
      src: S[mv.src],
      sources: S,
      csvName: 'biggest-movers',
      table: () => ({ columns: [{ key: 'name', label: 'Protocol' }, { key: 'category', label: 'Category' }, { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }, { key: 'change7d', label: '7d', num: true, fmt: (v) => pct(v) }, { key: 'change1d', label: '1d', num: true, fmt: (v) => pct(v) }, { key: 'page', label: 'DefiLlama', fmt: (v) => extLink(v, 'open') }], rows: [...mv.gainers, ...mv.losers] }),
    })));
  }

  // ---------- DEX volume & fees, daily ----------
  for (const [key, label, verb, kick] of [['dexVolume', 'DEX volume', 'swapped', 'Trading'], ['fees', 'Fees paid by users', 'paid', 'Fees']]) {
    const x = H[key];
    if (!x?.series?.length) continue;
    let range = 90;
    const data = () => (range === 90 ? trimDays(x.series, 90) : weeklySum(trimDays(x.series, range || 3650)));
    const card = chartCard({
      kicker: kick,
      take: key === 'dexVolume' ? flowTakeaway('DEX volume', x, 'swapped') : (x.total30d ? { pre: 'DeFi users paid ', hl: `${usd(x.total30d)} in fees`, post: ' over the last 30 days' } : null),
      title: `${label}, ${range === 90 ? 'daily, last 90 days' : 'weekly'}`,
      controls: segmented([{ value: 90, label: '90D daily' }, { value: 365, label: '1Y weekly' }, { value: 730, label: '2Y weekly' }], range, (v) => { range = v; card.update({ build: columnChart({ data: data(), name: label, period: v === 90 ? 'day' : 'week' }), title: `${label}, ${v === 90 ? 'daily, last 90 days' : `weekly, last ${v === 365 ? 'year' : '2 years'}`}` }); }, 'Range'),
      build: columnChart({ data: data(), name: label }),
      src: S[x.src],
      sources: S,
      csvName: key,
      table: () => ({ columns: [{ key: 'date', label: range === 90 ? 'Date' : 'Week ending' }, { key: 'v', label: `${label} (USD)`, num: true, fmt: (v) => usd(v), csv: (r) => r.v }], rows: data().slice().reverse().map(([ts, v]) => ({ date: date(ts), v })) }),
    });
    grid.append(h('div', { class: 'span-6' }, card));
  }

  // ---------- Categories ----------
  if (m.categories?.list?.length) {
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Categories',
      take: categoryTakeaway(m.categories.list),
      title: 'Protocol TVL by category',
      note: 'Sum of each protocol’s TVL in the category; some assets are counted by more than one protocol.',
      build: hbarChart({ items: m.categories.list.slice(0, 10).map((c) => ({ name: c.category, value: c.tvl, sub: `${c.count} protocols · ${pct(c.share, { signed: false })}` })), name: 'TVL' }),
      src: S[m.categories.src],
      sources: S,
      csvName: 'tvl-by-category',
      table: () => ({ columns: [{ key: 'category', label: 'Category' }, { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }, { key: 'share', label: 'Share', num: true, fmt: (v) => pct(v, { signed: false }) }, { key: 'count', label: 'Protocols', num: true }], rows: m.categories.list }),
    })));
  }

  // ---------- Catalyst preview + headlines ----------
  const cat = files['catalysts.json'].data;
  if (cat) {
    const now = Date.now();
    const upcoming = cat.items.filter((i) => Date.parse(i.date) >= now - 864e5 && (i.status === 'open' || i.status === 'upcoming')).slice(0, 7);
    const recent = cat.items.filter((i) => Date.parse(i.date) <= now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, Math.max(0, 7 - upcoming.length));
    const row = (i) => h('li', {},
      h('div', { class: 'when' }, shortDate(i.date), h('br'), relative(i.date)),
      h('div', { class: 'what' }, extLink(i.url, i.title), h('div', { class: 'meta' }, h('span', { class: 'chip solid' }, TYPE_LABEL[i.type] || i.type), i.symbols?.map((s) => h('span', { class: 'chip' }, s)), h('span', {}, i.sourceName))));
    const list = h('div', {},
      upcoming.length ? h('ul', { class: 'feed' }, upcoming.map(row)) : h('p', { class: 'chart-note' }, 'No open or upcoming votes or dated events in the data right now. Most recent items:'),
      recent.length ? h('ul', { class: 'feed' }, recent.map(row)) : null);
    grid.append(h('div', { class: 'span-6 acc-purple' }, infoCard({
      kicker: 'Catalysts',
      take: catalystTakeaway(cat.items, now),
      fallback: 'What’s coming up for your watchlist',
      body: [list, h('p', { class: 'src' }, h('a', { href: '#/catalysts' }, 'See the full timeline and filters →'), ' Information, not predictions.')],
    })));
    const heads = (cat.headlines || []).slice(0, 8);
    grid.append(h('div', { class: 'span-6' }, infoCard({
      kicker: 'News',
      take: heads.length ? { pre: '', hl: `${cat.headlines.length} DeFi headlines`, post: ` in the last 3 weeks from ${new Set(cat.headlines.map((x) => x.sourceName)).size} outlets` } : null,
      fallback: 'Latest DeFi headlines',
      body: heads.length
        ? h('ul', { class: 'feed' }, heads.map((i) => h('li', {}, h('div', { class: 'when' }, shortDate(i.date), h('br'), relative(i.date)), h('div', { class: 'what' }, extLink(i.url, i.title), h('div', { class: 'meta' }, h('span', {}, i.sourceName), i.symbols?.map((s) => h('span', { class: 'chip' }, s)))))))
        : unavailable('No headlines', 'None of the news feeds returned DeFi items this run. See Sources for each feed’s status.'),
      src: heads.length ? [...new Set(heads.map((i) => i.src))].map((k) => cat.sources[k]).filter(Boolean).slice(0, 4) : null,
    })));
  }
}

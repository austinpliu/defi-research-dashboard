// 02 — One protocol
import { h, append, band, statTile, sourceLine, subhead, segmented, extLink, pageError, term, unavailable, svgIcon } from '../ui.js';
import { chartCard, infoCard } from '../cards.js';
import { loadMany } from '../data.js';
import { lineChart, hbarChart, themeOf } from '../charts.js';
import { dataTable } from '../table.js';
import { usd, usdFull, pct, ratio, date, dateTime, relative, shortDate, compact, monthYear } from '../format.js';
import { trimDays, rollingSum, RANGES, rangeLabel, changeOver } from '../series.js';
import {
  trendTakeaway, protocolChainTakeaway, revenueTakeaway, priceTakeaway, valuationTakeaway, supplyTakeaway, yieldTakeaway,
} from '../takeaways.js';

export async function render(root, { params }) {
  const slug = params[0];
  const files = await loadMany([`protocols/${slug}.json`, 'index.json']);
  const d = files[`protocols/${slug}.json`].data;
  if (!d) {
    root.append(pageError(`No data file for “${slug}”. Add it to watchlist.json (see README › How to add a protocol) and run the “Update data” workflow. Details: ${files[`protocols/${slug}.json`].error}`));
    return;
  }
  const S = d.sources || {};
  const a = d.about || {};
  const name = d.name || a.name || slug;
  const sym = d.symbol || d.token?.symbol || null;
  document.title = `${name} · DeFi Research Dashboard`;

  root.append(band({
    n: '02',
    tag: `Section 02 · Protocol${d.group === 'peer' ? ' (peer)' : ''}`,
    title: name,
    sub: a.category ? `${a.category}${a.chains?.length ? ` on ${a.chains.length} chain${a.chains.length === 1 ? '' : 's'}` : ''}${sym ? ` · token ${sym}` : ''}` : null,
    chips: [
      h('a', { class: 'band-chip', href: `#/compare?ids=${slug}` }, 'Compare with others'),
      d.token?.id ? h('a', { class: 'band-chip', href: `#/token/${d.token.id}` }, `${sym || 'Token'} token page`) : null,
      h('a', { class: 'band-chip', href: `#/catalysts?p=${slug}` }, 'Catalysts'),
    ].filter(Boolean),
  }));

  // ---------- profile ----------
  const L = d.links || {};
  const linkList = [
    ['Website', L.website], ['Docs', L.docs], ['X / Twitter', L.twitter], ['GitHub', L.github],
    ...(L.audits || []).slice(0, 3).map((u, i) => [`Audit ${i + 1}`, u]),
    ['DefiLlama', L.defillama], d.token?.id ? ['CoinGecko', `https://www.coingecko.com/en/coins/${d.token.id}`] : null,
    ...(d.governance?.spaces || []).map((s) => [`Snapshot: ${s}`, `https://snapshot.org/#/${s}`]),
  ].filter((x) => x && x[1]);
  const profile = h('section', { class: 'card' },
    h('div', { class: 'p-head' },
      a.logo ? h('img', { class: 'p-logo', src: a.logo, alt: `${name} logo`, width: 56, height: 56, onerror: (e) => e.target.replaceWith(h('div', { class: 'p-logo' })) }) : h('div', { class: 'p-logo' }),
      h('div', {}, h('h2', { class: 'p-name' }, name), h('div', { class: 'chips', style: { marginTop: '8px' } },
        a.category ? h('span', { class: 'chip solid' }, a.category) : null,
        (a.chains || []).slice(0, 8).map((c) => h('span', { class: 'chip' }, c)),
        (a.chains || []).length > 8 ? h('span', { class: 'chip' }, `+${a.chains.length - 8} more`) : null))),
    a.description ? h('p', { class: 'p-desc' }, a.description) : unavailable('No description', a.unavailable || 'DefiLlama has no description for this protocol.'),
    d.token?.description && d.token.description !== a.description
      ? h('p', { class: 'p-desc', style: { fontSize: '14px', color: 'var(--ink-2)', marginTop: '8px' } }, h('b', {}, 'CoinGecko: '), d.token.description)
      : null,
    h('div', { class: 'links' }, linkList.map(([t, u]) => extLink(u, [t, svgIcon('ext')]))),
    sourceLine([S['dl-protocol'], d.token?.description ? S['cg-coin'] : null, L.docs ? { name: 'watchlist.json', label: 'docs link entered by hand', ok: true } : null].filter(Boolean), { sources: S }));
  root.append(profile);

  // ---------- stat strip ----------
  const T = d.tvl || {};
  const F = d.fees || {};
  const R = d.revenue || {};
  const tk = d.token || {};
  const mk = tk.market || {};
  const D = d.derived || {};
  const tokenSrc = S[mk.src] || S['cg-coin'];
  const stats = h('div', { class: 'stats six', style: { marginTop: '18px' } },
    statTile({ label: 'TVL', termKey: 'tvl', raw: T.value, value: usd(T.value), deltas: [{ v: T.change7d, per: '7d' }, { v: T.change30d, per: '30d' }], src: S[T.src], unavailableReason: T.unavailable }),
    statTile({ label: 'Fees, 30 days', termKey: 'fees', raw: F.total30d, value: usd(F.total30d), deltas: [{ v: F.change30dOver30d, per: F.changesCalculated ? 'vs prior 30d (calc.)' : 'vs prior 30d' }], src: S[F.src], unavailableReason: F.unavailable }),
    statTile({ label: 'Revenue, 30 days', termKey: 'revenue', raw: R.total30d, value: usd(R.total30d), deltas: [{ v: R.change30dOver30d, per: R.changesCalculated ? 'vs prior 30d (calc.)' : 'vs prior 30d' }], src: S[R.src], unavailableReason: R.unavailable }),
    statTile({ label: sym ? `${sym} price` : 'Token price', termKey: 'price', raw: mk.price, value: usd(mk.price), deltas: [{ v: mk.change24h, per: '24h' }, { v: mk.change7d, per: '7d' }], src: tokenSrc, unavailableReason: tk.unavailable || mk.partial }),
    statTile({ label: 'Market cap', termKey: 'marketCap', raw: mk.marketCap, value: usd(mk.marketCap), note: mk.fdv ? `FDV ${usd(mk.fdv)}` : null, src: tokenSrc, unavailableReason: tk.unavailable || mk.partial || 'CoinGecko reports no market cap for this token' }),
    statTile({ label: 'Mcap ÷ annual fees', termKey: 'mcapToFees', raw: D.mcapToFees?.value, value: ratio(D.mcapToFees?.value), note: D.annualizedFees?.value ? `Annualized fees ${usd(D.annualizedFees.value)}` : null, src: S['calc-mcap-fees'], sources: S, unavailableReason: 'Needs both a market cap and 30-day fees' }),
  );
  root.append(stats);

  const grid = h('div', { class: 'grid', style: { marginTop: '18px' } });
  root.append(grid);

  // ---------- TVL history ----------
  if (T.series?.length) {
    let range = 365;
    const build = () => lineChart({ series: [{ name: `${name} TVL`, data: trimDays(T.series, range) }], area: true });
    const athDraw = T.ath ? ((T.value - T.ath.value) / T.ath.value) * 100 : null;
    const card = chartCard({
      kicker: 'Total value locked',
      termKey: 'tvl',
      take: trendTakeaway(`${name} TVL`, T.series),
      title: `${name} TVL, ${rangeLabel(range)}`,
      note: T.note || null,
      size: 'tall',
      controls: segmented(RANGES, range, (v) => { range = v; card.update({ build: build(), title: `${name} TVL, ${rangeLabel(v)}` }); }, 'Time range'),
      build: build(),
      callouts: [
        T.ath ? h('div', { class: 'callout' }, h('div', { class: 'c-label' }, term('All-time high', 'ath')), h('div', { class: 'c-value' }, usd(T.ath.value)), h('div', { class: 'c-note' }, `${date(T.ath.ts)} · now ${pct(athDraw, { digits: 0 })}`)) : null,
        h('div', { class: 'callout dark' }, h('div', { class: 'c-label' }, '90-day change'), h('div', { class: 'c-value' }, pct(T.change90d, { digits: 0 })), h('div', { class: 'c-note' }, `1 year: ${pct(T.change1y, { digits: 0 })}`)),
      ],
      src: S[T.src],
      sources: S,
      csvName: `${slug}-tvl`,
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, { key: 'tvl', label: 'TVL (USD)', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }], rows: trimDays(T.series, range).slice().reverse().map(([ts, v]) => ({ date: date(ts), tvl: v })) }),
    });
    grid.append(h('div', { class: 'span-8' }, card));
  } else {
    grid.append(h('div', { class: 'span-8' }, chartCard({ kicker: 'Total value locked', fallback: `${name} TVL`, unavailableReason: T.unavailable || 'No TVL history', src: S['dl-protocol'], sources: S })));
  }

  // ---------- TVL by chain ----------
  const C = d.chainTvl;
  if (C?.list?.length) {
    grid.append(h('div', { class: 'span-4' }, chartCard({
      kicker: 'Chains',
      termKey: 'chain',
      take: protocolChainTakeaway(name, C),
      title: `Where ${name}’s TVL sits (${C.count} chain${C.count === 1 ? '' : 's'})`,
      size: 'tall',
      build: hbarChart({ items: C.list.slice(0, 8).map((c) => ({ name: c.chain, value: c.tvl, sub: pct(c.share, { signed: false }) })), name: 'TVL' }),
      src: S[C.src],
      sources: S,
      csvName: `${slug}-tvl-by-chain`,
      table: () => ({ columns: [{ key: 'chain', label: 'Chain' }, { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), csv: (r) => r.tvl }, { key: 'share', label: 'Share', num: true, fmt: (v) => pct(v, { signed: false }) }], rows: C.list }),
    })));
  }

  // ---------- Fees & revenue ----------
  if (F.series?.length || R.series?.length) {
    let range = 365;
    const nonZero = (x) => x && x.data.some(([, v]) => v > 0);
    const mkSeries = (t) => [
      F.series?.length ? { name: 'Fees', label: 'Fees', data: trimDays(rollingSum(F.series, 30), range), color: t.s[0] } : null,
      R.series?.length ? { name: 'Revenue', label: 'Revenue', data: trimDays(rollingSum(R.series, 30), range), color: t.s[1] } : null,
      d.holdersRevenue?.series?.length ? { name: 'Holders revenue', label: 'Holders', data: trimDays(rollingSum(d.holdersRevenue.series, 30), range), color: t.s[2] } : null,
    ].filter(nonZero);
    const build = (t) => lineChart({ series: mkSeries(t), minZero: true })(t);
    const legend = () => { const t = themeOf(document.querySelector('main')); return mkSeries(t).map((s) => ({ name: s.name, color: s.color })); };
    const card = chartCard({
      kicker: 'Fees & revenue',
      termKey: 'revenue',
      take: revenueTakeaway(name, F, R),
      title: `Rolling 30-day fees and revenue, ${rangeLabel(range)}`,
      note: 'Each point is the total of the 30 days before it, which smooths out daily noise.',
      controls: segmented(RANGES, range, (v) => { range = v; card.update({ build, title: `Rolling 30-day fees and revenue, ${rangeLabel(v)}` }); }, 'Time range'),
      build,
      src: [S[F.src], S[R.src], d.holdersRevenue?.series?.length ? S['dl-holders-revenue'] : null].filter(Boolean),
      sources: S,
      csvName: `${slug}-fees-revenue`,
      table: () => {
        const rf = new Map((F.series || []).map(([ts, v]) => [ts, v]));
        const rr = new Map((R.series || []).map(([ts, v]) => [ts, v]));
        const days = [...new Set([...rf.keys(), ...rr.keys()])].sort((x, y) => y - x);
        return { columns: [{ key: 'date', label: 'Date' }, { key: 'fees', label: 'Daily fees', num: true, fmt: (v) => usd(v), csv: (r) => r.fees }, { key: 'revenue', label: 'Daily revenue', num: true, fmt: (v) => usd(v), csv: (r) => r.revenue }], rows: days.map((ts) => ({ date: date(ts), fees: rf.get(ts) ?? null, revenue: rr.get(ts) ?? null })) };
      },
    });
    requestAnimationFrame(() => card.update({ legend: legend() }));
    grid.append(h('div', { class: 'span-6' }, card));
  } else {
    grid.append(h('div', { class: 'span-6' }, chartCard({ kicker: 'Fees & revenue', fallback: `${name} fees and revenue`, unavailableReason: F.unavailable || 'DefiLlama does not track fees for this protocol', src: S['dl-fees'], sources: S })));
  }

  // ---------- Token price ----------
  const ts = d.tokenSeries;
  if (ts?.price?.length) {
    let range = 365;
    const build = () => lineChart({ series: [{ name: `${sym} price`, data: trimDays(ts.price, range) }], area: true });
    const card = chartCard({
      kicker: 'Token',
      termKey: 'price',
      take: priceTakeaway(sym || name, mk, ts.price),
      title: `${sym || name} price in USD, ${rangeLabel(range)}`,
      controls: segmented([{ value: 30, label: '30D' }, { value: 90, label: '90D' }, { value: 365, label: '1Y' }], range, (v) => { range = v; card.update({ build: build(), title: `${sym || name} price in USD, ${rangeLabel(v)}` }); }, 'Time range'),
      build: build(),
      src: S[ts.src],
      sources: S,
      csvName: `${sym || slug}-price`,
      table: () => ({ columns: [{ key: 'date', label: 'Date' }, { key: 'price', label: 'Price (USD)', num: true, fmt: (v) => usd(v), csv: (r) => r.price }], rows: trimDays(ts.price, range).slice().reverse().map(([t2, v]) => ({ date: date(t2), price: v })) }),
    });
    grid.append(h('div', { class: 'span-6' }, card));
  } else {
    grid.append(h('div', { class: 'span-6' }, chartCard({ kicker: 'Token', fallback: `${sym || name} price`, unavailableReason: ts?.unavailable || tk.unavailable || 'No token price history', src: S['cg-chart'], sources: S })));
  }

  // ---------- Valuation + supply ----------
  const idx = files['index.json'].data;
  const others = (idx?.protocols || []).filter((p) => p.slug !== slug && p.mcap && p.fees30d).map((p) => ({ name: p.name, value: p.mcap / ((p.fees30d * 365) / 30) }));
  const sup = tk.supply || {};
  const valRows = [
    ['Market cap', 'marketCap', usd(mk.marketCap), tokenSrc],
    ['Fully diluted value', 'fdv', usd(mk.fdv), tokenSrc],
    ['Annualized fees', 'annualizedFees', usd(D.annualizedFees?.value), S['calc-annual-fees']],
    ['Annualized revenue', 'annualizedRevenue', usd(D.annualizedRevenue?.value), S['calc-annual-revenue']],
    ['Market cap ÷ annualized fees', 'mcapToFees', ratio(D.mcapToFees?.value), S['calc-mcap-fees']],
    ['Market cap ÷ annualized revenue', 'mcapToRevenue', ratio(D.mcapToRevenue?.value), S['calc-mcap-revenue']],
    ['FDV ÷ annualized fees', 'fdvToFees', ratio(D.fdvToFees?.value), S['calc-fdv-fees']],
    ['Market cap ÷ TVL', 'mcapToTvl', ratio(D.mcapToTvl?.value), S['calc-mcap-tvl']],
    ['Revenue as % of fees', 'revenueShare', D.revenueShare?.value != null ? pct(D.revenueShare.value, { signed: false }) : '—', S['calc-revenue-share']],
  ];
  const valTable = h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Metric'), h('th', { class: 'n' }, 'Value'), h('th', {}, 'How'))),
    h('tbody', {}, valRows.map(([label, key, val, src]) => h('tr', {}, h('td', {}, term(label, key)), h('td', { class: 'n' }, val), h('td', { class: 'sub wrap' }, src?.derived ? src.formula : src ? extLink(src.page, src.name) : '—'))))));
  const segbar = sup.circulating && (sup.max || sup.total)
    ? (() => {
      const cap = sup.max || sup.total;
      const circ = Math.min(100, (sup.circulating / cap) * 100);
      return h('div', {},
        h('p', { class: 'chart-title' }, `${sym || 'Token'} supply: circulating vs. not yet circulating (of ${sup.basis} supply)`),
        h('div', { class: 'segbar', role: 'img', 'aria-label': `${pct(circ, { signed: false })} circulating` },
          h('div', { style: { width: `${circ}%`, background: 'var(--marker)' }, title: `Circulating ${compact(sup.circulating)}` }, circ > 18 ? `${pct(circ, { signed: false, digits: 0 })} circulating` : ''),
          circ < 99.5 ? h('div', { style: { width: `${100 - circ}%`, background: 'var(--gray-marker)' }, title: `Not yet circulating ${compact(cap - sup.circulating)}` }, 100 - circ > 18 ? `${pct(100 - circ, { signed: false, digits: 0 })} not yet` : '') : null),
        h('div', { class: 'deltas', style: { color: 'var(--ink-2)' } }, h('span', {}, term('Circulating', 'circulating'), ' ', compact(sup.circulating, 2)), h('span', {}, term('Total', 'totalSupply'), ' ', compact(sup.total, 2)), h('span', {}, term('Max', 'maxSupply'), ' ', sup.max ? compact(sup.max, 2) : sup.maxInfinite ? 'no cap' : '—')));
    })()
    : null;
  const unl = d.unlocks || {};
  grid.append(h('div', { class: 'span-6' }, infoCard({
    kicker: 'Valuation & supply',
    take: valuationTakeaway(sym || name, D.mcapToFees?.value, others) || supplyTakeaway(sym || name, sup),
    fallback: `${sym || name} valuation and supply`,
    body: [
      valTable,
      segbar,
      unl.list?.length
        ? h('div', {}, h('p', { class: 'chart-title' }, term('Upcoming unlocks', 'unlock')), h('ul', { class: 'feed' }, unl.list.map((u) => h('li', {}, h('div', { class: 'when' }, date(u.ts)), h('div', { class: 'what' }, `${compact(u.tokens, 2)} ${sym || ''} ${u.category ? `(${u.category})` : ''}`)))))
        : h('div', { style: { marginTop: '12px' } }, unavailable('Upcoming unlocks: unavailable', unl.unavailable || 'No unlock schedule in the data.')),
    ],
    src: [tokenSrc, S['dl-fees']].filter(Boolean),
    sources: S,
  })));

  // ---------- TVL composition ----------
  const tb = d.tokenBreakdown;
  if (tb?.list?.length) {
    grid.append(h('div', { class: 'span-6' }, chartCard({
      kicker: 'Composition',
      termKey: 'tvl',
      take: tb.list[0] ? { pre: '', hl: `${tb.list[0].token} makes up ${pct(tb.list[0].share, { signed: false, digits: 0 })}`, post: ` of ${name}’s TVL` } : null,
      title: `Assets inside ${name}’s TVL (as of ${date(tb.asOf)})`,
      build: hbarChart({ items: tb.list.slice(0, 10).map((x) => ({ name: x.token, value: x.usd, sub: pct(x.share, { signed: false }) })), name: 'Value' }),
      src: S[tb.src],
      sources: S,
      csvName: `${slug}-tvl-composition`,
      table: () => ({ columns: [{ key: 'token', label: 'Asset' }, { key: 'usd', label: 'USD', num: true, fmt: (v) => usd(v), csv: (r) => r.usd }, { key: 'share', label: 'Share', num: true, fmt: (v) => pct(v, { signed: false }) }], rows: tb.list }),
    })));
  }

  // ---------- Yields ----------
  const Y = d.yields || {};
  grid.append(h('div', { class: 'span-12' }, infoCard({
    kicker: 'Yields',
    take: yieldTakeaway(name, Y.list),
    fallback: `Top yield pools on ${name}`,
    title: Y.list?.length ? `Largest ${Y.list.length} pools by deposits (DefiLlama project ids: ${(Y.projects || []).join(', ')})` : null,
    body: Y.list?.length
      ? dataTable({
        caption: `${name} yield pools`, csvName: `${slug}-yield-pools`, sortKey: 'tvl', pageSize: 12, filters: [{ key: 'chain', label: 'Chain' }],
        columns: [
          { key: 'symbol', label: 'Pool', fmt: (v, r) => h('span', {}, extLink(r.page, v), r.meta ? h('span', { class: 'sub' }, ` ${r.meta}`) : null) },
          { key: 'chain', label: 'Chain' },
          { key: 'project', label: 'Project' },
          { key: 'tvl', label: 'Deposits', num: true, fmt: (v) => usd(v), termKey: 'tvl' },
          { key: 'apy', label: 'APY', num: true, fmt: (v) => pct(v, { signed: false }), termKey: 'apy' },
          { key: 'apyBase', label: 'Base', num: true, fmt: (v) => pct(v, { signed: false }), termKey: 'apyBase' },
          { key: 'apyReward', label: 'Rewards', num: true, fmt: (v) => pct(v, { signed: false }), termKey: 'apyReward' },
          { key: 'apyMean30d', label: '30d avg', num: true, fmt: (v) => pct(v, { signed: false }) },
          { key: 'stablecoin', label: 'Stable', fmt: (v) => (v ? 'yes' : '') },
        ],
        rows: Y.list,
        csvExtra: [{ label: 'DefiLlama pool page', get: (r) => r.page }],
      })
      : unavailable('No yield pools', Y.unavailable || `DefiLlama’s yields database has no pools for ${name}.`),
    src: S['dl-yields'],
    sources: S,
  })));

  // ---------- Governance ----------
  const G = d.governance || {};
  const now = Date.now() / 1000;
  const props = (G.proposals || []).slice().sort((x, y) => (x.state === y.state ? (x.state === 'closed' ? y.end - x.end : x.end - y.end) : ['active', 'pending', 'closed'].indexOf(x.state) - ['active', 'pending', 'closed'].indexOf(y.state)));
  const openN = props.filter((p) => p.state === 'active').length;
  const pendingN = props.filter((p) => p.state === 'pending').length;
  const recentN = props.filter((p) => p.end >= now - 45 * 86400).length;
  const lastClosed = props.filter((p) => p.state === 'closed').sort((x, y) => y.end - x.end)[0];
  const spaceStats = Object.entries(G.spaceInfo || {}).filter(([, v]) => v).map(([k, v]) => `${v.name || k}: ${v.proposalsCount ?? '?'} proposals all-time, ${v.followers ?? '?'} followers`);
  const missingSpaces = Object.entries(G.spaceInfo || {}).filter(([, v]) => !v).map(([k]) => k);
  const govTake = openN
    ? { pre: '', hl: `${openN} vote${openN === 1 ? '' : 's'} open now`, post: pendingN ? `, ${pendingN} more starting soon` : '' }
    : pendingN
      ? { pre: '', hl: `${pendingN} vote${pendingN === 1 ? '' : 's'} starting soon`, post: '' }
      : recentN
        ? { pre: `${recentN} Snapshot vote${recentN === 1 ? '' : 's'} `, hl: 'in the last 45 days', post: '' }
        : lastClosed
          ? { pre: 'The last Snapshot vote ', hl: `closed ${relative(lastClosed.end * 1000)}`, post: '' }
          : null;
  grid.append(h('div', { class: 'span-6 acc-purple' }, infoCard({
    kicker: 'Governance',
    take: govTake,
    fallback: `${name} governance`,
    body: [spaceStats.length ? h('p', { class: 'chart-note' }, spaceStats.join(' · ')) : null, props.length
      ? h('ul', { class: 'feed' }, props.slice(0, 10).map((p) => h('li', {},
        h('div', { class: 'when' }, p.state === 'active' ? 'Closes' : p.state === 'pending' ? 'Opens' : 'Closed', h('br'), shortDate(p.state === 'pending' ? p.start : p.end)),
        h('div', { class: 'what' }, extLink(p.url, p.title), h('div', { class: 'meta' },
          h('span', { class: `chip ${p.state === 'active' ? 'ink' : ''}` }, p.state === 'active' ? 'Open' : p.state === 'pending' ? 'Upcoming' : 'Closed'),
          p.leadingChoice ? h('span', {}, `${p.state === 'closed' ? 'Result' : 'Leading'}: “${p.leadingChoice}” ${pct(p.leadingShare, { signed: false, digits: 0 })}`) : null,
          p.votes != null ? h('span', {}, `${compact(p.votes)} votes`) : null,
          p.discussion ? extLink(p.discussion, 'discussion') : null)))))
      : unavailable('No Snapshot proposals', G.unavailable || (missingSpaces.length ? `Snapshot doesn’t recognise the space${missingSpaces.length === 1 ? '' : 's'} ${missingSpaces.join(', ')} (taken from DefiLlama/CoinGecko or watchlist.json). This protocol may vote on-chain instead.` : 'No proposals found in this protocol’s Snapshot space.'))],
    src: S.snapshot,
    sources: S,
  })));

  // ---------- Incidents & milestones ----------
  const hk = d.hacks || {};
  const hm = d.hallmarks?.list || [];
  grid.append(h('div', { class: 'span-6' }, infoCard({
    kicker: 'Incidents & milestones',
    take: hk.list?.length ? { pre: `${name} appears in `, hl: `${hk.list.length} recorded hack${hk.list.length === 1 ? '' : 's'}`, post: '' } : hm.length ? { pre: 'DefiLlama marks ', hl: `${hm.length} notable event${hm.length === 1 ? '' : 's'}`, post: ` on ${name}’s timeline` } : null,
    fallback: `${name} incidents and milestones`,
    body: [
      hk.list?.length
        ? dataTable({ caption: 'Hacks', csvName: `${slug}-hacks`, search: false, sortKey: 'date', columns: [{ key: 'date', label: 'Date', fmt: (v) => date(v) }, { key: 'name', label: 'Name' }, { key: 'amount', label: 'Lost', num: true, fmt: (v) => usd(v) }, { key: 'technique', label: 'How', wrap: true }, { key: 'source', label: 'Source', fmt: (v) => extLink(v, 'link') }], rows: hk.list })
        : unavailable('Hack history: unavailable', `${hk.unavailable || ''} ${hk.note || ''}`.trim() || 'No data'),
      h('p', { class: 'chart-title' }, term('Timeline notes', 'hallmark')),
      hm.length ? h('ul', { class: 'feed' }, hm.slice(0, 10).map((x) => h('li', {}, h('div', { class: 'when' }, date(x.ts)), h('div', { class: 'what' }, x.text)))) : h('p', { class: 'muted' }, 'DefiLlama lists no timeline notes for this protocol.'),
    ],
    src: [S['dl-hacks'], S['dl-protocol']].filter(Boolean),
    sources: S,
  })));

  // ---------- Raises ----------
  const rz = d.raises?.list || [];
  grid.append(h('div', { class: 'span-6' }, infoCard({
    kicker: 'Funding',
    take: rz.length ? { pre: `${name} has `, hl: `${rz.length} recorded funding round${rz.length === 1 ? '' : 's'}`, post: rz.some((r) => r.amount) ? `, totalling ${usd(rz.reduce((s, r) => s + (r.amount || 0), 0) * 1e6)}` : '' } : null,
    fallback: `${name} funding rounds`,
    body: rz.length
      ? dataTable({ caption: 'Raises', csvName: `${slug}-raises`, search: false, sortKey: 'date', columns: [{ key: 'date', label: 'Date', fmt: (v) => date(v) }, { key: 'round', label: 'Round' }, { key: 'amount', label: 'Amount', num: true, fmt: (v) => (v != null ? usd(v * 1e6) : '—'), csv: (r) => (r.amount != null ? r.amount * 1e6 : '') }, { key: 'leadInvestors', label: 'Lead investors', wrap: true, fmt: (v) => (v || []).join(', ') || '—' }, { key: 'source', label: 'Source', fmt: (v) => extLink(v, 'link') }], rows: rz })
      : unavailable('No funding rounds', 'DefiLlama lists no raises for this protocol.'),
    src: S['dl-protocol'],
    sources: S,
  })));

  // ---------- News ----------
  const news = d.news || [];
  grid.append(h('div', { class: 'span-6' }, infoCard({
    kicker: 'News & posts',
    take: news.length ? { pre: '', hl: `${news.length} mention${news.length === 1 ? '' : 's'}`, post: ` of ${name} in recent news and posts` } : null,
    fallback: `${name} in the news`,
    body: news.length
      ? h('ul', { class: 'feed' }, news.map((i) => h('li', {}, h('div', { class: 'when' }, shortDate(i.date), h('br'), relative(i.date)), h('div', { class: 'what' }, extLink(i.url, i.title), h('div', { class: 'meta' }, h('span', {}, i.sourceName), h('span', { class: 'chip' }, i.type.replace('-', ' ')))))))
      : unavailable('No recent mentions', 'None of the news, blog or forum feeds mentioned this protocol recently.'),
    src: [...new Set(news.map((i) => i.src))].map((k) => S[k]).filter(Boolean).slice(0, 4),
    sources: S,
  })));

  // ---------- All sources for this page ----------
  root.append(subhead('Sources', 'Every dataset on this page'));
  const srcRows = Object.entries(S).map(([k, s]) => ({ key: k, name: s.name, label: s.label, page: s.page, api: s.api, fetchedAt: s.stale ? s.stale.lastGoodAt : s.fetchedAt, status: s.derived ? 'calculated' : s.stale ? 'stale' : s.ok ? 'ok' : 'failed', error: s.stale ? s.stale.reason : s.error, formula: s.formula }));
  root.append(dataTable({
    caption: 'Sources', csvName: `${slug}-sources`, sortKey: 'status', sortDir: 'asc', pageSize: 40, search: true,
    columns: [
      { key: 'status', label: 'Status', fmt: (v) => h('span', {}, h('span', { class: `status-dot ${v === 'ok' || v === 'calculated' ? 'ok' : v === 'stale' ? 'skip' : 'fail'}` }), v) },
      { key: 'label', label: 'Dataset', fmt: (v, r) => `${r.name}: ${v || ''}` },
      { key: 'page', label: 'Page', fmt: (v) => extLink(v, v ? new URL(v).host : '') },
      { key: 'api', label: 'Endpoint / formula', wrap: true, fmt: (v, r) => (r.formula ? r.formula : v && v.startsWith('http') ? extLink(v.split(' ')[0], v) : v || '—') },
      { key: 'fetchedAt', label: 'Fetched', fmt: (v) => (v ? dateTime(v) : '—') },
      { key: 'error', label: 'Problem', wrap: true, fmt: (v) => v || '' },
    ],
    rows: srcRows,
  }));
}

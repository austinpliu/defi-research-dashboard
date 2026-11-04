// 04 — Compare 2–5 protocols (and their tokens)
import { h, band, sourceLine, segmented, pageError, term, unavailable } from '../ui.js';
import { chartCard } from '../cards.js';
import { loadMany, loadSafe } from '../data.js';
import { lineChart, themeOf } from '../charts.js';
import { dataTable } from '../table.js';
import { usd, pct, ratio, date } from '../format.js';
import { trimDays, indexTo100, rollingSum, changeOver, valueAt, rangeLabel } from '../series.js';
import { compareTakeaway } from '../takeaways.js';
import { setQuery } from '../route.js';

const METRICS = {
  tvl: { label: 'TVL', short: 'TVL', get: (d) => d.tvl?.series, src: (d) => d.sources?.[d.tvl?.src], fmt: usd },
  fees: { label: 'Fees (rolling 30-day total)', short: 'fees', get: (d) => (d.fees?.series ? rollingSum(d.fees.series, 30) : null), src: (d) => d.sources?.['dl-fees'], fmt: usd },
  revenue: { label: 'Revenue (rolling 30-day total)', short: 'revenue', get: (d) => (d.revenue?.series ? rollingSum(d.revenue.series, 30) : null), src: (d) => d.sources?.['dl-revenue'], fmt: usd },
  price: { label: 'Token price', short: 'token price', get: (d) => d.tokenSeries?.price, src: (d) => d.sources?.[d.tokenSeries?.src], fmt: usd },
  mcap: { label: 'Token market cap', short: 'market cap', get: (d) => d.tokenSeries?.marketCap, src: (d) => d.sources?.[d.tokenSeries?.src], fmt: usd },
};

const slotOf = new Map(); // protocol slug → palette slot, kept while selected (colors follow the entity)
function assignSlots(ids) {
  for (const k of [...slotOf.keys()]) if (!ids.includes(k)) slotOf.delete(k);
  for (const id of ids) {
    if (slotOf.has(id)) continue;
    const used = new Set(slotOf.values());
    let s = 0;
    while (used.has(s)) s++;
    slotOf.set(id, s);
  }
}

export async function render(root, { query }) {
  const { data: idx, error } = await loadSafe('index.json');
  if (!idx) { root.append(pageError(error)); return; }
  const all = idx.protocols;
  let ids = (query.get('ids') || '').split(',').filter((x) => all.some((p) => p.slug === x));
  if (ids.length < 2) {
    const defaults = all.filter((p) => p.group === 'watchlist').sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).map((p) => p.slug);
    ids = [...new Set([...ids, ...defaults])].slice(0, 3);
  }
  let metric = METRICS[query.get('metric')] ? query.get('metric') : 'tvl';
  let mode = query.get('mode') === 'abs' ? 'abs' : 'index';
  let range = [90, 365].includes(Number(query.get('range'))) ? Number(query.get('range')) : 365;

  root.append(band({ n: '04', tag: 'Section 04 · Compare', title: 'Side by side', sub: 'Pick 2 to 5 protocols. Overlay their TVL, fees, revenue, token price or market cap, and compare valuation metrics in one table. The link in your address bar saves this view.' }));

  const picker = h('div', { class: 'picker', role: 'group', 'aria-label': 'Protocols to compare' });
  const controls = h('div', { class: 'filters stacked' },
    h('div', { class: 'group' }, h('label', { class: 'lbl' }, 'Protocols'), picker),
    h('div', { class: 'group' }, h('label', { class: 'lbl' }, 'Show'),
    segmented(Object.entries(METRICS).map(([k, m]) => ({ value: k, label: m.short === 'token price' ? 'Price' : m.short === 'market cap' ? 'Mkt cap' : m.short[0].toUpperCase() + m.short.slice(1) })), metric, (v) => { metric = v; update(); }, 'Metric'),
    segmented([{ value: 'index', label: 'Growth (=100)' }, { value: 'abs', label: 'Absolute' }], mode, (v) => { mode = v; update(); }, 'Units'),
    segmented([{ value: 90, label: '90D' }, { value: 365, label: '1Y' }], range, (v) => { range = v; update(); }, 'Range')));
  root.append(controls);

  const chartHolder = h('div');
  const tableHolder = h('div', { style: { marginTop: '18px' } });
  root.append(chartHolder, tableHolder);

  const docs = new Map();
  async function ensure(list) {
    const need = list.filter((s) => !docs.has(s));
    const got = await loadMany(need.map((s) => `protocols/${s}.json`));
    for (const s of need) docs.set(s, got[`protocols/${s}.json`].data || null);
  }

  function renderPicker() {
    const t = themeOf(document.querySelector('main') || document.body);
    picker.replaceChildren(...all.map((p) => {
      const on = ids.includes(p.slug);
      const b = h('button', { type: 'button', 'aria-pressed': String(on), disabled: !on && ids.length >= 5, title: !on && ids.length >= 5 ? 'Up to 5 at a time' : p.group === 'peer' ? 'Peer (not in your watchlist)' : 'Watchlist' },
        h('span', { class: 'sw', style: { background: on ? t.s[slotOf.get(p.slug) % 8] : null } }), p.name, p.group === 'peer' ? h('span', { class: 'sub' }, ' peer') : null);
      b.addEventListener('click', () => {
        if (on && ids.length <= 2) return; // keep at least two
        ids = on ? ids.filter((x) => x !== p.slug) : [...ids, p.slug];
        update();
      });
      return b;
    }));
  }

  let card = null;
  async function update() {
    assignSlots(ids);
    setQuery({ ids: ids.join(','), metric, mode, range });
    renderPicker();
    await ensure(ids);
    const M = METRICS[metric];
    const sel = ids.map((s) => ({ slug: s, d: docs.get(s), meta: all.find((p) => p.slug === s) }));
    const withData = sel.filter((x) => x.d && M.get(x.d)?.length);
    const missing = sel.filter((x) => !withData.includes(x));
    const seriesFor = (x) => {
      const raw = trimDays(M.get(x.d), range);
      return mode === 'index' ? indexTo100(raw) : raw;
    };
    const build = (t) => lineChart({
      series: withData.map((x) => ({ name: x.meta.name, label: x.meta.name, data: seriesFor(x), color: t.s[slotOf.get(x.slug) % 8] })),
      fmt: mode === 'index' ? (v) => v.toFixed(0) : M.fmt,
      axisFmt: mode === 'index' ? (v) => v.toFixed(0) : undefined,
    })(t);
    const rows = withData.map((x) => ({ name: x.meta.name, change: changeOver(M.get(x.d), range) }));
    const take = compareTakeaway(rows, M.short, rangeLabel(range));
    const legend = () => { const t = themeOf(document.querySelector('main')); return withData.map((x) => ({ name: x.meta.name, color: t.s[slotOf.get(x.slug) % 8] })); };
    const title = `${M.label}${mode === 'index' ? ', indexed to 100 at the start' : ''}, ${rangeLabel(range)}`;
    const srcs = withData.map((x) => M.src(x.d)).filter(Boolean);
    const table = () => {
      const base = withData[0] ? seriesFor(withData[0]) : [];
      return { columns: [{ key: 'date', label: 'Date' }, ...withData.map((x) => ({ key: x.slug, label: x.meta.name, num: true, fmt: (v) => (mode === 'index' ? (v != null ? v.toFixed(1) : '—') : M.fmt(v)), csv: (r) => r[x.slug] }))], rows: base.slice().reverse().map(([ts]) => ({ date: date(ts), ...Object.fromEntries(withData.map((x) => [x.slug, valueAt(seriesFor(x), ts)])) })) };
    };
    if (withData.length < 1) {
      chartHolder.replaceChildren(chartCard({ kicker: 'Overlay', fallback: title, unavailableReason: `None of the selected protocols has ${M.short} data.` }));
      card = null;
    } else if (!card || !card.isConnected) {
      card = chartCard({ kicker: 'Overlay', take, title, size: 'tall', build, legend: [], src: srcs, csvName: `compare-${metric}`, table });
      chartHolder.replaceChildren(card);
      const { mountPending } = await import('../cards.js');
      mountPending();
      card.update({ legend: legend() });
    } else {
      card.update({ build, take, title, legend: legend(), src: srcs, table });
    }
    if (missing.length) chartHolder.append(h('p', { class: 'src' }, `No ${M.short} data for: ${missing.map((x) => x.meta?.name || x.slug).join(', ')}.`));
    renderTable(sel);
  }

  function renderTable(sel) {
    const delta = (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v));
    const rows = sel.filter((x) => x.d).map(({ slug, d, meta }) => {
      const D = d.derived || {};
      const mk = d.token?.market || {};
      return {
        slug, name: meta.name, category: d.about?.category || '', chains: d.about?.chains || [],
        tvl: d.tvl?.value, tvl30: d.tvl?.change30d, tvl90: d.tvl?.change90d, tvl1y: d.tvl?.change1y,
        fees30: d.fees?.total30d, rev30: d.revenue?.total30d, annRev: D.annualizedRevenue?.value,
        mcap: mk.marketCap, fdv: mk.fdv, mcapFees: D.mcapToFees?.value, mcapRev: D.mcapToRevenue?.value, fdvFees: D.fdvToFees?.value, price30: mk.change30d,
      };
    });
    tableHolder.replaceChildren(h('section', { class: 'card' },
      h('div', { class: 'kicker' }, 'Metrics table'),
      h('h3', { class: 'takeaway' }, 'The numbers side by side'),
      dataTable({
        caption: 'Comparison', csvName: 'comparison', sortKey: 'tvl', search: false, filters: [],
        columns: [
          { key: 'name', label: 'Protocol', fmt: (v, r) => h('a', { href: `#/protocol/${r.slug}`, class: 'name' }, v) },
          { key: 'category', label: 'Category' },
          { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), termKey: 'tvl' },
          { key: 'tvl30', label: 'TVL 30d', num: true, fmt: delta, csv: (r) => r.tvl30 },
          { key: 'tvl90', label: 'TVL 90d', num: true, fmt: delta, csv: (r) => r.tvl90 },
          { key: 'tvl1y', label: 'TVL 1y', num: true, fmt: delta, csv: (r) => r.tvl1y },
          { key: 'fees30', label: 'Fees 30d', num: true, fmt: (v) => usd(v), termKey: 'fees' },
          { key: 'rev30', label: 'Revenue 30d', num: true, fmt: (v) => usd(v), termKey: 'revenue' },
          { key: 'annRev', label: 'Ann. revenue', num: true, fmt: (v) => usd(v), termKey: 'annualizedRevenue' },
          { key: 'mcap', label: 'Market cap', num: true, fmt: (v) => usd(v), termKey: 'marketCap' },
          { key: 'fdv', label: 'FDV', num: true, fmt: (v) => usd(v), termKey: 'fdv' },
          { key: 'mcapFees', label: 'Mcap ÷ fees', num: true, fmt: (v) => ratio(v), termKey: 'mcapToFees' },
          { key: 'mcapRev', label: 'Mcap ÷ revenue', num: true, fmt: (v) => ratio(v), termKey: 'mcapToRevenue' },
          { key: 'fdvFees', label: 'FDV ÷ fees', num: true, fmt: (v) => ratio(v), termKey: 'fdvToFees' },
          { key: 'price30', label: 'Price 30d', num: true, fmt: delta, csv: (r) => r.price30 },
        ],
        rows,
      }),
      h('p', { class: 'src' }, 'TVL, fees and revenue: DefiLlama. Market cap, FDV and price: CoinGecko. Ratios are calculated here: value ÷ (30-day total × 365 ÷ 30). Each protocol page lists the exact endpoints and fetch times.'),
      sourceLine(sel.filter((x) => x.d).flatMap((x) => [x.d.sources?.['dl-protocol']]).filter(Boolean).slice(0, 1))));
  }

  await update();
}

// 05 — Catalysts: votes, unlocks, launches/upgrades, forum posts, news.
// Information, not predictions.
import { h, openExternal, band, sourceLine, extLink, pageError, unavailable, term, takeaway } from '../ui.js';
import { chartCard } from '../cards.js';
import { loadSafe } from '../data.js';
import { timelineChart, themeOf } from '../charts.js';
import { dataTable } from '../table.js';
import { date, dateTime, relative, shortDate, usd, pct } from '../format.js';
import { catalystTakeaway } from '../takeaways.js';
import { setQuery } from '../route.js';

export const TYPES = {
  'governance-vote': { label: 'Governance vote', symbol: 'circle', slot: 0, term: 'governance' },
  unlock: { label: 'Token unlock', symbol: 'diamond', slot: 1, term: 'unlock' },
  'launch-upgrade': { label: 'Launch / upgrade', symbol: 'triangle', slot: 2 },
  scheduled: { label: 'Scheduled (DefiLlama)', symbol: 'pin', slot: 3, term: 'hallmark' },
  'governance-forum': { label: 'Forum post', symbol: 'rect', slot: 4, term: 'forum' },
  blog: { label: 'Protocol blog', symbol: 'roundRect', slot: 7 },
  news: { label: 'News', symbol: 'emptyCircle', slot: 6 },
};

const RANGES = {
  all: { label: 'All dates', from: -45, to: 60 },
  next7: { label: 'Next 7 days', from: 0, to: 7 },
  next30: { label: 'Next 30 days', from: 0, to: 30 },
  past7: { label: 'Past 7 days', from: -7, to: 0 },
  past30: { label: 'Past 30 days', from: -30, to: 0 },
};

export async function render(root, { query }) {
  const [{ data: cat, error }, predFile] = await Promise.all([loadSafe('catalysts.json'), loadSafe('predictions.json')]);
  if (!cat) { root.append(pageError(error)); return; }
  const S = cat.sources || {};
  const protocols = cat.protocols || [];
  const state = {
    p: new Set((query.get('p') || '').split(',').filter(Boolean)),
    types: new Set((query.get('type') || '').split(',').filter(Boolean)),
    range: RANGES[query.get('range')] ? query.get('range') : 'all',
    q: query.get('q') || '',
  };

  root.append(band({ n: '05', tag: 'Section 05 · Catalysts', title: 'What could move your tokens', sub: 'Governance votes, scheduled events, launches and upgrades, forum posts and news about your watchlist (and the peers you compare it with) — each with a link to the original. Information, not predictions.' }));
  root.append(h('div', { class: 'disclaimer', role: 'note', style: { marginBottom: '14px' } }, h('span', { class: 'chip' }, 'Information, not prediction'), 'Nothing here says a price will move. Types like “launch / upgrade” are assigned by simple keyword rules on the headline; open the source to judge for yourself.'));
  for (const u of cat.unavailable || []) root.append(h('div', { style: { marginBottom: '14px' } }, unavailable(`${TYPES[u.type]?.label || u.type}s: unavailable`, u.reason)));

  // ---------- filters ----------
  const chipRow = (items, set, key) => h('div', { class: 'group' }, items.map(([val, label]) => {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(set.has(val)) }, label);
    b.addEventListener('click', () => { set.has(val) ? set.delete(val) : set.add(val); b.setAttribute('aria-pressed', String(set.has(val))); apply(); });
    return b;
  }));
  const counts = {};
  for (const i of cat.items) counts[i.type] = (counts[i.type] || 0) + 1;
  const rangeSel = h('select', { 'aria-label': 'Date range' }, Object.entries(RANGES).map(([k, r]) => h('option', { value: k, selected: k === state.range }, r.label)));
  rangeSel.addEventListener('change', () => { state.range = rangeSel.value; apply(); });
  const search = h('input', { type: 'search', placeholder: 'Search titles…', value: state.q, 'aria-label': 'Search catalysts' });
  search.addEventListener('input', () => { state.q = search.value.trim(); apply(); });
  root.append(h('div', { class: 'filters' },
    h('label', { class: 'lbl' }, 'Token'), chipRow(protocols.map((p) => [p.slug, `${p.symbol || p.name}${p.group === 'peer' ? ' (peer)' : ''}`]), state.p, 'p'),
    h('label', { class: 'lbl' }, 'Type'), chipRow(Object.entries(TYPES).filter(([k]) => counts[k]).map(([k, t]) => [k, `${t.label} (${counts[k]})`]), state.types, 'type'),
    h('label', { class: 'lbl' }, 'When'), rangeSel, search));

  const timelineHolder = h('div');
  const listHolder = h('div', { class: 'grid', style: { marginTop: '18px' } });
  root.append(timelineHolder, listHolder);

  let card = null;
  function filtered() {
    const now = Date.now();
    const r = RANGES[state.range];
    const from = now + r.from * 864e5 - (state.range === 'all' ? 365 * 864e5 : 0);
    const to = now + r.to * 864e5 + (state.range === 'all' ? 365 * 864e5 : 0);
    const q = state.q.toLowerCase();
    return cat.items.filter((i) => {
      const t = Date.parse(i.date);
      if (t < from || t > to) return false;
      if (state.p.size && !i.protocols.some((s) => state.p.has(s))) return false;
      if (state.types.size && !state.types.has(i.type)) return false;
      if (q && !`${i.title} ${i.summary} ${i.sourceName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function apply() {
    setQuery({ p: [...state.p].join(','), type: [...state.types].join(','), range: state.range === 'all' ? '' : state.range, q: state.q });
    const items = filtered();
    const now = Date.now();
    const r = RANGES[state.range];
    const lanesP = protocols.filter((p) => (!state.p.size || state.p.has(p.slug)) && items.some((i) => i.protocols.includes(p.slug)));
    const lanes = lanesP.map((p) => p.symbol || p.name);
    const plotted = items.flatMap((i) => i.protocols.filter((s) => lanesP.some((p) => p.slug === s)).map((s) => ({ ...i, lane: lanes[lanesP.findIndex((p) => p.slug === s)] })));
    // fit the axis to the items shown (always including today, with a little padding)
    const times = plotted.map((i) => Date.parse(i.date));
    const lo = Math.max(now + r.from * 864e5, Math.min(now - 3 * 864e5, ...times));
    const hi = Math.min(now + r.to * 864e5, Math.max(now + 7 * 864e5, ...times));
    const pad = (hi - lo) * 0.03;
    const build = (t) => timelineChart({ items: plotted, lanes, typeMeta: TYPES, from: lo - pad, to: hi + pad })(t);
    const legend = () => { const t = themeOf(document.querySelector('main')); return Object.entries(TYPES).filter(([k]) => plotted.some((i) => i.type === k)).map(([, v]) => ({ name: v.label, color: t.s[v.slot % 8], box: true })); };
    const take = catalystTakeaway(items, now);
    const srcs = [...new Set(items.map((i) => i.src))].map((k) => S[k]).filter(Boolean).slice(0, 6);
    const table = () => ({ columns: [{ key: 'date', label: 'Date', fmt: (v) => dateTime(v) }, { key: 'type', label: 'Type', fmt: (v) => TYPES[v]?.label || v }, { key: 'symbols', label: 'Tokens', fmt: (v) => (v || []).join(', ') }, { key: 'title', label: 'Title', wrap: true, fmt: (v, row) => extLink(row.url, v) }, { key: 'sourceName', label: 'Source' }, { key: 'url', label: 'Link', csv: (row) => row.url, fmt: (v) => extLink(v, 'open') }], rows: items });
    if (!card || !card.isConnected) {
      card = chartCard({ kicker: 'Timeline', termKey: 'governance', take, fallback: 'Catalyst timeline', title: `${items.length} items · ${r.label.toLowerCase()} · each row is a token`, size: lanes.length > 6 ? 'tall' : '', build, legend: [], src: srcs, sources: S, csvName: 'catalysts', table, onClick: (p) => { if (p.data?.item?.url) openExternal(p.data.item.url); } });
      timelineHolder.replaceChildren(card);
      import('../cards.js').then(({ mountPending }) => { mountPending(); card.update({ legend: legend() }); });
    } else {
      card.update({ build, take, title: `${items.length} items · ${r.label.toLowerCase()} · each row is a token`, legend: legend(), src: srcs, table });
    }
    renderList(items, now);
  }

  function itemEl(i) {
    const T = TYPES[i.type] || { label: i.type, slot: 7 };
    const src = S[i.src];
    return h('div', { class: `cat-item ${i.status}` },
      h('div', { class: 'when' }, shortDate(i.date), h('div', { class: 'muted', style: { fontWeight: 500 } }, relative(i.date)), i.status === 'open' ? h('span', { class: 'chip ink', style: { marginTop: '4px' } }, 'Open') : i.status === 'upcoming' ? h('span', { class: 'chip solid', style: { marginTop: '4px' } }, 'Upcoming') : null),
      h('div', {},
        h('div', { class: 'chips', style: { marginBottom: '4px' } }, h('span', { class: 'chip' }, h('span', { class: 'type-dot', style: { background: `var(--s${(T.slot % 8) + 1})` } }), T.term ? term(T.label, T.term) : T.label), (i.symbols || []).map((s) => h('span', { class: 'chip solid' }, s))),
        extLink(i.url, i.title, { class: 'title' }),
        i.summary ? h('div', { class: 'summary', style: { fontSize: '13px', color: 'var(--ink-2)', marginTop: '3px' } }, i.summary) : null,
        h('p', { class: 'src', style: { marginTop: '6px' } }, 'Source: ', extLink(i.url, i.sourceName), src?.fetchedAt ? ` · fetched ${dateTime(src.fetchedAt)}` : '', i.type === 'launch-upgrade' ? ' · type from keyword match' : '')));
  }

  function renderList(items, now) {
    const upcoming = items.filter((i) => Date.parse(i.date) >= now || i.status === 'open').sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const past = items.filter((i) => !upcoming.includes(i)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const group = (list) => {
      const out = [];
      let lastDay = '';
      for (const i of list) {
        const d = date(i.date);
        if (d !== lastDay) { out.push(h('div', { class: 'cat-day' }, d, h('span', { class: 'rel' }, relative(i.date)))); lastDay = d; }
        out.push(itemEl(i));
      }
      return out;
    };
    const recentBlock = (span) => h('section', { class: span }, h('div', { class: 'kicker' }, 'Recent'), h('h3', { class: 'takeaway', style: { margin: '6px 0 4px' } }, `${past.length} recent item${past.length === 1 ? '' : 's'}`), past.length ? group(past.slice(0, 80)) : h('p', { class: 'muted' }, 'No recent items match these filters.'), past.length > 80 ? h('p', { class: 'src' }, `Showing 80 of ${past.length}. Narrow the filters or use the table/CSV above.`) : null);
    if (!upcoming.length) {
      listHolder.replaceChildren(
        h('div', { class: 'span-12' }, h('div', { class: 'notice' }, h('b', {}, 'Nothing upcoming or open matches these filters. '), 'Open Snapshot votes, pending votes and dated events appear here when the sources list them.')),
        recentBlock('span-12'));
      return;
    }
    listHolder.replaceChildren(
      h('section', { class: 'span-6' }, h('div', { class: 'kicker' }, 'Upcoming & open'), h('h3', { class: 'takeaway', style: { margin: '6px 0 4px' } }, `${upcoming.length} upcoming or open`), group(upcoming)),
      recentBlock('span-6'));
  }

  apply();

  // prediction markets: what traders are paying for crypto outcomes (Polymarket), and the protocols (DefiLlama)
  const P = predFile.data || {};
  const PS = P.sources || {};
  const ev = P.events || [];
  // like Polymarket itself: never round a near-certain outcome up to 100% (or a long shot down to 0%)
  const share = (v) => (v == null ? '—' : v > 99 ? '>99%' : v < 1 ? '<1%' : pct(v, { signed: false, digits: 0 }));
  const busiest = ev[0];
  const lead = busiest?.leaders?.[0];
  root.append(h('section', { class: 'card acc-purple', style: { marginTop: '24px' } },
    h('div', { class: 'kicker' }, term('Prediction markets', 'predictionMarket')),
    takeaway(lead ? (lead.label === 'Yes'
      ? { pre: 'Traders put ', hl: `${share(lead.probability)} on “${busiest.title}”`, post: ', the busiest crypto market on Polymarket in the last 24 hours' }
      : { pre: `In the busiest crypto market on Polymarket (“${busiest.title}”), `, hl: `traders put ${share(lead.probability)} on “${lead.label}”`, post: '' }) : null, 'What prediction markets are pricing'),
    h('div', { class: 'disclaimer', role: 'note', style: { margin: '8px 0 12px' } }, h('span', { class: 'chip' }, 'Market prices, not forecasts'), 'Each percentage is what traders are paying for that outcome, read as a probability. These are bets, not predictions by this site.'),
    ev.length
      ? dataTable({
        caption: 'Crypto prediction markets', csvName: 'prediction-markets', sortKey: 'volume24h', pageSize: 25,
        columns: [
          { key: 'title', label: 'Market', wrap: true, fmt: (v, r) => h('span', {}, extLink(r.url, v), r.marketCount > 1 ? h('span', { class: 'sub' }, ` · ${r.marketCount} outcomes`) : null) },
          { key: 'leaders', label: 'Likeliest outcomes', wrap: true, termKey: 'impliedProb', fmt: (v) => (v || []).map((l) => `${l.label} ${share(l.probability)}`).join(' · '), csv: (r) => (r.leaders || []).map((l) => `${l.label} ${l.probability}%`).join('; '), sortValue: (r) => r.leaders?.[0]?.probability ?? -1 },
          { key: 'volume24h', label: '24h volume', num: true, fmt: (v) => usd(v), termKey: 'pmVolume' },
          { key: 'volume', label: 'All-time volume', num: true, fmt: (v) => usd(v) },
          { key: 'liquidity', label: 'Liquidity', num: true, fmt: (v) => usd(v), termKey: 'pmLiquidity' },
          { key: 'endDate', label: 'Ends', fmt: (v) => (v ? date(v) : '—'), sortValue: (r) => (r.endDate ? Date.parse(r.endDate) : Infinity) },
        ],
        rows: ev,
        csvExtra: [{ label: 'Polymarket page', get: (r) => r.url }],
      })
      : unavailable('Prediction markets unavailable', P.unavailable || predFile.error),
    sourceLine([PS['pm-events']].filter(Boolean))));
  const PP = P.protocols || [];
  root.append(h('section', { class: 'card', style: { marginTop: '18px' } },
    h('div', { class: 'kicker' }, 'Prediction-market protocols'),
    takeaway(PP.length >= 2 ? { pre: `${PP[0].name} has `, hl: `${usd(PP[0].tvl)} TVL`, post: `, the most of the prediction-market protocols DefiLlama tracks (next: ${PP[1].name}, ${usd(PP[1].tvl)})` } : null, 'Prediction-market protocols by TVL'),
    PP.length
      ? dataTable({
        caption: 'Prediction-market protocols', csvName: 'prediction-market-protocols', sortKey: 'tvl', search: false, pageSize: 12,
        columns: [
          { key: 'name', label: 'Protocol', fmt: (v, r) => extLink(r.page, v, { class: 'name' }) },
          { key: 'tvl', label: 'TVL', num: true, fmt: (v) => usd(v), termKey: 'tvl' },
          { key: 'change7d', label: '7d', num: true, fmt: (v) => h('span', { class: `delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}` }, pct(v)), termKey: 'change7d' },
          { key: 'fees30d', label: 'Fees (30d)', num: true, fmt: (v) => usd(v), termKey: 'fees' },
          { key: 'chains', label: 'Chains', wrap: true },
        ],
        rows: PP,
        csvExtra: [{ label: 'DefiLlama page', get: (r) => r.page }],
      })
      : unavailable('Prediction-market protocols unavailable', PS['dl-protocols']?.error || predFile.error || 'DefiLlama lists no protocols with TVL in its Prediction Market category this run.'),
    sourceLine([PS['dl-protocols'], PS['dl-fees']].filter(Boolean))));

  // feed status
  root.append(h('section', { class: 'card', style: { marginTop: '24px' } },
    h('div', { class: 'kicker' }, 'Where these come from'),
    h('h3', { class: 'takeaway' }, 'Feed and API status for this run'),
    dataTable({
      caption: 'Catalyst sources', csvName: 'catalyst-sources', search: false, sortKey: 'ok', sortDir: 'asc', pageSize: 30,
      columns: [
        { key: 'ok', label: 'Status', fmt: (v, r) => h('span', {}, h('span', { class: `status-dot ${v ? 'ok' : 'fail'}` }), v ? 'ok' : 'failed'), sortValue: (r) => (r.ok ? 1 : 0) },
        { key: 'name', label: 'Source', fmt: (v, r) => extLink(r.page, v) },
        { key: 'label', label: 'Type' },
        { key: 'itemCount', label: 'Items in feed', num: true },
        { key: 'api', label: 'Feed / endpoint', wrap: true, fmt: (v) => (v && v.startsWith('http') ? extLink(v.split(' ')[0], v) : v || '—') },
        { key: 'fetchedAt', label: 'Fetched', fmt: (v) => (v ? dateTime(v) : '—') },
        { key: 'error', label: 'Problem', wrap: true, fmt: (v) => v || '' },
      ],
      rows: Object.values(S),
    })));
}

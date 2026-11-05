// DefiLlama — free, keyless endpoints only (no pro-api.llama.fi).
// Endpoints checked against DefiLlama's API docs / official SDK route table:
//   api.llama.fi:          /protocols, /protocol/{slug}, /v2/chains,
//                          /v2/historicalChainTvl[/{chain}],
//                          /overview/fees, /overview/dexs, /summary/fees/{slug},
//                          /summary/dexs/{slug}
//   stablecoins.llama.fi:  /stablecoins, /stablecoincharts/all
//   yields.llama.fi:       /pools
//   coins.llama.fi:        /prices/current/{coins}, /chart/{coins}
// /hacks, /raises and /emissions are listed as Pro-only; we try the free host
// once and report the result honestly if it is refused.
import {
  normSeries, dailySeries, changeOverDays, allTimeHigh, lastPoint, trimDays,
  compactSeries, roundSmart, num, pctChange, firstSentences, weeklySeries, slugify, sumLastDays, DAY,
} from './util.mjs';
import { sourceRecord } from './sources.mjs';

export const DL = {
  api: 'https://api.llama.fi',
  stable: 'https://stablecoins.llama.fi',
  yields: 'https://yields.llama.fi',
  coins: 'https://coins.llama.fi',
  site: 'https://defillama.com',
};

// Keys in chainTvls / currentChainTvls that are not chains (DefiLlama's
// default TVL excludes these "extra" buckets).
const EXTRA_TVL_KEYS = new Set([
  'borrowed', 'staking', 'pool2', 'doublecounted', 'liquidstaking',
  'dcAndLsOverlap', 'vesting', 'offers', 'treasury', 'govtokens', 'okexchain',
]);
export function isChainKey(k) {
  return !k.includes('-') && !EXTRA_TVL_KEYS.has(k);
}

const NOT_PROTOCOL_CATEGORIES = new Set(['CEX', 'Chain']);
// Bridges hold assets that are already counted on the chains they bridge to, so
// DefiLlama's headline TVL leaves them out; we do the same for categories and movers.
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge']);

export async function fetchGlobal(http) {
  const get = (url, label) => http.json(url, { label });
  const [
    protocols, chains, totalTvl, fees, revenue, dexs, stables, stableChart, pools, hacks, raises, emissions,
  ] = await Promise.all([
    get(`${DL.api}/protocols`, 'DefiLlama protocol list'),
    get(`${DL.api}/v2/chains`, 'DefiLlama chain TVL'),
    get(`${DL.api}/v2/historicalChainTvl`, 'DefiLlama total DeFi TVL history'),
    get(`${DL.api}/overview/fees?excludeTotalDataChartBreakdown=true`, 'DefiLlama fees overview'),
    get(`${DL.api}/overview/fees?excludeTotalDataChartBreakdown=true&dataType=dailyRevenue`, 'DefiLlama revenue overview'),
    get(`${DL.api}/overview/dexs?excludeTotalDataChartBreakdown=true`, 'DefiLlama DEX volume overview'),
    get(`${DL.stable}/stablecoins?includePrices=true`, 'DefiLlama stablecoin list'),
    get(`${DL.stable}/stablecoincharts/all`, 'DefiLlama total stablecoin supply history'),
    get(`${DL.yields}/pools`, 'DefiLlama yield pools'),
    get(`${DL.api}/hacks`, 'DefiLlama hacks (may be Pro-only)'),
    get(`${DL.api}/raises`, 'DefiLlama raises (may be Pro-only)'),
    get(`${DL.api}/emissions`, 'DefiLlama token unlocks (may be Pro-only)'),
  ]);
  return { protocols, chains, totalTvl, fees, revenue, dexs, stables, stableChart, pools, hacks, raises, emissions };
}

// ---------- Overview (fees / revenue / dex volume) ----------

/** Aggregate child protocols under their parent, like DefiLlama's own tables. */
export function groupOverview(protocols = []) {
  const groups = new Map();
  for (const p of protocols) {
    if (!p || NOT_PROTOCOL_CATEGORIES.has(p.category)) continue;
    const key = p.parentProtocol || p.defillamaId || p.name;
    const parentSlug = p.parentProtocol ? p.parentProtocol.replace(/^parent#/, '') : p.slug;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        slug: parentSlug || p.slug,
        name: p.parentProtocol ? null : p.displayName || p.name,
        children: [],
        category: p.category || null,
        chains: new Set(),
        total24h: 0, total7d: 0, total30d: 0, total1y: 0,
        total48hto24h: 0, total14dto7d: 0, total60dto30d: 0,
        logo: p.logo || null,
      };
      groups.set(key, g);
    }
    g.children.push(p.displayName || p.name);
    (p.chains || []).forEach((c) => g.chains.add(c));
    for (const f of ['total24h', 'total7d', 'total30d', 'total1y', 'total48hto24h', 'total14dto7d', 'total60dto30d']) {
      const v = num(p[f]);
      if (v !== null) g[f] += v;
    }
    if (!g.category && p.category) g.category = p.category;
    if (!g.logo && p.logo) g.logo = p.logo;
  }
  return [...groups.values()].map((g) => ({
    key: g.key,
    slug: g.slug,
    name: g.name || prettyParentName(g),
    category: g.category,
    chains: [...g.chains],
    childCount: g.children.length,
    children: g.children.slice(0, 12),
    total24h: roundSmart(g.total24h),
    total7d: roundSmart(g.total7d),
    total30d: roundSmart(g.total30d),
    total1y: roundSmart(g.total1y),
    change7dOver7d: roundSmart(pctChange(g.total7d, g.total14dto7d)),
    change30dOver30d: roundSmart(pctChange(g.total30d, g.total60dto30d)),
    logo: g.logo,
  }));
}

/** Child names look like "Aave V3" / "Sky Lending"; the shared leading words are the parent name. */
export function prettyParentName(g) {
  const strip = (n) => String(n).replace(/\s+[vV]\d+(\.\d+)?$/, '').trim();
  const names = g.children.map(strip);
  const words = names.map((n) => n.split(/\s+/));
  const common = [];
  for (let i = 0; i < words[0].length; i++) {
    const w = words[0][i];
    if (words.every((ws) => ws[i] === w)) common.push(w);
    else break;
  }
  if (common.length) return common.join(' ');
  return String(g.slug || names[0]).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

function overviewHeadline(res, src, days = 730) {
  const d = res.ok ? res.data : null;
  if (!d) return { value: null, src, unavailable: res.error };
  const series = normSeries(d.totalDataChart || []);
  return {
    value: roundSmart(d.total24h),
    total7d: roundSmart(d.total7d),
    total30d: roundSmart(d.total30d),
    total1y: roundSmart(d.total1y),
    change1d: roundSmart(d.change_1d),
    change7d: roundSmart(d.change_7dover7d ?? pctChange(d.total7d, d.total14dto7d)),
    change30d: roundSmart(d.change_30dover30d ?? pctChange(d.total30d, d.total60dto30d)),
    series: compactSeries(trimDays(series, days)),
    src,
  };
}

// ---------- Market overview (home page) ----------

export function buildMarket(raw, extra) {
  const sources = {};
  const S = (key, rec) => { sources[key] = rec; return key; };

  // Total DeFi TVL
  const tvlSrc = S('dl-tvl', sourceRecord({ name: 'DefiLlama', label: 'Total DeFi TVL (all chains)', page: `${DL.site}/`, res: raw.totalTvl }));
  let tvl = { value: null, src: tvlSrc, unavailable: raw.totalTvl.error };
  if (raw.totalTvl.ok) {
    const s = dailySeries(normSeries(raw.totalTvl.data, { tsKey: 'date', valKey: 'tvl' }));
    const ath = allTimeHigh(s);
    tvl = {
      value: roundSmart(lastPoint(s)?.[1]),
      asOf: lastPoint(s)?.[0],
      change7d: roundSmart(changeOverDays(s, 7)),
      change30d: roundSmart(changeOverDays(s, 30)),
      change1y: roundSmart(changeOverDays(s, 365)),
      ath: ath ? { value: roundSmart(ath.value), ts: ath.ts } : null,
      series: compactSeries(s),
      src: tvlSrc,
    };
  }

  // Stablecoin supply (sum of all pegs, in USD)
  const stSrc = S('dl-stable-chart', sourceRecord({ name: 'DefiLlama', label: 'Total stablecoin supply', page: `${DL.site}/stablecoins`, res: raw.stableChart }));
  let stablecoins = { value: null, src: stSrc, unavailable: raw.stableChart.error };
  if (raw.stableChart.ok && Array.isArray(raw.stableChart.data)) {
    const pts = raw.stableChart.data.map((p) => [Number(p.date), sumPegs(p.totalCirculatingUSD)]);
    const s = dailySeries(normSeries(pts));
    const ath = allTimeHigh(s);
    stablecoins = {
      value: roundSmart(lastPoint(s)?.[1]),
      asOf: lastPoint(s)?.[0],
      change7d: roundSmart(changeOverDays(s, 7)),
      change30d: roundSmart(changeOverDays(s, 30)),
      change1y: roundSmart(changeOverDays(s, 365)),
      ath: ath ? { value: roundSmart(ath.value), ts: ath.ts } : null,
      series: compactSeries(s),
      src: stSrc,
    };
  }

  const dexSrc = S('dl-dexs', sourceRecord({ name: 'DefiLlama', label: 'DEX trading volume', page: `${DL.site}/dexs`, res: raw.dexs }));
  const feeSrc = S('dl-fees', sourceRecord({ name: 'DefiLlama', label: 'Fees paid by users', page: `${DL.site}/fees`, res: raw.fees }));
  const revSrc = S('dl-revenue', sourceRecord({ name: 'DefiLlama', label: 'Protocol revenue', page: `${DL.site}/revenue`, res: raw.revenue }));

  const headline = {
    tvl,
    stablecoins,
    dexVolume: overviewHeadline(raw.dexs, dexSrc),
    fees: overviewHeadline(raw.fees, feeSrc),
    revenue: overviewHeadline(raw.revenue, revSrc),
  };

  // TVL by chain
  const chSrc = S('dl-chains', sourceRecord({ name: 'DefiLlama', label: 'TVL by chain', page: `${DL.site}/chains`, res: raw.chains }));
  let chains = { top: [], src: chSrc, unavailable: raw.chains.error };
  if (raw.chains.ok && Array.isArray(raw.chains.data)) {
    const list = raw.chains.data
      .filter((c) => num(c.tvl) > 0)
      .sort((a, b) => b.tvl - a.tvl);
    const total = list.reduce((s, c) => s + c.tvl, 0);
    chains = {
      total: roundSmart(total),
      count: list.length,
      top: list.slice(0, 15).map((c) => ({
        name: c.name,
        tvl: roundSmart(c.tvl),
        share: roundSmart((c.tvl / total) * 100),
        tokenSymbol: c.tokenSymbol || null,
        page: `${DL.site}/chain/${encodeURIComponent(c.name)}`,
      })),
      src: chSrc,
    };
  }
  if (extra.chainHistory) {
    chains.history = extra.chainHistory.series;
    chains.historySrc = S('dl-chain-history', extra.chainHistory.source);
    for (const c of chains.top) {
      const s = extra.chainHistory.series[c.name];
      if (s) {
        c.change7d = roundSmart(changeOverDays(s, 7));
        c.change30d = roundSmart(changeOverDays(s, 30));
      }
    }
  }

  // Protocol list: categories + biggest movers
  const plSrc = S('dl-protocols', sourceRecord({ name: 'DefiLlama', label: 'All protocols (TVL & 7-day change)', page: `${DL.site}/`, res: raw.protocols }));
  let categories = { list: [], src: plSrc, unavailable: raw.protocols.error };
  let movers = { gainers: [], losers: [], src: plSrc, unavailable: raw.protocols.error };
  if (raw.protocols.ok && Array.isArray(raw.protocols.data)) {
    const list = raw.protocols.data.filter((p) => !NOT_PROTOCOL_CATEGORIES.has(p.category) && !BRIDGE_CATEGORIES.has(p.category) && num(p.tvl) > 0);
    const byCat = new Map();
    for (const p of list) {
      const c = p.category || 'Other';
      const e = byCat.get(c) || { category: c, tvl: 0, count: 0 };
      e.tvl += p.tvl;
      e.count += 1;
      byCat.set(c, e);
    }
    const catList = [...byCat.values()].sort((a, b) => b.tvl - a.tvl);
    const catTotal = catList.reduce((s, c) => s + c.tvl, 0);
    categories = {
      list: catList.slice(0, 14).map((c) => ({ ...c, tvl: roundSmart(c.tvl), share: roundSmart((c.tvl / catTotal) * 100) })),
      excluded: [...BRIDGE_CATEGORIES, ...NOT_PROTOCOL_CATEGORIES],
      src: plSrc,
    };
    const MIN_TVL = 100e6;
    const eligible = list
      .filter((p) => p.tvl >= MIN_TVL && num(p.change_7d) !== null && Math.abs(p.change_7d) < 10000)
      .map((p) => ({
        name: p.name,
        slug: p.slug,
        category: p.category,
        chains: (p.chains || []).slice(0, 4),
        tvl: roundSmart(p.tvl),
        change7d: roundSmart(p.change_7d),
        change1d: roundSmart(p.change_1d),
        page: `${DL.site}/protocol/${p.slug}`,
      }));
    movers = {
      minTvl: MIN_TVL,
      eligibleCount: eligible.length,
      gainers: [...eligible].sort((a, b) => b.change7d - a.change7d).slice(0, 10),
      losers: [...eligible].sort((a, b) => a.change7d - b.change7d).slice(0, 10),
      src: plSrc,
    };
  }

  // Top protocols by fees / revenue (parents aggregated)
  const topFees = raw.fees.ok
    ? groupOverview(raw.fees.data.protocols).filter((p) => p.total30d > 0).sort((a, b) => b.total30d - a.total30d).slice(0, 25)
    : [];
  const topRevenue = raw.revenue.ok
    ? groupOverview(raw.revenue.data.protocols).filter((p) => p.total30d > 0).sort((a, b) => b.total30d - a.total30d).slice(0, 25)
    : [];

  // Stablecoins by issuer (each DefiLlama stablecoin is one issuer's coin)
  const slSrc = S('dl-stablecoins', sourceRecord({ name: 'DefiLlama', label: 'Stablecoins by issuer', page: `${DL.site}/stablecoins`, res: raw.stables }));
  let stableIssuers = { top: [], src: slSrc, unavailable: raw.stables.error };
  if (raw.stables.ok && Array.isArray(raw.stables.data?.peggedAssets)) {
    const list = raw.stables.data.peggedAssets
      .map((a) => ({
        id: a.id,
        name: a.name,
        symbol: a.symbol,
        geckoId: a.gecko_id || null,
        pegType: a.pegType,
        pegMechanism: a.pegMechanism,
        price: roundSmart(a.price),
        circulating: sumPegs(a.circulating),
        prevWeek: sumPegs(a.circulatingPrevWeek),
        prevMonth: sumPegs(a.circulatingPrevMonth),
        chains: (a.chains || []).length,
      }))
      .filter((a) => a.circulating > 0)
      .sort((a, b) => b.circulating - a.circulating);
    const total = list.reduce((s, a) => s + a.circulating, 0);
    const top = list.slice(0, 8);
    const rest = list.slice(8);
    stableIssuers = {
      total: roundSmart(total),
      count: list.length,
      top: top.map((a) => ({
        ...a,
        circulating: roundSmart(a.circulating),
        prevWeek: undefined,
        prevMonth: undefined,
        change7d: roundSmart(pctChange(a.circulating, a.prevWeek)),
        change30d: roundSmart(pctChange(a.circulating, a.prevMonth)),
        share: roundSmart((a.circulating / total) * 100),
        page: `${DL.site}/stablecoin/${slugify(a.name)}`,
      })),
      other: {
        count: rest.length,
        circulating: roundSmart(rest.reduce((s, a) => s + a.circulating, 0)),
        share: roundSmart((rest.reduce((s, a) => s + a.circulating, 0) / total) * 100),
      },
      src: slSrc,
    };
  }
  if (extra.stableHistory) {
    stableIssuers.history = extra.stableHistory.series;
    stableIssuers.historySrc = S('dl-stable-history', extra.stableHistory.source);
  }

  return {
    headline,
    chains,
    categories,
    movers,
    topFees: { list: topFees, src: feeSrc, unavailable: raw.fees.ok ? undefined : raw.fees.error },
    topRevenue: { list: topRevenue, src: revSrc, unavailable: raw.revenue.ok ? undefined : raw.revenue.error },
    stablecoins: stableIssuers,
    sources,
  };
}

export function sumPegs(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).reduce((s, v) => s + (num(v) || 0), 0);
}

// ---------- Screener table (all protocols) ----------

export function buildScreener(raw, watch) {
  if (!raw.protocols.ok || !Array.isArray(raw.protocols.data)) return null;
  const feeBy = new Map();
  const revBy = new Map();
  if (raw.fees.ok) for (const p of raw.fees.data.protocols || []) feeBy.set(String(p.defillamaId ?? p.name), p);
  if (raw.revenue.ok) for (const p of raw.revenue.data.protocols || []) revBy.set(String(p.defillamaId ?? p.name), p);
  const rows = raw.protocols.data
    .filter((p) => !NOT_PROTOCOL_CATEGORIES.has(p.category) && num(p.tvl) >= 5e6)
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 600)
    .map((p) => {
      const f = feeBy.get(String(p.id)) || feeBy.get(p.name);
      const r = revBy.get(String(p.id)) || revBy.get(p.name);
      return {
        name: p.name,
        slug: p.slug,
        parent: p.parentProtocol ? p.parentProtocol.replace(/^parent#/, '') : null,
        category: p.category || 'Other',
        chains: p.chains || [],
        tvl: roundSmart(p.tvl),
        change1d: roundSmart(p.change_1d),
        change7d: roundSmart(p.change_7d),
        mcap: roundSmart(p.mcap) || null,
        fees30d: f ? roundSmart(f.total30d) : null,
        revenue30d: r ? roundSmart(r.total30d) : null,
        symbol: p.symbol && p.symbol !== '-' ? p.symbol : null,
        watch: watch.has(p.slug) || (p.parentProtocol && watch.has(p.parentProtocol.replace(/^parent#/, ''))),
      };
    });
  return {
    rows,
    sources: {
      'dl-protocols': sourceRecord({ name: 'DefiLlama', label: 'Protocol list (TVL, changes, category, chains)', page: `${DL.site}/`, res: raw.protocols }),
      'dl-fees': sourceRecord({ name: 'DefiLlama', label: 'Fees (30d) per protocol', page: `${DL.site}/fees`, res: raw.fees }),
      'dl-revenue': sourceRecord({ name: 'DefiLlama', label: 'Revenue (30d) per protocol', page: `${DL.site}/revenue`, res: raw.revenue }),
    },
  };
}

// ---------- One protocol ----------

export async function fetchProtocolRaw(http, slug) {
  const enc = encodeURIComponent(slug);
  const [protocol, fees, revenue, holders] = await Promise.all([
    http.json(`${DL.api}/protocol/${enc}`, { label: `DefiLlama protocol ${slug}` }),
    http.json(`${DL.api}/summary/fees/${enc}?dataType=dailyFees`, { label: `DefiLlama fees ${slug}`, retries: 1 }),
    http.json(`${DL.api}/summary/fees/${enc}?dataType=dailyRevenue`, { label: `DefiLlama revenue ${slug}`, retries: 1 }),
    http.json(`${DL.api}/summary/fees/${enc}?dataType=dailyHoldersRevenue`, { label: `DefiLlama holders revenue ${slug}`, retries: 1 }),
  ]);
  return { protocol, fees, revenue, holders };
}

/** Find a protocol in /protocols by slug or name when the configured slug fails. */
export function resolveSlug(protocolList, wanted) {
  if (!Array.isArray(protocolList)) return null;
  const w = wanted.toLowerCase();
  const exact = protocolList.find((p) => p.slug === w || p.name?.toLowerCase() === w);
  if (exact) return exact.parentProtocol ? exact.parentProtocol.replace(/^parent#/, '') : exact.slug;
  const child = protocolList.find((p) => p.parentProtocol === `parent#${w}`);
  if (child) return w;
  return null;
}

/** Children slugs for a parent (used to match yield pools). */
export function childSlugs(protocolList, slug, otherNames = []) {
  const out = new Set([slug]);
  if (!Array.isArray(protocolList)) return out;
  for (const p of protocolList) {
    if (p.parentProtocol === `parent#${slug}`) out.add(p.slug);
    if (otherNames.includes(p.name)) out.add(p.slug);
  }
  return out;
}

export function buildProtocolCore(raw, slug) {
  const p = raw.protocol.ok ? raw.protocol.data : null;
  const page = `${DL.site}/protocol/${slug}`;
  const sources = {
    'dl-protocol': sourceRecord({ name: 'DefiLlama', label: 'TVL & protocol profile', page, res: raw.protocol }),
    'dl-fees': sourceRecord({ name: 'DefiLlama', label: 'Fees (daily)', page, res: raw.fees }),
    'dl-revenue': sourceRecord({ name: 'DefiLlama', label: 'Revenue (daily)', page, res: raw.revenue }),
    'dl-holders-revenue': sourceRecord({ name: 'DefiLlama', label: 'Holders revenue (daily)', page, res: raw.holders }),
  };
  const out = { sources };
  if (!p) {
    out.about = { unavailable: raw.protocol.error, src: 'dl-protocol' };
    out.tvl = { unavailable: raw.protocol.error, src: 'dl-protocol' };
    return out;
  }

  // the fees summary for the same protocol often carries a category / chain list
  // when the protocol profile doesn't (parents, some single protocols)
  const feeMeta = raw.fees?.ok ? raw.fees.data : raw.revenue?.ok ? raw.revenue.data : null;
  out.about = {
    name: p.name,
    description: firstSentences(p.description, 2),
    category: p.category || (typeof feeMeta?.category === 'string' ? feeMeta.category : null),
    chains: p.chains?.length ? p.chains : Array.isArray(feeMeta?.chains) ? feeMeta.chains : [],
    logo: p.logo || null,
    url: p.url || null,
    twitter: p.twitter ? `https://x.com/${p.twitter}` : null,
    github: (p.github || []).map((g) => `https://github.com/${g}`),
    audits: p.audits ?? null,
    auditNote: p.audit_note || null,
    auditLinks: p.audit_links || [],
    geckoId: p.gecko_id || null,
    symbol: p.symbol && p.symbol !== '-' ? p.symbol : null,
    oracles: p.oracles || [],
    forkedFrom: p.forkedFrom || [],
    listedAt: p.listedAt || null,
    otherProtocols: p.otherProtocols || [],
    governanceID: p.governanceID || [],
    treasury: p.treasury || null,
    methodology: typeof p.methodology === 'string' ? p.methodology : null,
    src: 'dl-protocol',
  };

  // TVL history (default TVL, excludes borrowed/staking/pool2 like DefiLlama's site).
  // Some parent protocols (e.g. RWA issuers) come back with an empty combined
  // series but full per-chain series; then we add the chains up ourselves.
  let tvlSeries = dailySeries(normSeries(p.tvl || [], { tsKey: 'date', valKey: 'totalLiquidityUSD' }));
  let tvlNote = null;
  if (!tvlSeries.length && p.chainTvls) {
    const byDay = new Map();
    const chainsUsed = [];
    for (const [k, v] of Object.entries(p.chainTvls)) {
      if (!isChainKey(k) || !Array.isArray(v?.tvl) || !v.tvl.length) continue;
      chainsUsed.push(k);
      for (const [ts, val] of dailySeries(normSeries(v.tvl, { tsKey: 'date', valKey: 'totalLiquidityUSD' }))) byDay.set(ts, (byDay.get(ts) || 0) + val);
    }
    tvlSeries = [...byDay.entries()].sort((x, y) => x[0] - y[0]);
    // drop a trailing day where only some chains have reported yet
    if (tvlSeries.length > 2 && tvlSeries[tvlSeries.length - 1][1] < tvlSeries[tvlSeries.length - 2][1] * 0.5) tvlSeries.pop();
    if (tvlSeries.length) tvlNote = `DefiLlama returned no combined TVL series for this protocol, so this is the sum of its per-chain series (${chainsUsed.join(', ')}).`;
  }
  const ath = allTimeHigh(tvlSeries);
  const current = lastPoint(tvlSeries);
  out.tvl = {
    value: roundSmart(current?.[1]),
    asOf: current?.[0] || null,
    change1d: roundSmart(changeOverDays(tvlSeries, 1)),
    change7d: roundSmart(changeOverDays(tvlSeries, 7)),
    change30d: roundSmart(changeOverDays(tvlSeries, 30)),
    change90d: roundSmart(changeOverDays(tvlSeries, 90)),
    change1y: roundSmart(changeOverDays(tvlSeries, 365)),
    ath: ath ? { value: roundSmart(ath.value), ts: ath.ts } : null,
    series: compactSeries(tvlSeries),
    note: tvlNote,
    src: 'dl-protocol',
  };

  // Current TVL by chain (fall back to the last point of each chain series)
  let cur = p.currentChainTvls || {};
  if (!Object.keys(cur).length && p.chainTvls) {
    cur = {};
    for (const [k, v] of Object.entries(p.chainTvls)) {
      const last = Array.isArray(v?.tvl) && v.tvl.length ? v.tvl[v.tvl.length - 1] : null;
      if (last) cur[k] = num(last.totalLiquidityUSD);
    }
  }
  const chainRows = Object.entries(cur)
    .filter(([k, v]) => isChainKey(k) && num(v) > 0)
    .sort((a, b) => b[1] - a[1]);
  const chainTotal = chainRows.reduce((s, [, v]) => s + v, 0);
  out.chainTvl = {
    list: chainRows.slice(0, 12).map(([chain, v]) => ({ chain, tvl: roundSmart(v), share: roundSmart((v / chainTotal) * 100) })),
    count: chainRows.length,
    borrowed: roundSmart(cur.borrowed) || null,
    staking: roundSmart(cur.staking) || null,
    src: 'dl-protocol',
  };
  // Chain history for the top 5 chains (last 365 days)
  const hist = {};
  for (const [chain] of chainRows.slice(0, 5)) {
    const s = p.chainTvls?.[chain]?.tvl;
    if (s) hist[chain] = compactSeries(trimDays(dailySeries(normSeries(s, { tsKey: 'date', valKey: 'totalLiquidityUSD' })), 365));
  }
  out.chainTvl.history = hist;

  // What the TVL is made of (latest token breakdown, in USD)
  const tiu = Array.isArray(p.tokensInUsd) ? p.tokensInUsd[p.tokensInUsd.length - 1] : null;
  if (tiu?.tokens) {
    const entries = Object.entries(tiu.tokens).filter(([, v]) => num(v) > 0).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    out.tokenBreakdown = {
      asOf: tiu.date,
      list: entries.slice(0, 10).map(([token, v]) => ({ token, usd: roundSmart(v), share: roundSmart((v / total) * 100) })),
      otherShare: roundSmart((entries.slice(10).reduce((s, [, v]) => s + v, 0) / total) * 100),
      src: 'dl-protocol',
    };
  }

  // Funding raises and DefiLlama's timeline notes ("hallmarks")
  out.raises = {
    list: (p.raises || [])
      .map((r) => ({
        date: r.date,
        round: r.round || null,
        amount: num(r.amount),
        valuation: num(r.valuation),
        leadInvestors: r.leadInvestors || [],
        otherInvestors: r.otherInvestors || [],
        source: r.source || null,
      }))
      .sort((a, b) => (b.date || 0) - (a.date || 0)),
    note: 'Amounts are in millions of USD, as reported by DefiLlama.',
    src: 'dl-protocol',
  };
  const seenHm = new Set();
  out.hallmarks = {
    list: (p.hallmarks || [])
      .filter((h) => Array.isArray(h) && h.length >= 2)
      .map(([ts, text]) => ({ ts: Array.isArray(ts) ? ts[0] : ts, text }))
      .filter((h) => { const k = `${h.ts}|${h.text}`; return seenHm.has(k) ? false : (seenHm.add(k), true); })
      .sort((a, b) => b.ts - a.ts),
    src: 'dl-protocol',
  };

  out.mcapFromDefiLlama = num(p.mcap);

  // Fees, revenue, holders revenue
  out.fees = summarizeFees(raw.fees, 'dl-fees');
  out.revenue = summarizeFees(raw.revenue, 'dl-revenue');
  out.holdersRevenue = summarizeFees(raw.holders, 'dl-holders-revenue');
  return out;
}

function summarizeFees(res, src) {
  if (!res.ok || !res.data) return { unavailable: res.error || 'No data', src };
  const d = res.data;
  const s = dailySeries(normSeries(d.totalDataChart || []));
  if (!s.length && d.total24h == null) return { unavailable: 'DefiLlama has no data of this type for this protocol', src };
  // The summary endpoint doesn't always include window-over-window changes;
  // when it doesn't, compute them from the same daily series (and say so).
  // Both windows must have every day: comparing a 26-day sum with a 30-day sum (a gap in
  // DefiLlama's series) showed Ondo's fees at +19.6% when the like-for-like change was about +4%.
  const calc7 = d.change_7dover7d == null ? pctChange(sumLastDays(s, 7, 0, 7), sumLastDays(s, 7, 7, 7)) : null;
  const calc30 = d.change_30dover30d == null ? pctChange(sumLastDays(s, 30, 0, 30), sumLastDays(s, 30, 30, 30)) : null;
  return {
    total24h: roundSmart(d.total24h),
    total7d: roundSmart(d.total7d),
    total30d: roundSmart(d.total30d),
    total1y: roundSmart(d.total1y),
    totalAllTime: roundSmart(d.totalAllTime),
    change1d: roundSmart(d.change_1d),
    change7dOver7d: roundSmart(d.change_7dover7d ?? calc7),
    change30dOver30d: roundSmart(d.change_30dover30d ?? calc30),
    changesCalculated: d.change_30dover30d == null && calc30 != null,
    series: compactSeries(s),
    methodology: d.methodology || null,
    src,
  };
}

// ---------- Yields ----------

export function poolsForProtocol(poolsRes, slugs, limit = 12) {
  if (!poolsRes.ok || !Array.isArray(poolsRes.data?.data)) return null;
  // Pools paying 0% are usually collateral-only (e.g. Compound V3's WBTC), so pools that pay
  // yield come first, each group largest first. Zero-yield pools fill in only if needed.
  const pays = (p) => ((Number(p.apy) || 0) > 0 ? 1 : 0);
  return poolsRes.data.data
    .filter((p) => slugs.has(p.project))
    .sort((a, b) => pays(b) - pays(a) || (b.tvlUsd || 0) - (a.tvlUsd || 0))
    .slice(0, limit)
    .map((p) => ({
      pool: p.pool,
      project: p.project,
      chain: p.chain,
      symbol: p.symbol,
      meta: p.poolMeta || null,
      tvl: roundSmart(p.tvlUsd),
      apy: roundSmart(p.apy),
      apyBase: roundSmart(p.apyBase),
      apyReward: roundSmart(p.apyReward),
      apyMean30d: roundSmart(p.apyMean30d),
      stablecoin: Boolean(p.stablecoin),
      page: `${DL.site}/yields/pool/${p.pool}`,
      api: `${DL.yields}/chart/${p.pool}`,
    }));
}

// ---------- Hacks ----------

export function hacksForProtocol(hacksRes, names, ids = new Set()) {
  if (!hacksRes.ok || !Array.isArray(hacksRes.data)) return null;
  const lower = names.filter(Boolean).map((n) => n.toLowerCase());
  return hacksRes.data
    .filter((h) => (h.defillamaId != null && ids.has(String(h.defillamaId))) || lower.includes(String(h.name || '').toLowerCase()))
    .map((h) => ({
      date: h.date,
      name: h.name,
      amount: num(h.amount),
      technique: h.technique || null,
      classification: h.classification || null,
      chain: Array.isArray(h.chain) ? h.chain.join(', ') : h.chain || null,
      returnedFunds: num(h.returnedFunds),
      source: h.source || null,
    }))
    .sort((a, b) => b.date - a.date);
}

/** DefiLlama ids of a parent and its children (to match the hacks database). */
export function familyIds(protocolList, slug, ownId) {
  const out = new Set(ownId ? [String(ownId)] : []);
  if (!Array.isArray(protocolList)) return out;
  for (const p of protocolList) if (p.parentProtocol === `parent#${slug}` || p.slug === slug) out.add(String(p.id));
  return out;
}

// ---------- Chain + stablecoin history helpers ----------

export async function fetchChainHistory(http, chainNames) {
  const results = await Promise.all(
    chainNames.map((c) => http.json(`${DL.api}/v2/historicalChainTvl/${encodeURIComponent(c)}`, { label: `DefiLlama ${c} TVL history` }))
  );
  const series = {};
  let firstOk = null;
  results.forEach((r, i) => {
    if (r.ok && Array.isArray(r.data)) {
      series[chainNames[i]] = compactSeries(trimDays(dailySeries(normSeries(r.data, { tsKey: 'date', valKey: 'tvl' })), 365));
      firstOk = firstOk || r;
    }
  });
  const failed = results.filter((r) => !r.ok);
  return {
    series,
    source: sourceRecord({
      name: 'DefiLlama',
      label: 'TVL history per chain',
      page: `${DL.site}/chains`,
      res: firstOk || results[0],
      api: `${DL.api}/v2/historicalChainTvl/{chain}`,
      note: failed.length ? `${failed.length} chain(s) failed: ${failed.map((f) => f.error).join('; ').slice(0, 200)}` : undefined,
    }),
  };
}

export async function fetchStableHistory(http, coins, totalSeries) {
  const results = await Promise.all(
    coins.map((c) => http.json(`${DL.stable}/stablecoincharts/all?stablecoin=${encodeURIComponent(c.id)}`, { label: `DefiLlama ${c.symbol} supply history` }))
  );
  const series = {};
  let firstOk = null;
  const totalLast = totalSeries?.length ? totalSeries[totalSeries.length - 1][1] : null;
  results.forEach((r, i) => {
    if (r.ok && Array.isArray(r.data)) {
      const s = weeklySeries(dailySeries(normSeries(r.data.map((p) => [Number(p.date), sumPegs(p.totalCirculatingUSD)]))));
      const last = s.length ? s[s.length - 1][1] : null;
      // Guard: if the API ignored the ?stablecoin filter we'd get the grand total back.
      if (last && totalLast && Math.abs(last - totalLast) / totalLast < 0.001) return;
      series[coins[i].symbol] = compactSeries(s.filter(([ts]) => ts >= Date.now() / 1000 - 4 * 365 * DAY));
      firstOk = firstOk || r;
    }
  });
  return {
    series,
    source: sourceRecord({
      name: 'DefiLlama',
      label: 'Supply history per stablecoin',
      page: `${DL.site}/stablecoins`,
      res: firstOk || results[0],
      api: `${DL.stable}/stablecoincharts/all?stablecoin={id}`,
    }),
  };
}

// ---------- DefiLlama coin prices (fallback when CoinGecko is rate-limited) ----------

export async function fetchLlamaCoin(http, geckoId) {
  const key = `coingecko:${geckoId}`;
  const [cur, chart] = await Promise.all([
    http.json(`${DL.coins}/prices/current/${key}`, { label: `DefiLlama price ${geckoId}` }),
    http.json(`${DL.coins}/chart/${key}?span=365&period=1d`, { label: `DefiLlama price history ${geckoId}` }),
  ]);
  return { cur, chart, key };
}

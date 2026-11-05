// Inputs for the Fundamentals Checklist (site/data/fundamentals.json). The pipeline only gathers
// numbers and their sources; the checklist's ✓ / ~ / ✗ statuses are computed in the browser
// (site/assets/js/fundamentals/rules.js) so threshold changes apply instantly.
import { DL } from './defillama.mjs';
import { sourceRecord } from './sources.mjs';
import { roundSmart, num, DAY } from './util.mjs';

const YEAR = 365 * 86400;

/** DefiLlama coins API: weekly prices over ~5 years (documented, keyless). */
export async function fetchWeeklyPrices(http, geckoId, now = Date.now()) {
  const start = Math.floor(now / 1000) - 5 * YEAR;
  const key = `coingecko:${geckoId}`;
  const res = await http.json(`${DL.coins}/chart/${key}?start=${start}&span=262&period=1w`, { label: `DefiLlama weekly price history ${geckoId}` });
  const pts = res.ok ? res.data?.coins?.[key]?.prices : null;
  const series = Array.isArray(pts) ? pts.map((p) => [num(p.timestamp), num(p.price)]).filter(([t, v]) => t && v > 0).sort((a, b) => a[0] - b[0]) : null;
  return {
    series: series?.length ? series : null,
    source: sourceRecord({ name: 'DefiLlama', label: 'Weekly price history (up to 5 years)', page: `https://www.coingecko.com/en/coins/${geckoId}`, res: series?.length ? res : { ...res, ok: false, error: res.error || 'No price points returned' } }),
  };
}

const lastDays = (series, days, now) => (series || []).filter(([t]) => t >= now / 1000 - days * 86400).map(([t, v]) => [t, roundSmart(v)]);
function monthly(series) {
  const out = new Map();
  for (const [t, v] of series || []) { const d = new Date(t * 1000); out.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, [t, roundSmart(v)]); }
  return [...out.values()];
}

/** One protocol's inputs. Everything carries the key of its source record. */
export function fundamentalsInputs({ entry, doc, token, weekly, now = Date.now() }) {
  const S = {};
  const use = (key, rec) => { if (rec) S[key] = rec; return rec ? key : null; };
  const tvlSeries = doc.tvl?.series || [];
  const firstTvl = tvlSeries.find(([, v]) => v > 0);
  const unl = token?.unlocks;
  const next12 = (unl?.events || []).filter((e) => e.ts * 1000 > now && e.ts * 1000 <= now + 365 * DAY * 1000 && e.kind !== 'vesting-end');
  return {
    slug: doc.slug,
    name: entry.name,
    symbol: entry.symbol || doc.symbol || token?.symbol || null,
    group: entry.group,
    tokenId: token?.id || null,
    category: doc.about?.category || null,
    page: `${DL.site}/protocol/${doc.slug}`,
    revenue: { daily: lastDays(doc.revenue?.series, 400, now), total30d: num(doc.revenue?.total30d), unavailable: doc.revenue?.unavailable || null, src: use('dl-revenue', doc.sources['dl-revenue']) },
    holdersRevenue: { daily: lastDays(doc.holdersRevenue?.series, 400, now), total30d: num(doc.holdersRevenue?.total30d), unavailable: doc.holdersRevenue?.unavailable || null, src: use('dl-holders-revenue', doc.sources['dl-holders-revenue']) },
    fees: { total30d: num(doc.fees?.total30d), src: use('dl-fees', doc.sources['dl-fees']) },
    // token incentives (emissions) are on DefiLlama's paid plan only
    incentives: { unavailable: doc.unlocks?.unavailable || 'Token incentive emissions are only on DefiLlama’s paid API (its /emissions endpoint answers HTTP 402), so incentives can’t be compared with holders revenue.', src: use('dl-emissions', doc.sources['dl-emissions']) },
    tvl: {
      value: num(doc.tvl?.value), ath: doc.tvl?.ath || null, firstTs: firstTvl ? firstTvl[0] : null, monthly: monthly(tvlSeries),
      unavailable: doc.tvl?.unavailable || (tvlSeries.length ? null : 'DefiLlama reports no TVL history for this protocol.'), src: use('dl-protocol', doc.sources['dl-protocol']),
    },
    listedAt: num(doc.about?.listedAt),
    hacks: { list: (doc.hacks?.list || []).map((x) => ({ date: x.date, name: x.name, amount: num(x.amount), returned: num(x.returnedFunds), technique: x.technique || x.classification || null })), unavailable: doc.hacks?.unavailable || null, src: use('dl-hacks', doc.sources['dl-hacks']) },
    market: token?.market ? { price: num(token.market.price), marketCap: num(token.market.marketCap), fdv: num(token.market.fdv), volume24h: num(token.market.volume24h), src: use('cg-coin', token.sources[token.market.src] || token.sources['cg-coin']) } : { unavailable: token ? token.unavailable || 'No market data' : 'No token tracked for this protocol', src: null },
    supply: token?.supply ? { circulating: num(token.supply.circulating), total: num(token.supply.total), max: num(token.supply.max), maxInfinite: Boolean(token.supply.maxInfinite), src: use('cg-coin-supply', token.sources[token.supply.src] || token.sources['cg-coin']) } : { unavailable: 'No supply data', src: null },
    dex: token?.dex ? { liquidity: num(token.dex.totalLiquidity), volume24h: num(token.dex.totalVolume24h), pools: num(token.dex.poolCount), unavailable: token.dex.unavailable || null, src: use('dex', Object.entries(token.sources).find(([k, v]) => (k.startsWith('ds-') || k.startsWith('gt-')) && v.ok)?.[1] || null) } : { unavailable: 'No DEX data', src: null },
    priceDaily: token?.series?.price ? token.series.price.map(([t, v]) => [t, roundSmart(v)]) : [],
    mcapDaily: token?.series?.marketCap ? token.series.marketCap.map(([t, v]) => [t, roundSmart(v)]) : [],
    seriesSrc: use('cg-chart', token?.sources?.['cg-chart'] || null),
    priceWeekly: weekly?.series || [],
    priceWeeklySrc: use('dl-price-weekly', weekly?.source || null),
    unlocks: unl ? {
      status: unl.status,
      next12mTokens: next12.some((e) => e.tokens != null) ? roundSmart(next12.reduce((s, e) => s + (e.tokens || 0), 0)) : null,
      next12mUnknown: next12.filter((e) => e.tokens == null).length,
      next12mEvents: next12.length,
      summary: unl.summary || null,
      src: use('manual-unlocks', token.sources[unl.src] || null),
    } : { status: 'unconfirmed', next12mTokens: null, next12mUnknown: 0, next12mEvents: 0, src: null },
    sources: S,
  };
}

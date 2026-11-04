// Market-wide coin list (CoinGecko) and prediction markets (Polymarket's Gamma API
// plus DefiLlama's "Prediction Market" protocols). All free and keyless.
//
// CoinGecko /coins/markets: https://docs.coingecko.com/reference/coins-markets
// Polymarket Gamma /events: https://docs.polymarket.com/api-reference/events/list-events
import { CG } from './coingecko.mjs';
import { DL } from './defillama.mjs';
import { sourceRecord } from './sources.mjs';
import { roundSmart, num, truncate, stripHtml } from './util.mjs';

export const PM = { gamma: 'https://gamma-api.polymarket.com', site: 'https://polymarket.com' };
export const DEFI_CATEGORY = 'decentralized-finance-defi';

const marketsUrl = (extra = '') =>
  `${CG.api}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d${extra}`;

/** Two keyless calls: the 250 largest coins, and the 250 largest in CoinGecko's DeFi category. */
export async function fetchCoinMarkets(http) {
  const opts = { retries: 2, backoffMs: 15000 };
  const all = await http.json(marketsUrl(), { ...opts, label: 'CoinGecko top coins by market cap' });
  const defi = await http.json(marketsUrl(`&category=${DEFI_CATEGORY}`), { ...opts, label: 'CoinGecko DeFi category coins' });
  return {
    all,
    defi,
    sources: {
      'cg-markets': sourceRecord({ name: 'CoinGecko', label: 'Top 250 coins by market cap', page: 'https://www.coingecko.com/', res: all }),
      'cg-markets-defi': sourceRecord({ name: 'CoinGecko', label: 'DeFi category, top 250 by market cap', page: `https://www.coingecko.com/en/categories/${DEFI_CATEGORY}`, res: defi }),
    },
  };
}

const listOf = (res) => (res?.ok && Array.isArray(res.data) ? res.data : null);

/**
 * One row per coin (union of both lists, ranked by market cap). `defi` is true/false when
 * the DeFi list loaded, and null when it didn't (unknown, rather than "not DeFi").
 */
export function buildCoinRows(allRes, defiRes, trackedIds = new Set()) {
  const all = listOf(allRes);
  if (!all) return null;
  const defiList = listOf(defiRes);
  const defiIds = defiList ? new Set(defiList.map((c) => c.id)) : null;
  const rows = new Map();
  for (const c of [...all, ...(defiList || [])]) {
    if (!c?.id || rows.has(c.id)) continue;
    rows.set(c.id, {
      id: c.id,
      symbol: String(c.symbol || '').toUpperCase(),
      name: c.name || c.id,
      rank: num(c.market_cap_rank),
      price: roundSmart(c.current_price),
      mcap: roundSmart(c.market_cap),
      fdv: roundSmart(c.fully_diluted_valuation),
      volume24h: roundSmart(c.total_volume),
      change24h: roundSmart(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
      change7d: roundSmart(c.price_change_percentage_7d_in_currency),
      change30d: roundSmart(c.price_change_percentage_30d_in_currency),
      circulating: roundSmart(c.circulating_supply),
      maxSupply: roundSmart(c.max_supply),
      athChange: roundSmart(c.ath_change_percentage),
      defi: defiIds ? defiIds.has(c.id) : null,
      tracked: trackedIds.has(c.id),
      page: `${CG.site}/${c.id}`,
    });
  }
  return [...rows.values()].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

/** Active crypto events on Polymarket, busiest (24h volume) first. */
export async function fetchPredictionEvents(http) {
  const url = `${PM.gamma}/events?tag_slug=crypto&closed=false&order=volume24hr&ascending=false&limit=50`;
  const res = await http.json(url, { label: 'Polymarket crypto events', retries: 2 });
  return {
    res,
    source: sourceRecord({ name: 'Polymarket', label: 'Crypto prediction markets (Gamma API)', page: `${PM.site}/crypto`, res }),
  };
}

// Gamma returns outcomes and prices as JSON-encoded strings, e.g. '["Yes","No"]'.
const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};

/** The likeliest outcomes of one event, as implied probabilities (a $0.23 "Yes" share = 23%). */
function leadersOf(markets) {
  const single = markets.length === 1;
  const opts = [];
  for (const m of markets) {
    const outcomes = parseList(m.outcomes).map(String);
    const prices = parseList(m.outcomePrices).map(num);
    if (!outcomes.length || outcomes.length !== prices.length) continue;
    const yes = outcomes.findIndex((o) => /^yes$/i.test(o));
    if (yes >= 0 && prices[yes] != null) {
      opts.push({ label: single ? 'Yes' : truncate(stripHtml(m.groupItemTitle || m.question || ''), 80), prob: prices[yes] });
    } else if (single) {
      // non Yes/No markets ("Up"/"Down", names): every outcome is an option
      outcomes.forEach((o, i) => { if (prices[i] != null) opts.push({ label: truncate(o, 80), prob: prices[i] }); });
    }
  }
  return opts
    .filter((o) => o.prob >= 0 && o.prob <= 1)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3)
    .map((o) => ({ label: o.label, probability: roundSmart(o.prob * 100) }));
}

export function buildPredictionEvents(res, { limit = 25 } = {}) {
  if (!res?.ok) return null;
  const list = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : null;
  if (!list) return null;
  // the request asks for the crypto tag; if the API ever ignored that, the tags still decide
  const isCrypto = (e) => !Array.isArray(e.tags) || !e.tags.length || e.tags.some((t) => /crypto/i.test(`${t?.slug || ''} ${t?.label || ''}`));
  return list
    .filter((e) => e?.slug && e.closed !== true && isCrypto(e))
    .map((e) => {
      const markets = (e.markets || []).filter((m) => m && m.closed !== true && m.active !== false);
      return {
        id: String(e.id ?? e.slug),
        title: truncate(stripHtml(e.title || e.slug), 160),
        url: `${PM.site}/event/${encodeURIComponent(e.slug)}`,
        endDate: e.endDate || null,
        volume24h: roundSmart(num(e.volume24hr)),
        volume: roundSmart(num(e.volume)),
        liquidity: roundSmart(num(e.liquidity)),
        marketCount: markets.length,
        leaders: leadersOf(markets),
      };
    })
    .filter((e) => e.leaders.length)
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, limit);
}

/** DefiLlama protocols in the "Prediction Market" category, largest TVL first. */
export function predictionProtocols(protocolsRes, fees30dById = new Map(), limit = 12) {
  if (!protocolsRes?.ok || !Array.isArray(protocolsRes.data)) return null;
  return protocolsRes.data
    .filter((p) => p.category === 'Prediction Market' && (p.tvl || 0) > 0)
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      slug: p.slug,
      tvl: roundSmart(p.tvl),
      change7d: roundSmart(p.change_7d),
      fees30d: roundSmart(fees30dById.get(String(p.id)) ?? null),
      chains: (p.chains || []).slice(0, 6),
      page: `${DL.site}/protocol/${p.slug}`,
    }));
}

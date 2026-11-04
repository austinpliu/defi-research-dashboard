// CoinGecko keyless public API (api.coingecko.com/api/v3, no x-cg-*-api-key header).
// Endpoints per CoinGecko's official SDK: /coins/{id}, /coins/{id}/market_chart, /search.
// Keyless limits are low and shared per IP, so calls are spaced out and retried.
import { normSeries, dailySeries, compactSeries, roundSmart, num, firstSentences, pctChange, changeOverDays, lastPoint } from './util.mjs';
import { sourceRecord } from './sources.mjs';
import { DL } from './defillama.mjs';

export const CG = { api: 'https://api.coingecko.com/api/v3', site: 'https://www.coingecko.com/en/coins' };

export async function fetchCoinRaw(http, id) {
  const coin = await http.json(
    `${CG.api}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`,
    { label: `CoinGecko coin ${id}`, retries: 3, backoffMs: 20000 }
  );
  const chart = await http.json(
    `${CG.api}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=365&interval=daily`,
    { label: `CoinGecko 1y market chart ${id}`, retries: 3, backoffMs: 20000 }
  );
  return { coin, chart };
}

export async function searchCoin(http, query) {
  const r = await http.json(`${CG.api}/search?query=${encodeURIComponent(query)}`, { label: `CoinGecko search ${query}`, retries: 1, backoffMs: 20000 });
  if (!r.ok) return [];
  return (r.data.coins || []).slice(0, 5).map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, rank: c.market_cap_rank }));
}

const usd = (o) => num(o?.usd);

export function buildToken(raw, id) {
  const page = `${CG.site}/${id}`;
  const sources = {
    'cg-coin': sourceRecord({ name: 'CoinGecko', label: 'Token price, market cap & supply', page, res: raw.coin }),
    'cg-chart': sourceRecord({ name: 'CoinGecko', label: 'Price, market cap & volume (1 year, daily)', page: `${page}/historical_data`, res: raw.chart }),
  };
  const out = { id, sources };

  const c = raw.coin.ok ? raw.coin.data : null;
  if (c) {
    const md = c.market_data || {};
    const circ = num(md.circulating_supply);
    const total = num(md.total_supply);
    const max = num(md.max_supply);
    out.profile = {
      name: c.name,
      symbol: (c.symbol || '').toUpperCase(),
      image: c.image?.small || c.image?.thumb || null,
      description: firstSentences(c.description?.en, 2),
      categories: c.categories || [],
      genesisDate: c.genesis_date || null,
      links: {
        homepage: (c.links?.homepage || []).filter(Boolean)[0] || null,
        whitepaper: c.links?.whitepaper || null,
        twitter: c.links?.twitter_screen_name ? `https://x.com/${c.links.twitter_screen_name}` : null,
        forum: (c.links?.official_forum_url || []).filter(Boolean)[0] || null,
        snapshot: c.links?.snapshot_url || null,
        github: (c.links?.repos_url?.github || []).filter(Boolean).slice(0, 3),
        explorers: (c.links?.blockchain_site || []).filter(Boolean).slice(0, 3),
      },
      platforms: Object.fromEntries(Object.entries(c.platforms || {}).filter(([k, v]) => k && v)),
      src: 'cg-coin',
    };
    const spark = md.sparkline_7d?.price || [];
    out.market = {
      price: roundSmart(usd(md.current_price)),
      change1h: roundSmart(md.price_change_percentage_1h_in_currency?.usd),
      change24h: roundSmart(md.price_change_percentage_24h),
      change7d: roundSmart(md.price_change_percentage_7d),
      change30d: roundSmart(md.price_change_percentage_30d),
      change1y: roundSmart(md.price_change_percentage_1y),
      marketCap: roundSmart(usd(md.market_cap)) || null,
      fdv: roundSmart(usd(md.fully_diluted_valuation)) || null,
      volume24h: roundSmart(usd(md.total_volume)),
      high24h: roundSmart(usd(md.high_24h)),
      low24h: roundSmart(usd(md.low_24h)),
      ath: roundSmart(usd(md.ath)),
      athDate: md.ath_date?.usd || null,
      athChange: roundSmart(md.ath_change_percentage?.usd),
      atl: roundSmart(usd(md.atl)),
      atlDate: md.atl_date?.usd || null,
      rank: md.market_cap_rank ?? c.market_cap_rank ?? null,
      mcapToTvl: roundSmart(md.mcap_to_tvl_ratio),
      fdvToTvl: roundSmart(md.fdv_to_tvl_ratio),
      lastUpdated: md.last_updated || c.last_updated || null,
      sparkline7d: spark.length ? spark.filter((_, i) => i % 4 === 0 || i === spark.length - 1).map(roundSmart) : [],
      src: 'cg-coin',
    };
    out.supply = {
      circulating: roundSmart(circ),
      total: roundSmart(total),
      max: roundSmart(max),
      maxInfinite: Boolean(md.max_supply_infinite),
      // share of the eventual supply already trading (uses max if set, else total)
      circulatingPctOfMax: circ && (max || total) ? roundSmart((circ / (max || total)) * 100) : null,
      notYetCirculating: circ && (max || total) ? roundSmart((max || total) - circ) : null,
      basis: max ? 'max' : total ? 'total' : null,
      src: 'cg-coin',
    };
  } else {
    out.unavailable = raw.coin.error;
  }

  const ch = raw.chart.ok ? raw.chart.data : null;
  if (ch) {
    const price = dailySeries(normSeries(ch.prices || [], { ms: true }));
    out.series = {
      price: compactSeries(price),
      marketCap: compactSeries(dailySeries(normSeries(ch.market_caps || [], { ms: true }))),
      volume: compactSeries(dailySeries(normSeries(ch.total_volumes || [], { ms: true }))),
      src: 'cg-chart',
    };
    if (out.market && out.market.change90d == null) out.market.change90d = roundSmart(changeOverDays(price, 90));
  } else {
    out.series = { unavailable: raw.chart.error, src: 'cg-chart' };
  }
  return out;
}

/** Fill gaps from DefiLlama's coin price API when CoinGecko failed. */
export function applyLlamaFallback(token, llama, geckoId) {
  const key = llama.key;
  const page = `${DL.site}/`;
  if (!token.market && llama.cur.ok && llama.cur.data?.coins?.[key]) {
    const c = llama.cur.data.coins[key];
    token.sources['dl-coin'] = sourceRecord({ name: 'DefiLlama', label: 'Token price (fallback: CoinGecko unavailable)', page, res: llama.cur });
    token.market = {
      price: roundSmart(c.price),
      priceTime: c.timestamp || null,
      confidence: c.confidence ?? null,
      src: 'dl-coin',
      partial: 'CoinGecko was unavailable, so only the price comes from DefiLlama; market cap, FDV, volume and supply are unavailable this run.',
    };
    token.profile = token.profile || { name: geckoId, symbol: (c.symbol || '').toUpperCase(), src: 'dl-coin' };
  }
  if ((!token.series || token.series.unavailable) && llama.chart.ok && llama.chart.data?.coins?.[key]?.prices) {
    const s = dailySeries(normSeries(llama.chart.data.coins[key].prices, { tsKey: 'timestamp', valKey: 'price' }));
    token.sources['dl-coin-chart'] = sourceRecord({ name: 'DefiLlama', label: 'Price history (fallback: CoinGecko unavailable)', page, res: llama.chart });
    token.series = { price: compactSeries(s), src: 'dl-coin-chart' };
    if (token.market && token.market.change7d == null) {
      token.market.change7d = roundSmart(changeOverDays(s, 7));
      token.market.change30d = roundSmart(changeOverDays(s, 30));
    }
  }
  return token;
}

export { pctChange, lastPoint };

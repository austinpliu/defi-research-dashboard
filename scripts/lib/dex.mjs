// DEX liquidity for a token.
// Primary: DexScreener (api.dexscreener.com, keyless, 300 calls/min) for chains we can map.
// Fallback: GeckoTerminal public API (api.geckoterminal.com/api/v2, keyless, 30 calls/min)
//   /networks?page=N                         → maps CoinGecko platform ids to GeckoTerminal network ids
//   /networks/{network}/tokens/{address}/pools → top pools for a token
//   DexScreener /token-pairs/v1/{chainId}/{tokenAddress}
import { num, roundSmart } from './util.mjs';
import { sourceRecord } from './sources.mjs';

export const GT = { api: 'https://api.geckoterminal.com/api/v2', site: 'https://www.geckoterminal.com' };
export const DS = { api: 'https://api.dexscreener.com', site: 'https://dexscreener.com' };

// CoinGecko platform id → DexScreener chain id (only used for the fallback).
const DEXSCREENER_CHAINS = {
  ethereum: 'ethereum',
  'arbitrum-one': 'arbitrum',
  base: 'base',
  solana: 'solana',
  'binance-smart-chain': 'bsc',
  'polygon-pos': 'polygon',
  avalanche: 'avalanche',
  'optimistic-ethereum': 'optimism',
  hyperevm: 'hyperevm',
  sonic: 'sonic',
  mantle: 'mantle',
  linea: 'linea',
  scroll: 'scroll',
  blast: 'blast',
  sui: 'sui',
  aptos: 'aptos',
  plasma: 'plasma',
};

const GT_HEADERS = { Accept: 'application/json;version=20230302' };

export async function fetchNetworkMap(http) {
  const map = {};
  let lastRes = null;
  for (let page = 1; page <= 8; page++) {
    const r = await http.json(`${GT.api}/networks?page=${page}`, { label: `GeckoTerminal networks p${page}`, headers: GT_HEADERS, retries: 2, backoffMs: 10000 });
    lastRes = r;
    if (!r.ok || !Array.isArray(r.data?.data) || !r.data.data.length) break;
    for (const n of r.data.data) {
      const cg = n.attributes?.coingecko_asset_platform_id;
      if (cg) map[cg] = n.id;
    }
    if (!r.data.links?.next) break;
  }
  return { map, res: lastRes };
}

function gtPool(p, included, network) {
  const a = p.attributes || {};
  const dexId = p.relationships?.dex?.data?.id;
  const dex = included.get(`dex:${dexId}`)?.attributes?.name || dexId || null;
  return {
    name: a.name,
    dex,
    network,
    address: a.address,
    liquidity: roundSmart(num(a.reserve_in_usd)),
    volume24h: roundSmart(num(a.volume_usd?.h24)),
    priceUsd: roundSmart(num(a.base_token_price_usd)),
    change24h: roundSmart(num(a.price_change_percentage?.h24)),
    txns24h: a.transactions?.h24 ? (a.transactions.h24.buys || 0) + (a.transactions.h24.sells || 0) : null,
    createdAt: a.pool_created_at || null,
    page: `${GT.site}/${network}/pools/${a.address}`,
  };
}

/**
 * Fetch top pools for every platform the token lives on.
 * Returns { pools, sources, attempted }.
 */
export async function fetchTokenPools(http, platforms, getNetworkMap, { maxPlatforms = 3 } = {}) {
  const entries = Object.entries(platforms || {}).filter(([, addr]) => addr);
  // Ethereum first, then the rest in CoinGecko's order
  entries.sort((a, b) => (a[0] === 'ethereum' ? -1 : b[0] === 'ethereum' ? 1 : 0));
  const pools = [];
  const sources = {};
  const attempted = [];
  for (const [platform, address] of entries.slice(0, maxPlatforms)) {
    let got = false;
    // 1) DexScreener (generous rate limit) when we know its chain id
    const chainId = DEXSCREENER_CHAINS[platform];
    if (chainId) {
      const url = `${DS.api}/token-pairs/v1/${chainId}/${address}`;
      const r = await http.json(url, { label: `DexScreener pairs ${platform}`, retries: 2 });
      const key = `ds-${chainId}`;
      sources[key] = sourceRecord({ name: 'DexScreener', label: `DEX pairs on ${platform}`, page: `${DS.site}/${chainId}/${address}`, res: r });
      attempted.push({ platform, source: 'DexScreener', ok: r.ok && Array.isArray(r.data), error: r.error });
      if (r.ok && Array.isArray(r.data) && r.data.length) {
        for (const p of r.data) {
          pools.push({
            name: `${p.baseToken?.symbol || '?'} / ${p.quoteToken?.symbol || '?'}`,
            dex: [p.dexId, ...(p.labels || [])].filter(Boolean).join(' '),
            network: p.chainId,
            address: p.pairAddress,
            liquidity: roundSmart(num(p.liquidity?.usd)),
            volume24h: roundSmart(num(p.volume?.h24)),
            priceUsd: roundSmart(num(p.priceUsd)),
            change24h: roundSmart(num(p.priceChange?.h24)),
            txns24h: p.txns?.h24 ? (p.txns.h24.buys || 0) + (p.txns.h24.sells || 0) : null,
            createdAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
            page: p.url || `${DS.site}/${p.chainId}/${p.pairAddress}`,
            src: key,
          });
        }
        got = true;
      }
    }
    // 2) GeckoTerminal for chains DexScreener doesn't cover (or when it had nothing)
    if (!got) {
      const networkMap = await getNetworkMap();
      const network = networkMap[platform];
      if (network) {
        const url = `${GT.api}/networks/${network}/tokens/${encodeURIComponent(address)}/pools?include=dex&page=1`;
        const r = await http.json(url, { label: `GeckoTerminal pools ${platform}`, headers: GT_HEADERS, retries: 2, backoffMs: 20000 });
        const key = `gt-${network}`;
        sources[key] = sourceRecord({ name: 'GeckoTerminal', label: `DEX pools on ${platform}`, page: `${GT.site}/${network}/tokens/${address}`, res: r });
        attempted.push({ platform, network, source: 'GeckoTerminal', ok: r.ok, error: r.error });
        if (r.ok && Array.isArray(r.data?.data)) {
          const included = new Map((r.data.included || []).map((i) => [`${i.type}:${i.id}`, i]));
          for (const p of r.data.data) pools.push({ ...gtPool(p, included, network), src: key });
        }
      } else if (!chainId) {
        attempted.push({ platform, ok: false, error: 'No DexScreener chain or GeckoTerminal network for this platform' });
      }
    }
  }
  // the same pool can appear twice (once per side); keep the first
  const seen = new Set();
  const unique = pools.filter((p) => (seen.has(p.address) ? false : (seen.add(p.address), true)));
  unique.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
  const withLiq = unique.filter((p) => p.liquidity != null);
  return {
    pools: unique.slice(0, 15),
    // null (unknown) when no pool reports liquidity, e.g. order-book markets
    totalLiquidity: withLiq.length ? roundSmart(withLiq.reduce((s, p) => s + p.liquidity, 0)) : null,
    totalVolume24h: roundSmart(unique.reduce((s, p) => s + (p.volume24h || 0), 0)),
    poolCount: unique.length,
    sources,
    attempted,
  };
}

// DEX liquidity for a token.
// Primary: GeckoTerminal public API (api.geckoterminal.com/api/v2, keyless, 30 calls/min)
//   /networks?page=N                         → maps CoinGecko platform ids to GeckoTerminal network ids
//   /networks/{network}/tokens/{address}/pools → top pools for a token
// Fallback: DexScreener (api.dexscreener.com, keyless, 300 calls/min)
//   /token-pairs/v1/{chainId}/{tokenAddress}
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
export async function fetchTokenPools(http, platforms, networkMap, { maxPlatforms = 4 } = {}) {
  const entries = Object.entries(platforms || {}).filter(([, addr]) => addr);
  // Ethereum first, then the rest in CoinGecko's order
  entries.sort((a, b) => (a[0] === 'ethereum' ? -1 : b[0] === 'ethereum' ? 1 : 0));
  const pools = [];
  const sources = {};
  const attempted = [];
  for (const [platform, address] of entries.slice(0, maxPlatforms)) {
    const network = networkMap[platform];
    let got = false;
    if (network) {
      const url = `${GT.api}/networks/${network}/tokens/${address}/pools?include=dex&page=1`;
      const r = await http.json(url, { label: `GeckoTerminal pools ${platform}`, headers: GT_HEADERS, retries: 2, backoffMs: 15000 });
      const key = `gt-${network}`;
      sources[key] = sourceRecord({ name: 'GeckoTerminal', label: `DEX pools on ${platform}`, page: `${GT.site}/${network}/tokens/${address}`, res: r });
      attempted.push({ platform, network, ok: r.ok, error: r.error });
      if (r.ok && Array.isArray(r.data?.data)) {
        const included = new Map((r.data.included || []).map((i) => [`${i.type}:${i.id}`, i]));
        for (const p of r.data.data) pools.push({ ...gtPool(p, included, network), src: key });
        got = true;
      }
    }
    if (!got && DEXSCREENER_CHAINS[platform]) {
      const chainId = DEXSCREENER_CHAINS[platform];
      const url = `${DS.api}/token-pairs/v1/${chainId}/${address}`;
      const r = await http.json(url, { label: `DexScreener pairs ${platform}`, retries: 2 });
      const key = `ds-${chainId}`;
      sources[key] = sourceRecord({ name: 'DexScreener', label: `DEX pairs on ${platform}`, page: `${DS.site}/${chainId}/${address}`, res: r });
      attempted.push({ platform, chainId, ok: r.ok, error: r.error, fallback: true });
      if (r.ok && Array.isArray(r.data)) {
        for (const p of r.data) {
          pools.push({
            name: `${p.baseToken?.symbol || '?'} / ${p.quoteToken?.symbol || '?'}`,
            dex: p.dexId || null,
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
      }
    } else if (!got && !network) {
      attempted.push({ platform, ok: false, error: 'No GeckoTerminal network or DexScreener chain mapping for this platform' });
    }
  }
  pools.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
  return { pools: pools.slice(0, 15), totalLiquidity: roundSmart(pools.reduce((s, p) => s + (p.liquidity || 0), 0)), totalVolume24h: roundSmart(pools.reduce((s, p) => s + (p.volume24h || 0), 0)), poolCount: pools.length, sources, attempted };
}

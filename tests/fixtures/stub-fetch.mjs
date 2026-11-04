// Test-only: replaces global fetch with tiny SYNTHETIC responses shaped like
// the real APIs, so the pipeline's code paths can be exercised offline.
// These numbers are fake and are only ever written to a temporary folder by
// tests/pipeline.test.mjs — never to site/data.
const DAY = 86400;
const now = Math.floor(Date.now() / 1000 / DAY) * DAY;
const days = (n, f) => Array.from({ length: n }, (_, i) => f(now - (n - 1 - i) * DAY, i));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function xml(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
}

const protocolsList = [
  { id: '1', name: 'Alpha V3', slug: 'alpha-v3', parentProtocol: 'parent#alpha', category: 'Lending', chains: ['Ethereum', 'Base'], tvl: 2e10, change_1d: 1, change_7d: 5, mcap: 3e9, symbol: 'ALP' },
  { id: '2', name: 'Beta', slug: 'beta', category: 'Dexs', chains: ['Ethereum'], tvl: 5e8, change_7d: -12, change_1d: -1, symbol: 'BET' },
  { id: '3', name: 'Gamma', slug: 'gamma', category: 'Yield', chains: ['Arbitrum'], tvl: 2e8, change_7d: 40, change_1d: 2, symbol: '-' },
  { id: '4', name: 'Some CEX', slug: 'some-cex', category: 'CEX', chains: ['Ethereum'], tvl: 9e10, change_7d: 1 },
];

const overview = (scale) => ({
  total24h: 1e7 * scale, total7d: 7e7 * scale, total30d: 3e8 * scale, total1y: 3.6e9 * scale,
  total14dto7d: 6e7 * scale, total60dto30d: 2.8e8 * scale, change_1d: 2,
  totalDataChart: days(400, (ts, i) => [ts, 1e7 * scale * (1 + (i % 7) / 10)]),
  protocols: [
    { name: 'Alpha V3', displayName: 'Alpha V3', defillamaId: '1', parentProtocol: 'parent#alpha', category: 'Lending', chains: ['Ethereum'], total24h: 1e6, total7d: 7e6, total30d: 3e7, total14dto7d: 6e6, total60dto30d: 2.9e7, slug: 'alpha-v3' },
    { name: 'Alpha V2', displayName: 'Alpha V2', defillamaId: '5', parentProtocol: 'parent#alpha', category: 'Lending', chains: ['Ethereum'], total24h: 1e5, total7d: 7e5, total30d: 3e6, slug: 'alpha-v2' },
    { name: 'Beta', displayName: 'Beta', defillamaId: '2', category: 'Dexs', chains: ['Ethereum'], total24h: 2e6, total7d: 1.4e7, total30d: 6e7, slug: 'beta' },
    { name: 'Ethereum', displayName: 'Ethereum', defillamaId: '9', category: 'Chain', total30d: 9e9 },
  ],
});

const protocolDetail = (name) => ({
  name,
  description: `${name} is a synthetic test protocol. It exists only in tests. Third sentence is dropped.`,
  category: 'Lending',
  chains: ['Ethereum', 'Base'],
  url: 'https://example.com',
  twitter: 'example',
  github: ['example'],
  audit_links: ['https://example.com/audit'],
  gecko_id: 'alpha-token',
  governanceID: ['snapshot:alpha.eth'],
  otherProtocols: [name, `${name} V3`],
  mcap: 3e9,
  tvl: days(800, (ts, i) => ({ date: ts, totalLiquidityUSD: 1e9 + i * 1e6 })),
  currentChainTvls: { Ethereum: 1.5e9, Base: 2e8, borrowed: 5e8, 'Ethereum-borrowed': 4e8 },
  chainTvls: {
    Ethereum: { tvl: days(400, (ts, i) => ({ date: ts, totalLiquidityUSD: 1e9 + i * 1e6 })) },
    Base: { tvl: days(100, (ts, i) => ({ date: ts, totalLiquidityUSD: 1e8 + i * 1e5 })) },
  },
  tokensInUsd: [{ date: now, tokens: { USDC: 5e8, WETH: 4e8, WBTC: 1e8 } }],
  raises: [{ date: now - 400 * DAY, round: 'Seed', amount: 5, leadInvestors: ['Fund A'], otherInvestors: [], source: 'https://example.com/raise' }],
  hallmarks: [[now - 100 * DAY, 'V3 launch'], [now + 20 * DAY, 'Scheduled upgrade']],
});

const coin = (id) => ({
  id, symbol: 'alp', name: 'Alpha Token', description: { en: 'Alpha token. Used for tests.' },
  links: { homepage: ['https://example.com'], twitter_screen_name: 'example', snapshot_url: 'https://snapshot.org/#/alpha.eth', official_forum_url: [''], repos_url: { github: [] }, blockchain_site: [] },
  platforms: { ethereum: '0xabc', 'unknown-chain': '0xdef' },
  market_data: {
    current_price: { usd: 100 }, market_cap: { usd: 1.5e9 }, fully_diluted_valuation: { usd: 1.6e9 }, total_volume: { usd: 1e8 },
    circulating_supply: 1.5e7, total_supply: 1.6e7, max_supply: 1.6e7,
    price_change_percentage_24h: 1, price_change_percentage_7d: -3, price_change_percentage_30d: 10, price_change_percentage_1y: 50,
    ath: { usd: 600 }, ath_date: { usd: '2021-05-18T00:00:00.000Z' }, ath_change_percentage: { usd: -83 }, atl: { usd: 25 },
    sparkline_7d: { price: Array.from({ length: 168 }, (_, i) => 95 + (i % 10)) },
  },
});

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test feed</title>
<item><title><![CDATA[Alpha launches V4 on mainnet]]></title><link>https://example.com/a</link><pubDate>${new Date().toUTCString()}</pubDate><description>Alpha &amp; friends.</description></item>
<item><title>Stablecoin supply climbs in DeFi</title><link>https://example.com/b</link><pubDate>${new Date(Date.now() - 86400e3).toUTCString()}</pubDate></item>
<item><title>Old news</title><link>https://example.com/c</link><pubDate>Mon, 01 Jan 2018 00:00:00 GMT</pubDate></item>
</channel></rss>`;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/hacks') || u.includes('/raises') || u.includes('/emissions')) return json({ message: 'pro only' }, 403);
  if (u.endsWith('api.llama.fi/protocols')) return json(protocolsList);
  if (u.includes('/v2/chains')) return json([{ name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH' }, { name: 'Solana', tvl: 9e9, tokenSymbol: 'SOL' }]);
  if (u.includes('/v2/historicalChainTvl')) return json(days(800, (ts, i) => ({ date: ts, tvl: 8e10 + i * 1e7 })));
  if (u.includes('/overview/fees') && u.includes('dailyRevenue')) return json(overview(0.4));
  if (u.includes('/overview/fees')) return json(overview(1));
  if (u.includes('/overview/dexs')) return json(overview(10));
  if (u.includes('stablecoins.llama.fi/stablecoins')) return json({ peggedAssets: [
    { id: '1', name: 'Tether', symbol: 'USDT', gecko_id: 'tether', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', price: 1, circulating: { peggedUSD: 1.5e11 }, circulatingPrevWeek: { peggedUSD: 1.48e11 }, circulatingPrevMonth: { peggedUSD: 1.4e11 }, chains: ['Ethereum'] },
    { id: '2', name: 'USD Coin', symbol: 'USDC', gecko_id: 'usd-coin', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', price: 1, circulating: { peggedUSD: 6e10 }, circulatingPrevWeek: { peggedUSD: 6.1e10 }, circulatingPrevMonth: { peggedUSD: 5.5e10 }, chains: ['Ethereum'] },
  ] });
  if (u.includes('stablecoincharts/all?stablecoin=1')) return json(days(500, (ts) => ({ date: String(ts), totalCirculatingUSD: { peggedUSD: 1.4e11 } })));
  if (u.includes('stablecoincharts/all?stablecoin=2')) return json(days(500, (ts) => ({ date: String(ts), totalCirculatingUSD: { peggedUSD: 6e10 } })));
  if (u.includes('stablecoincharts/all')) return json(days(800, (ts, i) => ({ date: String(ts), totalCirculatingUSD: { peggedUSD: 2e11 + i * 1e8, peggedEUR: 1e8 } })));
  if (u.includes('yields.llama.fi/pools')) return json({ status: 'success', data: [
    { pool: 'p1', chain: 'Ethereum', project: 'alpha-v3', symbol: 'USDC', tvlUsd: 1e9, apy: 4.1, apyBase: 3, apyReward: 1.1, stablecoin: true },
    { pool: 'p2', chain: 'Base', project: 'beta', symbol: 'ETH', tvlUsd: 5e8, apy: 2 },
  ] });
  if (u.includes('api.llama.fi/protocol/does-not-exist')) return json({ message: 'not found' }, 400);
  if (u.includes('api.llama.fi/protocol/')) return json(protocolDetail(decodeURIComponent(u.split('/protocol/')[1])));
  if (u.includes('/summary/fees/') && u.includes('dailyHoldersRevenue')) return json({ message: 'no data' }, 404);
  if (u.includes('/summary/fees/')) return json({ total24h: 1e5, total7d: 7e5, total30d: 3e6, total1y: 3.6e7, totalAllTime: 9e7, change_1d: 3, totalDataChart: days(500, (ts, i) => [ts, 1e5 + i]) });
  if (u.includes('coingecko.com/api/v3/coins/missing-coin')) return json({ error: 'coin not found' }, 404);
  if (u.includes('coingecko.com/api/v3/search')) return json({ coins: [{ id: 'right-id', name: 'Right', symbol: 'RGT', market_cap_rank: 100 }] });
  if (u.includes('/market_chart')) return json({ prices: days(365, (ts, i) => [ts * 1000, 80 + i / 10]), market_caps: days(365, (ts, i) => [ts * 1000, 1e9 + i * 1e6]), total_volumes: days(365, (ts) => [ts * 1000, 1e8]) });
  if (u.includes('coingecko.com/api/v3/coins/')) return json(coin(u.split('/coins/')[1].split('?')[0]));
  if (u.includes('coins.llama.fi/prices/current')) return json({ coins: { 'coingecko:missing-coin': { price: 2.5, symbol: 'MIS', timestamp: now, confidence: 0.99 } } });
  if (u.includes('coins.llama.fi/chart')) return json({ coins: { 'coingecko:missing-coin': { prices: days(30, (ts, i) => ({ timestamp: ts, price: 2 + i / 100 })) } } });
  if (u.includes('geckoterminal.com/api/v2/networks?page=')) return json({ data: [{ id: 'eth', type: 'network', attributes: { name: 'Ethereum', coingecko_asset_platform_id: 'ethereum' } }], links: { next: null } });
  if (u.includes('geckoterminal.com/api/v2/networks/eth/tokens/')) return json({ data: [{ id: 'eth_0xpool', attributes: { address: '0xpool', name: 'ALP / WETH', reserve_in_usd: '1000000', volume_usd: { h24: '50000' }, base_token_price_usd: '100', price_change_percentage: { h24: '1.2' }, transactions: { h24: { buys: 10, sells: 5 } }, pool_created_at: '2021-01-01T00:00:00Z' }, relationships: { dex: { data: { id: 'uniswap_v3', type: 'dex' } } } }], included: [{ id: 'uniswap_v3', type: 'dex', attributes: { name: 'Uniswap V3' } }] });
  if (u.includes('hub.snapshot.org')) {
    const p = (state, start, end) => ({ id: `0x${state}`, title: `Proposal ${state}`, start, end, state, choices: ['For', 'Against'], scores: [70, 30], scores_total: 100, votes: 12, space: { id: 'alpha.eth', name: 'Alpha' }, link: `https://snapshot.org/#/alpha.eth/proposal/0x${state}` });
    return json({ data: { active: [p('active', now - DAY, now + 2 * DAY)], pending: [p('pending', now + DAY, now + 4 * DAY)], closed: [p('closed', now - 9 * DAY, now - 3 * DAY)] } });
  }
  if (u.includes('broken-feed')) return new Response('nope', { status: 404 });
  if (u.endsWith('.rss') || u.includes('/feed') || u.includes('rss')) return xml(rss);
  return json({ message: `stub has no route for ${u}` }, 404);
};

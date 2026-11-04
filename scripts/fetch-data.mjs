#!/usr/bin/env node
// Fetches every number the dashboard shows and writes JSON files to site/data/.
//
//   node scripts/fetch-data.mjs          (normal run)
//   PROBE=1 node scripts/fetch-data.mjs  (also prints the shape of each API response)
//
// No API keys. No dependencies (Node 18+ has fetch built in).
// Runs every 6 hours on GitHub Actions (.github/workflows/update-data.yml).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Http } from './lib/http.mjs';
import {
  DL, fetchGlobal, buildMarket, buildScreener, fetchProtocolRaw, buildProtocolCore, resolveSlug,
  childSlugs, poolsForProtocol, hacksForProtocol, fetchChainHistory, fetchStableHistory, fetchLlamaCoin,
} from './lib/defillama.mjs';
import { fetchCoinRaw, buildToken, applyLlamaFallback, searchCoin } from './lib/coingecko.mjs';
import { fetchNetworkMap, fetchTokenPools } from './lib/dex.mjs';
import { spacesFromSources, fetchProposals } from './lib/governance.mjs';
import { fetchFeed, feedItems } from './lib/feeds.mjs';
import { sourceRecord, derivedRecord, carryForward } from './lib/sources.mjs';
import { roundSmart, num, slugify, normSeries, dailySeries, trimDays, compactSeries } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DATA_OUT_DIR || join(ROOT, 'site', 'data');
const WATCHLIST = process.env.WATCHLIST_FILE || join(ROOT, 'watchlist.json');
const PROBE = process.env.PROBE === '1';
const started = Date.now();
const problems = [];
const problem = (severity, message, hint) => {
  problems.push({ severity, message, ...(hint ? { hint } : {}) });
  console.log(`${severity === 'error' ? '✗✗' : '!!'} ${message}${hint ? ` — ${hint}` : ''}`);
};

// ---------- small file helpers ----------
const readJSON = (p, fallback = null) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJSON = (p, obj, pretty = false) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(obj, null, pretty ? 2 : 0)}\n`);
};
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, path, v) => {
  const ks = path.split('.');
  let cur = o;
  ks.slice(0, -1).forEach((k) => {
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  });
  cur[ks[ks.length - 1]] = v;
};

function shape(v, depth = 0) {
  if (Array.isArray(v)) return `Array(${v.length})${v.length && depth < 2 ? `<${shape(v[0], depth + 1)}>` : ''}`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 2) return `{${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',…' : ''}}`;
    return `{${keys.slice(0, 30).map((k) => `${k}:${shape(v[k], depth + 1)}`).join(', ')}${keys.length > 30 ? ', …' : ''}}`;
  }
  return typeof v === 'string' ? `str(${v.slice(0, 24)})` : typeof v;
}
const probe = (label, res) => {
  if (PROBE && res?.ok) console.log(`   ↳ shape ${label}: ${shape(res.data).slice(0, 1500)}`);
};

/** Reuse last run's data for sections whose source failed this run (max 48h old). */
function carrySections(next, prev, groups) {
  if (!prev?.sources) return next;
  for (const { src, paths } of groups) {
    const fresh = next.sources?.[src];
    if (!fresh || fresh.ok) continue;
    const prevSource = prev.sources[src];
    const prevData = paths.map((p) => getPath(prev, p));
    if (prevData.every((d) => d == null)) continue;
    const { data, source } = carryForward({ freshData: null, freshSource: fresh, prevData, prevSource });
    if (data) {
      paths.forEach((p, i) => setPath(next, p, prevData[i]));
      next.sources[src] = source;
      problem('warn', `${src}: using data from ${source.stale.lastGoodAt} because the latest fetch failed (${fresh.error})`);
    }
  }
  return next;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- main ----------
async function main() {
  const watchlist = readJSON(WATCHLIST);
  if (!watchlist || !Array.isArray(watchlist.protocols)) throw new Error('watchlist.json is missing or has no "protocols" list');
  const entries = [
    ...watchlist.protocols.map((p) => ({ ...p, group: 'watchlist' })),
    ...(watchlist.peers || []).map((p) => ({ ...p, group: 'peer' })),
  ].filter((p) => {
    if (!p.name || !p.defillama) {
      problem('error', `watchlist.json entry ${JSON.stringify(p).slice(0, 80)} needs both "name" and "defillama"`);
      return false;
    }
    return true;
  });

  const http = new Http();
  http.configureHost('api.llama.fi', { minIntervalMs: 300, concurrency: 3 });
  http.configureHost('stablecoins.llama.fi', { minIntervalMs: 300, concurrency: 2 });
  http.configureHost('yields.llama.fi', { minIntervalMs: 300, concurrency: 1 });
  http.configureHost('coins.llama.fi', { minIntervalMs: 300, concurrency: 2 });
  http.configureHost('api.coingecko.com', { minIntervalMs: 7000, concurrency: 1 });
  http.configureHost('api.geckoterminal.com', { minIntervalMs: 2300, concurrency: 1 });
  http.configureHost('api.dexscreener.com', { minIntervalMs: 400, concurrency: 1 });
  http.configureHost('hub.snapshot.org', { minIntervalMs: 1500, concurrency: 1 });

  // 1. Market-wide data ---------------------------------------------------
  console.log('\n== DefiLlama market-wide data');
  const raw = await fetchGlobal(http);
  for (const [k, r] of Object.entries(raw)) probe(k, r);
  if (PROBE && raw.fees.ok) console.log('   ↳ fees protocol sample:', JSON.stringify(raw.fees.data.protocols?.slice(0, 2)).slice(0, 1500));
  if (PROBE && raw.protocols.ok) console.log('   ↳ protocols sample:', JSON.stringify(raw.protocols.data.find((p) => p.parentProtocol)).slice(0, 1200));
  if (PROBE && raw.pools.ok) console.log('   ↳ pool sample:', JSON.stringify(raw.pools.data.data?.[0]).slice(0, 800));
  if (PROBE && raw.hacks.ok) console.log('   ↳ hack sample:', JSON.stringify(raw.hacks.data?.[0]).slice(0, 800));
  if (PROBE && raw.emissions.ok) console.log('   ↳ emissions sample:', JSON.stringify(raw.emissions.data?.[0]).slice(0, 1500));
  if (PROBE && raw.raises.ok) console.log('   ↳ raises sample:', JSON.stringify(raw.raises.data?.raises?.[0] ?? raw.raises.data?.[0]).slice(0, 800));

  const topChains = raw.chains.ok ? [...raw.chains.data].sort((a, b) => b.tvl - a.tvl).slice(0, 6).map((c) => c.name) : [];
  const chainHistory = topChains.length ? await fetchChainHistory(http, topChains) : null;
  let stableHistory = null;
  if (raw.stables.ok && raw.stableChart.ok) {
    const top = [...raw.stables.data.peggedAssets]
      .map((a) => ({ id: a.id, symbol: a.symbol, c: Object.values(a.circulating || {}).reduce((s, v) => s + (Number(v) || 0), 0) }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 5);
    const totalSeries = dailySeries(normSeries(raw.stableChart.data.map((p) => [Number(p.date), Object.values(p.totalCirculatingUSD || {}).reduce((s, v) => s + (Number(v) || 0), 0)])));
    stableHistory = await fetchStableHistory(http, top, totalSeries);
  }

  const prevMarket = readJSON(join(OUT, 'market.json'));
  let market = buildMarket(raw, { chainHistory, stableHistory });
  market = carrySections(market, prevMarket, [
    { src: 'dl-tvl', paths: ['headline.tvl'] },
    { src: 'dl-stable-chart', paths: ['headline.stablecoins'] },
    { src: 'dl-dexs', paths: ['headline.dexVolume'] },
    { src: 'dl-fees', paths: ['headline.fees', 'topFees'] },
    { src: 'dl-revenue', paths: ['headline.revenue', 'topRevenue'] },
    { src: 'dl-chains', paths: ['chains'] },
    { src: 'dl-protocols', paths: ['categories', 'movers'] },
    { src: 'dl-stablecoins', paths: ['stablecoins'] },
  ]);

  const watchSlugs = new Set(entries.map((e) => e.defillama));
  const screener = buildScreener(raw, watchSlugs);

  // 2. One file per protocol -----------------------------------------------
  console.log('\n== Protocols');
  const protocolList = raw.protocols.ok ? raw.protocols.data : null;
  const yieldsSrc = sourceRecord({ name: 'DefiLlama', label: 'Yield pools', page: `${DL.site}/yields`, res: raw.pools });
  const hacksSrc = sourceRecord({ name: 'DefiLlama', label: 'Hacks database', page: `${DL.site}/hacks`, res: raw.hacks, note: raw.hacks.ok ? undefined : 'DefiLlama lists /hacks as a Pro (paid) endpoint; the free host refused it.' });

  const protocols = await mapLimit(entries, 2, async (entry) => {
    let slug = entry.defillama;
    let r = await fetchProtocolRaw(http, slug);
    if (!r.protocol.ok && protocolList) {
      const alt = resolveSlug(protocolList, slug) || resolveSlug(protocolList, entry.name);
      if (alt && alt !== slug) {
        problem('warn', `DefiLlama slug "${slug}" for ${entry.name} failed (${r.protocol.error}); using "${alt}" found in the protocol list`, `Update "defillama" for ${entry.name} in watchlist.json to "${alt}"`);
        slug = alt;
        r = await fetchProtocolRaw(http, slug);
      }
    }
    if (!r.protocol.ok) problem('error', `Could not load ${entry.name} from DefiLlama (${r.protocol.error})`, `Check the "defillama" slug for ${entry.name} in watchlist.json — it's the last part of its defillama.com/protocol/... URL`);
    probe(`protocol ${slug}`, r.protocol);
    probe(`fees ${slug}`, r.fees);
    const core = buildProtocolCore(r, slug);
    const doc = {
      slug,
      configuredSlug: entry.defillama,
      name: entry.name,
      symbol: entry.symbol || core.about?.symbol || null,
      group: entry.group,
      generatedAt: new Date().toISOString(),
      ...core,
    };
    // links: DefiLlama + watchlist overrides
    doc.links = {
      website: core.about?.url || null,
      docs: entry.links?.docs || null,
      twitter: core.about?.twitter || null,
      github: core.about?.github?.[0] || null,
      audits: core.about?.auditLinks || [],
      defillama: `${DL.site}/protocol/${slug}`,
      ...(entry.links || {}),
    };

    // yields
    const slugs = childSlugs(protocolList, slug, core.about?.otherProtocols || []);
    const pools = poolsForProtocol(raw.pools, slugs);
    doc.sources['dl-yields'] = yieldsSrc;
    doc.yields = pools ? { list: pools, projects: [...slugs], src: 'dl-yields' } : { unavailable: raw.pools.error, src: 'dl-yields' };

    // hacks / incidents
    const names = [entry.name, core.about?.name, ...(core.about?.otherProtocols || [])].filter(Boolean);
    const hacks = hacksForProtocol(raw.hacks, names);
    doc.sources['dl-hacks'] = hacksSrc;
    doc.hacks = hacks ? { list: hacks, src: 'dl-hacks' } : { unavailable: hacksSrc.error, note: hacksSrc.note, src: 'dl-hacks' };

    return { entry, doc, slugs };
  });

  // 3. Tokens (CoinGecko, spaced out to respect the keyless rate limit) -----
  console.log('\n== Tokens');
  const tokenJobs = [];
  for (const p of protocols) {
    const id = p.entry.coingecko || p.doc.about?.geckoId;
    if (id) tokenJobs.push({ id, protocol: p });
    else problem('warn', `${p.entry.name}: no CoinGecko id (none in watchlist.json and DefiLlama has none) — token data skipped`);
  }
  const tokens = [];
  for (const job of tokenJobs) {
    const { id } = job;
    const r = await fetchCoinRaw(http, id);
    probe(`coin ${id}`, r.coin);
    let token = buildToken(r, id);
    if (r.coin.status === 404) {
      const hits = await searchCoin(http, job.protocol.entry.symbol || job.protocol.entry.name);
      problem('error', `CoinGecko id "${id}" (${job.protocol.entry.name}) was not found`, hits.length ? `CoinGecko search suggests: ${hits.map((h) => `${h.id} (${h.name}, ${h.symbol})`).join('; ')}` : 'Check the "coingecko" field in watchlist.json');
    }
    if (!r.coin.ok || !r.chart.ok) {
      const llama = await fetchLlamaCoin(http, id);
      token = applyLlamaFallback(token, llama, id);
    }
    const prevTok = readJSON(join(OUT, 'tokens', `${id}.json`));
    token = carrySections(token, prevTok, [
      { src: 'cg-coin', paths: ['profile', 'market', 'supply'] },
      { src: 'cg-chart', paths: ['series'] },
    ]);
    token.protocol = { slug: job.protocol.doc.slug, name: job.protocol.entry.name };
    token.symbol = token.profile?.symbol || job.protocol.entry.symbol || null;
    token.name = token.profile?.name || job.protocol.entry.name;
    token.generatedAt = new Date().toISOString();
    tokens.push(token);
    job.protocol.token = token;
  }

  // 4. DEX liquidity (GeckoTerminal, DexScreener fallback) --------------------
  console.log('\n== DEX liquidity');
  const { map: networkMap, res: netRes } = await fetchNetworkMap(http);
  if (!netRes?.ok) problem('warn', `GeckoTerminal network list failed (${netRes?.error}); DEX pools will use DexScreener only`);
  for (const t of tokens) {
    const platforms = t.profile?.platforms;
    if (!platforms || !Object.keys(platforms).length) {
      t.dex = { unavailable: t.profile ? 'CoinGecko lists no contract addresses for this token (it may be native to its own chain)' : 'Token profile unavailable, so contract addresses are unknown', pools: [] };
      continue;
    }
    const d = await fetchTokenPools(http, platforms, networkMap);
    t.sources = { ...t.sources, ...d.sources };
    t.dex = { pools: d.pools, totalLiquidity: d.totalLiquidity, totalVolume24h: d.totalVolume24h, poolCount: d.poolCount, attempted: d.attempted };
    if (!d.pools.length) t.dex.unavailable = d.attempted.map((a) => `${a.platform}: ${a.error || 'no pools'}`).join('; ') || 'No pools found';
    const prevTok = readJSON(join(OUT, 'tokens', `${t.id}.json`));
    if (!d.pools.length && prevTok?.dex?.pools?.length && prevTok.dex.fetchedAt && Date.now() - Date.parse(prevTok.dex.fetchedAt) < 48 * 36e5) {
      t.dex = { ...prevTok.dex, stale: { lastGoodAt: prevTok.dex.fetchedAt, reason: t.dex.unavailable } };
      for (const [k, v] of Object.entries(prevTok.sources || {})) if (k.startsWith('gt-') || k.startsWith('ds-')) t.sources[k] = { ...v, stale: true };
    } else {
      t.dex.fetchedAt = new Date().toISOString();
    }
  }

  // 5. Governance (Snapshot) ---------------------------------------------------
  console.log('\n== Governance');
  const spaceOwner = new Map();
  for (const p of protocols) {
    const spaces = spacesFromSources({
      governanceID: p.doc.about?.governanceID || [],
      snapshotUrl: p.token?.profile?.links?.snapshot || null,
      override: p.entry.snapshot || [],
    });
    p.spaces = spaces;
    // a space shared by several entries belongs to the first watchlist entry that lists it
    spaces.forEach((s) => {
      const cur = spaceOwner.get(s);
      if (!cur || (cur.entry.group !== 'watchlist' && p.entry.group === 'watchlist')) spaceOwner.set(s, p);
    });
  }
  const allSpaces = [...spaceOwner.keys()];
  const gov = await fetchProposals(http, allSpaces);
  if (gov.source && !gov.source.ok) problem('warn', `Snapshot query failed (${gov.source.error})`);
  for (const p of protocols) {
    const props = gov.proposals.filter((x) => p.spaces.includes(x.space));
    p.doc.sources.snapshot = gov.source || sourceRecord({ name: 'Snapshot', label: 'Governance proposals', page: 'https://snapshot.org', res: { ok: false, error: 'No Snapshot space found for this protocol' } });
    p.doc.governance = p.spaces.length
      ? { spaces: p.spaces, proposals: props, src: 'snapshot', ...(gov.source?.ok ? {} : { unavailable: gov.source?.error }) }
      : { spaces: [], proposals: [], src: 'snapshot', unavailable: 'No Snapshot space found in DefiLlama or CoinGecko data for this protocol (it may vote on-chain or elsewhere)' };
  }

  // 6. Feeds (protocol blogs/forums + crypto news) ----------------------------
  console.log('\n== Feeds');
  const watchMeta = protocols.filter((p) => p.entry.group === 'watchlist').map((p) => ({ slug: p.doc.slug, name: p.entry.name, symbol: p.entry.symbol || p.doc.symbol, keywords: p.entry.keywords }));
  const feedJobs = [
    ...protocols.flatMap((p) => (p.entry.feeds || []).map((f) => ({ ...f, owner: p.doc.slug }))),
    ...(watchlist.newsFeeds || []).map((f) => ({ ...f, type: 'news' })),
  ];
  const feedResults = await mapLimit(feedJobs, 4, async (f) => ({ f, ...(await fetchFeed(http, f)) }));
  const catSources = {};
  let feedItemsAll = [];
  for (const { f, items, source } of feedResults) {
    const key = `feed-${slugify(f.name)}`;
    catSources[key] = source;
    if (!source.ok) problem('warn', `Feed "${f.name}" failed (${source.error})`, `Check or remove its URL in watchlist.json: ${f.url}`);
    feedItemsAll.push(...feedItems({ items, feed: f, srcKey: key, protocols: watchMeta, ownerSlug: f.owner || null, maxAgeDays: f.type === 'news' ? 21 : 45 }));
  }
  // de-duplicate by URL
  const seen = new Set();
  feedItemsAll = feedItemsAll.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));

  // 7. Unlocks (only if DefiLlama's emissions endpoint answers on the free host) ---
  const unlockNote = raw.emissions.ok
    ? null
    : `Unlock schedules unavailable: DefiLlama serves them only on its paid Pro API, and no free keyless source was found (${raw.emissions.error}).`;
  const unlockItems = [];
  if (raw.emissions.ok && Array.isArray(raw.emissions.data)) {
    for (const p of protocols) {
      const gid = p.token?.id;
      const e = raw.emissions.data.find((x) => (gid && (x.gecko_id === gid || x.token === `coingecko:${gid}`)) || String(x.name || '').toLowerCase() === p.entry.name.toLowerCase());
      if (!e) continue;
      const evs = (e.events || [])
        .filter((ev) => Number(ev.timestamp) * 1000 > Date.now() && Number(ev.timestamp) * 1000 < Date.now() + 365 * 86400e3)
        .slice(0, 12)
        .map((ev) => ({
          ts: Number(ev.timestamp),
          tokens: Array.isArray(ev.noOfTokens) ? ev.noOfTokens.reduce((s, v) => s + (Number(v) || 0), 0) : num(ev.noOfTokens),
          description: ev.description || null,
          category: ev.category || null,
        }));
      p.doc.unlocks = { list: evs, src: 'dl-emissions' };
      p.doc.sources['dl-emissions'] = sourceRecord({ name: 'DefiLlama', label: 'Token unlocks', page: `${DL.site}/unlocks`, res: raw.emissions });
      for (const ev of evs) {
        unlockItems.push({
          id: `unlock-${p.doc.slug}-${ev.ts}`,
          date: new Date(ev.ts * 1000).toISOString(),
          type: 'unlock',
          status: 'upcoming',
          protocols: [p.doc.slug],
          symbols: [p.entry.symbol].filter(Boolean),
          title: `${p.entry.symbol || p.entry.name} unlock: ${roundSmart(ev.tokens)?.toLocaleString('en-US')} tokens${ev.category ? ` (${ev.category})` : ''}`,
          summary: ev.description || '',
          url: `${DL.site}/unlocks/${p.doc.slug}`,
          sourceName: 'DefiLlama',
          src: 'dl-emissions',
          tokens: ev.tokens,
        });
      }
    }
    catSources['dl-emissions'] = sourceRecord({ name: 'DefiLlama', label: 'Token unlocks', page: `${DL.site}/unlocks`, res: raw.emissions });
  } else {
    for (const p of protocols) {
      p.doc.unlocks = { unavailable: unlockNote, src: 'dl-emissions' };
      p.doc.sources['dl-emissions'] = sourceRecord({ name: 'DefiLlama', label: 'Token unlocks', page: `${DL.site}/unlocks`, res: raw.emissions, note: 'Pro-only endpoint' });
    }
  }

  // 8. Derived ratios + per-protocol news ------------------------------------
  for (const p of protocols) {
    const doc = p.doc;
    const t = p.token;
    if (t) {
      doc.token = { id: t.id, symbol: t.symbol, name: t.name, market: t.market || null, supply: t.supply || null, unavailable: t.unavailable || null };
      doc.tokenSeries = t.series || null;
      for (const [k, v] of Object.entries(t.sources)) if (k.startsWith('cg-') || k.startsWith('dl-coin')) doc.sources[k] = v;
    } else {
      doc.token = { unavailable: 'No token configured for this protocol' };
    }
    const fees30 = num(doc.fees?.total30d);
    const rev30 = num(doc.revenue?.total30d);
    const mcap = num(t?.market?.marketCap);
    const fdv = num(t?.market?.fdv);
    const tvl = num(doc.tvl?.value);
    const annual = (x) => (x != null ? (x * 365) / 30 : null);
    const ratio = (a, b) => (a != null && b != null && b > 0 ? roundSmart(a / b) : null);
    doc.derived = {
      annualizedFees: { value: roundSmart(annual(fees30)), src: 'calc-annual-fees' },
      annualizedRevenue: { value: roundSmart(annual(rev30)), src: 'calc-annual-revenue' },
      mcapToFees: { value: ratio(mcap, annual(fees30)), src: 'calc-mcap-fees' },
      mcapToRevenue: { value: ratio(mcap, annual(rev30)), src: 'calc-mcap-revenue' },
      fdvToFees: { value: ratio(fdv, annual(fees30)), src: 'calc-fdv-fees' },
      mcapToTvl: { value: ratio(mcap, tvl), src: 'calc-mcap-tvl' },
      revenueShare: { value: fees30 && rev30 != null ? roundSmart((rev30 / fees30) * 100) : null, src: 'calc-revenue-share' },
    };
    doc.sources['calc-annual-fees'] = derivedRecord({ label: 'Annualized fees', from: ['dl-fees'], formula: 'Last 30 days of fees × 365 ÷ 30' });
    doc.sources['calc-annual-revenue'] = derivedRecord({ label: 'Annualized revenue', from: ['dl-revenue'], formula: 'Last 30 days of revenue × 365 ÷ 30' });
    doc.sources['calc-mcap-fees'] = derivedRecord({ label: 'Market cap ÷ annualized fees', from: ['cg-coin', 'dl-fees'], formula: 'CoinGecko market cap ÷ (30-day fees × 365 ÷ 30)' });
    doc.sources['calc-mcap-revenue'] = derivedRecord({ label: 'Market cap ÷ annualized revenue', from: ['cg-coin', 'dl-revenue'], formula: 'CoinGecko market cap ÷ (30-day revenue × 365 ÷ 30)' });
    doc.sources['calc-fdv-fees'] = derivedRecord({ label: 'Fully diluted value ÷ annualized fees', from: ['cg-coin', 'dl-fees'], formula: 'CoinGecko FDV ÷ (30-day fees × 365 ÷ 30)' });
    doc.sources['calc-mcap-tvl'] = derivedRecord({ label: 'Market cap ÷ TVL', from: ['cg-coin', 'dl-protocol'], formula: 'CoinGecko market cap ÷ DefiLlama TVL' });
    doc.sources['calc-revenue-share'] = derivedRecord({ label: 'Revenue as % of fees', from: ['dl-fees', 'dl-revenue'], formula: '30-day revenue ÷ 30-day fees × 100' });

    doc.news = feedItemsAll
      .filter((i) => i.protocols.includes(doc.slug))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 12);
    for (const i of doc.news) doc.sources[i.src] = catSources[i.src];
  }

  // carry forward per-protocol sections whose sources failed
  for (const p of protocols) {
    const prev = readJSON(join(OUT, 'protocols', `${p.doc.slug}.json`));
    p.doc = carrySections(p.doc, prev, [
      { src: 'dl-protocol', paths: ['about', 'tvl', 'chainTvl', 'tokenBreakdown', 'raises', 'hallmarks'] },
      { src: 'dl-fees', paths: ['fees'] },
      { src: 'dl-revenue', paths: ['revenue'] },
      { src: 'dl-yields', paths: ['yields'] },
      { src: 'snapshot', paths: ['governance'] },
    ]);
  }

  // 9. Catalysts ---------------------------------------------------------------
  const now = Date.now();
  const govItems = gov.proposals.map((x) => {
    const owner = spaceOwner.get(x.space);
    const isOpen = x.state === 'active';
    const isPending = x.state === 'pending';
    const when = isPending ? x.start : x.end;
    const lead = x.leadingChoice ? `Leading: “${x.leadingChoice}” with ${x.leadingShare}% of voting power.` : '';
    const summary = isPending
      ? `Voting opens ${new Date(x.start * 1000).toUTCString().slice(5, 22)} UTC and closes ${new Date(x.end * 1000).toUTCString().slice(5, 22)} UTC.`
      : isOpen
        ? `Voting closes ${new Date(x.end * 1000).toUTCString().slice(5, 22)} UTC. ${lead} ${x.votes ?? 0} votes so far.`
        : `Closed ${new Date(x.end * 1000).toUTCString().slice(5, 16)}. ${x.leadingChoice ? `Result: “${x.leadingChoice}” (${x.leadingShare}%).` : ''} ${x.votes ?? 0} votes.`;
    return {
      id: `snapshot-${x.id}`,
      date: new Date(when * 1000).toISOString(),
      type: 'governance-vote',
      status: isOpen ? 'open' : isPending ? 'upcoming' : 'closed',
      protocols: owner ? [owner.doc.slug] : [],
      symbols: owner ? [owner.entry.symbol].filter(Boolean) : [],
      group: owner?.entry.group,
      title: x.title,
      summary: summary.trim(),
      url: x.url,
      sourceName: `Snapshot · ${x.spaceName}`,
      src: 'snapshot',
      start: x.start,
      end: x.end,
      votes: x.votes,
    };
  });
  if (gov.source) catSources.snapshot = gov.source;
  const scheduled = protocols.filter((p) => p.entry.group === 'watchlist').flatMap((p) =>
    (p.doc.hallmarks?.list || [])
      .filter((h) => h.ts * 1000 > now)
      .map((h) => ({
        id: `hallmark-${p.doc.slug}-${h.ts}`,
        date: new Date(h.ts * 1000).toISOString(),
        type: 'scheduled',
        status: 'upcoming',
        protocols: [p.doc.slug],
        symbols: [p.entry.symbol].filter(Boolean),
        title: h.text,
        summary: 'Listed as a future date on DefiLlama’s protocol timeline.',
        url: `${DL.site}/protocol/${p.doc.slug}`,
        sourceName: 'DefiLlama timeline',
        src: 'dl-hallmarks',
      }))
  );
  if (scheduled.length) catSources['dl-hallmarks'] = sourceRecord({ name: 'DefiLlama', label: 'Protocol timeline notes', page: `${DL.site}/`, res: raw.protocols });

  const watchSet = new Set(watchMeta.map((w) => w.slug));
  const catalystItems = [...govItems.filter((g) => g.group !== 'peer'), ...unlockItems, ...scheduled, ...feedItemsAll.filter((i) => i.protocols.some((s) => watchSet.has(s)))]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const headlines = feedItemsAll
    .filter((i) => i.baseType === 'news' && (i.defi || i.protocols.length))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 30);
  const catalysts = {
    generatedAt: new Date().toISOString(),
    items: catalystItems,
    headlines,
    unavailable: unlockNote ? [{ type: 'unlock', reason: unlockNote }] : [],
    protocols: watchMeta.map(({ slug, name, symbol }) => ({ slug, name, symbol })),
    sources: catSources,
    disclaimer: 'Information, not predictions. Each item links to its original source; dates and labels come from that source or from simple keyword rules described on the page.',
  };

  // 10. Index (nav, search, watchlist strip) ----------------------------------
  const index = {
    generatedAt: new Date().toISOString(),
    protocols: protocols.map(({ entry, doc, token }) => ({
      slug: doc.slug,
      name: entry.name,
      symbol: entry.symbol || doc.symbol || null,
      group: entry.group,
      tokenId: token?.id || null,
      category: doc.about?.category || null,
      chains: doc.about?.chains || [],
      logo: doc.about?.logo || null,
      tvl: doc.tvl?.value ?? null,
      tvlChange1d: doc.tvl?.change1d ?? null,
      tvlChange7d: doc.tvl?.change7d ?? null,
      tvlChange30d: doc.tvl?.change30d ?? null,
      tvlSpark: doc.tvl?.series ? doc.tvl.series.slice(-30).map((p) => p[1]) : [],
      fees30d: doc.fees?.total30d ?? null,
      revenue30d: doc.revenue?.total30d ?? null,
      price: token?.market?.price ?? null,
      priceChange24h: token?.market?.change24h ?? null,
      priceChange7d: token?.market?.change7d ?? null,
      mcap: token?.market?.marketCap ?? null,
      priceSpark: token?.market?.sparkline7d || [],
      srcTvl: doc.sources['dl-protocol'],
      srcPrice: token ? token.sources[token.market?.src] || token.sources['cg-coin'] : null,
    })),
  };

  // 11. Write everything ---------------------------------------------------
  console.log('\n== Writing files');
  const keepProtocols = new Set();
  for (const p of protocols) {
    writeJSON(join(OUT, 'protocols', `${p.doc.slug}.json`), p.doc);
    keepProtocols.add(`${p.doc.slug}.json`);
  }
  const keepTokens = new Set();
  for (const t of tokens) {
    writeJSON(join(OUT, 'tokens', `${t.id}.json`), t);
    keepTokens.add(`${t.id}.json`);
  }
  // remove files for protocols/tokens no longer in the watchlist
  for (const [dir, keep] of [['protocols', keepProtocols], ['tokens', keepTokens]]) {
    const d = join(OUT, dir);
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.json') && !keep.has(f)) unlinkSync(join(d, f));
  }
  market.generatedAt = new Date().toISOString();
  writeJSON(join(OUT, 'market.json'), market);
  if (screener) writeJSON(join(OUT, 'screener.json'), { generatedAt: new Date().toISOString(), ...screener });
  writeJSON(join(OUT, 'catalysts.json'), catalysts);
  writeJSON(join(OUT, 'index.json'), index);

  const failed = http.requests.filter((r) => !r.ok);
  const run = process.env.GITHUB_RUN_ID
    ? { id: process.env.GITHUB_RUN_ID, url: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, trigger: process.env.GITHUB_EVENT_NAME }
    : { local: true };
  writeJSON(
    join(OUT, 'meta.json'),
    {
      generatedAt: new Date().toISOString(),
      durationSec: Math.round((Date.now() - started) / 1000),
      run,
      counts: { requests: http.requests.length, failed: failed.length, protocols: protocols.length, tokens: tokens.length, catalysts: catalystItems.length },
      problems,
      requests: http.requests,
    },
    true
  );
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s — ${http.requests.length} requests, ${failed.length} failed, ${problems.length} problems noted.`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

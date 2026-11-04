#!/usr/bin/env node
// Opens every source link the dashboard shows and records whether it works.
// Results go to site/data/link-check.json and appear on the site's Sources page.
//
//   node scripts/check-links.mjs
//
// For web pages it also records the page <title>, so you can confirm the link
// lands on the right protocol/token, not just that it returns HTTP 200.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Http } from './lib/http.mjs';
import { stripHtml } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DATA_OUT_DIR || join(ROOT, 'site', 'data');
const MAX_LINKS = Number(process.env.MAX_LINKS || 1500);

// Sites that refuse automated checks; we list them as "not checked automatically".
const SKIP_HOSTS = [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/, /(^|\.)t\.me$/, /(^|\.)discord\.(gg|com)$/, /(^|\.)linkedin\.com$/];

const readJSON = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** Walk any JSON value and collect URL strings with a short description of where they were found. */
function collect(value, where, out) {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) && !value.includes('{') && !value.includes(' ')) {
      if (!out.has(value)) out.set(value, new Set());
      out.get(value).add(where);
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((v) => collect(v, where, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'series' || k === 'history' || k === 'sparkline7d' || k === 'tvlSpark' || k === 'priceSpark' || k === 'requests' || k === 'logo' || k === 'image') continue;
      collect(v, where, out);
    }
  }
}

async function main() {
  const files = ['market.json', 'catalysts.json', 'index.json', 'screener.json', 'coins.json', 'predictions.json'].map((f) => [f, join(OUT, f)]);
  for (const dir of ['protocols', 'tokens']) {
    const d = join(OUT, dir);
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.json')) files.push([`${dir}/${f}`, join(d, f)]);
  }
  const urls = new Map();
  for (const [name, path] of files) {
    const data = readJSON(path);
    if (!data) continue;
    // the screener has 600 rows; its links follow one pattern, so sample the first 25
    if (name === 'screener.json') data.rows = (data.rows || []).slice(0, 25);
    // ~400 coins whose links follow one CoinGecko pattern: sample them too
    if (name === 'coins.json') data.rows = (data.rows || []).slice(0, 25);
    collect(data, name, urls);
  }
  // API documentation linked from the Sources page (written in the site code, not the data)
  for (const u of ['https://api-docs.defillama.com/', 'https://docs.coingecko.com/docs/keyless-public-api', 'https://docs.dexscreener.com/api/reference', 'https://apiguide.geckoterminal.com/', 'https://docs.snapshot.box/', 'https://docs.polymarket.com/']) {
    if (!urls.has(u)) urls.set(u, new Set(['Sources page (API docs)']));
  }
  // DefiLlama protocol pages for screener rows are built in the browser; check a sample of them too
  const screener = readJSON(join(OUT, 'screener.json'));
  for (const r of (screener?.rows || []).slice(0, 10)) {
    const u = `https://defillama.com/protocol/${r.slug}`;
    if (!urls.has(u)) urls.set(u, new Set(['screener.json (row link)']));
  }

  // API endpoints were already fetched by fetch-data.mjs; reuse those results.
  const meta = readJSON(join(OUT, 'meta.json'));
  const fetched = new Map((meta?.requests || []).map((r) => [r.url, r]));
  // one request per second per site unless configured below; several sites run in parallel
  const http = new Http({ verbose: false, budgetMs: Number(process.env.LINK_BUDGET_MIN || 12) * 60e3, hostDefaults: { minIntervalMs: 1000, concurrency: 1 } });
  const list = [...urls.entries()].slice(0, MAX_LINKS);
  const results = [];
  let i = 0;
  const POOL_CHART = /^https:\/\/yields\.llama\.fi\/chart\//;
  const POOL_CHART_SAMPLE = 6;
  let poolChartChecks = 0;
  // be gentle with each host
  for (const h of ['defillama.com', 'www.coingecko.com', 'www.geckoterminal.com', 'dexscreener.com', 'snapshot.org']) http.configureHost(h, { minIntervalMs: 800, concurrency: 2 });
  http.configureHost('api.coingecko.com', { minIntervalMs: 7000, concurrency: 1 });
  http.configureHost('api.geckoterminal.com', { minIntervalMs: 2500, concurrency: 1 });
  http.configureHost('yields.llama.fi', { minIntervalMs: 5000, concurrency: 1 });
  const workers = Array.from({ length: 8 }, async () => {
    while (i < list.length) {
      const [url, where] = list[i++];
      const host = new URL(url).host;
      if (SKIP_HOSTS.some((re) => re.test(host))) {
        results.push({ url, where: [...where], ok: null, status: null, note: 'Not checked automatically (site blocks bots) — open it by hand' });
        continue;
      }
      if (fetched.has(url)) {
        const f = fetched.get(url);
        // A request that failed during the fetch is the reason the site shows "unavailable"
        // there (e.g. a paid-only endpoint): the link is right, it shows the failure.
        // Rate limits, busy servers and network errors mean "try it by hand", not "broken".
        const expected = !f.ok && f.status >= 400 && f.status < 500 && f.status !== 429;
        results.push({
          url, where: [...where].slice(0, 5), ok: f.ok ? true : null, status: f.status, kind: 'api',
          error: f.ok ? undefined : f.error, checkedAt: f.fetchedAt,
          note: f.ok ? 'Checked during the data fetch'
            : expected ? `Failed during the data fetch (${f.status}), which is why the site shows "unavailable" here`
              : f.status === 429 ? 'Rate-limited during the data fetch — open by hand'
                : `Couldn't be fetched during the data fetch (${String(f.error || f.status).slice(0, 80)}) — open by hand`,
          ...(expected ? { expected: true } : {}),
        });
        continue;
      }
      // DefiLlama's per-pool history endpoint rate-limits after a handful of calls, and every
      // pool's URL follows the same documented pattern, so only a sample is opened.
      if (POOL_CHART.test(url)) {
        if (poolChartChecks >= POOL_CHART_SAMPLE) {
          results.push({ url, where: [...where].slice(0, 5), ok: null, status: null, note: `Not checked one by one: DefiLlama rate-limits this endpoint, so only ${POOL_CHART_SAMPLE} pool histories were opened (listed in this table) — open by hand` });
          continue;
        }
        poolChartChecks += 1;
      }
      if (url.includes('hub.snapshot.org/graphql')) {
        results.push({ url, where: [...where], ok: null, status: null, note: 'GraphQL endpoint (POST only); see Snapshot proposal links instead' });
        continue;
      }
      const r = await http.text(url, { label: 'link check', retries: 1, timeoutMs: 25000, backoffMs: 3000 });
      // Bot protection (e.g. Cloudflare's "Just a moment...") or rate limits mean
      // "couldn't check automatically", not "broken".
      const bodyStart = String(r.data || r.error || '').slice(0, 3000);
      const busy = r.status === 502 || r.status === 503 || r.status === 504;
      if (!r.ok && (r.status === 0 || r.status === 429 || busy || (r.status === 403 && /just a moment|cf-chl|cloudflare|attention required|captcha|access denied|<!DOCTYPE html/i.test(bodyStart)))) {
        const note = r.status === 0 ? `Couldn't connect during the check (${r.error}) — open by hand`
          : r.status === 429 ? 'Rate-limited during the check — open by hand'
          : busy && !/just a moment|cf-chl|cloudflare|captcha/i.test(bodyStart) ? `The site was overloaded or down during the check (HTTP ${r.status}) — open by hand`
          : 'Site blocks automated checks (bot protection) — open by hand';
        results.push({ url, where: [...where].slice(0, 5), ok: null, status: r.status, note, checkedAt: r.fetchedAt });
        process.stdout.write('~');
        continue;
      }
      const isHtml = typeof r.data === 'string' && /<html|<title/i.test(r.data.slice(0, 5000));
      const title = isHtml ? stripHtml((r.data.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').slice(0, 140) : null;
      results.push({
        url,
        where: [...where].slice(0, 5),
        ok: r.ok,
        status: r.status,
        finalUrl: r.finalUrl && r.finalUrl !== url ? r.finalUrl : undefined,
        title: title || undefined,
        kind: isHtml ? 'page' : r.ok ? 'data' : undefined,
        error: r.ok ? undefined : r.error,
        checkedAt: r.fetchedAt,
      });
      process.stdout.write(r.ok ? '.' : 'x');
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => (a.ok === b.ok ? a.url.localeCompare(b.url) : a.ok === false ? -1 : 1));
  const summary = {
    checkedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter((r) => r.ok === true).length,
    broken: results.filter((r) => r.ok === false).length,
    skipped: results.filter((r) => r.ok === null && !r.expected).length,
    expected: results.filter((r) => r.expected).length,
    truncated: urls.size > MAX_LINKS ? urls.size - MAX_LINKS : 0,
  };
  writeFileSync(join(OUT, 'link-check.json'), `${JSON.stringify({ ...summary, results }, null, 1)}\n`);
  // a small file the site loads on every page, so a link that failed the check is marked where it appears
  const broken = results.filter((r) => r.ok === false).map((r) => ({ url: r.url, status: r.status || null }));
  writeFileSync(join(OUT, 'broken-links.json'), `${JSON.stringify({ checkedAt: summary.checkedAt, links: broken }, null, 1)}\n`);
  console.log(`\nLink check: ${summary.ok} ok, ${summary.broken} broken, ${summary.skipped} not checked (of ${summary.total}).`);
  for (const r of results.filter((x) => x.ok === false)) console.log(`  ✗ ${r.status || '---'} ${r.url}  (${r.error})  in ${r.where.join(', ')}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

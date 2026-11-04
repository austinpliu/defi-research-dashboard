// 08 — Sources & data status: what was fetched, when, what failed, and whether links open.
import { h, band, extLink, pageError, unavailable } from '../ui.js';
import { loadMany } from '../data.js';
import { dataTable } from '../table.js';
import { dateTime, relative } from '../format.js';

const API_DOCS = [
  ['DefiLlama', 'TVL, fees, revenue, DEX volume, stablecoins, yields, hacks, chains', 'https://api-docs.defillama.com/'],
  ['CoinGecko', 'Token price, market cap, FDV, volume, supply (keyless public API)', 'https://docs.coingecko.com/docs/keyless-public-api'],
  ['DexScreener', 'DEX pairs and liquidity', 'https://docs.dexscreener.com/api/reference'],
  ['GeckoTerminal', 'DEX pools (fallback)', 'https://apiguide.geckoterminal.com/'],
  ['Snapshot', 'Governance proposals (GraphQL hub)', 'https://docs.snapshot.box/tools/api'],
  ['RSS feeds', 'News sites, protocol blogs (Medium) and governance forums (Discourse)', null],
];

export async function render(root) {
  const files = await loadMany(['meta.json', 'link-check.json']);
  const meta = files['meta.json'].data;
  const links = files['link-check.json'].data;
  if (!meta) { root.append(pageError(files['meta.json'].error)); return; }
  root.append(band({
    n: '08',
    tag: 'Section 08 · Sources',
    title: 'Sources & data status',
    sub: `Last fetched ${dateTime(meta.generatedAt)} (${relative(meta.generatedAt)}) in ${meta.durationSec}s. ${meta.counts.requests - meta.counts.failed} of ${meta.counts.requests} requests succeeded.`,
    chips: meta.run?.url ? [h('a', { class: 'band-chip', href: meta.run.url, target: '_blank', rel: 'noopener' }, 'Open the GitHub Actions run ↗')] : [h('span', { class: 'band-chip' }, 'Fetched by a local run')],
  }));

  const grid = h('div', { class: 'grid' });
  root.append(grid);
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'kicker' }, 'How the data gets here'),
    h('h3', { class: 'takeaway' }, 'A robot fetches everything every 6 hours'),
    h('ol', { style: { paddingLeft: '18px', lineHeight: 1.6, fontSize: '14px' } },
      h('li', {}, 'A scheduled GitHub Action runs ', h('code', {}, 'scripts/fetch-data.mjs'), ' every 6 hours (and whenever you press “Run workflow” or edit the watchlist).'),
      h('li', {}, 'The script calls only free, keyless public APIs and RSS feeds, spacing out requests to respect their rate limits.'),
      h('li', {}, 'It saves the results as JSON files in ', h('code', {}, 'site/data/'), ', recording for every dataset the exact endpoint, a page you can check by hand, and the time it was fetched.'),
      h('li', {}, 'If a source fails, its section shows “unavailable” with the reason. If it worked in the last 48 hours, the previous numbers are shown instead and marked STALE.'),
      h('li', {}, 'The website just reads those files: no server, no database, no keys.'))));
  grid.append(h('section', { class: 'card span-6' },
    h('div', { class: 'kicker' }, 'APIs used'),
    h('h3', { class: 'takeaway' }, 'Free, keyless public sources'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', {}, 'Used for'), h('th', {}, 'Docs'))), h('tbody', {}, API_DOCS.map(([n, u, d]) => h('tr', {}, h('td', { class: 'name' }, n), h('td', { class: 'wrap' }, u), h('td', {}, d ? extLink(d, 'docs') : '—'))))))));

  // problems
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'kicker' }, 'Problems this run'),
    h('h3', { class: 'takeaway' }, meta.problems?.length ? `${meta.problems.length} thing${meta.problems.length === 1 ? '' : 's'} to know about` : 'No problems recorded'),
    meta.problems?.length
      ? h('ul', { class: 'feed' }, meta.problems.map((p) => h('li', {}, h('div', { class: 'when' }, h('span', { class: `chip ${p.severity === 'error' ? 'ink' : ''}` }, p.severity)), h('div', { class: 'what' }, p.message, p.hint ? h('div', { class: 'meta' }, `How to fix: ${p.hint}`) : null))))
      : h('p', { class: 'muted' }, 'Every source answered.')));

  // requests
  const reqRows = meta.requests.map((r) => ({ ...r, host: new URL(r.url).host, status: r.status || (r.skipped ? 'skipped' : 'network error') }));
  grid.append(h('section', { class: 'card span-12' },
    h('div', { class: 'kicker' }, 'Every request'),
    h('h3', { class: 'takeaway' }, `${meta.counts.requests} requests, ${meta.counts.failed} failed`),
    dataTable({
      caption: 'Requests', csvName: 'fetch-requests', sortKey: 'ok', sortDir: 'asc', pageSize: 40,
      filters: [{ key: 'host', label: 'Host' }],
      columns: [
        { key: 'ok', label: 'Result', fmt: (v, r) => h('span', {}, h('span', { class: `status-dot ${v ? 'ok' : 'fail'}` }), v ? 'ok' : 'failed'), sortValue: (r) => (r.ok ? 1 : 0) },
        { key: 'status', label: 'HTTP', num: true },
        { key: 'label', label: 'What', wrap: true },
        { key: 'url', label: 'Endpoint', wrap: true, fmt: (v, r) => (r.method === 'GET' ? extLink(v, v) : `${r.method} ${v}`) },
        { key: 'ms', label: 'Time (ms)', num: true },
        { key: 'bytes', label: 'Size (KB)', num: true, fmt: (v) => (v ? (v / 1024).toFixed(0) : '0'), csv: (r) => r.bytes },
        { key: 'fetchedAt', label: 'Fetched', fmt: (v) => dateTime(v) },
        { key: 'error', label: 'Error', wrap: true, fmt: (v) => v || '' },
      ],
      rows: reqRows,
    })));

  // link check
  if (links) {
    const rows = links.results.map((r) => ({ ...r, state: r.ok === true ? 'opens' : r.ok === false ? 'broken' : 'check by hand', host: new URL(r.url).host, whereText: (r.where || []).join(', ') }));
    grid.append(h('section', { class: 'card span-12' },
      h('div', { class: 'kicker' }, 'Link check'),
      h('h3', { class: 'takeaway' }, `${links.ok} of ${links.total} source links opened automatically; ${links.broken} broken, ${links.skipped} need a manual check`),
      h('p', { class: 'chart-note' }, `Checked ${dateTime(links.checkedAt)}. For web pages the page title is shown, so you can confirm each link lands on the right protocol or token. Sites with bot protection (DefiLlama, CoinGecko, DexScreener and others sometimes) can’t be checked automatically.`),
      dataTable({
        caption: 'Link check', csvName: 'link-check', sortKey: 'state', sortDir: 'asc', pageSize: 40,
        filters: [{ key: 'state', label: 'Result', plural: 'results' }, { key: 'host', label: 'Host' }],
        columns: [
          { key: 'state', label: 'Result', fmt: (v) => h('span', {}, h('span', { class: `status-dot ${v === 'opens' ? 'ok' : v === 'broken' ? 'fail' : 'skip'}` }), v) },
          { key: 'status', label: 'HTTP', num: true },
          { key: 'url', label: 'Link', wrap: true, fmt: (v) => extLink(v, v) },
          { key: 'title', label: 'Page title', wrap: true, fmt: (v, r) => v || r.note || '' },
          { key: 'whereText', label: 'Used in', wrap: true },
        ],
        rows,
      })));
  } else {
    grid.append(h('section', { class: 'card span-12' }, unavailable('Link check not run yet', files['link-check.json'].error)));
  }
}

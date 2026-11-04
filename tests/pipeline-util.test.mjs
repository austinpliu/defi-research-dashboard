import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundSmart, pctChange, normSeries, dailySeries, valueDaysAgo, changeOverDays, allTimeHigh,
  sumLastDays, trimDays, firstSentences, mentions, stripHtml, DAY,
} from '../scripts/lib/util.mjs';
import { parseFeed } from '../scripts/lib/rss.mjs';
import { prettyParentName, groupOverview, isChainKey, poolsForProtocol } from '../scripts/lib/defillama.mjs';
import { spacesFromSources, mainQuery, latestQuery } from '../scripts/lib/governance.mjs';
import { carryForward } from '../scripts/lib/sources.mjs';
import { classify } from '../scripts/lib/feeds.mjs';

const series = (vals, start = 1_700_000_000) => vals.map((v, i) => [Math.floor(start / DAY) * DAY + i * DAY, v]);

test('roundSmart keeps sensible precision', () => {
  assert.equal(roundSmart(1234.56), 1235);
  assert.equal(roundSmart(12.3456), 12.35);
  assert.equal(roundSmart(0.000123456), 0.0001235);
  assert.equal(roundSmart(null), null);
  assert.equal(roundSmart('abc'), null);
});

test('pctChange handles missing and zero baselines', () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(null, 100), null);
});

test('normSeries accepts objects, milliseconds and sorts', () => {
  const s = normSeries([{ date: 1700086400, tvl: 2 }, { date: 1700000000, tvl: 1 }], { tsKey: 'date', valKey: 'tvl' });
  assert.deepEqual(s, [[1700000000, 1], [1700086400, 2]]);
  const ms = normSeries([[1700000000000, 5]]);
  assert.deepEqual(ms, [[1700000000, 5]]);
});

test('changeOverDays compares with the point N days earlier', () => {
  const s = series([100, 101, 102, 103, 104, 105, 106, 120]);
  assert.equal(valueDaysAgo(s, 7), 100);
  assert.equal(Math.round(changeOverDays(s, 7)), 20);
  assert.equal(changeOverDays(s, 30), null, 'not enough history → null, never a guess');
});

test('allTimeHigh finds the record and its date', () => {
  const s = series([1, 5, 3]);
  assert.deepEqual(allTimeHigh(s), { value: 5, ts: s[1][0] });
});

test('sumLastDays and offsets', () => {
  const s = series([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]);
  assert.equal(sumLastDays(s, 7), 14);
  assert.equal(sumLastDays(s, 7, 7), 7);
});

test('dailySeries keeps the last point of each day', () => {
  const d = Math.floor(1700000000 / DAY) * DAY;
  assert.deepEqual(dailySeries([[d + 10, 1], [d + 20, 2], [d + DAY + 5, 3]]), [[d, 2], [d + DAY, 3]]);
});

test('trimDays keeps the most recent window', () => {
  const s = series([1, 2, 3, 4, 5]);
  assert.equal(trimDays(s, 2).length, 3);
});

test('firstSentences returns at most n sentences, without HTML', () => {
  assert.equal(firstSentences('<p>One. Two! Three?</p>', 2), 'One. Two!');
  assert.equal(firstSentences('', 2), '');
});

test('mentions: tickers are case-sensitive words, names are not', () => {
  assert.ok(mentions('HYPE rallies after Hyperliquid upgrade', ['HYPE']));
  assert.ok(!mentions('The hype around memecoins', ['HYPE']));
  assert.ok(mentions('aave governance passes', ['Aave']));
  assert.ok(!mentions('Skyrocketing yields', ['SKY']));
  assert.ok(!mentions('Pendleton news', ['Pendle']));
});

test('stripHtml decodes entities and drops tags', () => {
  assert.equal(stripHtml('<b>A &amp; B</b>&nbsp;&#8217;s'), 'A & B ’s');
});

test('parseFeed reads RSS and Atom', () => {
  const rss = '<rss><channel><title>T</title><item><title><![CDATA[Hello]]></title><link>https://a.com/1</link><pubDate>Tue, 04 Nov 2025 10:00:00 GMT</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss>';
  const r = parseFeed(rss);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].title, 'Hello');
  assert.equal(r.items[0].date, '2025-11-04T10:00:00.000Z');
  const atom = '<feed><title>F</title><entry><title>E</title><link rel="alternate" href="https://b.com/2"/><updated>2025-11-04T10:00:00Z</updated></entry></feed>';
  const a = parseFeed(atom);
  assert.equal(a.items[0].link, 'https://b.com/2');
  assert.throws(() => parseFeed('<html>not a feed</html>'));
});

test('prettyParentName uses shared leading words', () => {
  assert.equal(prettyParentName({ children: ['Aave V2', 'Aave V3'], slug: 'aave' }), 'Aave');
  assert.equal(prettyParentName({ children: ['Sky Lending', 'Sky Savings'], slug: 'sky' }), 'Sky');
  assert.equal(prettyParentName({ children: ['Uniswap V3'], slug: 'uniswap' }), 'Uniswap');
  assert.equal(prettyParentName({ children: ['Foo', 'Bar'], slug: 'foo-bar' }), 'Foo Bar');
});

test('groupOverview aggregates children and drops chains', () => {
  const g = groupOverview([
    { name: 'Aave V3', defillamaId: '1', parentProtocol: 'parent#aave', total30d: 10, total60dto30d: 5, category: 'Lending' },
    { name: 'Aave V2', defillamaId: '2', parentProtocol: 'parent#aave', total30d: 5, total60dto30d: 5, category: 'Lending' },
    { name: 'Ethereum', defillamaId: '9', category: 'Chain', total30d: 999 },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].name, 'Aave');
  assert.equal(g[0].total30d, 15);
  assert.equal(g[0].change30dOver30d, 50);
});

test('isChainKey filters DefiLlama extra TVL buckets', () => {
  assert.ok(isChainKey('Ethereum'));
  assert.ok(!isChainKey('borrowed'));
  assert.ok(!isChainKey('Ethereum-borrowed'));
});

test('spacesFromSources reads DefiLlama ids and CoinGecko URLs', () => {
  assert.deepEqual(spacesFromSources({ governanceID: ['snapshot:aave.eth', 'eip155:1:0xabc'] }), ['aave.eth']);
  assert.deepEqual(spacesFromSources({ snapshotUrl: 'https://snapshot.box/#/s:pendle.eth' }), ['pendle.eth']);
  assert.deepEqual(spacesFromSources({ snapshotUrl: 'https://snapshot.org/#/ens.eth/' }), ['ens.eth']);
});

test('Snapshot queries stay within the hub limit of 5 top-level selections', () => {
  const roots = (q) => (q.match(/^\s{2}\w+: (proposals|spaces)\(/gm) || []).length + (q.match(/^\s{2}spaces\(/gm) || []).length;
  assert.ok(roots(mainQuery('id', true)) <= 5);
  assert.equal(roots(latestQuery('id', 5)), 5);
});

test('carryForward reuses recent data, marks it stale, and gives up after 48h', () => {
  const fresh = { ok: false, error: 'HTTP 429', fetchedAt: new Date().toISOString() };
  const recent = { ok: true, fetchedAt: new Date(Date.now() - 3 * 36e5).toISOString() };
  const r = carryForward({ freshData: null, freshSource: fresh, prevData: { x: 1 }, prevSource: recent });
  assert.deepEqual(r.data, { x: 1 });
  assert.equal(r.source.stale.reason, 'HTTP 429');
  const old = { ok: true, fetchedAt: new Date(Date.now() - 72 * 36e5).toISOString() };
  const r2 = carryForward({ freshData: null, freshSource: fresh, prevData: { x: 1 }, prevSource: old });
  assert.equal(r2.data, null);
  assert.equal(r2.source.error, 'HTTP 429');
});

test('classify labels launches and upgrades by keyword', () => {
  assert.equal(classify('Aave V4 goes live on mainnet', 'news'), 'launch-upgrade');
  assert.equal(classify('Weekly market wrap', 'news'), 'news');
  assert.equal(classify('[ARFC] Risk parameter update', 'governance-forum'), 'governance-forum');
});

test('poolsForProtocol lists pools that pay yield before zero-yield collateral pools', () => {
  const res = { ok: true, data: { data: [
    { pool: 'a', project: 'x', tvlUsd: 100, apy: 0 },
    { pool: 'b', project: 'x', tvlUsd: 10, apy: 3 },
    { pool: 'c', project: 'y', tvlUsd: 1000, apy: 5 },
    { pool: 'd', project: 'x', tvlUsd: 50, apy: null },
  ] } };
  assert.deepEqual(poolsForProtocol(res, new Set(['x'])).map((p) => p.pool), ['b', 'a', 'd']);
});

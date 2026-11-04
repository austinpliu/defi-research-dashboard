// Unit tests for the browser-side logic that doesn't touch the DOM:
// number formatting, takeaway headline rules, series math and CSV output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usd, pct, ratio, compact, date, relative, direction } from '../site/assets/js/format.js';
import {
  trendTakeaway, chainTakeaway, leaderTakeaway, stablecoinTakeaway, moversTakeaway, flowTakeaway, revenueTakeaway,
  valuationTakeaway, supplyTakeaway, liquidityTakeaway, yieldTakeaway, compareTakeaway, catalystTakeaway, priceTakeaway, seriesChange,
} from '../site/assets/js/takeaways.js';
import { trimDays, indexTo100, weeklySum, rollingSum, monthlyLast, valueAt, changeOver } from '../site/assets/js/series.js';
import { toCSV } from '../site/assets/js/export.js';

const DAY = 86400;
const T0 = 1_760_000_000 - (1_760_000_000 % DAY);
const days = (vals) => vals.map((v, i) => [T0 + i * DAY, v]);
const text = (t) => (t ? `${t.pre}${t.hl}${t.post}` : null);

test('usd formats compactly with sensible precision', () => {
  assert.equal(usd(1.234e12), '$1.23T');
  assert.equal(usd(94.2e9), '$94.2B');
  assert.equal(usd(177.4e9), '$177B');
  assert.equal(usd(512e6), '$512M');
  assert.equal(usd(12_400), '$12.4K');
  assert.equal(usd(950), '$950');
  assert.equal(usd(1.5), '$1.50');
  assert.equal(usd(0.06635), '$0.06635');
  assert.equal(usd(-2e9), '−$2.0B');
  assert.equal(usd(null), '—');
  assert.equal(usd(NaN), '—');
});

test('pct, ratio, compact, direction', () => {
  assert.equal(pct(2.345), '+2.3%');
  assert.equal(pct(-12.36), '−12.4%');
  assert.equal(pct(150), '+150%');
  assert.equal(pct(5, { signed: false }), '5.0%');
  assert.equal(ratio(4.337), '4.34×');
  assert.equal(ratio(33.2), '33.2×');
  assert.equal(compact(15_440_000), '15.4M');
  assert.equal(direction(0.01), 'flat');
  assert.equal(direction(-3), 'down');
});

test('dates are UTC and relative times read naturally', () => {
  assert.equal(date('2026-11-04T08:54:00Z'), '4 Nov 2026');
  const now = Date.parse('2026-11-04T12:00:00Z');
  assert.equal(relative('2026-11-04T09:00:00Z', now), '3h ago');
  assert.equal(relative('2026-11-06T12:00:00Z', now), 'in 2 days');
});

test('trendTakeaway: record high beats everything else', () => {
  const s = days([...Array(100).fill(50), 60, 70, 80, 100]);
  assert.match(text(trendTakeaway('TVL', s)), /record high/);
});

test('trendTakeaway: a big 30-day move is reported with its size', () => {
  const s = days([...Array(100).fill(100), ...Array(29).fill(80)]);
  const t = trendTakeaway('DeFi TVL', s);
  assert.equal(t.hl, 'fell 20.0% in 30 days');
});

test('trendTakeaway: deep drawdown from an old peak', () => {
  const s = days([200, ...Array(400).fill(50)]);
  assert.match(text(trendTakeaway('TVL', s)), /75% below its peak/);
});

test('trendTakeaway returns null without data (card shows a plain title)', () => {
  assert.equal(trendTakeaway('TVL', []), null);
});

test('chainTakeaway: majority share, or the fastest grower', () => {
  assert.match(text(chainTakeaway([{ name: 'Ethereum', share: 54, change30d: -3 }, { name: 'Base', share: 7, change30d: 2 }])), /more than half/);
  assert.match(text(chainTakeaway([{ name: 'Ethereum', share: 54, change30d: -3 }, { name: 'Base', share: 7, change30d: 22 }])), /Base is the fastest-growing/);
});

test('leaderTakeaway: multiple or plain lead, with a scope', () => {
  const t = leaderTakeaway([{ name: 'A', total30d: 300 }, { name: 'B', total30d: 100 }], { metric: 'fees', scope: 'tracked protocol' });
  assert.equal(text(t), 'A earned 3.00x more fees than any other tracked protocol over the last 30 days');
  assert.match(text(leaderTakeaway([{ name: 'A', total30d: 110 }, { name: 'B', total30d: 100 }])), /led all protocols/);
});

test('stablecoinTakeaway: concentration of the top two', () => {
  const t = stablecoinTakeaway(days([1, 2, 3, 2]), { top: [{ symbol: 'USDT', name: 'Tether', share: 60 }, { symbol: 'USDC', name: 'USD Coin', share: 24 }] });
  assert.equal(text(t), 'USDT and USDC make up 84% of all stablecoins');
});

test('moversTakeaway picks the bigger absolute move', () => {
  const mv = { minTvl: 100e6, gainers: [{ name: 'Up', change7d: 20 }], losers: [{ name: 'Down', change7d: -64 }] };
  assert.match(text(moversTakeaway(mv)), /^Down TVL fell 64% this week/);
});

test('flowTakeaway: week-over-week change when large, else 7-day total', () => {
  assert.equal(flowTakeaway('DEX volume', { value: 1, change7d: 24.8 }).hl, 'jumped 25% week over week');
  assert.match(text(flowTakeaway('DEX volume', { value: 1, change7d: 2, total7d: 5e10 })), /\$50.0B in the last 7 days/);
});

test('revenueTakeaway: zero revenue is stated as such, not as "keeps 0%"', () => {
  assert.equal(revenueTakeaway('X', { total30d: 100 }, { total30d: 0 }).hl, 'no protocol revenue');
  assert.equal(revenueTakeaway('X', { total30d: 100 }, { total30d: 13 }).hl, '13% of its fees');
});

test('valuationTakeaway ranks against the other tracked protocols', () => {
  const others = [{ value: 10 }, { value: 20 }];
  assert.match(text(valuationTakeaway('AAA', 4, others)), /lowest multiple of the 3 protocols/);
  assert.match(text(valuationTakeaway('AAA', 40, others)), /highest multiple/);
  assert.equal(text(valuationTakeaway('AAA', 15, others)), 'AAA trades at 15.0× annualized fees');
  assert.equal(valuationTakeaway('AAA', null, others), null);
});

test('supply, liquidity, yield and price takeaways', () => {
  assert.match(text(supplyTakeaway('T', { circulatingPctOfMax: 30, basis: 'max' })), /^Only 30% of T's max supply/);
  assert.match(text(liquidityTakeaway('T', { totalLiquidity: 100, pools: [{ liquidity: 80, dex: 'uniswap', name: 'T / ETH' }] })), /one uniswap pool/);
  assert.equal(yieldTakeaway('P', [{ apy: 0, tvl: 1, symbol: 'A', chain: 'E' }]).hl, 'pay almost no yield');
  assert.equal(yieldTakeaway('P', [{ apy: 0, tvl: 9, symbol: 'A', chain: 'E' }, { apy: 4.5, tvl: 1, symbol: 'B', chain: 'E' }]).hl, 'up to 4.5% APY');
  assert.match(text(priceTakeaway('T', { price: 1, athChange: -80, athDate: '2021-05-18T00:00:00Z' })), /80% below its all-time high from May 2021/);
});

test('compareTakeaway names the fastest grower and the biggest loser', () => {
  const t = compareTakeaway([{ name: 'A', change: 69 }, { name: 'B', change: -53 }, { name: 'C', change: 5 }], 'TVL', 'the past year');
  assert.equal(text(t), 'A grew TVL fastest over the past year (+69%), while B shrank 53%');
});

test('catalystTakeaway counts votes closing within 7 days', () => {
  const now = Date.parse('2026-11-04T00:00:00Z');
  const items = [
    { type: 'governance-vote', status: 'open', date: '2026-11-06T00:00:00Z', title: 'a' },
    { type: 'governance-vote', status: 'open', date: '2026-11-08T00:00:00Z', title: 'b' },
    { type: 'news', status: 'past', date: '2026-11-03T00:00:00Z', title: 'c' },
  ];
  assert.equal(catalystTakeaway(items, now).hl, '2 governance votes');
});

test('series helpers', () => {
  const s = days([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(trimDays(s, 2).length, 3);
  assert.deepEqual(indexTo100(days([50, 100]))[1][1], 200);
  assert.equal(rollingSum(days([1, 1, 1, 1]), 3).length, 2);
  assert.equal(rollingSum(days([1, 2, 3]), 3)[0][1], 6);
  assert.equal(valueAt(s, T0 + 3 * DAY), 4);
  assert.equal(Math.round(changeOver(s, 7)), 100);
  assert.equal(seriesChange(s, 7), changeOver(s, 7), 'takeaways and tiles use the same arithmetic');
  const w = weeklySum(days(Array(21).fill(1)));
  assert.ok(w.every(([, v]) => v === 7), 'only complete weeks are kept');
  assert.equal(monthlyLast(days([1, 2, 3])).length >= 1, true);
});

test('toCSV quotes commas, quotes and newlines', () => {
  const csv = toCSV([{ label: 'Name', get: (r) => r.n }, { label: 'Value', get: (r) => r.v }], [{ n: 'A, "B"', v: 1 }, { n: 'line\nbreak', v: null }]);
  assert.equal(csv, 'Name,Value\r\n"A, ""B""",1\r\n"line\nbreak",');
});

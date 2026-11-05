// Unit tests for the Fundamentals Checklist rules (site/assets/js/fundamentals/rules.js):
// threshold validation and fallback, every check (including empty data, zero revenue and ties),
// the watchlist ranking and the overview takeaway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  effectiveThresholds, validateThresholds, evaluate, evaluateAll, overviewTakeaway,
  windowSum, rangeBound, worstRetention, seriesChange, CHECKS,
} from '../site/assets/js/fundamentals/rules.js';

const CONFIG = JSON.parse(readFileSync(new URL('../site/config/fundamentals-thresholds.json', import.meta.url)));
const T = effectiveThresholds(CONFIG).values;
const DAY = 86400;
const NOW = 1_780_000_000 - (1_780_000_000 % DAY);
const daily = (n, v) => Array.from({ length: n }, (_, i) => [NOW - (n - 1 - i) * DAY, typeof v === 'function' ? v(i) : v]);
const YEAR = 365.25 * DAY;

/** A protocol with every input present; override pieces per test. */
function proto(over = {}) {
  return {
    slug: 'demo', name: 'Demo', symbol: 'DMO', tokenId: 'demo-token',
    revenue: { daily: daily(400, 100_000), src: 'dl-revenue' },
    holdersRevenue: { daily: daily(400, 60_000), src: 'dl-holders-revenue' },
    incentives: { unavailable: 'paid only', src: 'dl-emissions' },
    tvl: { value: 1e9, ath: { value: 1.2e9, ts: NOW - YEAR }, firstTs: NOW - 5 * YEAR, monthly: [[NOW - 4 * YEAR, 5e8], [NOW - 3 * YEAR, 1e9], [NOW - 2 * YEAR, 6e8], [NOW, 1e9]], src: 'dl-protocol' },
    hacks: { list: [], src: 'dl-hacks' },
    market: { price: 1, marketCap: 500_000_000, fdv: 520_000_000, volume24h: 20_000_000, src: 'cg-coin' },
    supply: { circulating: 9.5e8, total: 1e9, max: 1e9, src: 'cg-coin-supply' },
    dex: { liquidity: 15_000_000, volume24h: 5e6, pools: 4, src: 'dex' },
    priceDaily: daily(365, 1),
    seriesSrc: 'cg-chart',
    priceWeekly: Array.from({ length: 100 }, (_, i) => [NOW - (99 - i) * 7 * DAY, 1 + (i % 2) * 0.5]),
    priceWeeklySrc: 'dl-price-weekly',
    unlocks: { status: 'confirmed', next12mTokens: 1e7, next12mUnknown: 0, src: 'manual-unlocks' },
    ...over,
  };
}
const run = (p, ctx = {}, t = T) => evaluate(p, t, { now: NOW, ...ctx });

// ---------- thresholds ----------
test('defaults load with no errors and nothing marked changed', () => {
  const r = effectiveThresholds(CONFIG, {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.changed, []);
  assert.equal(r.values['holders.shareStrong'], 50);
  for (const o of CONFIG.order) {
    const s = r.values[o.strong]; const w = r.values[o.weak];
    assert.ok(o.better === 'higher' ? s > w : s < w, `default order ${o.strong} vs ${o.weak}`);
  }
});

test('a valid override applies and is marked changed; numeric strings are accepted', () => {
  const r = effectiveThresholds(CONFIG, { 'size.peStrong': '30', 'holders.minAnnual': 5e6 });
  assert.equal(r.values['size.peStrong'], 30);
  assert.equal(r.values['holders.minAnnual'], 5e6);
  assert.deepEqual(r.changed.sort(), ['holders.minAnnual', 'size.peStrong']);
  assert.deepEqual(r.errors, []);
});

test('negative, non-numeric and out-of-bounds values fall back to the default with a message', () => {
  const r = effectiveThresholds(CONFIG, { 'size.peStrong': -5, 'holders.shareWeak': 'abc', 'holders.shareStrong': 150, 'supply.rangeBand': 1 });
  assert.equal(r.values['size.peStrong'], 25);
  assert.equal(r.values['holders.shareWeak'], 10);
  assert.equal(r.values['holders.shareStrong'], 50);
  assert.equal(r.values['supply.rangeBand'], 2);
  assert.equal(r.errors.length, 4);
  assert.match(r.errors.find((e) => e.key === 'size.peStrong').message, /negative.*default \(25\)/);
  assert.match(r.errors.find((e) => e.key === 'holders.shareStrong').message, /at most 100/);
  assert.deepEqual(r.changed, []);
});

test('a strong cutoff weaker than the weak one is rejected and both fall back', () => {
  const higher = effectiveThresholds(CONFIG, { 'holders.shareStrong': 5, 'holders.shareWeak': 20 });
  assert.equal(higher.values['holders.shareStrong'], 50);
  assert.equal(higher.values['holders.shareWeak'], 10);
  assert.match(higher.errors[0].message, /must be higher than/);
  const lower = effectiveThresholds(CONFIG, { 'size.peStrong': 200 }); // strong P/E above the weak 100
  assert.equal(lower.values['size.peStrong'], 25);
  assert.match(lower.errors[0].message, /must be lower than/);
  const equal = validateThresholds(CONFIG, { 'track.ageStrong': 1 }); // equal to the weak 1: no gap, rejected
  assert.equal(equal.length, 1);
});

test('unknown keys, an empty or missing override set, and a missing config never throw', () => {
  assert.deepEqual(effectiveThresholds(CONFIG, { 'old.key': 3 }).errors, []);
  assert.deepEqual(effectiveThresholds(CONFIG, null).errors, []);
  assert.deepEqual(effectiveThresholds(null, { a: 1 }), { values: {}, errors: [], changed: [] });
});

// ---------- series helpers ----------
test('windowSum needs every day of the window', () => {
  assert.equal(windowSum(daily(30, 1), 30), 30);
  assert.equal(windowSum(daily(29, 1), 30), null);
  assert.equal(windowSum(daily(90, 1), 30, 60), 30);
  assert.equal(windowSum([], 30), null);
  assert.equal(windowSum(undefined, 30), null);
});

test('rangeBound finds the stretch ending now within the band', () => {
  const w = [[0, 10], [7 * DAY, 1], [14 * DAY, 1.5], [21 * DAY, 1.9], [28 * DAY, 1.2]];
  const r = rangeBound(w, 2);
  assert.equal(r.since, 7 * DAY); // the 10 breaks the 2× band
  assert.equal(r.low, 1);
  assert.equal(r.high, 1.9);
  assert.equal(r.wholeHistory, false);
  assert.equal(rangeBound(w, 20).wholeHistory, true);
  assert.equal(rangeBound([], 2), null);
  assert.equal(rangeBound(w, 1), null);
});

test('worstRetention measures the deepest fall from a running peak', () => {
  assert.deepEqual(worstRetention([[1, 10], [2, 5], [3, 20], [4, 4], [5, 30]]).ratio, 0.2);
  assert.equal(worstRetention([[1, 1], [2, 2], [3, 3]]), null); // never fell
  assert.equal(worstRetention([]), null);
});

test('seriesChange needs enough history', () => {
  assert.equal(Math.round(seriesChange(daily(100, (i) => (i <= 9 ? 1 : 2)), 90)), 100);
  assert.equal(seriesChange(daily(30, 1), 90), null);
  assert.equal(seriesChange([], 30), null);
});

// ---------- 1. revenue to holders ----------
test('holders: 60% share and $22M a year is strong; numbers carry sources', () => {
  const c = run(proto()).holders;
  assert.equal(c.status, 'strong');
  assert.equal(Math.round(c.share), 60);
  assert.ok(c.numbers.every((n) => 'src' in n));
  assert.equal(c.numbers.find((n) => n.label.startsWith('Holders revenue, 30')).value, 1_800_000);
  assert.equal(c.numbers.find((n) => n.label.includes('incentives')).value, 'no data');
});
test('holders: zero revenue is weak; zero holders revenue is weak; low share is weak', () => {
  assert.equal(run(proto({ revenue: { daily: daily(400, 0) }, holdersRevenue: { daily: daily(400, 0) } })).holders.status, 'weak');
  assert.equal(run(proto({ holdersRevenue: { daily: daily(400, 0) } })).holders.status, 'weak');
  assert.equal(run(proto({ holdersRevenue: { daily: daily(400, 5_000) } })).holders.status, 'weak');
});
test('holders: a share between the lines, or a big share of a tiny revenue, is mixed', () => {
  assert.equal(run(proto({ holdersRevenue: { daily: daily(400, 30_000) } })).holders.status, 'mixed');
  const tiny = proto({ revenue: { daily: daily(400, 100) }, holdersRevenue: { daily: daily(400, 90) } });
  assert.equal(run(tiny).holders.status, 'mixed');
});
test('holders: missing data is “no data” with the reason, never an estimate', () => {
  const c = run(proto({ holdersRevenue: { daily: [], unavailable: 'HTTP 400' } })).holders;
  assert.equal(c.status, 'nodata');
  assert.match(c.why, /HTTP 400/);
  assert.equal(c.numbers.find((n) => n.label.startsWith('Holders revenue, 30')).value, null);
  assert.equal(run(proto({ revenue: { daily: [], unavailable: 'down' } })).holders.status, 'nodata');
  assert.equal(run({}).holders.status, 'nodata');
});
test('holders: the 90-day trend compares the last 30 days with 60–90 days ago', () => {
  const growing = proto({ holdersRevenue: { daily: daily(400, (i) => (i >= 370 ? 60_000 : 30_000)) } });
  const c = run(growing).holders;
  assert.equal(Math.round(c.numbers.find((n) => n.label.includes('trend')).value), 100);
});

// ---------- 2. revenue vs size ----------
test('size: market cap ÷ revenue picks the status; zero revenue is weak; no market cap is no data', () => {
  assert.equal(run(proto()).size.status, 'strong'); // 500M / 36.5M ≈ 13.7×
  assert.equal(run(proto({ market: { marketCap: 2e9 } })).size.status, 'mixed'); // ≈ 55×
  assert.equal(run(proto({ market: { marketCap: 5e9 } })).size.status, 'weak'); // ≈ 137×
  assert.equal(run(proto({ revenue: { daily: daily(400, 0) } })).size.status, 'weak');
  assert.equal(run(proto({ market: { unavailable: 'No token' } })).size.status, 'nodata');
  assert.equal(run(proto({ revenue: { daily: [] } })).size.status, 'nodata');
});
test('size: exactly at a cutoff counts as reaching it', () => {
  const at = proto({ market: { marketCap: 25 * 36_500_000 } });
  assert.equal(run(at).size.status, 'strong');
  const weak = proto({ market: { marketCap: 100 * 36_500_000 } });
  assert.equal(run(weak).size.status, 'weak');
});
test('evaluateAll ranks on market cap ÷ revenue; ties share a rank; no-revenue rows are unranked', () => {
  const rows = evaluateAll([
    proto({ slug: 'a', market: { marketCap: 1e9 } }),
    proto({ slug: 'b', market: { marketCap: 5e8 } }),
    proto({ slug: 'c', market: { marketCap: 1e9 } }),
    proto({ slug: 'd', revenue: { daily: daily(400, 0) } }),
  ], T, { now: NOW });
  const rank = Object.fromEntries(rows.map((r) => [r.p.slug, r.checks.size.rank]));
  assert.deepEqual(rank, { a: 2, b: 1, c: 2, d: undefined });
  assert.equal(rows[0].checks.size.of, 3);
  assert.deepEqual(evaluateAll([], T), []);
});

// ---------- 3. value-accrual switch ----------
test('call: big revenue with little to holders is an open option (mixed), confirmed plan is strong', () => {
  const p = proto({ revenue: { daily: daily(400, 200_000) }, holdersRevenue: { daily: daily(400, 0) } });
  assert.equal(run(p).call.status, 'mixed');
  const plan = { protocol: 'demo', what: 'Fee switch vote passed', source: 'https://example.org/vote', lastChecked: '2026-11-01' };
  const c = run(p, { valueAccrual: [plan] }).call;
  assert.equal(c.status, 'strong');
  assert.ok(c.numbers.some((n) => n.value === 'Fee switch vote passed'));
  assert.equal(run(p, { valueAccrual: [{ ...plan, protocol: 'other' }] }).call.status, 'mixed');
});
test('call: not applicable when value already flows to holders', () => {
  assert.equal(run(proto({ revenue: { daily: daily(400, 200_000) } })).call.status, 'na'); // 30% share
  const atLine = proto({ holdersRevenue: { daily: daily(400, 10_000) } }); // exactly 10%: still “little”
  assert.equal(run(atLine).call.status, 'mixed');
});
test('call: small revenue is not applicable; missing revenue or holders data is no data', () => {
  const small = proto({ revenue: { daily: daily(400, 1_000) }, holdersRevenue: { daily: daily(400, 0) } });
  assert.equal(run(small).call.status, 'na');
  assert.equal(run(proto({ revenue: { daily: [] } })).call.status, 'nodata');
  assert.equal(run(proto({ revenue: { daily: daily(400, 200_000) }, holdersRevenue: { daily: [], unavailable: 'HTTP 400' } })).call.status, 'nodata');
});

// ---------- 4. supply ----------
test('supply: mostly circulating with small unlocks is strong; low circulation or big unlocks weak', () => {
  assert.equal(run(proto()).supply.status, 'strong'); // 95% circulating, unlocks ~1.1%
  assert.equal(run(proto({ supply: { circulating: 4e8, max: 1e9 } })).supply.status, 'weak');
  assert.equal(run(proto({ unlocks: { status: 'confirmed', next12mTokens: 2e8 } })).supply.status, 'weak');
  assert.equal(run(proto({ unlocks: { status: 'confirmed', next12mTokens: 5e7 } })).supply.status, 'mixed');
});
test('supply: unconfirmed unlocks use the max-supply ceiling only when it settles the question', () => {
  const fully = proto({ supply: { circulating: 1e9, max: 1e9 }, unlocks: { status: 'unconfirmed', next12mTokens: null } });
  assert.equal(run(fully).supply.status, 'strong'); // nothing left to unlock
  const open = proto({ supply: { circulating: 9e8, max: 1e9 }, unlocks: { status: 'unconfirmed', next12mTokens: null } });
  const c = run(open).supply;
  assert.equal(c.status, 'mixed');
  assert.match(c.why, /unconfirmed/);
});
test('supply: no max supply and no schedule is no data; no circulating figure is no data', () => {
  assert.equal(run(proto({ supply: { circulating: 1e9, max: null }, unlocks: { status: 'unconfirmed' } })).supply.status, 'nodata');
  assert.equal(run(proto({ supply: {} })).supply.status, 'nodata');
});
test('supply: the range band is context only and reports years in range', () => {
  const c = run(proto()).supply;
  const band = c.numbers.find((n) => n.label.startsWith('Traded within'));
  assert.ok(band.value > 1.8 && band.value < 2);
  const narrow = run(proto(), {}, { ...T, 'supply.rangeBand': 1.2 }).supply;
  assert.equal(narrow.status, c.status);
});

// ---------- 5. liquidity ----------
test('liquidity: thin DEX liquidity is weak; deep and active is strong; between is mixed', () => {
  assert.equal(run(proto()).liquidity.status, 'strong'); // 3% liquidity, 4% volume
  assert.equal(run(proto({ dex: { liquidity: 1e6 } })).liquidity.status, 'weak'); // 0.2%
  assert.equal(run(proto({ dex: { liquidity: 5e6 } })).liquidity.status, 'mixed'); // 1%
  assert.equal(run(proto({ dex: { liquidity: null }, market: { marketCap: 5e8, volume24h: 1e7 } })).liquidity.status, 'mixed');
  assert.equal(run(proto({ dex: {}, market: { marketCap: 5e8 } })).liquidity.status, 'nodata');
  assert.equal(run(proto({ market: {} })).liquidity.status, 'nodata');
});

// ---------- 6. track record ----------
test('track: old and resilient is strong; young, hacked or wiped out is weak', () => {
  assert.equal(run(proto()).track.status, 'strong');
  assert.equal(run(proto({ tvl: { ...proto().tvl, firstTs: NOW - 0.5 * YEAR } })).track.status, 'weak');
  assert.equal(run(proto({ hacks: { list: [{ amount: 5e7, returned: 1e7 }] } })).track.status, 'weak');
  assert.equal(run(proto({ hacks: { list: [{ amount: 5e7, returned: 4.5e7 }] } })).track.status, 'strong'); // $5M net
  assert.equal(run(proto({ tvl: { ...proto().tvl, monthly: [[1, 100], [2, 5], [3, 100]] } })).track.status, 'weak');
  assert.equal(run(proto({ tvl: { ...proto().tvl, firstTs: NOW - 2 * YEAR } })).track.status, 'mixed');
});
test('track: no TVL history is no data; team notes appear as context with their sources', () => {
  assert.equal(run(proto({ tvl: { monthly: [], unavailable: 'none' } })).track.status, 'nodata');
  const c = run(proto(), { teamNotes: [{ protocol: 'demo', text: 'Founded by X', sources: ['https://example.org'] }] }).track;
  assert.ok(c.numbers.some((n) => n.value === 'Founded by X'));
  assert.equal(c.status, 'strong');
});

// ---------- 7. narrative ----------
const rising = (factor) => daily(365, (i) => (i > 274 ? factor : 1));
test('narrative: price far ahead of flat revenue is weak; revenue far ahead of flat price is strong', () => {
  assert.equal(run(proto({ priceDaily: rising(2) })).narrative.status, 'weak'); // price +100, revenue 0
  const revUp = proto({ revenue: { daily: daily(400, (i) => (i >= 310 ? 200_000 : 100_000)) } });
  assert.equal(run(revUp).narrative.status, 'strong'); // revenue +100, price 0
  assert.equal(run(proto()).narrative.status, 'mixed');
});
test('narrative: zero or missing earlier revenue, or short price history, is no data', () => {
  assert.equal(run(proto({ revenue: { daily: daily(400, (i) => (i >= 310 ? 1 : 0)) } })).narrative.status, 'nodata');
  assert.equal(run(proto({ revenue: { daily: daily(100, 1) } })).narrative.status, 'nodata');
  assert.equal(run(proto({ priceDaily: daily(30, 1) })).narrative.status, 'nodata');
});

// ---------- whole-row behaviour ----------
test('empty input gives a status for every check and never throws', () => {
  const r = run({});
  assert.deepEqual(Object.keys(r).sort(), CHECKS.map((c) => c.id).sort());
  for (const c of Object.values(r)) {
    assert.ok(['nodata', 'na', 'weak'].includes(c.status), c.why);
    assert.equal(typeof c.why, 'string');
  }
});

test('takeaway: names the top holders-revenue yield, handles ties and the all-zero case', () => {
  const rows = evaluateAll([
    proto({ slug: 'a', name: 'Alpha' }),
    proto({ slug: 'b', name: 'Beta', market: { marketCap: 1e9 } }),
    proto({ slug: 'c', name: 'Gamma', holdersRevenue: { daily: daily(400, 0) } }),
  ], T, { now: NOW });
  const t = overviewTakeaway(rows);
  assert.equal(t.pre, 'Alpha ');
  assert.match(t.post, /1 of 3 send none/);
  const tie = overviewTakeaway(evaluateAll([proto({ name: 'Alpha' }), proto({ name: 'Beta' })], T, { now: NOW }));
  assert.equal(tie.pre, 'Alpha and Beta ');
  const none = overviewTakeaway(evaluateAll([proto({ holdersRevenue: { daily: daily(400, 0) } })], T, { now: NOW }));
  assert.match(none.hl, /returned revenue to token holders/);
  assert.equal(overviewTakeaway([]), null);
});

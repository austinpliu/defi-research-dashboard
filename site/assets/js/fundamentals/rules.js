// The Fundamentals Checklist rules: pure functions, run in the browser (so threshold edits apply
// instantly) and tested in Node. A research aid, not a rating: statuses describe the data
// against your thresholds; they don't say buy or sell.
// Statuses: 'strong' ✓, 'mixed' ~, 'weak' ✗, 'nodata', and 'na' (doesn't apply).

export const CHECKS = [
  { id: 'holders', n: 1, label: 'Revenue to holders' },
  { id: 'size', n: 2, label: 'Revenue vs size' },
  { id: 'call', n: 3, label: 'Fee-switch option' },
  { id: 'supply', n: 4, label: 'Supply & overhang' },
  { id: 'liquidity', n: 5, label: 'Liquidity & float' },
  { id: 'track', n: 6, label: 'Track record' },
  { id: 'narrative', n: 7, label: 'Narrative vs fundamentals' },
];
export const STATUS = { strong: '✓', mixed: '~', weak: '✗', nodata: 'no data', na: '—' };
const RANK = { strong: 3, mixed: 2, weak: 1, na: 0, nodata: -1 };
export const statusRank = (s) => RANK[s] ?? -1;

const DAY = 86400;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- thresholds: defaults, your overrides, validation ----------
/**
 * Merge your overrides into the defaults. Invalid values (not numbers, out of bounds, or a strong
 * cutoff no stronger than its weak one) fall back to the defaults, with a message for each.
 * Returns { values, errors: [{ key, message }], changed: [keys that differ from the default] }.
 */
export function effectiveThresholds(config, overrides = {}) {
  const meta = config?.thresholds || {};
  const values = {};
  const errors = [];
  for (const [key, m] of Object.entries(meta)) values[key] = m.default;
  for (const [key, raw] of Object.entries(overrides || {})) {
    const m = meta[key];
    if (!m) continue; // a threshold that no longer exists: ignore it
    const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    const problem = !isNum(v) ? 'must be a number'
      : v < 0 ? 'can’t be negative'
        : isNum(m.min) && v < m.min ? `must be at least ${m.min}`
          : isNum(m.max) && v > m.max ? `must be at most ${m.max}` : null;
    if (problem) errors.push({ key, message: `${m.label} ${problem}; using the default (${m.default}).` });
    else values[key] = v;
  }
  for (const o of config?.order || []) {
    const s = values[o.strong];
    const w = values[o.weak];
    if (!isNum(s) || !isNum(w)) continue;
    const bad = o.better === 'higher' ? s <= w : s >= w;
    if (bad) {
      errors.push({ key: o.strong, message: `“${meta[o.strong]?.label}” (${s}) must be ${o.better === 'higher' ? 'higher' : 'lower'} than “${meta[o.weak]?.label}” (${w}); using the defaults for both.` });
      values[o.strong] = meta[o.strong].default;
      values[o.weak] = meta[o.weak].default;
    }
  }
  const changed = Object.keys(meta).filter((k) => values[k] !== meta[k].default);
  return { values, errors, changed };
}

/** Check one proposed set of overrides (for the settings form): only the errors. */
export const validateThresholds = (config, overrides) => effectiveThresholds(config, overrides).errors;

// ---------- series helpers (daily [unixSeconds, value] pairs) ----------
/** Sum of the last `days` days ending `offset` days before the series' last day; null unless every day is present. */
export function windowSum(daily, days, offset = 0) {
  if (!daily?.length) return null;
  const end = daily[daily.length - 1][0] - offset * DAY;
  const start = end - days * DAY;
  const pts = daily.filter(([t]) => t > start && t <= end);
  const uniqueDays = new Set(pts.map(([t]) => Math.floor(t / DAY)));
  if (uniqueDays.size < days) return null;
  return pts.reduce((s, [, v]) => s + (isNum(v) ? v : 0), 0);
}
export function pctChange(now, before) {
  if (!isNum(now) || !isNum(before) || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}
/** % change between the last value and the value `days` earlier (nearest point at or before). */
export function seriesChange(series, days) {
  if (!series?.length) return null;
  const [t1, v1] = series[series.length - 1];
  const target = t1 - days * DAY;
  let v0 = null;
  for (const [t, v] of series) { if (t <= target + DAY / 2) v0 = v; else break; }
  if (series[0][0] > target + 3 * DAY) return null; // not enough history
  return pctChange(v1, v0);
}
/**
 * The longest stretch, ending at the latest week, in which max ÷ min of the weekly price
 * stays at or below `band`. Returns { years, low, high, since } or null.
 */
export function rangeBound(weekly, band) {
  if (!weekly || weekly.length < 2 || !isNum(band) || band <= 1) return null;
  let lo = Infinity;
  let hi = -Infinity;
  let i = weekly.length - 1;
  for (; i >= 0; i -= 1) {
    const v = weekly[i][1];
    const nlo = Math.min(lo, v);
    const nhi = Math.max(hi, v);
    if (nhi / nlo > band) break;
    lo = nlo; hi = nhi;
  }
  const first = weekly[i + 1];
  const last = weekly[weekly.length - 1];
  if (!first || first === last) return { years: 0, low: lo, high: hi, since: last[0], wholeHistory: false };
  return { years: (last[0] - first[0]) / (365.25 * DAY), low: lo, high: hi, since: first[0], wholeHistory: i < 0 };
}
/** Worst drawdown: the lowest value ÷ running peak, over a [ts, value] series. */
export function worstRetention(series) {
  let peak = 0;
  let worst = null;
  for (const [t, v] of series || []) {
    if (!isNum(v)) continue;
    if (v > peak) peak = v;
    else if (peak > 0) { const r = v / peak; if (worst === null || r < worst.ratio) worst = { ratio: r, ts: t, peak }; }
  }
  return worst;
}

// ---------- the checks ----------
const N = (label, value, unit, src, note) => ({ label, value: isNum(value) || typeof value === 'string' ? value : null, unit, src: src || null, ...(note ? { note } : {}) });
const result = (status, why, numbers = [], extra = {}) => ({ status, why, numbers, ...extra });
const annual = (x) => (isNum(x) ? (x * 365) / 30 : null);

function holdersCheck(p, T) {
  const rev30 = windowSum(p.revenue?.daily, 30) ?? (isNum(p.revenue?.total30d) ? p.revenue.total30d : null);
  const hr30 = p.holdersRevenue?.unavailable ? null : windowSum(p.holdersRevenue?.daily, 30) ?? (isNum(p.holdersRevenue?.total30d) ? p.holdersRevenue.total30d : null);
  const months = [0, 30, 60].map((off) => windowSum(p.holdersRevenue?.daily, 30, off)).reverse();
  const trend = months.every(isNum) ? pctChange(months[2], months[0]) : null;
  const share = isNum(hr30) && isNum(rev30) && rev30 > 0 ? (hr30 / rev30) * 100 : null;
  const numbers = [
    N('Holders revenue, 30 days', hr30, 'usd', p.holdersRevenue?.src),
    N('Holders revenue, annualized', annual(hr30), 'usd', p.holdersRevenue?.src, 'last 30 days × 365 ÷ 30'),
    N('Revenue, 30 days', rev30, 'usd', p.revenue?.src),
    N('Holders’ share of revenue', share, 'pct', p.holdersRevenue?.src),
    N('Holders revenue trend (last 30 days vs 60–90 days ago)', trend, 'pctChange', p.holdersRevenue?.src),
    N('Token incentives vs holders revenue', p.incentives?.unavailable ? 'no data' : null, 'text', p.incentives?.src, p.incentives?.unavailable || null),
  ];
  const extra = { months, share, hr30, rev30 };
  if (p.revenue?.unavailable && !isNum(rev30)) return result('nodata', `No revenue data: ${p.revenue.unavailable}`, numbers, extra);
  if (!isNum(rev30)) return result('nodata', 'DefiLlama has no complete 30 days of revenue for this protocol.', numbers, extra);
  if (rev30 === 0) return result('weak', 'The protocol made no revenue in the last 30 days, so nothing can reach token holders.', numbers, extra);
  if (!isNum(hr30)) return result('nodata', `No holders-revenue data${p.holdersRevenue?.unavailable ? `: ${p.holdersRevenue.unavailable}` : ' for the last 30 days'}.`, numbers, extra);
  if (hr30 === 0) return result('weak', 'It makes revenue, but none of it reached token holders in the last 30 days.', numbers, extra);
  if (share < T['holders.shareWeak']) return result('weak', `Only ${share.toFixed(1)}% of revenue reaches holders, under your ${T['holders.shareWeak']}% line.`, numbers, extra);
  if (share >= T['holders.shareStrong'] && annual(hr30) >= T['holders.minAnnual']) return result('strong', `${share.toFixed(0)}% of revenue reaches holders, about ${fmtUsd(annual(hr30))} a year.`, numbers, extra);
  return result('mixed', share >= T['holders.shareStrong'] ? `${share.toFixed(0)}% of revenue reaches holders, but that is only about ${fmtUsd(annual(hr30))} a year.` : `${share.toFixed(0)}% of revenue reaches holders: some value flows back, but less than your ${T['holders.shareStrong']}% line.`, numbers, extra);
}

function sizeCheck(p, T) {
  const rev30 = windowSum(p.revenue?.daily, 30) ?? (isNum(p.revenue?.total30d) ? p.revenue.total30d : null);
  const annRev = annual(rev30);
  const mcap = p.market?.marketCap;
  const pe = isNum(mcap) && isNum(annRev) && annRev > 0 ? mcap / annRev : null;
  const revToTvl = isNum(annRev) && isNum(p.tvl?.value) && p.tvl.value > 0 ? (annRev / p.tvl.value) * 100 : null;
  const numbers = [
    N('Revenue, annualized', annRev, 'usd', p.revenue?.src, 'last 30 days × 365 ÷ 30'),
    N('Market cap', mcap, 'usd', p.market?.src),
    N('Market cap ÷ revenue', pe, 'x', p.market?.src, 'like a price-to-earnings ratio'),
    N('TVL', p.tvl?.value, 'usd', p.tvl?.src),
    N('Revenue as % of TVL (yearly)', revToTvl, 'pct', p.tvl?.src),
  ];
  const extra = { pe, revToTvl, annRev };
  if (!isNum(mcap)) return result('nodata', p.market?.unavailable ? `No market cap: ${p.market.unavailable}.` : 'No market cap for the token.', numbers, extra);
  if (!isNum(annRev)) return result('nodata', 'DefiLlama has no complete 30 days of revenue for this protocol.', numbers, extra);
  if (annRev === 0) return result('weak', 'No revenue in the last 30 days, so the market cap isn’t backed by any.', numbers, extra);
  if (pe <= T['size.peStrong']) return result('strong', `The market cap is ${pe.toFixed(1)}× annualized revenue, at or under your ${T['size.peStrong']}× line.`, numbers, extra);
  if (pe >= T['size.peWeak']) return result('weak', `The market cap is ${pe.toFixed(0)}× annualized revenue: the market pays a lot per dollar of revenue.`, numbers, extra);
  return result('mixed', `The market cap is ${pe.toFixed(1)}× annualized revenue, between your ${T['size.peStrong']}× and ${T['size.peWeak']}× lines.`, numbers, extra);
}

function callCheck(p, T, holders, ctx) {
  const rev30 = holders.rev30;
  const annRev = annual(rev30);
  const share = holders.share;
  const plans = (ctx.valueAccrual || []).filter((e) => e.token === p.tokenId || e.protocol === p.slug);
  const numbers = [
    N('Revenue, annualized', annRev, 'usd', p.revenue?.src),
    N('Holders’ share of revenue', share, 'pct', p.holdersRevenue?.src),
    ...plans.map((e) => N('Announced', e.what, 'text', null, `${e.date || 'undated'} · last checked ${e.lastChecked || '—'}`)),
  ];
  const extra = { plans };
  if (!isNum(annRev)) return result('nodata', 'Needs revenue data to judge.', numbers, extra);
  if (annRev < T['call.minRevenue']) return result('na', `Revenue (about ${fmtUsd(annRev)} a year) is under your ${fmtUsd(T['call.minRevenue'])} line, so a fee switch wouldn’t matter much yet.`, numbers, extra);
  if (!isNum(share)) return result('nodata', `It earns about ${fmtUsd(annRev)} a year, but there’s no holders-revenue data to see how much reaches holders.`, numbers, extra);
  if (share > T['call.maxHoldersShare']) return result('na', `Value already reaches holders (${share.toFixed(0)}% of revenue), so there’s no switch left to flip.`, numbers, extra);
  if (plans.length) return result('strong', `About ${fmtUsd(annRev)} a year of revenue with little reaching holders, and a fee switch or buyback has been announced (see the source).`, numbers, extra);
  return result('mixed', `About ${fmtUsd(annRev)} a year of revenue, but only ${share.toFixed(1)}% reaches holders. No announced fee switch is recorded; add one in Settings if there is one.`, numbers, extra);
}

function supplyCheck(p, T) {
  const s = p.supply || {};
  const circ = s.circulating;
  const max = s.max || null;
  const circShare = isNum(circ) && isNum(max) && max > 0 ? (circ / max) * 100 : null;
  const mcapFdv = isNum(p.market?.marketCap) && isNum(p.market?.fdv) && p.market.fdv > 0 ? (p.market.marketCap / p.market.fdv) * 100 : null;
  const unl = p.unlocks || {};
  const unlockShare = isNum(unl.next12mTokens) && isNum(circ) && circ > 0 ? (unl.next12mTokens / circ) * 100 : null;
  // whatever isn't circulating yet bounds any future unlock, so a nearly fully circulating token can't have a big overhang
  const ceiling = isNum(circ) && isNum(max) && circ > 0 ? (Math.max(0, max - circ) / circ) * 100 : null;
  const range = rangeBound(p.priceWeekly, T['supply.rangeBand']);
  const numbers = [
    N('Circulating supply', circ, 'tokens', s.src),
    N('Max supply', max ?? (s.maxInfinite ? 'no cap' : null), max ? 'tokens' : 'text', s.src),
    N('Circulating, % of max', circShare, 'pct', s.src),
    N('Market cap ÷ fully diluted value', mcapFdv, 'pct', p.market?.src),
    N('Unlocks in the next 12 months, % of circulating', unlockShare, 'pct', unl.src, unl.status === 'unconfirmed' ? 'schedule unconfirmed' : unl.next12mUnknown ? `${unl.next12mUnknown} release(s) of unpublished size not counted` : null),
    N('Most that could ever unlock, % of circulating', ceiling, 'pct', s.src, 'max supply minus circulating'),
    N(`Traded within a ${T['supply.rangeBand']}× band for`, range ? range.years : null, 'years', p.priceWeeklySrc, range ? `${range.wholeHistory ? 'the whole history shown, ' : ''}weekly price ${fmtPrice(range.low)}–${fmtPrice(range.high)}` : 'no weekly price history'),
  ];
  const extra = { circShare, mcapFdv, unlockShare, ceiling, range };
  if (!isNum(circ)) return result('nodata', 'No circulating supply figure.', numbers, extra);
  const overhang = isNum(unlockShare) ? unlockShare : unl.status === 'none' ? 0 : isNum(ceiling) && ceiling <= T['supply.unlockStrong'] ? ceiling : null;
  if ((isNum(circShare) && circShare < T['supply.circWeak']) || (isNum(overhang) && overhang > T['supply.unlockWeak'])) {
    return result('weak', isNum(overhang) && overhang > T['supply.unlockWeak'] ? `Unlocks in the next year add about ${overhang.toFixed(1)}% to today’s circulating supply.` : `Only ${circShare.toFixed(0)}% of the max supply circulates; most is still to come.`, numbers, extra);
  }
  if (!isNum(circShare) && !isNum(overhang)) return result('nodata', 'No max supply and no confirmed unlock schedule, so the overhang can’t be measured.', numbers, extra);
  if ((isNum(circShare) ? circShare >= T['supply.circStrong'] : true) && isNum(overhang) && overhang <= T['supply.unlockStrong']) {
    const tail = overhang === 0 ? 'nothing is scheduled to unlock in the next year' : `at most ${overhang.toFixed(1)}% more can unlock in the next year`;
    return result('strong', isNum(circShare) ? `${circShare.toFixed(0)}% of the max supply circulates and ${tail}.` : `${tail[0].toUpperCase()}${tail.slice(1)}.`, numbers, extra);
  }
  return result('mixed', isNum(overhang) ? `${isNum(circShare) ? `${circShare.toFixed(0)}% circulates; ` : ''}unlocks add about ${overhang.toFixed(1)}% over the next year.` : `${circShare.toFixed(0)}% circulates, but the unlock schedule is unconfirmed, so the overhang is unknown.`, numbers, extra);
}

function liquidityCheck(p, T) {
  const mcap = p.market?.marketCap;
  const liq = p.dex?.liquidity;
  const vol = p.market?.volume24h;
  const liqShare = isNum(liq) && isNum(mcap) && mcap > 0 ? (liq / mcap) * 100 : null;
  const volShare = isNum(vol) && isNum(mcap) && mcap > 0 ? (vol / mcap) * 100 : null;
  const numbers = [
    N('DEX liquidity', liq, 'usd', p.dex?.src, isNum(p.dex?.pools) ? `${p.dex.pools} pools found` : null),
    N('DEX liquidity, % of market cap', liqShare, 'pct', p.dex?.src),
    N('24h volume (all exchanges)', vol, 'usd', p.market?.src),
    N('24h volume, % of market cap', volShare, 'pct', p.market?.src),
  ];
  const extra = { liqShare, volShare };
  if (!isNum(mcap)) return result('nodata', 'No market cap for the token.', numbers, extra);
  if (!isNum(liqShare) && !isNum(volShare)) return result('nodata', 'No DEX liquidity or volume data.', numbers, extra);
  if (isNum(liqShare) && liqShare < T['liquidity.liqWeak']) return result('weak', `DEX liquidity is only ${liqShare.toFixed(2)}% of market cap: thin, so the price can move sharply either way.`, numbers, extra);
  if (isNum(liqShare) && liqShare >= T['liquidity.liqStrong'] && isNum(volShare) && volShare >= T['liquidity.volStrong']) return result('strong', `DEX liquidity is ${liqShare.toFixed(1)}% of market cap and ${volShare.toFixed(1)}% of it trades daily.`, numbers, extra);
  if (!isNum(liqShare)) return result('mixed', `No DEX pool reports liquidity; daily volume is ${volShare.toFixed(1)}% of market cap.`, numbers, extra);
  return result('mixed', `DEX liquidity is ${liqShare.toFixed(1)}% of market cap${isNum(volShare) ? `, with ${volShare.toFixed(1)}% trading daily` : ''}.`, numbers, extra);
}

function trackCheck(p, T, ctx) {
  const tvl = p.tvl || {};
  const now = ctx.now ?? Date.now() / 1000;
  const firstTs = tvl.firstTs ?? p.listedAt ?? null;
  const years = isNum(firstTs) ? (now - firstTs) / (365.25 * DAY) : null;
  const worst = worstRetention(tvl.monthly);
  const fromPeak = isNum(tvl.value) && isNum(tvl.ath?.value) && tvl.ath.value > 0 ? (tvl.value / tvl.ath.value) * 100 : null;
  const hacks = p.hacks?.list || [];
  const netLoss = hacks.reduce((s, x) => s + Math.max(0, (x.amount || 0) - (x.returned || 0)), 0);
  const team = (ctx.teamNotes || []).find((t) => t.protocol === p.slug);
  const numbers = [
    N('Peak TVL', tvl.ath?.value, 'usd', tvl.src, tvl.ath?.ts ? `on ${fmtDate(tvl.ath.ts)}` : null),
    N('TVL today, % of peak', fromPeak, 'pct', tvl.src),
    N('Live for', years, 'years', tvl.src, isNum(firstTs) ? `first TVL on DefiLlama ${fmtDate(firstTs)}` : null),
    N('TVL kept at its worst drawdown', worst ? worst.ratio * 100 : null, 'pct', tvl.src, worst ? `low in ${fmtMonth(worst.ts)}, monthly data` : null),
    N('Hacks recorded', hacks.length, 'count', p.hacks?.src),
    N('Net hack losses (not returned)', hacks.length ? netLoss : 0, 'usd', p.hacks?.src),
    ...(team ? [N('Team background', team.text, 'text', null, team.sources?.length ? `${team.sources.length} source link(s)` : null)] : []),
  ];
  const extra = { years, worst, netLoss, team };
  if (!isNum(years) || !tvl.monthly?.length) return result('nodata', tvl.unavailable || 'No TVL history to judge a track record.', numbers, extra);
  if (years < T['track.ageWeak']) return result('weak', `Live for only ${years.toFixed(1)} years: no track record through a downturn yet.`, numbers, extra);
  if (netLoss > T['track.hackLossWeak']) return result('weak', `${fmtUsd(netLoss)} lost to hacks and not returned.`, numbers, extra);
  if (worst && worst.ratio * 100 < T['track.retentionWeak']) return result('weak', `At its worst, TVL fell to ${fmtPct0(worst.ratio * 100)} of its earlier peak.`, numbers, extra);
  if (years >= T['track.ageStrong'] && (!worst || worst.ratio * 100 >= T['track.retentionStrong'])) return result('strong', `Live for ${years.toFixed(1)} years${worst ? `, kept at least ${(worst.ratio * 100).toFixed(0)}% of its peak TVL through drawdowns` : ''}${netLoss ? `, ${fmtUsd(netLoss)} net hack losses` : ', no unreturned hack losses'}.`, numbers, extra);
  return result('mixed', `Live for ${years.toFixed(1)} years${worst ? `; at its worst TVL fell to ${fmtPct0(worst.ratio * 100)} of its peak` : ''}.`, numbers, extra);
}

function narrativeCheck(p, T) {
  const r30 = pctChange(windowSum(p.revenue?.daily, 30), windowSum(p.revenue?.daily, 30, 30));
  const r90 = pctChange(windowSum(p.revenue?.daily, 90), windowSum(p.revenue?.daily, 90, 90));
  const p30 = seriesChange(p.priceDaily, 30);
  const p90 = seriesChange(p.priceDaily, 90);
  const gap = isNum(p90) && isNum(r90) ? p90 - r90 : null;
  const numbers = [
    N('Price change, 30 days', p30, 'pctChange', p.seriesSrc),
    N('Revenue change, 30 days vs the 30 before', r30, 'pctChange', p.revenue?.src),
    N('Price change, 90 days', p90, 'pctChange', p.seriesSrc),
    N('Revenue change, 90 days vs the 90 before', r90, 'pctChange', p.revenue?.src),
    N('Price minus revenue change, 90 days', gap, 'pts', null),
  ];
  const extra = { r30, r90, p30, p90, gap };
  if (!isNum(p90)) return result('nodata', 'No 90-day price history.', numbers, extra);
  if (!isNum(r90)) return result('nodata', 'Revenue over the two 90-day windows is incomplete or zero, so the change can’t be measured.', numbers, extra);
  if (gap > T['narrative.aheadPts']) return result('weak', `The price moved ${gap.toFixed(0)} points more than revenue over 90 days: it is running ahead of the fundamentals.`, numbers, extra);
  if (-gap > T['narrative.lagPts']) return result('strong', `Revenue did ${(-gap).toFixed(0)} points better than the price over 90 days: fundamentals ahead of the price (possibly overlooked).`, numbers, extra);
  return result('mixed', `Price and revenue moved roughly together over 90 days (price ${fmtSigned(p90)}, revenue ${fmtSigned(r90)}).`, numbers, extra);
}

/** Every check for one protocol. ctx: { valueAccrual, teamNotes, now (unix seconds) }. */
export function evaluate(p, T, ctx = {}) {
  const holders = holdersCheck(p, T);
  return {
    holders,
    size: sizeCheck(p, T),
    call: callCheck(p, T, holders, ctx),
    supply: supplyCheck(p, T),
    liquidity: liquidityCheck(p, T),
    track: trackCheck(p, T, ctx),
    narrative: narrativeCheck(p, T),
  };
}

/** All protocols, plus the watchlist rank on market cap ÷ revenue (ties share a rank). */
export function evaluateAll(list, T, ctx = {}) {
  const rows = (list || []).map((p) => ({ p, checks: evaluate(p, T, ctx) }));
  const withPe = rows.filter((r) => isNum(r.checks.size.pe)).sort((a, b) => a.checks.size.pe - b.checks.size.pe);
  let rank = 0;
  let prev = null;
  withPe.forEach((r, i) => { if (r.checks.size.pe !== prev) { rank = i + 1; prev = r.checks.size.pe; } r.checks.size.rank = rank; r.checks.size.of = withPe.length; });
  for (const r of rows) {
    const annHr = r.checks.holders.hr30 != null ? annual(r.checks.holders.hr30) : null;
    r.holdersYield = isNum(annHr) && isNum(r.p.market?.marketCap) && r.p.market.marketCap > 0 ? (annHr / r.p.market.marketCap) * 100 : null;
  }
  return rows;
}

/** Headline for the overview: who returns the most revenue to holders relative to market cap. */
export function overviewTakeaway(rows) {
  const ranked = (rows || []).filter((r) => isNum(r.holdersYield) && r.holdersYield > 0).sort((a, b) => b.holdersYield - a.holdersYield);
  if (!ranked.length) {
    const any = (rows || []).some((r) => r.checks.holders.status !== 'nodata');
    return any ? { pre: 'None of these protocols ', hl: 'returned revenue to token holders', post: ' in the last 30 days' } : null;
  }
  const top = ranked[0];
  const tie = ranked[1] && ranked[1].holdersYield.toFixed(1) === top.holdersYield.toFixed(1); // equal as shown
  if (tie) return { pre: `${top.p.name} and ${ranked[1].p.name} `, hl: `return the most revenue to holders relative to market cap`, post: `, about ${top.holdersYield.toFixed(1)}% a year each` };
  const zero = (rows || []).filter((r) => r.checks.holders.hr30 === 0).length;
  return { pre: `${top.p.name} `, hl: `returns the most revenue to holders relative to its market cap`, post: `: about ${top.holdersYield.toFixed(1)}% a year${zero ? `. ${zero} of ${rows.length} send none to holders` : ''}` };
}

// ---------- small formatters used in the sentences ----------
function fmtUsd(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
const fmtPrice = (v) => (isNum(v) ? (v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(2)}`) : '—');
const fmtPct0 = (v) => (v > 0 && v < 1 ? 'under 1%' : `${v.toFixed(0)}%`);
const fmtSigned = (v) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(0)}%` : '—');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (t) => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtMonth = (t) => { const d = new Date(t * 1000); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

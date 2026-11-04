// Takeaway headlines, generated from the live data with simple rules.
// Each rule returns { pre, hl, post } — the "hl" part gets the marker highlight —
// or null when the data can't support a claim (the card then shows a plain title).
// Nothing here is fixed prose: every number and every name comes from the data passed in.
import { usd, pct, ratio, monthYear, date } from './format.js';

const DAY = 86400;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const last = (s) => (s && s.length ? s[s.length - 1] : null);

function valueDaysAgo(series, days) {
  if (!series?.length) return null;
  const target = series[series.length - 1][0] - days * DAY;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= target + DAY / 2) return target - series[i][0] > 1.5 * DAY ? null : series[i][1];
  }
  return null;
}
export function seriesChange(series, days) {
  const l = last(series);
  const p = valueDaysAgo(series, days);
  if (!l || !isNum(p) || p <= 0) return null;
  return ((l[1] - p) / p) * 100;
}
export function seriesPeak(series) {
  let best = null;
  for (const p of series || []) if (!best || p[1] > best[1]) best = p;
  return best;
}

/**
 * Trend claim for a stock metric (TVL, supply, price).
 * Priority: record high → big 30-day move → deep drawdown → 1-year change → steady.
 */
export function trendTakeaway(label, series, { money = true, bigMove = 10, recordWindowDays = 14 } = {}) {
  const l = last(series);
  if (!l) return null;
  const fmt = (v) => (money ? usd(v) : v.toLocaleString('en-US'));
  const peak = seriesPeak(series);
  const c30 = seriesChange(series, 30);
  const c365 = seriesChange(series, 365);
  const fromPeak = peak && peak[1] > 0 ? ((l[1] - peak[1]) / peak[1]) * 100 : null;
  if (peak && l[1] >= peak[1] * 0.99 && l[0] - peak[0] <= recordWindowDays * DAY && series.length > 60) {
    return { pre: `${label} is at a `, hl: 'record high', post: ` of ${fmt(l[1])}` };
  }
  if (isNum(c30) && Math.abs(c30) >= bigMove) {
    return { pre: `${label} `, hl: `${c30 > 0 ? 'rose' : 'fell'} ${pct(Math.abs(c30), { signed: false })} in 30 days`, post: `, to ${fmt(l[1])}` };
  }
  if (isNum(fromPeak) && fromPeak <= -40) {
    return { pre: `${label} is still `, hl: `${pct(Math.abs(fromPeak), { signed: false, digits: 0 })} below its peak`, post: ` from ${monthYear(peak[0])}` };
  }
  if (isNum(c365) && Math.abs(c365) >= 5) {
    return { pre: `${label} is `, hl: `${c365 > 0 ? 'up' : 'down'} ${pct(Math.abs(c365), { signed: false, digits: 0 })} from a year ago`, post: `, at ${fmt(l[1])}` };
  }
  if (isNum(c30)) {
    return { pre: `${label} `, hl: Math.abs(c30) < 3 ? 'held steady' : `${c30 > 0 ? 'edged up' : 'slipped'} ${pct(Math.abs(c30), { signed: false })}`, post: ` over the last month, at ${fmt(l[1])}` };
  }
  return null;
}

/** "Ethereum holds 58% of all DeFi TVL" or the fastest-growing big chain. */
export function chainTakeaway(chains) {
  if (!chains?.length) return null;
  const growers = chains.slice(0, 10).filter((c) => isNum(c.change30d)).sort((a, b) => b.change30d - a.change30d);
  const g = growers[0];
  if (g && g.change30d >= 15 && g !== chains[0]) {
    return { pre: `${g.name} is the `, hl: 'fastest-growing top-10 chain', post: `, up ${pct(g.change30d, { signed: false })} in 30 days` };
  }
  const top = chains[0];
  if (!isNum(top.share)) return null;
  if (top.share >= 50) return { pre: `${top.name} still holds `, hl: 'more than half', post: ` of all DeFi TVL (${pct(top.share, { signed: false, digits: 0 })})` };
  return { pre: `${top.name} holds `, hl: `${pct(top.share, { signed: false, digits: 0 })} of all DeFi TVL`, post: '' };
}

/** Leader in a ranked list of protocols by a money metric. scope names the comparison set. */
export function leaderTakeaway(list, { metric = 'fees', field = 'total30d', period = 'the last 30 days', scope = 'protocol' } = {}) {
  if (!list?.length || !isNum(list[0][field])) return null;
  const [a, b] = list;
  if (b && isNum(b[field]) && b[field] > 0) {
    const x = a[field] / b[field];
    if (x >= 1.8) return { pre: `${a.name} earned `, hl: `${ratio(x).replace('×', 'x')} more ${metric}`, post: ` than any other ${scope} over ${period}` };
  }
  return { pre: `${a.name} `, hl: `led ${scope === 'protocol' ? 'all protocols' : `every ${scope}`} in ${metric}`, post: ` over ${period}, with ${usd(a[field])}` };
}

/** Stablecoins: record supply, or how concentrated issuance is. */
export function stablecoinTakeaway(series, issuers) {
  const l = last(series);
  const peak = seriesPeak(series);
  if (l && peak && l[1] >= peak[1] * 0.995 && l[0] - peak[0] <= 14 * DAY) {
    return { pre: 'Stablecoin supply just hit ', hl: `a record ${usd(l[1])}`, post: '' };
  }
  const top = issuers?.top;
  if (top?.length >= 2 && isNum(top[0].share) && isNum(top[1].share)) {
    const two = top[0].share + top[1].share;
    if (two >= 70) return { pre: `${top[0].symbol} and ${top[1].symbol} make up `, hl: `${pct(two, { signed: false, digits: 0 })} of all stablecoins`, post: '' };
    return { pre: `${top[0].name} issues `, hl: `${pct(top[0].share, { signed: false, digits: 0 })} of all stablecoins`, post: '' };
  }
  return null;
}

/** Biggest mover among protocols above the TVL floor. */
export function moversTakeaway(movers) {
  const g = movers?.gainers?.[0];
  const l = movers?.losers?.[0];
  const floor = movers?.minTvl ? usd(movers.minTvl, { digits: 0 }) : null;
  const tail = floor ? `, the biggest move among protocols over ${floor} TVL` : '';
  if (g && l && Math.abs(l.change7d) > Math.abs(g.change7d) && l.change7d < 0) {
    return { pre: `${l.name} TVL `, hl: `fell ${pct(Math.abs(l.change7d), { signed: false, digits: 0 })} this week`, post: tail };
  }
  if (g && g.change7d > 0) return { pre: `${g.name} TVL `, hl: `jumped ${pct(g.change7d, { signed: false, digits: 0 })} this week`, post: tail };
  return null;
}

/** Flow metrics (DEX volume, fees): week-over-week change or 7-day total. */
export function flowTakeaway(label, h, verb = 'swapped') {
  if (!h || !isNum(h.value)) return null;
  if (isNum(h.change7d) && Math.abs(h.change7d) >= 10) {
    return { pre: `${label} `, hl: `${h.change7d > 0 ? 'jumped' : 'dropped'} ${pct(Math.abs(h.change7d), { signed: false, digits: 0 })} week over week`, post: '' };
  }
  if (isNum(h.total7d)) return { pre: `Traders ${verb} `, hl: `${usd(h.total7d)} in the last 7 days`, post: ` on ${label.toLowerCase()}` };
  return null;
}

export function categoryTakeaway(list) {
  const t = list?.[0];
  if (!t || !isNum(t.share)) return null;
  return { pre: `${t.category} is DeFi's largest category, with `, hl: `${pct(t.share, { signed: false, digits: 0 })} of protocol TVL`, post: '' };
}

/** Protocol fees vs revenue. */
export function revenueTakeaway(name, fees, revenue) {
  const f = fees?.total30d;
  const r = revenue?.total30d;
  if (isNum(fees?.change30dOver30d) && Math.abs(fees.change30dOver30d) >= 25) {
    return { pre: `${name}'s fees are `, hl: `${fees.change30dOver30d > 0 ? 'up' : 'down'} ${pct(Math.abs(fees.change30dOver30d), { signed: false, digits: 0 })}`, post: ' on the previous 30 days' };
  }
  if (isNum(f) && f > 0 && r === 0) return { pre: 'DefiLlama records ', hl: 'no protocol revenue', post: ` for ${name}, only ${usd(f)} of fees in 30 days` };
  if (isNum(f) && f > 0 && isNum(r)) {
    const share = (r / f) * 100;
    return { pre: `${name} keeps `, hl: `${pct(share, { signed: false, digits: 0 })} of its fees`, post: ' as revenue' };
  }
  if (isNum(f)) return { pre: `${name} generated `, hl: `${usd(f)} in fees`, post: ' over the last 30 days' };
  return null;
}

export function protocolChainTakeaway(name, chainTvl) {
  const t = chainTvl?.list?.[0];
  if (!t || !isNum(t.share)) return null;
  if (chainTvl.count === 1) return { pre: `All of ${name}'s TVL sits on `, hl: t.chain, post: '' };
  if (t.share >= 50) return { pre: '', hl: `${pct(t.share, { signed: false, digits: 0 })} of ${name}'s TVL`, post: ` sits on ${t.chain}` };
  return { pre: `${name} is spread across `, hl: `${chainTvl.count} chains`, post: `; the biggest, ${t.chain}, holds ${pct(t.share, { signed: false, digits: 0 })}` };
}

/**
 * Token valuation vs fees, ranked against other tracked protocols.
 * `others` = [{ name, value }] for every OTHER protocol (not this one).
 */
export function valuationTakeaway(symbol, mcapToFees, others = []) {
  if (!isNum(mcapToFees) || mcapToFees <= 0) return null;
  const valid = others.filter((p) => isNum(p.value) && p.value > 0);
  const cheaper = valid.filter((p) => p.value < mcapToFees).length;
  const base = { pre: `${symbol} trades at `, hl: `${ratio(mcapToFees)} annualized fees`, post: '' };
  if (valid.length >= 2 && cheaper === 0) return { ...base, post: `, the lowest multiple of the ${valid.length + 1} protocols tracked here` };
  if (valid.length >= 2 && cheaper === valid.length) return { ...base, post: `, the highest multiple of the ${valid.length + 1} protocols tracked here` };
  return base;
}

export function priceTakeaway(symbol, market, series) {
  if (!market || !isNum(market.price)) return null;
  if (market.athDate && Date.now() - Date.parse(market.athDate) < 7 * 864e5) {
    return { pre: `${symbol} set `, hl: 'a new all-time high', post: ` on ${date(market.athDate)}` };
  }
  if (isNum(market.athChange) && market.athChange <= -50) {
    return { pre: `${symbol} is `, hl: `${pct(Math.abs(market.athChange), { signed: false, digits: 0 })} below its all-time high`, post: market.athDate ? ` from ${monthYear(market.athDate)}` : '' };
  }
  const c1y = isNum(market.change1y) ? market.change1y : seriesChange(series, 365);
  if (isNum(c1y) && Math.abs(c1y) >= 10) return { pre: `${symbol} is `, hl: `${c1y > 0 ? 'up' : 'down'} ${pct(Math.abs(c1y), { signed: false, digits: 0 })} over the past year`, post: '' };
  if (isNum(market.change30d)) return { pre: `${symbol} `, hl: `${market.change30d >= 0 ? 'gained' : 'lost'} ${pct(Math.abs(market.change30d), { signed: false })}`, post: ' over the last 30 days' };
  return null;
}

export function supplyTakeaway(symbol, supply) {
  const p = supply?.circulatingPctOfMax;
  if (!isNum(p)) return null;
  const basis = supply.basis === 'max' ? 'max supply' : 'total supply';
  if (p >= 99.5) return { pre: `All of ${symbol}'s `, hl: basis, post: ' is already circulating' };
  if (p < 50) return { pre: `Only `, hl: `${pct(p, { signed: false, digits: 0 })} of ${symbol}'s ${basis}`, post: ' is circulating so far' };
  return { pre: '', hl: `${pct(p, { signed: false, digits: 0 })} of ${symbol}'s ${basis}`, post: ' is already circulating' };
}

export function liquidityTakeaway(symbol, dex) {
  const top = dex?.pools?.[0];
  if (!top || !isNum(top.liquidity)) return null;
  const total = dex.totalLiquidity;
  if (isNum(total) && total > 0 && top.liquidity / total >= 0.5) {
    return { pre: `Most of ${symbol}'s DEX liquidity sits in `, hl: `one ${top.dex || 'DEX'} pool`, post: ` (${top.name}, ${usd(top.liquidity)})` };
  }
  return { pre: `${symbol} has `, hl: `${usd(total)} of DEX liquidity`, post: ` across the ${dex.pools.length} largest pools` };
}

export function yieldTakeaway(name, pools) {
  const list = (pools || []).filter((p) => isNum(p.apy));
  if (!list.length) return null;
  const best = list.reduce((a, b) => (b.apy > a.apy ? b : a));
  if (best.apy < 0.05) return { pre: `${name}'s largest pools `, hl: 'pay almost no yield', post: ' right now' };
  return { pre: `${name}'s largest pools pay `, hl: `up to ${pct(best.apy, { signed: false })} APY`, post: ` (${best.symbol} on ${best.chain}, ${usd(best.tvl)} deposited)` };
}

/** Compare view: fastest growth over the selected window. */
export function compareTakeaway(rows, metricLabel, windowLabel) {
  const ok = rows.filter((r) => isNum(r.change));
  if (ok.length < 2) return null;
  ok.sort((a, b) => b.change - a.change);
  const a = ok[0];
  const z = ok[ok.length - 1];
  if (a.change > 0) return { pre: `${a.name} grew ${metricLabel} `, hl: `fastest over ${windowLabel} (${pct(a.change, { digits: 0 })})`, post: z.change < 0 ? `, while ${z.name} shrank ${pct(Math.abs(z.change), { signed: false, digits: 0 })}` : '' };
  return { pre: `Every protocol here lost ${metricLabel} over ${windowLabel}; `, hl: `${z.name} fell most`, post: ` (${pct(z.change, { digits: 0 })})` };
}

export function catalystTakeaway(items, now = Date.now()) {
  const soon = items.filter((i) => i.type === 'governance-vote' && i.status === 'open' && Date.parse(i.date) - now < 7 * 864e5 && Date.parse(i.date) > now);
  if (soon.length >= 2) return { pre: '', hl: `${soon.length} governance votes`, post: ' close in the next 7 days' };
  if (soon.length === 1) return { pre: 'Next vote to close: ', hl: soon[0].title, post: ` (${soon[0].symbols?.join(', ') || ''})` };
  const upcoming = items.filter((i) => Date.parse(i.date) > now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (upcoming.length) return { pre: 'Next on the calendar: ', hl: upcoming[0].title, post: '' };
  const recent = items.filter((i) => Date.parse(i.date) <= now && now - Date.parse(i.date) < 7 * 864e5);
  if (recent.length) return { pre: '', hl: `${recent.length} items`, post: ' about your watchlist in the past week' };
  return null;
}

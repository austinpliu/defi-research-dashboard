// Number and date formatting. Pure functions (unit-tested in tests/site-logic.test.mjs).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** $1.23T / $94.2B / $512M / $12.4K / $950 / $0.4521 */
export function usd(v, { digits } = {}) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (a >= 1e12) return `${sign}$${fmt(a / 1e12, digits ?? 2)}T`;
  if (a >= 1e9) return `${sign}$${fmt(a / 1e9, digits ?? (a >= 1e11 ? 0 : 1))}B`;
  if (a >= 1e6) return `${sign}$${fmt(a / 1e6, digits ?? (a >= 1e8 ? 0 : 1))}M`;
  if (a >= 1e4) return `${sign}$${fmt(a / 1e3, digits ?? (a >= 1e5 ? 0 : 1))}K`;
  if (a >= 100) return `${sign}$${fmt(a, 0)}`;
  if (a >= 1) return `${sign}$${fmt(a, 2)}`;
  if (a === 0) return '$0';
  return `${sign}$${Number(a.toPrecision(4))}`;
}

/** Full-precision dollars for tables/tooltips: $1,234,567 */
export function usdFull(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 1 ? 2 : 6;
  return `${v < 0 ? '−' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d })}`;
}

/** Plain compact number (tokens, votes): 1.2B / 34.5M / 12.3K */
export function compact(v, digits = 1) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(digits)}K`;
  return `${s}${Math.round(a).toLocaleString('en-US')}`;
}

/** +2.4% / −13% (signed; one decimal under 10%) */
export function pct(v, { signed = true, digits } = {}) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : 2);
  const s = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '';
  return `${s}${a.toFixed(d)}%`;
}

export function ratio(v) {
  if (!isNum(v)) return '—';
  if (v >= 100) return `${Math.round(v)}×`;
  if (v >= 10) return `${v.toFixed(1)}×`;
  return `${v.toFixed(2)}×`;
}

export function direction(v, eps = 0.05) {
  if (!isNum(v)) return 'flat';
  if (v > eps) return 'up';
  if (v < -eps) return 'down';
  return 'flat';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(x) {
  if (x instanceof Date) return x;
  if (typeof x === 'number') return new Date(x < 1e11 ? x * 1000 : x);
  return new Date(x);
}

/** 4 Nov 2026 */
export function date(x) {
  const d = toDate(x);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Nov 2026 */
export function monthYear(x) {
  const d = toDate(x);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 4 Nov 2026, 08:23 UTC */
export function dateTime(x) {
  const d = toDate(x);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date(d)}, ${hh}:${mm} UTC`;
}

/** "3h ago" / "in 2 days" */
export function relative(x, now = Date.now()) {
  const t = toDate(x).getTime();
  if (Number.isNaN(t)) return '';
  const diff = t - now;
  const a = Math.abs(diff);
  const m = 60e3, h = 36e5, dd = 864e5;
  let s;
  if (a < m) s = 'just now';
  else if (a < h) s = `${Math.round(a / m)} min`;
  else if (a < dd) s = `${Math.round(a / h)}h`;
  else if (a < 60 * dd) s = `${Math.round(a / dd)} day${Math.round(a / dd) === 1 ? '' : 's'}`;
  else s = `${Math.round(a / (30 * dd))} months`;
  if (s === 'just now') return s;
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

export function shortDate(x) {
  const d = toDate(x);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function tokenAmount(v) {
  return compact(v, 2);
}

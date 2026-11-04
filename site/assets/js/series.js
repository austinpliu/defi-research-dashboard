// Client-side series helpers. Series are [[unixSeconds, value], ...] ascending.
const DAY = 86400;

export function trimDays(series, days) {
  if (!series?.length || !days) return series || [];
  const cutoff = series[series.length - 1][0] - days * DAY;
  return series.filter(([ts]) => ts >= cutoff);
}

/** Rebase to 100 at the first point (for comparing growth). */
export function indexTo100(series) {
  const first = series.find(([, v]) => typeof v === 'number' && v > 0);
  if (!first) return [];
  return series.filter(([ts]) => ts >= first[0]).map(([ts, v]) => [ts, (v / first[1]) * 100]);
}

/** Sum daily values into weeks (labelled by the week's last day). */
export function weeklySum(series) {
  const out = new Map();
  for (const [ts, v] of series) {
    const wk = Math.floor(ts / (7 * DAY));
    const e = out.get(wk) || [ts, 0, 0];
    e[0] = Math.max(e[0], ts);
    e[1] += v || 0;
    e[2] += 1;
    out.set(wk, e);
  }
  // drop a trailing partial week so the last bar isn't misleadingly short
  const arr = [...out.values()].sort((a, b) => a[0] - b[0]);
  if (arr.length && arr[arr.length - 1][2] < 7) arr.pop();
  return arr.map(([ts, v]) => [ts, v]);
}

/** Rolling N-day sum (e.g. 30-day fees) for each day. */
export function rollingSum(series, n = 30) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < series.length; i++) {
    acc += series[i][1] || 0;
    if (i >= n) acc -= series[i - n][1] || 0;
    if (i >= n - 1) out.push([series[i][0], acc]);
  }
  return out;
}

/** Last point of each calendar month. */
export function monthlyLast(series) {
  const out = new Map();
  for (const [ts, v] of series) {
    const d = new Date(ts * 1000);
    out.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, [ts, v]);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

/** Value at (or just before) a timestamp. */
export function valueAt(series, ts) {
  let best = null;
  for (const p of series) {
    if (p[0] <= ts + DAY / 2) best = p;
    else break;
  }
  return best ? best[1] : null;
}

export function lastValue(series) {
  return series?.length ? series[series.length - 1][1] : null;
}

export function changeOver(series, days) {
  if (!series?.length) return null;
  const l = series[series.length - 1];
  const p = valueAt(series, l[0] - days * DAY);
  if (p === null || p <= 0) return null;
  return ((l[1] - p) / p) * 100;
}

export const RANGES = [
  { value: 90, label: '90D' },
  { value: 365, label: '1Y' },
  { value: 0, label: 'All' },
];

export function rangeLabel(days) {
  if (!days) return 'all time';
  if (days === 365) return 'the past year';
  return `the past ${days} days`;
}

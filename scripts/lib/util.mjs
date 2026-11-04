// Small pure helpers used by the pipeline. No network, no file access —
// everything here is unit-tested in tests/pipeline-util.test.mjs.

export const DAY = 86400; // seconds

/** Round to a sensible precision so JSON stays small and diffs stay quiet. */
export function roundSmart(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n);
  if (a >= 1) return Math.round(n * 100) / 100;
  if (a === 0) return 0;
  // keep 4 significant digits for small numbers (token prices, ratios)
  return Number(n.toPrecision(4));
}

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Percent change from prev to curr, or null when it can't be computed. */
export function pctChange(curr, prev) {
  curr = num(curr);
  prev = num(prev);
  if (curr === null || prev === null || prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

/** Normalise a series of points to [[unixSeconds, value], ...] sorted ascending. */
export function normSeries(points, { tsKey = 0, valKey = 1, ms = false } = {}) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    let ts = Array.isArray(p) ? p[0] : p?.[tsKey];
    let v = Array.isArray(p) ? p[1] : p?.[valKey];
    ts = Number(ts);
    v = num(v);
    if (!Number.isFinite(ts) || v === null) continue;
    if (ms || ts > 1e11) ts = Math.floor(ts / 1000);
    out.push([ts, v]);
  }
  out.sort((a, b) => a[0] - b[0]);
  // de-duplicate identical timestamps, keeping the last value
  const dedup = [];
  for (const p of out) {
    if (dedup.length && dedup[dedup.length - 1][0] === p[0]) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return dedup;
}

/** Keep one point per UTC day (the last one seen that day). */
export function dailySeries(series) {
  const byDay = new Map();
  for (const [ts, v] of series) byDay.set(Math.floor(ts / DAY) * DAY, v);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
}

export function lastPoint(series) {
  return series.length ? series[series.length - 1] : null;
}

/** Value of the latest point at or before (last timestamp - days). */
export function valueDaysAgo(series, days) {
  if (!series.length) return null;
  const target = series[series.length - 1][0] - days * DAY;
  // allow 36h of slack so a missing day doesn't break the comparison
  let best = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= target + DAY * 0.5) {
      best = series[i];
      break;
    }
  }
  if (!best || target - best[0] > DAY * 1.5) return null;
  return best[1];
}

export function changeOverDays(series, days) {
  const last = lastPoint(series);
  if (!last) return null;
  return pctChange(last[1], valueDaysAgo(series, days));
}

/** Highest value in a series, with its date. */
export function allTimeHigh(series) {
  let best = null;
  for (const [ts, v] of series) if (!best || v > best[1]) best = [ts, v];
  return best ? { value: best[1], ts: best[0] } : null;
}

/** Sum of the values in the last `days` daily points (inclusive of last). */
export function sumLastDays(series, days, offsetDays = 0) {
  if (!series.length) return null;
  const end = series[series.length - 1][0] - offsetDays * DAY;
  const start = end - (days - 1) * DAY;
  let s = 0;
  let n = 0;
  for (const [ts, v] of series) {
    if (ts >= start - DAY / 2 && ts <= end + DAY / 2) {
      s += v;
      n += 1;
    }
  }
  return n >= Math.max(1, Math.floor(days * 0.8)) ? s : null;
}

/** Keep points newer than `days` ago (relative to the last point). */
export function trimDays(series, days) {
  if (!series.length) return [];
  const cutoff = series[series.length - 1][0] - days * DAY;
  return series.filter(([ts]) => ts >= cutoff);
}

/** Round every value in a series. */
export function compactSeries(series) {
  return series.map(([ts, v]) => [ts, roundSmart(v)]);
}

/** Weekly downsample (last value of each ISO-ish week) for long histories. */
export function weeklySeries(series) {
  const byWeek = new Map();
  for (const [ts, v] of series) byWeek.set(Math.floor(ts / (7 * DAY)), [ts, v]);
  return [...byWeek.values()].sort((a, b) => a[0] - b[0]);
}

/** Strip HTML tags and decode the handful of entities that show up in feeds. */
export function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…');
}

/**
 * First n sentences of a description. Doesn't split on abbreviations such as
 * "U.S.", "e.g." or "Inc.", or on decimals like "3.5".
 */
export function firstSentences(text, n = 2) {
  const clean = stripHtml(text || '');
  if (!clean) return '';
  const pieces = clean.split(/(?<=[.!?])\s+(?=["“(A-Z0-9])/);
  const ABBR = /(\b(?:[A-Z]\.){1,3}|\b(?:e\.g|i\.e|etc|vs|inc|ltd|co|corp|no|st|mr|ms|dr|jr|sr|approx|est)\.)$/i;
  const sentences = [];
  for (const piece of pieces) {
    if (sentences.length && ABBR.test(sentences[sentences.length - 1])) sentences[sentences.length - 1] += ` ${piece}`;
    else sentences.push(piece);
  }
  return sentences.slice(0, n).join(' ').trim();
}

export function truncate(s, max = 220) {
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Escape a string for use inside a RegExp. */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `text` mention any keyword? Keywords that are all caps (tickers like
 * HYPE, SKY) match case-sensitively on word boundaries; others ignore case.
 */
export function mentions(text, keywords) {
  if (!text || !keywords?.length) return false;
  return keywords.some((k) => {
    if (!k) return false;
    const isTicker = k === k.toUpperCase() && /[A-Z]/.test(k);
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(k)}($|[^A-Za-z0-9])`, isTicker ? '' : 'i');
    return re.test(text);
  });
}

export function isoDate(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

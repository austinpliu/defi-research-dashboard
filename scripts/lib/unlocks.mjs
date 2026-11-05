// Token unlock schedules from free, keyless sources (see DECISIONS.md › Unlocks).
//
// Route 1: DefiLlama's open-source emissions adapters (github.com/DefiLlama/emissions-adapters).
// Route 2: on-chain vesting contracts read through free public RPC endpoints.
// Route 3: a hand-checked unlocks.json built from each project's own docs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export const EMISSIONS_REPO = 'https://github.com/DefiLlama/emissions-adapters';

/**
 * Route 1: can the emissions-adapters repo be cloned anonymously? Runs outside this
 * repository's checkout with credential helpers off, so it sees exactly what the public
 * sees (and never sends this repository's token anywhere). If it can, list the adapter
 * files for the tracked tokens.
 */
export async function probeEmissionsRepo({ names = [], printFiles = false } = {}) {
  const fetchedAt = new Date().toISOString();
  if (process.env.UNLOCKS_REPO_PROBE === '0') return { ok: false, skipped: true, error: 'Skipped (UNLOCKS_REPO_PROBE=0)', fetchedAt };
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const cwd = mkdtempSync(join(tmpdir(), 'emissions-'));
  const git = (args, timeout = 60000) => run('git', ['-c', 'credential.helper=', ...args], { cwd, env, timeout, maxBuffer: 8 << 20 });
  try {
    const { stdout } = await git(['ls-remote', EMISSIONS_REPO, 'HEAD'], 30000);
    const sha = stdout.trim().split(/\s+/)[0] || null;
    await git(['clone', '--quiet', '--depth', '1', EMISSIONS_REPO, 'repo'], 120000);
    const root = join(cwd, 'repo');
    const top = readdirSync(root).sort();
    const protoDir = join(root, 'protocols');
    const all = existsSync(protoDir) ? readdirSync(protoDir) : [];
    const wanted = names.map((n) => String(n).toLowerCase()).filter((n) => n.length >= 3);
    const files = all.filter((f) => wanted.some((n) => f.toLowerCase().includes(n))).sort();
    if (printFiles) {
      const pkg = existsSync(join(root, 'package.json')) ? readFileSync(join(root, 'package.json'), 'utf8') : '(no package.json)';
      console.log(`   ↳ emissions-adapters @ ${sha}: top level ${JSON.stringify(top)}; ${all.length} protocol files`);
      console.log(`   ↳ package.json: ${pkg.slice(0, 1500)}`);
      for (const f of files.slice(0, 14)) {
        const p = join(protoDir, f);
        const body = existsSync(p) && !f.includes('.') ? readdirSync(p).join(', ') : readFileSync(p, 'utf8');
        console.log(`   ↳ ---- protocols/${f} ----\n${String(body).slice(0, 4000)}`);
      }
    }
    return { ok: true, sha, top, protocolCount: all.length, files, fetchedAt };
  } catch (e) {
    const msg = String(e.stderr || e.message || e).trim().split('\n').filter(Boolean).pop() || 'git failed';
    return { ok: false, error: msg.slice(0, 240), fetchedAt };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------- Route 3: hand-checked unlocks.json ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const AVG_MONTH_DAYS = 365.25 / 12;
const toTs = (s) => (DAY_RE.test(s) ? Date.parse(`${s}T00:00:00Z`) : MONTH_RE.test(s) ? Date.parse(`${s}-01T00:00:00Z`) : NaN);
const precisionOf = (s) => (DAY_RE.test(s) ? 'day' : 'month');
const addMonths = (t, n) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); };
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const shareOk = (v) => v === null || v === undefined || (typeof v === 'number' && v >= 0 && v <= 1);

/** Read unlocks.json. Returns { lastChecked, tokens, problems }; tokens are validated, bad entries dropped. */
export function loadManualUnlocks(path) {
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { lastChecked: null, tokens: {}, problems: [`unlocks.json could not be read (${e.message})`] };
  }
  const tokens = {};
  for (const [id, e] of Object.entries(raw.tokens || {})) {
    const bad = [];
    if (!['scheduled', 'partial', 'none', 'unconfirmed'].includes(e.status)) bad.push('status must be scheduled, partial, none or unconfirmed');
    const srcIds = new Set();
    for (const s of e.sources || []) {
      if (!isUrl(s.url)) bad.push(`source "${s.label || s.id}" needs an http(s) url`);
      srcIds.add(s.id);
    }
    if (!(e.sources || []).length) bad.push('needs at least one source link');
    for (const sc of e.schedules || []) {
      if (!['monthly', 'linear'].includes(sc.type)) bad.push(`schedule "${sc.label}": type must be monthly or linear`);
      if (sc.type === 'monthly' && !(MONTH_RE.test(sc.from) && MONTH_RE.test(sc.to))) bad.push(`schedule "${sc.label}": monthly needs from/to as YYYY-MM`);
      if (sc.type === 'linear' && !(sc.end && Number.isFinite(toTs(sc.end))) ) bad.push(`schedule "${sc.label}": linear needs an end date`);
      if (sc.start && !Number.isFinite(toTs(sc.start))) bad.push(`schedule "${sc.label}": bad start date`);
      if (!shareOk(sc.sharePerPeriod) || !shareOk(sc.share)) bad.push(`schedule "${sc.label}": shares are fractions of supply between 0 and 1`);
      if (sc.source && !srcIds.has(sc.source)) bad.push(`schedule "${sc.label}": unknown source id "${sc.source}"`);
    }
    for (const ev of e.events || []) {
      if (!Number.isFinite(toTs(ev.date))) bad.push(`event "${ev.label}": date must be YYYY-MM-DD or YYYY-MM`);
      if (!shareOk(ev.share)) bad.push(`event "${ev.label}": share is a fraction of supply between 0 and 1`);
      if (ev.source && !srcIds.has(ev.source)) bad.push(`event "${ev.label}": unknown source id "${ev.source}"`);
    }
    if (bad.length) problems.push(`unlocks.json entry "${id}" skipped: ${bad.join('; ')}`);
    else tokens[id] = { ...e, lastChecked: e.lastChecked || raw.lastChecked || null };
  }
  return { lastChecked: raw.lastChecked || null, tokens, problems };
}

/**
 * Upcoming unlocks for one token from its unlocks.json entry. Token amounts are only
 * calculated when the docs give a share of supply (share × CoinGecko's max or total supply);
 * nothing is filled in otherwise. Monthly tranches have month precision unless the docs
 * name the day.
 */
export function buildTokenUnlocks(entry, { supply = null, now = Date.now(), monthsAhead = 12 } = {}) {
  if (!entry) {
    return { status: 'unconfirmed', summary: 'No unlock schedule has been checked for this token yet. Add one to unlocks.json from the project’s own docs.', events: [], schedules: [], sources: [], method: 'none' };
  }
  const denom = supply?.max || supply?.total || null;
  const supplyBasis = supply?.max ? 'max supply' : supply?.total ? 'total supply' : null;
  const horizon = addMonths(now, monthsAhead + 1);
  const srcOf = (id) => (entry.sources || []).find((s) => s.id === id) || entry.sources?.[0] || null;
  const tokensFor = (share) => (share != null && denom ? share * denom : null);
  const events = [];
  const schedules = [];
  for (const sc of entry.schedules || []) {
    const source = srcOf(sc.source);
    if (sc.type === 'monthly') {
      // start from next month: with no day in the docs, this month's tranche may already have happened
      const first = Math.max(toTs(sc.from), addMonths(now, 1));
      for (let t = first; t <= toTs(sc.to) && t < horizon; t = addMonths(t, 1)) {
        events.push({ ts: t / 1000, precision: 'month', label: sc.label, kind: 'monthly', share: sc.sharePerPeriod ?? null, tokens: tokensFor(sc.sharePerPeriod), basis: sc.basis || null, source });
      }
      schedules.push({ label: sc.label, type: 'monthly', from: sc.from, to: sc.to, sharePerPeriod: sc.sharePerPeriod ?? null, tokensPerPeriod: tokensFor(sc.sharePerPeriod), ongoing: toTs(sc.to) >= Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1), basis: sc.basis || null, source });
    } else if (sc.type === 'linear') {
      const startTs = sc.start ? toTs(sc.start) : null;
      const endTs = toTs(sc.end);
      const total = sc.tokens ?? tokensFor(sc.share);
      const months = startTs != null ? (endTs - startTs) / (AVG_MONTH_DAYS * 86400e3) : null;
      schedules.push({
        label: sc.label, type: 'linear', start: sc.start || null, end: sc.end, share: sc.share ?? null, tokens: total,
        // the average per month is only exact when the docs give both ends of the window
        tokensPerMonth: total != null && months > 0 ? total / months : null,
        ongoing: endTs > now && (startTs == null || startTs <= now), basis: sc.basis || null, source,
      });
      if (endTs > now && endTs < horizon) {
        events.push({ ts: endTs / 1000, precision: precisionOf(sc.end), label: `${sc.label}: vesting ends`, kind: 'vesting-end', share: null, tokens: null, basis: sc.basis || null, source });
      }
    }
  }
  for (const ev of entry.events || []) {
    const t = toTs(ev.date);
    if (t > now && t < horizon) events.push({ ts: t / 1000, precision: precisionOf(ev.date), label: ev.label, kind: 'release', share: ev.share ?? null, tokens: tokensFor(ev.share), basis: ev.basis || null, source: srcOf(ev.source) });
  }
  events.sort((a, b) => a.ts - b.ts);
  return {
    status: entry.status,
    summary: entry.summary || null,
    lastChecked: entry.lastChecked || null,
    method: 'manual',
    sources: entry.sources || [],
    supplyUsed: denom ? { value: denom, basis: supplyBasis } : null,
    schedules,
    events,
  };
}

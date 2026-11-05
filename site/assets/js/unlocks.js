// Upcoming token unlocks, shared by token and protocol pages.
// Data: tokens/<id>.json › unlocks (built from the hand-checked unlocks.json).
import { h, extLink, term } from './ui.js';
import { dataTable } from './table.js';
import { compact, date, monthYear } from './format.js';

export const STATUS = {
  scheduled: 'Schedule published',
  partial: 'Partly published',
  none: 'Nothing left to unlock',
  unconfirmed: 'Unconfirmed',
};

/** "During Dec 2026" when the docs give only the month; never an invented day. */
export const whenText = (ts, precision) => (precision === 'month' ? `During ${monthYear(ts * 1000)}` : date(ts * 1000));
const shareText = (s) => (s == null ? '—' : `${(s * 100).toFixed(s * 100 < 1 ? 2 : 1)}%`);

/** One-line, data-generated headline for an unlocks card. */
export function unlockTakeaway(sym, u) {
  if (!u) return null;
  const next = (u.events || []).find((e) => e.tokens != null);
  if (next) return { pre: 'Next confirmed unlock: ', hl: `${compact(next.tokens, 2)} ${sym} ${next.precision === 'month' ? `during ${monthYear(next.ts * 1000)}` : `on ${date(next.ts * 1000)}`}`, post: next.share != null ? ` (${shareText(next.share)} of supply)` : '' };
  const lin = (u.schedules || []).find((s) => s.type === 'linear' && s.ongoing && s.tokensPerMonth != null);
  if (lin) return { pre: `${lin.label}: `, hl: `about ${compact(lin.tokensPerMonth, 2)} ${sym} a month`, post: ` vests until ${date(Date.parse(`${lin.end}T00:00:00Z`))}` };
  const dated = (u.events || []).find((e) => e.kind === 'release');
  if (dated) return { pre: `${sym}'s next scheduled release is `, hl: whenText(dated.ts, dated.precision).replace('During', 'during'), post: ', but the project doesn’t publish its size' };
  if (u.status === 'none') return { pre: `${sym} has `, hl: 'nothing left to unlock', post: ', according to its docs' };
  if (u.status === 'partial') return { pre: `${sym}'s docs give `, hl: 'vesting windows, not dated tranches', post: '' };
  return { pre: `${sym}'s unlock schedule is `, hl: 'unconfirmed', post: ': the project publishes none we could check' };
}

export function unlocksBlock(u, sym, { maxEvents = 8 } = {}) {
  if (!u) return h('div', { class: 'notice' }, h('b', {}, 'Unconfirmed. '), 'No unlock schedule has been checked for this token yet.');
  const parts = [h('div', { class: 'chips', style: { margin: '2px 0 8px' } }, h('span', { class: `chip ${u.status === 'unconfirmed' ? '' : 'solid'}` }, STATUS[u.status] || u.status), u.method === 'manual' ? h('span', { class: 'chip' }, 'Hand-checked from the project’s docs') : null)];
  if (u.summary) parts.push(h('p', { class: 'p-desc', style: { fontSize: '14px', margin: '0 0 10px' } }, u.summary));
  const events = (u.events || []).slice(0, maxEvents);
  if (events.length) {
    parts.push(dataTable({
      caption: `${sym} upcoming unlocks`, csvName: `${sym.toLowerCase()}-unlocks`, search: false, sortKey: 'ts', sortDir: 'asc', pageSize: maxEvents,
      columns: [
        { key: 'ts', label: 'When', fmt: (v, r) => whenText(v, r.precision), csv: (r) => (r.precision === 'month' ? monthYear(r.ts * 1000) : date(r.ts * 1000)) },
        { key: 'label', label: 'What', wrap: true },
        { key: 'tokens', label: 'Amount', num: true, fmt: (v, r) => (v != null ? `${compact(v, 2)} ${sym}` : r.kind === 'vesting-end' ? '—' : 'not published'), termKey: 'unlock' },
        { key: 'share', label: 'Share of supply', num: true, fmt: (v) => shareText(v) },
        { key: 'source', label: 'Source', fmt: (v) => (v?.url ? extLink(v.url, v.label) : '—'), csv: (r) => r.source?.url || '' },
      ],
      rows: events,
    }));
    if ((u.events || []).length > events.length) parts.push(h('p', { class: 'chart-note' }, `Showing the next ${events.length} of ${u.events.length} in the coming year.`));
  }
  const ongoing = (u.schedules || []).filter((s) => s.ongoing);
  if (ongoing.length) {
    parts.push(h('p', { class: 'chart-title', style: { marginTop: '10px' } }, 'Vesting schedules still running'));
    parts.push(h('ul', { class: 'summary-list' }, ongoing.map((s) => h('li', {},
      h('b', {}, s.label), ': ',
      s.type === 'monthly'
        ? `monthly until ${monthYear(Date.parse(`${s.to}-01T00:00:00Z`))}${s.tokensPerPeriod != null ? `, ${compact(s.tokensPerPeriod, 2)} ${sym} (${shareText(s.sharePerPeriod)} of supply) a month` : ', amount not published'}`
        : `linear ${s.start ? `from ${date(Date.parse(`${s.start}T00:00:00Z`))} ` : ''}until ${s.end.length === 7 ? monthYear(Date.parse(`${s.end}-01T00:00:00Z`)) : date(Date.parse(`${s.end}T00:00:00Z`))}${s.tokens != null ? `, ${compact(s.tokens, 2)} ${sym} in total` : ''}${s.tokensPerMonth != null ? ` (about ${compact(s.tokensPerMonth, 2)} a month on average)` : ''}`,
      s.basis ? h('div', { class: 'meta', style: { fontSize: '12.5px', color: 'var(--ink-2)', marginTop: '2px' } }, s.basis) : null))));
  }
  const srcs = (u.sources || []).filter((s) => s.url);
  parts.push(h('p', { class: 'source-line' },
    term('Unlocks', 'unlock'), ' manually sourced from ',
    srcs.length ? srcs.flatMap((s, i) => [i ? ' and ' : '', extLink(s.url, s.label)]) : 'no published source',
    u.lastChecked ? `; last checked ${date(Date.parse(`${u.lastChecked}T00:00:00Z`))}.` : '.',
    u.supplyUsed ? ` Token amounts are the docs’ share × CoinGecko’s ${u.supplyUsed.basis} (${compact(u.supplyUsed.value, 2)} ${sym}).` : ''));
  return h('div', { class: 'unlocks' }, parts);
}

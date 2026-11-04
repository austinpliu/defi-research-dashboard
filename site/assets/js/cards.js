// Chart card: takeaway headline → chart → legend → source line, with
// PNG / Table / CSV buttons. Every chart has a table-view twin.
import { h, append, takeaway as takeawayEl, sourceLine, svgIcon, unavailable, term } from './ui.js';
import { mountChart, updateChart } from './charts.js';
import { exportCardPNG, downloadCSV } from './export.js';
import { dataTable } from './table.js';
import { dateTime } from './format.js';

const pending = [];

/** Mount every chart created since the last call (call after the page is in the DOM). */
export function mountPending() {
  // charts whose card isn't in the page yet stay queued for the next call
  for (let i = 0; i < pending.length;) {
    const { el, build, onClick } = pending[i];
    if (el.isConnected) {
      pending.splice(i, 1);
      mountChart(el, build, { onClick });
    } else i++;
  }
}

/** Forget queued charts (called on navigation so detached pages don't pile up). */
export function clearPending() {
  pending.length = 0;
}

export function sourceText(srcs, sources = {}) {
  const list = (Array.isArray(srcs) ? srcs : [srcs]).filter(Boolean);
  return list
    .map((s) => {
      if (s.derived) return `Calculated: ${s.formula} (inputs: ${(s.from || []).map((k) => sources[k]?.name || k).join(', ')})`;
      const when = s.stale ? s.stale.lastGoodAt : s.fetchedAt;
      return `Source: ${s.name}${s.label ? ` (${s.label})` : ''}${s.page ? ` — ${s.page}` : ''}${s.api ? ` · API: ${s.api}` : ''}${when ? ` · fetched ${dateTime(when)}` : ''}${s.stale ? ' (stale)' : ''}`;
    })
    .join('   ');
}

/**
 * opts: { kicker, take, fallback, title, note, size: ''|'tall'|'short'|'mini', controls, legend:[{name,color,box}],
 *         src, sources, table: () => ({columns, rows}), csvName, build, onClick, callouts, unavailableReason, big }
 */
export function chartCard(opts) {
  const card = h('section', { class: 'card chart-card' });
  // kicker and tools share the top row so the headline gets the full width
  const tools = h('div', { class: 'card-tools' });
  const head = h('div', { class: 'card-top' }, h('div', { class: 'kicker' }, opts.kicker || ''), tools);
  let titleEl = takeawayEl(opts.take, opts.fallback || opts.title, { big: opts.big });
  card.append(head, titleEl);

  if (opts.unavailableReason) {
    if (opts.title) card.append(h('p', { class: 'chart-title' }, opts.title));
    card.append(unavailable('Unavailable', opts.unavailableReason));
    if (opts.src) card.append(sourceLine(opts.src, { sources: opts.sources }));
    return card;
  }

  // chart title, with a (?) glossary tooltip for the metric when termKey is given
  const titleText = h('span', {}, opts.title || '');
  const titleP = opts.title ? h('p', { class: 'chart-title' }, titleText, opts.termKey ? [' ', term('', opts.termKey).lastChild] : null) : null;
  if (titleP) card.append(titleP);
  if (opts.note) card.append(h('p', { class: 'chart-note' }, opts.note));
  if (opts.controls) card.append(h('div', { class: 'chart-controls' }, opts.controls));

  const chartEl = h('div', { class: `chart ${opts.size || ''}`.trim(), role: 'img', 'aria-label': opts.title || titleEl.dataset.plain });
  const legendEl = h('ul', { class: 'legend' });
  const tableHolder = h('div', { hidden: true });
  const body = opts.callouts ? h('div', { class: 'with-callout' }, h('div', { style: { minWidth: 0 } }, chartEl, legendEl), h('div', { class: 'callouts' }, opts.callouts)) : h('div', {}, chartEl, legendEl);
  card.append(body, tableHolder);
  const srcEl = h('div');
  card.append(srcEl);

  const state = { take: opts.take, title: opts.title, legend: opts.legend || [], src: opts.src, table: opts.table };
  const renderLegend = () => {
    legendEl.replaceChildren(...state.legend.map((l) => h('li', {}, h('span', { class: `key${l.box ? ' box' : ''}`, style: { background: l.color } }), l.name)));
    legendEl.hidden = !state.legend.length;
  };
  renderLegend();
  srcEl.replaceChildren(sourceLine(state.src, { sources: opts.sources }));

  // tools
  const tableBtn = h('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', title: 'Show the numbers behind this chart' }, svgIcon('table'), 'Table');
  tableBtn.addEventListener('click', () => {
    const show = tableHolder.hidden;
    tableHolder.hidden = !show;
    tableBtn.setAttribute('aria-pressed', String(show));
    if (show) {
      const t = state.table?.();
      tableHolder.replaceChildren(t ? dataTable({ ...t, search: false, pageSize: 15, csvName: opts.csvName || titleEl.dataset.plain }) : h('p', { class: 'muted' }, 'No table for this chart.'));
    }
  });
  const pngBtn = h('button', { type: 'button', class: 'tool', title: 'Download this chart as a PNG (with headline and source)' }, svgIcon('img'), 'PNG');
  pngBtn.addEventListener('click', async () => {
    pngBtn.disabled = true;
    try {
      await exportCardPNG({
        card,
        chartEl,
        kicker: opts.kicker,
        takeaway: state.take ? state.take : { plain: titleEl.dataset.plain },
        title: state.title,
        legend: state.legend,
        sourceText: sourceText(state.src, opts.sources),
        filename: titleEl.dataset.plain,
      });
    } finally {
      pngBtn.disabled = false;
    }
  });
  const csvBtn = h('button', { type: 'button', class: 'tool', title: 'Download the chart data as CSV' }, svgIcon('csv'), 'CSV');
  csvBtn.addEventListener('click', () => {
    const t = state.table?.();
    if (!t) return;
    const cols = t.columns.map((c) => ({ label: c.label, get: (r) => (c.csv ? c.csv(r) : r[c.key]) }));
    downloadCSV(opts.csvName || titleEl.dataset.plain, cols, t.rows);
  });
  append(tools, [pngBtn, tableBtn, csvBtn]);

  pending.push({ el: chartEl, build: opts.build, onClick: opts.onClick });

  /** Update chart + headline + legend + sources (e.g. after a range toggle). */
  card.update = (next) => {
    if (next.take !== undefined || next.fallback !== undefined) {
      state.take = next.take;
      const nt = takeawayEl(next.take, next.fallback || opts.fallback || opts.title, { big: opts.big });
      titleEl.replaceWith(nt);
      titleEl = nt;
      chartEl.setAttribute('aria-label', state.title || nt.dataset.plain);
    }
    if (next.title !== undefined && titleP) { state.title = next.title; titleText.textContent = next.title; }
    if (next.legend) { state.legend = next.legend; renderLegend(); }
    if (next.src) { state.src = next.src; srcEl.replaceChildren(sourceLine(state.src, { sources: opts.sources })); }
    if (next.table) state.table = next.table;
    if (next.build) updateChart(chartEl, next.build);
    if (!tableHolder.hidden) { tableHolder.hidden = true; tableBtn.click(); }
  };
  card.chartEl = chartEl;
  return card;
}

/** A plain (non-chart) card with a headline + body + source line. */
export function infoCard({ kicker, take, fallback, title, body, src, sources, tools }) {
  const card = h('section', { class: 'card' });
  const head = h('div', { class: 'card-top' }, h('div', { class: 'kicker' }, kicker || ''), tools ? h('div', { class: 'card-tools' }, tools) : null);
  card.append(head, takeawayEl(take, fallback || title));
  if (title && (take || fallback)) card.append(h('p', { class: 'chart-title' }, title));
  append(card, [body]);
  if (src) card.append(sourceLine(src, { sources }));
  return card;
}

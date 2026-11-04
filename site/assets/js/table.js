// Sortable, searchable, filterable table with CSV export.
// columns: [{ key, label, termKey?, num?, fmt?(v,row) → string|Node, sortValue?(row), csv?(row), wrap?, title? }]
// filters: [{ key, label, multi? }]  — key's values can be strings or arrays (e.g. chains)
import { h, append, term, svgIcon } from './ui.js';
import { downloadCSV } from './export.js';

export function dataTable({
  columns, rows, id, sortKey, sortDir = 'desc', search = true, searchKeys, filters = [], pageSize = 25, csvName = 'table',
  rowClass, caption, csvExtra = [], emptyText = 'No rows match these filters.', footer,
}) {
  const state = { sortKey, sortDir, q: '', filters: Object.fromEntries(filters.map((f) => [f.key, ''])), limit: pageSize };
  const root = h('div', { class: 'table-block' });
  const tools = h('div', { class: 'table-tools' });
  const count = h('span', { class: 'table-count', 'aria-live': 'polite' });
  const wrap = h('div', { class: 'table-wrap' });
  const more = h('div', { class: 'table-more' });

  if (search) {
    const input = h('input', { type: 'search', placeholder: 'Search…', 'aria-label': `Search ${caption || 'table'}` });
    input.addEventListener('input', () => { state.q = input.value.trim().toLowerCase(); state.limit = pageSize; render(); });
    tools.append(input);
  }
  for (const f of filters) {
    const values = new Map();
    for (const r of rows) {
      const v = r[f.key];
      for (const x of Array.isArray(v) ? v : [v]) if (x) values.set(x, (values.get(x) || 0) + 1);
    }
    const opts = [...values.entries()].sort((a, b) => b[1] - a[1]);
    if (opts.length < 2) continue;
    const sel = h('select', { 'aria-label': `Filter by ${f.label}` },
      h('option', { value: '' }, `All ${f.plural || `${f.label.toLowerCase()}s`}`),
      opts.map(([v, n]) => h('option', { value: v }, `${v} (${n})`)));
    sel.addEventListener('change', () => { state.filters[f.key] = sel.value; state.limit = pageSize; render(); });
    tools.append(sel);
  }
  tools.append(h('span', { class: 'spacer' }), count,
    h('button', { type: 'button', class: 'tool', onclick: () => exportCSV() }, svgIcon('csv'), 'CSV'));

  const filtered = () => {
    let out = rows;
    if (state.q) {
      const keys = searchKeys || columns.map((c) => c.key);
      out = out.filter((r) => keys.some((k) => String(Array.isArray(r[k]) ? r[k].join(' ') : r[k] ?? '').toLowerCase().includes(state.q)));
    }
    for (const [k, v] of Object.entries(state.filters)) {
      if (!v) continue;
      out = out.filter((r) => (Array.isArray(r[k]) ? r[k].includes(v) : r[k] === v));
    }
    if (state.sortKey) {
      const col = columns.find((c) => c.key === state.sortKey);
      const val = (r) => (col?.sortValue ? col.sortValue(r) : r[state.sortKey]);
      const dir = state.sortDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const xn = x === null || x === undefined || Number.isNaN(x);
        const yn = y === null || y === undefined || Number.isNaN(y);
        if (xn && yn) return 0;
        if (xn) return 1; // blanks always last
        if (yn) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y)) * dir;
      });
    }
    return out;
  };

  function headerCell(c) {
    const sorted = state.sortKey === c.key;
    const th = h('th', { class: c.num ? 'n' : '', scope: 'col', 'aria-sort': sorted ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : null, title: c.title || null });
    const btn = h('button', { type: 'button', 'aria-label': `Sort by ${c.label}` }, c.label, h('span', { class: 'arrow', 'aria-hidden': 'true' }, sorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '↕'));
    btn.addEventListener('click', () => {
      if (state.sortKey === c.key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = c.key; state.sortDir = c.num ? 'desc' : 'asc'; }
      render();
    });
    th.append(btn);
    if (c.termKey) th.append(' ', term('', c.termKey).lastChild);
    return th;
  }

  function render() {
    const list = filtered();
    count.textContent = `${list.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows`;
    const table = h('table', { class: 'data', id: id || null });
    if (caption) table.append(h('caption', { class: 'sr-only' }, caption));
    table.append(h('thead', {}, h('tr', {}, columns.map(headerCell))));
    const tbody = h('tbody');
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: columns.length, class: 'muted' }, emptyText)));
    for (const r of list.slice(0, state.limit)) {
      const tr = h('tr', { class: rowClass ? rowClass(r) || null : null });
      for (const c of columns) {
        const v = r[c.key];
        const out = c.fmt ? c.fmt(v, r) : v ?? '—';
        tr.append(append(h('td', { class: [c.num ? 'n' : '', c.wrap ? 'wrap' : ''].join(' ').trim() || null }), [out]));
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.replaceChildren(table);
    more.replaceChildren();
    if (list.length > state.limit) {
      more.append(h('button', { type: 'button', class: 'tool', onclick: () => { state.limit += pageSize * 2; render(); } }, `Show more (${list.length - state.limit} hidden)`));
    }
  }

  function exportCSV() {
    const list = filtered();
    const cols = [...columns.map((c) => ({ label: c.label, get: (r) => (c.csv ? c.csv(r) : Array.isArray(r[c.key]) ? r[c.key].join('; ') : r[c.key]) })), ...csvExtra];
    downloadCSV(csvName, cols, list);
  }

  append(root, [tools, wrap, more, footer || null]);
  render();
  root.refresh = render;
  return root;
}

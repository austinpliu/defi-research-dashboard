// ECharts wrappers that implement the house style: hairline horizontal grid only,
// 2px lines, thin bars with 4px rounded ends, direct labels, one y-axis (never two),
// colors read from CSS variables so light/dark mode and section accents just work.
/* global echarts */
import { usd, compact, pct, date, shortDate, monthYear } from './format.js';

const registry = new Set();

export function themeOf(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), grid: v('--grid'), axis: v('--axis'),
    surface: v('--surface'), border: v('--border-strong'), mark: v('--mark') || v('--s1'), marker: v('--marker'),
    up: v('--up'), down: v('--down'), other: v('--s-other'),
    s: ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(v),
    green: v('--green-mark'), red: '#d9423f',
  };
}

/** Mount a chart. build(theme) returns an ECharts option. Re-runs on resize/theme change. */
export function mountChart(el, build, { onClick } = {}) {
  if (typeof echarts === 'undefined') {
    el.textContent = 'Chart library failed to load.';
    return null;
  }
  const inst = echarts.init(el, null, { renderer: 'canvas' });
  const entry = { el, inst, build };
  registry.add(entry);
  inst.setOption(build(themeOf(el)), true);
  if (onClick) inst.on('click', onClick);
  const ro = new ResizeObserver(() => inst.resize());
  ro.observe(el);
  entry.ro = ro;
  el.__chart = inst;
  el.__entry = entry;
  return inst;
}

export function updateChart(el, build) {
  const entry = el.__entry;
  if (!entry) return mountChart(el, build);
  entry.build = build;
  entry.inst.setOption(build(themeOf(el)), true);
  return entry.inst;
}

export function disposeAll() {
  for (const e of registry) {
    e.ro?.disconnect();
    e.inst.dispose();
  }
  registry.clear();
}

export function rethemeAll() {
  for (const e of registry) e.inst.setOption(e.build(themeOf(e.el)), true);
}

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
// Date ticks: "2026" at year starts, "Mar" at month starts, "Mar 8" for days in between.
const TIME_LABELS = { year: '{yyyy}', month: '{MMM}', day: '{MMM} {d}', hour: '{MMM} {d}', minute: '{MMM} {d}', second: '{MMM} {d}', millisecond: '{MMM} {d}', none: '{MMM} {d}' };

function tooltipBase(t) {
  return {
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 11],
    textStyle: { color: t.ink, fontSize: 12, fontFamily: FONT },
    extraCssText: 'border-radius:10px;box-shadow:0 10px 28px -14px rgba(0,0,0,.45);',
    className: 'ec-tip',
    confine: true,
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function base(t) {
  return {
    animationDuration: 500,
    animationDurationUpdate: 300,
    textStyle: { fontFamily: FONT, color: t.ink2 },
    aria: { enabled: true },
  };
}

export const fmtAxisUsd = (v) => {
  const a = Math.abs(v);
  if (a < 1e4) return `${v < 0 ? '−' : ''}$${a.toLocaleString('en-US', { maximumFractionDigits: a < 1 ? 3 : a % 1 ? 2 : 0 })}`;
  return usd(v, { digits: a >= 1e9 && a < 1e10 ? 1 : 0 }).replace('.0B', 'B');
};

/**
 * Time-series line chart.
 * series: [{ name, data: [[unixSec, value]], color?, label? }]
 */
export function lineChart({ series, fmt = usd, axisFmt = fmtAxisUsd, area = false, endLabels = true, minZero = false, markToday = false, yName }) {
  return (t) => {
    const many = series.length > 1;
    return {
      ...base(t),
      grid: { left: 6, right: endLabels ? (many ? 112 : 70) : 14, top: 18, bottom: 6, containLabel: true },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, hideOverlap: true, fontSize: 11, formatter: TIME_LABELS },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: yName,
        nameTextStyle: { color: t.muted, fontSize: 11 },
        scale: !minZero,
        axisLabel: { color: t.muted, fontSize: 11, formatter: axisFmt },
        splitLine: { lineStyle: { color: t.grid, width: 1 } },
        axisLine: { show: false },
        splitNumber: 4,
      },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.axis, width: 1 } },
        formatter: (ps) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          if (!arr.length) return '';
          const head = `<div class="d">${esc(date(arr[0].value[0]))}</div>`;
          const rows = arr
            .slice()
            .sort((a, b) => (b.value[1] ?? -Infinity) - (a.value[1] ?? -Infinity))
            .map((p) => `<div><span class="k" style="background:${p.color}"></span><span class="v">${esc(fmt(p.value[1]))}</span> <span style="color:${t.muted}">${esc(p.seriesName)}</span></div>`)
            .join('');
          return head + rows;
        },
      },
      series: series.map((s, i) => {
        const color = s.color || (many ? t.s[i % 8] : t.mark);
        return {
          type: 'line',
          name: s.name,
          data: s.data.map(([ts, v]) => [ts * 1000, v]),
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          sampling: 'lttb',
          lineStyle: { width: 2, color, cap: 'round', join: 'round' },
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          areaStyle: area && !many ? { color, opacity: 0.12 } : undefined,
          emphasis: { focus: many ? 'series' : 'none', lineStyle: { width: 2.5 } },
          endLabel: endLabels
            ? { show: true, formatter: (p) => (many ? `${s.label || s.name}  ${fmt(p.value[1])}` : fmt(p.value[1])), color: t.ink, fontWeight: 650, fontSize: 11.5, fontFamily: FONT, distance: 6 }
            : undefined,
          labelLayout: many ? { moveOverlap: 'shiftY' } : undefined,
          markLine: markToday && i === 0
            ? { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, label: { color: t.muted, formatter: 'today' }, data: [{ xAxis: Date.now() }] }
            : undefined,
        };
      }),
    };
  };
}

/** Columns over time (daily or weekly), single series. data: [[unixSec, value]] */
export function columnChart({ data, fmt = usd, axisFmt = fmtAxisUsd, name = '', color, labelLast = true, period = 'day' }) {
  return (t) => {
    const c = color || t.mark;
    const n = data.length;
    return {
      ...base(t),
      grid: { left: 6, right: labelLast ? 44 : 14, top: labelLast ? 26 : 14, bottom: 6, containLabel: true },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.muted, hideOverlap: true, fontSize: 11, formatter: TIME_LABELS }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: axisFmt }, splitLine: { lineStyle: { color: t.grid } }, axisLine: { show: false }, splitNumber: 4 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,0.08)' } },
        formatter: (ps) => {
          const p = Array.isArray(ps) ? ps[0] : ps;
          const label = period === 'week' ? `Week ending ${date(p.value[0])}` : period === 'month' ? monthYear(p.value[0]) : date(p.value[0]);
          return `<div class="d">${esc(label)}</div><div><span class="v">${esc(fmt(p.value[1]))}</span> <span style="color:${t.muted}">${esc(name)}</span></div>`;
        },
      },
      series: [{
        type: 'bar',
        name,
        data: data.map(([ts, v], i) => ({ value: [ts * 1000, v], label: labelLast && i === n - 1 ? { show: true, position: 'top', formatter: () => fmt(v), color: t.ink, fontWeight: 650, fontSize: 11.5 } : undefined })),
        barMaxWidth: 22,
        barCategoryGap: '25%',
        itemStyle: { color: c, borderRadius: [3, 3, 0, 0] },
        emphasis: { itemStyle: { opacity: 0.8 } },
      }],
    };
  };
}

/**
 * Horizontal ranked bars, single series (one color), value label at the tip.
 * items: [{ name, value, sub?, highlight? }] in display order (largest first).
 */
export function hbarChart({ items, fmt = usd, name = '', color, highlightColor, onClickName }) {
  return (t) => {
    const c = color || t.mark;
    const rev = [...items].reverse();
    return {
      ...base(t),
      grid: { left: 6, right: 74, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: true, axisLabel: { show: false }, splitLine: { lineStyle: { color: t.grid } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: {
        type: 'category',
        data: rev.map((d) => d.name),
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.ink2, fontWeight: 600, fontSize: 12, width: 130, overflow: 'truncate', formatter: (v) => v },
        triggerEvent: Boolean(onClickName),
      },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'item',
        formatter: (p) => {
          const d = rev[p.dataIndex];
          return `<div class="d">${esc(d.name)}</div><div><span class="v">${esc(fmt(d.value))}</span> <span style="color:${t.muted}">${esc(name)}</span></div>${d.sub ? `<div style="color:${t.muted}">${esc(d.sub)}</div>` : ''}`;
        },
      },
      series: [{
        type: 'bar',
        name,
        data: rev.map((d) => ({ value: d.value, itemStyle: { color: d.highlight ? highlightColor || t.ink : c } })),
        barMaxWidth: 20,
        barCategoryGap: '32%',
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', formatter: (p) => fmt(p.value), color: t.ink, fontWeight: 650, fontSize: 11.5, fontFamily: FONT },
        emphasis: { itemStyle: { opacity: 0.85 } },
      }],
    };
  };
}

/** Diverging horizontal bars for gains/losses. items: [{ name, value (pct) }] */
export function divergingChart({ items, fmt = (v) => pct(v, { digits: 0 }) }) {
  return (t) => {
    const rev = [...items].reverse();
    const max = Math.max(...items.map((d) => Math.abs(d.value)), 1);
    return {
      ...base(t),
      grid: { left: 6, right: 56, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', min: -max * 1.15, max: max * 1.15, axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'category', data: rev.map((d) => d.name), axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.ink2, fontWeight: 600, fontSize: 12, width: 120, overflow: 'truncate' } },
      tooltip: { ...tooltipBase(t), trigger: 'item', formatter: (p) => { const d = rev[p.dataIndex]; return `<div class="d">${esc(d.name)}</div><div><span class="v">${esc(fmt(d.value))}</span> <span style="color:${t.muted}">${esc(d.sub || '')}</span></div>`; } },
      series: [{
        type: 'bar',
        data: rev.map((d) => ({ value: d.value, itemStyle: { color: d.value >= 0 ? t.up : t.down, borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
        barMaxWidth: 18,
        barCategoryGap: '34%',
        label: { show: true, position: 'right', formatter: (p) => fmt(p.value), color: t.ink, fontWeight: 650, fontSize: 11.5, fontFamily: FONT },
      }],
    };
  };
}

/**
 * Stacked columns over time. series: [{ name, data: [[unixSec, v]] }] aligned on the same timestamps.
 * Colors follow the entity (fixed palette order); the last series may be "Other" (gray).
 */
export function stackedColumns({ series, fmt = usd, axisFmt = fmtAxisUsd, period = 'month' }) {
  return (t) => {
    // a category axis gives every period an equal, readable column (time axes squeeze bars)
    const stamps = series[0]?.data.map(([ts]) => ts) || [];
    const label = (ts) => (period === 'month' ? monthYear(ts) : shortDate(ts));
    return {
      ...base(t),
      grid: { left: 6, right: 14, top: 14, bottom: 6, containLabel: true },
      xAxis: {
        type: 'category',
        data: stamps.map(label),
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => (v.startsWith('Jan') ? v.slice(4) : v.slice(0, 3)) },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', axisLabel: { color: t.muted, fontSize: 11, formatter: axisFmt }, splitLine: { lineStyle: { color: t.grid } }, axisLine: { show: false }, splitNumber: 4 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,0.08)' } },
        formatter: (ps) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          const total = arr.reduce((s, p) => s + (p.value || 0), 0);
          return `<div class="d">${esc(arr[0].axisValue)} · total ${esc(fmt(total))}</div>${arr.slice().reverse().map((p) => `<div><span class="k" style="background:${p.color};height:8px;width:8px"></span><span class="v">${esc(fmt(p.value))}</span> <span style="color:${t.muted}">${esc(p.seriesName)}</span></div>`).join('')}`;
        },
      },
      series: series.map((s, i) => ({
        type: 'bar',
        name: s.name,
        stack: 'total',
        data: s.data.map(([, v]) => v),
        barMaxWidth: 22,
        barCategoryGap: '18%',
        itemStyle: { color: s.color || (s.other ? t.other : t.s[i % 8]), borderColor: t.surface, borderWidth: 1 },
        emphasis: { focus: 'series' },
      })),
    };
  };
}

/** Catalyst timeline: swimlanes (one per token), dots by type, a "today" line. */
export function timelineChart({ items, lanes, typeMeta, from, to, onOpen }) {
  return (t) => {
    const types = Object.keys(typeMeta);
    return {
      ...base(t),
      grid: { left: 6, right: 18, top: 28, bottom: 6, containLabel: true },
      xAxis: { type: 'time', min: from, max: to, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.muted, hideOverlap: true, fontSize: 11, formatter: TIME_LABELS }, splitLine: { show: true, lineStyle: { color: t.grid } } },
      yAxis: { type: 'category', data: lanes, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink2, fontWeight: 650, fontSize: 12 }, splitLine: { show: true, lineStyle: { color: t.grid } } },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'item',
        formatter: (p) => {
          const it = p.data.item;
          return `<div class="d">${esc(date(it.date))} · ${esc(typeMeta[it.type]?.label || it.type)}</div><div style="max-width:280px;white-space:normal"><span class="v">${esc(it.title)}</span></div><div style="color:${t.muted}">${esc(it.sourceName)} — click to open</div>`;
        },
      },
      series: types.map((ty, i) => ({
        type: 'scatter',
        name: typeMeta[ty].label,
        symbol: typeMeta[ty].symbol,
        symbolSize: 13,
        itemStyle: { color: t.s[typeMeta[ty].slot % 8], borderColor: t.surface, borderWidth: 2, opacity: 0.95 },
        emphasis: { scale: 1.4 },
        data: items.filter((it) => it.type === ty).map((it) => ({ value: [Date.parse(it.date), it.lane], item: it })),
        markLine: i === 0 ? { silent: true, symbol: 'none', lineStyle: { color: t.ink, width: 1.5, type: 'solid' }, label: { formatter: 'Today', color: t.ink, fontWeight: 700, position: 'end' }, data: [{ xAxis: Date.now() }] } : undefined,
      })),
    };
  };
}

export { compact };

// Downloads: tables as CSV, chart cards as PNG (headline + chart + source line,
// ready to drop into an article).
/* global echarts */
import { themeOf } from './charts.js';

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeName(s) {
  return String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
}

export function toCSV(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.get(r))).join(','));
  return lines.join('\r\n');
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function downloadCSV(name, columns, rows) {
  const csv = `﻿${toCSV(columns, rows)}`; // BOM so Excel reads UTF-8
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeName(name)}-${stamp()}.csv`);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Word-wrap rich text (runs with a highlight flag) into lines of runs. */
function layoutRuns(ctx, runs, maxWidth) {
  const words = [];
  for (const r of runs) {
    const parts = r.text.split(/(\s+)/).filter((p) => p.length);
    for (const p of parts) words.push({ text: p, hl: r.hl, space: /^\s+$/.test(p) });
  }
  const lines = [[]];
  let width = 0;
  for (const w of words) {
    const ww = ctx.measureText(w.text).width;
    if (!w.space && width + ww > maxWidth && lines[lines.length - 1].length) {
      lines.push([]);
      width = 0;
    }
    if (w.space && !lines[lines.length - 1].length) continue;
    lines[lines.length - 1].push({ ...w, width: ww });
    width += ww;
  }
  return lines;
}

function wrapPlain(ctx, text, maxWidth) {
  return layoutRuns(ctx, [{ text, hl: false }], maxWidth).map((l) => l.map((w) => w.text).join('').trim());
}

/**
 * Compose a PNG: kicker, takeaway headline (with marker), chart title, chart image,
 * legend, source line. Colors come from the card's CSS variables (light or dark).
 */
export async function exportCardPNG({ card, chartEl, kicker, takeaway, title, legend = [], sourceText, filename }) {
  await document.fonts?.ready;
  const cs = getComputedStyle(card);
  const v = (n) => cs.getPropertyValue(n).trim();
  const surface = v('--surface') || '#fbf9f4';
  const ink = v('--ink') || '#0e0e0c';
  const muted = v('--muted') || '#6b685f';
  const marker = v('--marker') || '#f9a83f';
  const mark = v('--mark') || '#ef8417';
  const inst = chartEl?.__chart;
  const W = 1200;
  const PAD = 56;
  const inner = W - PAD * 2;
  const scale = 2;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '800 40px "Inter Tight", Inter, sans-serif';
  const runs = takeaway?.hl
    ? [{ text: takeaway.pre || '', hl: false }, { text: takeaway.hl, hl: true }, { text: takeaway.post || '', hl: false }]
    : [{ text: takeaway?.plain || title || '', hl: false }];
  const headLines = layoutRuns(measure, runs, inner);
  measure.font = '400 15px Inter, sans-serif';
  const srcLines = wrapPlain(measure, sourceText || '', inner);

  let chartImg = null;
  let chartH = 0;
  if (inst) {
    // Re-draw the chart off-screen at the export width, so the image is crisp and
    // the labels keep their normal size (scaling the on-screen canvas blurs it).
    const entry = chartEl.__entry;
    const onScreen = chartEl.getBoundingClientRect();
    const aspect = Math.min(0.62, Math.max(0.4, onScreen.height / Math.max(1, onScreen.width)));
    chartH = Math.round(inner * aspect);
    let url;
    if (entry?.build && typeof echarts !== 'undefined') {
      const tmp = document.createElement('div');
      Object.assign(tmp.style, { position: 'fixed', left: '-10000px', top: '0', width: `${inner}px`, height: `${chartH}px` });
      card.append(tmp); // inside the card so section colours (CSS variables) apply
      const off = echarts.init(tmp, null, { renderer: 'canvas', devicePixelRatio: 2 });
      off.setOption({ ...entry.build(themeOf(card)), animation: false }, true);
      url = off.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: surface });
      off.dispose();
      tmp.remove();
    } else {
      url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: surface });
    }
    chartImg = await loadImage(url);
    if (!entry?.build) chartH = Math.round((chartImg.height / chartImg.width) * inner);
  }

  const headLH = 48;
  const H = PAD + 26 + 14 + headLines.length * headLH + 12 + (title ? 30 : 0) + (chartImg ? chartH + 16 : 0) + (legend.length ? 30 : 0) + 18 + srcLines.length * 21 + 26 + PAD - 20;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = mark;
  ctx.fillRect(0, 0, W, 6);

  let y = PAD;
  // kicker
  if (kicker) {
    ctx.fillStyle = mark;
    ctx.fillRect(PAD, y + 4, 12, 12);
    ctx.fillStyle = muted;
    ctx.font = '700 13px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(kicker.toUpperCase(), PAD + 20, y + 3);
  }
  y += 26 + 14;

  // headline with marker blocks
  ctx.font = '800 40px "Inter Tight", Inter, sans-serif';
  ctx.textBaseline = 'alphabetic';
  for (const line of headLines) {
    let x = PAD;
    // draw highlight rectangles first (merge contiguous highlighted words)
    let hlStart = null;
    for (let i = 0; i <= line.length; i++) {
      const w = line[i];
      if (w && w.hl && hlStart === null) hlStart = x;
      if ((!w || !w.hl) && hlStart !== null) {
        ctx.fillStyle = marker;
        let end = x;
        // don't extend the marker over a trailing space
        if (line[i - 1]?.space) end -= line[i - 1].width;
        ctx.fillRect(hlStart - 4, y + 4, end - hlStart + 8, headLH - 4);
        hlStart = null;
      }
      if (w) x += w.width;
    }
    x = PAD;
    for (const w of line) {
      ctx.fillStyle = w.hl ? '#0e0e0c' : ink;
      ctx.fillText(w.text, x, y + 40);
      x += w.width;
    }
    y += headLH;
  }
  y += 12;
  if (title) {
    ctx.fillStyle = ink;
    ctx.font = '700 17px Inter, sans-serif';
    ctx.fillText(title, PAD, y + 18);
    y += 30;
  }
  if (chartImg) {
    ctx.drawImage(chartImg, PAD, y, inner, chartH);
    y += chartH + 16;
  }
  if (legend.length) {
    let x = PAD;
    ctx.font = '600 13px Inter, sans-serif';
    for (const l of legend) {
      ctx.fillStyle = l.color;
      ctx.fillRect(x, y + 6, 14, 4);
      ctx.fillStyle = ink;
      ctx.fillText(l.name, x + 20, y + 13);
      x += 20 + ctx.measureText(l.name).width + 18;
    }
    y += 30;
  }
  y += 8;
  ctx.fillStyle = muted;
  ctx.font = '400 15px Inter, sans-serif';
  for (const l of srcLines) {
    ctx.fillText(l, PAD, y + 15);
    y += 21;
  }
  ctx.font = '700 13px Inter, sans-serif';
  ctx.fillStyle = muted;
  const brand = 'DeFi Research Dashboard';
  ctx.fillText(brand, W - PAD - ctx.measureText(brand).width, H - PAD + 30);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  downloadBlob(blob, `${safeName(filename || takeaway?.plain || title)}-${stamp()}.png`);
}

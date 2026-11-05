// Graph view of notes and their links: a canvas force layout with drag, zoom, pan,
// hover to highlight neighbours, click to open, folder/tag filters, and "draw a link"
// (drag from one note to another adds [[target]] to the first note).
import { h, svgIcon } from '../ui.js';
import * as store from './store.js';
import { buildIndex, basename, dirname, parseTags, appendLink, linkTextFor } from './model.js';
import { noteHref } from './workspace.js';
import { toast } from './dialog.js';

const hash = (s) => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; };

export function renderGraph(main, { focus = null, tag = '', folder = '' } = {}) {
  const touch = matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 760px)').matches;
  const opts = { tag, folder, ghosts: false, drawMode: false };
  const all = () => store.liveNotes();
  const tags = [...new Set(all().flatMap((n) => parseTags(n.body)))].sort();
  const folders = store.allFolders();

  const canvas = h('canvas', { class: 'ng-canvas', role: 'img', tabindex: 0 });
  // colours come from the page (section accent and light/dark tokens), read once per frame
  let pal = null;
  const css = (name, fallback) => getComputedStyle(canvas.isConnected ? canvas : document.documentElement).getPropertyValue(name).trim() || fallback;
  const readPalette = () => { pal = { s: Array.from({ length: 8 }, (_, i) => css(`--s${i + 1}`, '#2a78d6')), other: css('--s-other', '#a8a397') }; };
  const info = h('div', { class: 'ng-info', 'aria-live': 'polite' });
  const folderSel = h('select', { class: 'nw-filter', 'aria-label': 'Show one folder' }, h('option', { value: '' }, 'All folders'), folders.map((f) => h('option', { value: f, selected: f === folder }, f)));
  const tagSel = h('select', { class: 'nw-filter', 'aria-label': 'Show one tag' }, h('option', { value: '' }, 'All tags'), tags.map((t) => h('option', { value: t, selected: t === tag }, `#${t}`)));
  const ghostBox = h('input', { type: 'checkbox', 'aria-label': 'Show links to notes that don’t exist yet' });
  const drawBtn = h('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', title: 'Drag from one note to another to add a link' }, svgIcon('link'), 'Draw a link');
  const fitBtn = h('button', { type: 'button', class: 'tool' }, 'Fit');
  const legend = h('div', { class: 'ng-legend' });
  const wrap = h('div', { class: 'ng-wrap' }, canvas, info);
  main.replaceChildren(
    h('div', { class: 'ng card' },
      h('div', { class: 'ng-controls' }, folderSel, tagSel, h('label', { class: 'ng-check' }, ghostBox, 'Missing notes'), drawBtn, fitBtn),
      wrap,
      legend,
      h('p', { class: 'ng-help' }, touch
        ? 'Tap a note to see its links, tap again to open it. Drag to move, pinch to zoom. Turn on “Draw a link”, then drag from one note to another.'
        : 'Click a note to open it, hover to see its links. Drag notes to arrange them, scroll to zoom, drag the background to pan. With “Draw a link” on (or holding Shift), drag from one note to another to link them.')));

  // ---------- data ----------
  let nodes = [];
  let edges = [];
  let byId = new Map();
  let neighbours = new Map();
  function build() {
    const idx = buildIndex(store.allNotes());
    const keep = (n) => (!opts.folder || n.path === opts.folder || n.path.startsWith(`${opts.folder}/`)) && (!opts.tag || parseTags(n.body).includes(opts.tag));
    const shown = idx.notes.filter(keep);
    const old = byId;
    const top = (p) => (p.includes('/') ? p.split('/')[0] : '');
    const tops = [...new Set(idx.notes.map((n) => top(n.path)))].sort();
    nodes = shown.map((n) => {
      const prev = old.get(n.path);
      const a = hash(n.path) * Math.PI * 2;
      const r = 80 + hash(`${n.path}r`) * 140;
      return { id: n.path, label: basename(n.path), group: top(n.path), color: tops.indexOf(top(n.path)), x: prev?.x ?? Math.cos(a) * r, y: prev?.y ?? Math.sin(a) * r, vx: 0, vy: 0, deg: 0, ghost: false };
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set();
    edges = [];
    for (const n of shown) {
      for (const l of idx.outgoing.get(n.path) || []) {
        let to = l.to;
        if (!to && opts.ghosts && l.target) {
          to = `ghost:${l.target.toLowerCase()}`;
          if (!byId.has(to)) { const a = hash(to) * Math.PI * 2; const g = { id: to, label: l.target, group: null, color: -1, x: Math.cos(a) * 200, y: Math.sin(a) * 200, vx: 0, vy: 0, deg: 0, ghost: true }; nodes.push(g); byId.set(to, g); }
        }
        if (!to || !byId.has(to) || to === n.path) continue;
        const k = [n.path, to].sort().join('→');
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push({ a: byId.get(n.path), b: byId.get(to) });
      }
    }
    neighbours = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const e of edges) { e.a.deg += 1; e.b.deg += 1; neighbours.get(e.a.id).add(e.b.id); neighbours.get(e.b.id).add(e.a.id); }
    canvas.setAttribute('aria-label', `Graph of ${nodes.filter((n) => !n.ghost).length} notes and ${edges.length} links`);
    const groups = tops.filter((g) => nodes.some((n) => n.group === g));
    legend.replaceChildren(...groups.slice(0, 9).map((g) => h('span', { class: 'ng-key' }, h('i', { style: { background: colorFor(tops.indexOf(g)) } }), g || 'Top level')));
    info.textContent = nodes.length ? '' : 'No notes to show. Create a few notes and link them with [[Note name]].';
    alpha = 1;
  }
  const colorFor = (i) => { if (!pal) readPalette(); return i < 0 ? pal.other : pal.s[i % 8]; };

  // ---------- view transform ----------
  let scale = 1;
  let userView = false; // once you pan or zoom, resizes stop re-fitting
  let ox = 0;
  let oy = 0;
  let W = 0;
  let H = 0;
  const toWorld = (sx, sy) => ({ x: (sx - ox) / scale, y: (sy - oy) / scale });
  function resize() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(280, r.width);
    H = Math.max(320, Math.min(innerHeight * (touch ? 0.62 : 0.7), 680));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function fit() {
    if (!nodes.length) { scale = 1; ox = W / 2; oy = H / 2; return; }
    const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    scale = Math.max(0.2, Math.min(2, Math.min(W / (maxX - minX + 120), H / (maxY - minY + 120))));
    ox = W / 2 - ((minX + maxX) / 2) * scale; oy = H / 2 - ((minY + maxY) / 2) * scale;
  }

  // ---------- simulation ----------
  let alpha = 1;
  let raf = 0;
  let fitted = false;
  function step() {
    const n = nodes.length;
    const rep = 2400;
    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = nodes[j];
        let dx = a.x - b.x; let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 250000) continue;
        const f = (rep / d2) * alpha;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const dx = e.b.x - e.a.x; const dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 70) * 0.02 * alpha;
      e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f; e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
    }
    for (const p of nodes) {
      p.vx -= p.x * 0.004 * alpha; p.vy -= p.y * 0.004 * alpha;
      if (p === dragNode) { p.vx = 0; p.vy = 0; continue; }
      p.vx *= 0.82; p.vy *= 0.82;
      p.x += Math.max(-30, Math.min(30, p.vx)); p.y += Math.max(-30, Math.min(30, p.vy));
    }
    alpha = Math.max(0, alpha * 0.985 - 0.0005);
  }
  function loop() {
    if (!canvas.isConnected) { cancelAnimationFrame(raf); return; }
    if (alpha > 0.002 || dragNode) step();
    if (!fitted && alpha < 0.35) { fit(); fitted = true; }
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ---------- drawing ----------
  let hover = null;
  let selected = focus && store.getNote(focus) ? focus : null;
  let linkFrom = null;
  let pointerWorld = null;
  const radius = (n) => (n.ghost ? 3.5 : 4.5 + Math.sqrt(n.deg) * 2.2) * (touch ? 1.25 : 1);
  function draw() {
    const ctx = canvas.getContext('2d');
    readPalette();
    const ink = css('--ink', '#0e0e0c'); const muted = css('--muted', '#6b685f'); const page = css('--surface', '#fbf9f4'); const axis = css('--axis', '#c9c5b9'); const mark = css('--mark', '#d29e00') || css('--yellow-mark', '#d29e00');
    ctx.clearRect(0, 0, W, H);
    const lit = hover || selected;
    const near = lit ? neighbours.get(lit) || new Set() : null;
    const on = (n) => !lit || n.id === lit || near.has(n.id);
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    ctx.lineWidth = 1 / scale;
    for (const e of edges) {
      const hot = lit && (e.a.id === lit || e.b.id === lit);
      ctx.strokeStyle = hot ? mark : axis;
      ctx.globalAlpha = lit && !hot ? 0.12 : 1;
      ctx.lineWidth = (hot ? 2.2 : 1.3) / scale;
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    }
    if (linkFrom && pointerWorld) {
      ctx.globalAlpha = 1; ctx.strokeStyle = mark; ctx.lineWidth = 2 / scale; ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.beginPath(); ctx.moveTo(linkFrom.x, linkFrom.y); ctx.lineTo(pointerWorld.x, pointerWorld.y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const n of nodes) {
      ctx.globalAlpha = on(n) ? 1 : 0.18;
      const r = radius(n);
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.ghost ? page : colorFor(n.color);
      ctx.fill();
      ctx.lineWidth = (n.id === lit ? 3 : n.ghost ? 1.2 : 1.5) / scale;
      ctx.strokeStyle = n.id === lit ? ink : n.ghost ? muted : page;
      ctx.stroke();
    }
    // labels: around the highlighted note, big hubs, and everything once zoomed in
    const fontPx = 12 / Math.max(scale, 0.6);
    ctx.font = `600 ${fontPx}px ${css('--font', 'system-ui')}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of nodes) {
      const show = lit ? on(n) : !touch && (scale > 1.15 || n.deg >= 3 || nodes.length <= 25);
      if (!show) continue;
      ctx.globalAlpha = 1;
      const text = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
      const y = n.y + radius(n) + 3 / scale;
      ctx.lineWidth = 3 / scale; ctx.strokeStyle = page; ctx.strokeText(text, n.x, y);
      ctx.fillStyle = n.ghost ? muted : ink; ctx.fillText(text, n.x, y);
    }
    ctx.restore();
  }

  // ---------- interaction ----------
  const pick = (sx, sy) => {
    const w = toWorld(sx, sy);
    let best = null; let bd = Infinity;
    for (const n of nodes) { const d = Math.hypot(n.x - w.x, n.y - w.y); const hit = radius(n) + (touch ? 14 : 6) / scale; if (d < hit && d < bd) { best = n; bd = d; } }
    return best;
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pointers = new Map();
  let dragNode = null;
  let panning = null;
  let moved = false;
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    pointers.set(e.pointerId, p);
    moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; dragNode = null; panning = null; linkFrom = null; return; }
    const n = pick(p.x, p.y);
    if (n && !n.ghost && (opts.drawMode || e.shiftKey)) { linkFrom = n; pointerWorld = toWorld(p.x, p.y); }
    else if (n) { dragNode = n; alpha = Math.max(alpha, 0.3); }
    else panning = { x: p.x, y: p.y, ox, oy };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const ns = Math.max(0.15, Math.min(4, pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
      userView = true;
      const w = toWorld(pinch.cx, pinch.cy); scale = ns; ox = pinch.cx - w.x * scale; oy = pinch.cy - w.y * scale; moved = true; return;
    }
    if (linkFrom) { pointerWorld = toWorld(p.x, p.y); hover = pick(p.x, p.y)?.id || null; moved = true; return; }
    if (dragNode) { const w = toWorld(p.x, p.y); if (Math.hypot(w.x - dragNode.x, w.y - dragNode.y) * scale > 3) moved = true; dragNode.x = w.x; dragNode.y = w.y; alpha = Math.max(alpha, 0.2); return; }
    if (panning) { if (Math.hypot(p.x - panning.x, p.y - panning.y) > 3) { moved = true; userView = true; } ox = panning.ox + p.x - panning.x; oy = panning.oy + p.y - panning.y; return; }
    if (!touch) { const n = pick(p.x, p.y); hover = n?.id || null; canvas.style.cursor = n ? (opts.drawMode || e.shiftKey ? 'crosshair' : 'pointer') : 'grab'; }
  });
  const end = async (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const p = pos(e);
    if (linkFrom) {
      const to = pick(p.x, p.y);
      const from = linkFrom;
      linkFrom = null; pointerWorld = null;
      if (to && to.id !== from.id) await addLink(from, to);
      return;
    }
    const n = dragNode || (!moved ? pick(p.x, p.y) : null);
    dragNode = null; panning = null;
    if (!moved && n) {
      if (n.ghost) { location.hash = `#/notes?create=${encodeURIComponent(n.label)}`; return; }
      if (touch && selected !== n.id) { selected = n.id; showInfo(n); return; }
      location.hash = noteHref(n.id);
    } else if (!moved && !n) { selected = null; info.textContent = ''; }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; dragNode = null; panning = null; linkFrom = null; });
  canvas.addEventListener('pointerleave', () => { if (!touch) hover = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    userView = true;
    const p = pos(e);
    const w = toWorld(p.x, p.y);
    scale = Math.max(0.15, Math.min(4, scale * Math.exp(-e.deltaY * 0.0015)));
    ox = p.x - w.x * scale; oy = p.y - w.y * scale;
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') scale = Math.min(4, scale * 1.2);
    else if (e.key === '-') scale = Math.max(0.15, scale / 1.2);
    else if (e.key === '0') fit();
  });

  function showInfo(n) {
    const nb = [...(neighbours.get(n.id) || [])].map((id) => byId.get(id)?.label).filter(Boolean);
    info.replaceChildren(h('b', {}, n.label), ` · ${nb.length} link${nb.length === 1 ? '' : 's'}${nb.length ? `: ${nb.slice(0, 5).join(', ')}${nb.length > 5 ? '…' : ''}` : ''} `, h('a', { href: noteHref(n.id), class: 'tool sm' }, 'Open'));
  }

  async function addLink(from, to) {
    const note = store.getNote(from.id);
    if (!note) return;
    const text = linkTextFor(to.id, store.allNotes());
    const body = appendLink(note.body, text);
    if (body === note.body) { toast(`${from.label} already links to ${to.label}`); return; }
    await store.saveNote(from.id, body);
    toast(`Added [[${text}]] to ${from.label}`);
  }

  folderSel.addEventListener('change', () => { opts.folder = folderSel.value; build(); fitted = false; });
  tagSel.addEventListener('change', () => { opts.tag = tagSel.value; build(); fitted = false; });
  ghostBox.addEventListener('change', () => { opts.ghosts = ghostBox.checked; build(); });
  drawBtn.addEventListener('click', () => { opts.drawMode = !opts.drawMode; drawBtn.setAttribute('aria-pressed', String(opts.drawMode)); canvas.classList.toggle('drawing', opts.drawMode); });
  fitBtn.addEventListener('click', fit);
  const ro = new ResizeObserver(() => { const w0 = W; resize(); if (!userView || Math.abs(W - w0) > 80) { fit(); if (selected) centreOn(byId.get(selected)); } draw(); });
  ro.observe(wrap);
  let mounted = false;
  const off = store.subscribe(() => { if (canvas.isConnected) mounted = true; else if (mounted) { off(); ro.disconnect(); return; } build(); });

  // read-only positions for automated checks (tests/browser/smoke.mjs)
  canvas.graphNodes = () => nodes.map((n) => ({ id: n.id, label: n.label, x: n.x * scale + ox, y: n.y * scale + oy }));
  build();
  resize();
  // pre-settle the layout so the first frame isn't a burst of motion
  for (let i = 0; i < 120 && nodes.length; i += 1) step();
  fit(); fitted = alpha < 0.35;
  function centreOn(n) { if (!n) return; scale = Math.min(2, scale * 1.4); ox = W / 2 - n.x * scale; oy = H / 2 - n.y * scale; }
  if (selected) { const n = byId.get(selected); if (n) { showInfo(n); centreOn(n); } }
  raf = requestAnimationFrame(loop);
  return { rebuild: build };
}

#!/usr/bin/env node
// Browser smoke test: opens every page at desktop and phone width and fails if a
// page throws a JavaScript error, draws no content, or scrolls sideways on a phone.
//
//   npm install --no-save playwright && npx playwright install chromium
//   python3 -m http.server 8765 --directory site &   (or: npx serve site -l 8765)
//   node tests/browser/smoke.mjs
//
// Runs on GitHub Actions in .github/workflows/site-check.yml.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const index = await (await fetch(`${BASE}data/index.json`)).json();
const firstProtocol = index.protocols[0]?.slug;
const firstToken = index.protocols.find((p) => p.tokenId)?.tokenId;
const fundamentals = await (await fetch(`${BASE}data/fundamentals.json`)).json();
const firstChecklist = fundamentals.protocols[0]?.slug;
const routes = ['#/', '#/protocols', `#/protocol/${firstProtocol}`, '#/tokens', `#/token/${firstToken}`, '#/compare', '#/catalysts', '#/screener', '#/fundamentals', `#/fundamentals/${firstChecklist}`, '#/fundamentals/settings', '#/glossary', '#/sources', '#/no-such-page'];

const browser = await chromium.launch();
let failures = 0;
for (const [label, opts] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // logos/images come from other sites and may be blocked; that's not a page bug
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  for (const r of routes) {
    errors.length = 0;
    await page.goto(BASE + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => ({
      blocks: document.querySelectorAll('main .card, main .stat, main .band').length,
      charts: document.querySelectorAll('main .chart').length,
      drawn: [...document.querySelectorAll('main .chart')].filter((c) => c.querySelector('canvas')).length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      error: document.querySelector('main .unavailable .u-title')?.textContent || '',
    }));
    const problems = [...errors];
    if (r !== '#/no-such-page' && info.blocks < 2) problems.push(`only ${info.blocks} content blocks rendered`);
    if (info.drawn < info.charts) problems.push(`${info.charts - info.drawn} of ${info.charts} charts not drawn`);
    if (label === 'phone' && info.overflow > 1) problems.push(`page is ${info.overflow}px wider than the phone screen`);
    console.log(`${problems.length ? '✗' : '✓'} ${label.padEnd(7)} ${r.padEnd(28)} blocks=${info.blocks} charts=${info.drawn}/${info.charts}${problems.length ? `  → ${problems.join(' | ')}` : ''}`);
    failures += problems.length ? 1 : 0;
  }

  // ---------- notes: workspace, autosave, links, graph, side panel ----------
  const check = async (name, fn) => {
    errors.length = 0;
    let problem = null;
    try { problem = await fn(); } catch (e) { problem = e.message.split('\n')[0]; }
    if (errors.length) problem = [problem, ...errors].filter(Boolean).join(' | ');
    console.log(`${problem ? '✗' : '✓'} ${label.padEnd(7)} ${name}${problem ? `  → ${problem}` : ''}`);
    failures += problem ? 1 : 0;
  };
  await check('notes: workspace, create, autosave, [[ link', async () => {
    await page.goto(`${BASE}#/notes`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.nw-welcome');
    await page.evaluate(async () => { const s = await import('./assets/js/notes/store.js'); await s.init(); await s.createNote('Smoke', 'Target note', 'target'); });
    await page.click('.nw-actions .tool.primary');
    await page.fill('.nd-input', 'Smoke test note');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ne-text');
    if (label === 'phone') await page.click('.mode-edit');
    await page.click('.ne-text');
    await page.keyboard.type('Links to [[Target');
    await page.waitForSelector('.ne-pop-item');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ne-text');
    const text = await page.inputValue('.ne-text');
    if (text !== 'Links to [[Target note]]') return `after reload the note says ${JSON.stringify(text)}`;
    const back = await page.evaluate(async () => { const m = await import('./assets/js/notes/model.js'); const s = await import('./assets/js/notes/store.js'); return (m.buildIndex(s.allNotes()).backlinks.get('Smoke/Target note.md') || []).length; });
    if (back !== 1) return `expected 1 backlink, got ${back}`;
    if (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) > 1) return 'notes page scrolls sideways';
    return null;
  });
  await check('notes: graph view draws', async () => {
    await page.goto(`${BASE}#/notes?view=graph`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ng-canvas');
    await page.waitForTimeout(800);
    const label2 = await page.getAttribute('.ng-canvas', 'aria-label');
    return /2 notes and 1 link/.test(label2) ? null : `graph says “${label2}”`;
  });
  await check('notes: side panel on a protocol page', async () => {
    await page.goto(`${BASE}#/protocol/${firstProtocol}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.nc');
    await page.click('#notes-btn');
    await page.waitForSelector('#notes-panel:not([hidden])');
    await page.click('#notes-panel .tool:has-text("New note about")');
    await page.waitForSelector('#notes-panel .ne-text');
    const body = await page.inputValue('#notes-panel .ne-text');
    if (!body.includes(`(#/protocol/${firstProtocol})`)) return 'new note has no link back to the page';
    await page.keyboard.press('Escape');
    return null;
  });

  // ---------- fundamentals checklist: table, detail, settings with live preview, note ----------
  await check('fundamentals: overview table, filter, research-aid label', async () => {
    await page.goto(`${BASE}#/fundamentals`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.fc-overview tbody tr');
    if (!(await page.textContent('.fc-aid')).includes('not a rating')) return 'no research-aid label';
    const rows = await page.locator('.fc-overview tbody tr').count();
    if (rows !== fundamentals.protocols.length) return `table has ${rows} rows, data has ${fundamentals.protocols.length}`;
    const cells = await page.locator('.fc-overview tbody .fc-st').count();
    if (cells < rows * 7) return `only ${cells} status cells`;
    const sel = page.locator('.fc-overview .table-tools select').first();
    const opts = await sel.locator('option').count();
    if (opts > 2) { await sel.selectOption({ index: 1 }); const after = await page.locator('.fc-overview tbody tr').count(); if (!(after > 0 && after <= rows)) return `filter left ${after} rows`; }
    return null;
  });
  await check('fundamentals: detail page links every number to a source', async () => {
    await page.goto(`${BASE}#/fundamentals/${firstChecklist}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.fc-check');
    const n = await page.locator('.fc-check').count();
    if (n !== 7) return `${n} check cards`;
    const missing = await page.evaluate(() => [...document.querySelectorAll('.fc-nums tbody tr')].filter((tr) => !tr.querySelector('td:last-child a[href^="http"]')).map((tr) => tr.querySelector('th').textContent));
    return missing.length ? `numbers without a source link: ${missing.slice(0, 3).join('; ')}` : null;
  });
  await check('fundamentals: settings validate, preview live, persist, and show as custom', async () => {
    await page.goto(`${BASE}#/fundamentals/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#th-size-peStrong');
    await page.fill('#th-size-peStrong', '-5');
    await page.waitForTimeout(150);
    if (!(await page.locator('#thresholds .fs-err:not([hidden])').count())) return 'a negative value showed no error';
    await page.fill('#th-size-peStrong', '500'); // weaker than the ✗ line (100)
    await page.waitForTimeout(150);
    if (!/must be lower/.test(await page.textContent('#thresholds .fs-err:not([hidden])'))) return 'a ✓ cutoff weaker than ✗ was not rejected';
    await page.fill('#th-size-peStrong', '99');
    await page.waitForTimeout(900);
    if (!/Saved/.test(await page.textContent('.fs-status'))) return 'valid value not saved';
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#th-size-peStrong');
    if (await page.inputValue('#th-size-peStrong') !== '99') return 'setting did not survive a reload';
    await page.goto(`${BASE}#/fundamentals`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.fc-overview');
    if (!(await page.textContent('main')).includes('Using your custom settings')) return 'no “Using your custom settings” notice';
    return null;
  });
  await check('fundamentals: “New note from this checklist” opens a note', async () => {
    await page.goto(`${BASE}#/fundamentals/${firstChecklist}`, { waitUntil: 'networkidle' });
    await page.click('.fc-strip .tool.primary');
    await page.waitForSelector('#notes-panel .ne-text');
    const body = await page.inputValue('#notes-panel .ne-text');
    if (!/fundamentals checklist/.test(body) || !/## My take/.test(body)) return 'the note is missing the checklist';
    await page.keyboard.press('Escape');
    return null;
  });
  await ctx.close();
}
await browser.close();
if (failures) {
  console.error(`\n${failures} page check(s) failed.`);
  process.exit(1);
}
console.log('\nAll pages rendered without errors.');

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
const routes = ['#/', '#/protocols', `#/protocol/${firstProtocol}`, '#/tokens', `#/token/${firstToken}`, '#/compare', '#/catalysts', '#/screener', '#/glossary', '#/sources', '#/no-such-page'];

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
  await ctx.close();
}
await browser.close();
if (failures) {
  console.error(`\n${failures} page check(s) failed.`);
  process.exit(1);
}
console.log('\nAll pages rendered without errors.');

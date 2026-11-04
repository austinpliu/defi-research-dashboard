// Runs the whole data script offline against SYNTHETIC stub responses
// (tests/fixtures/stub-fetch.mjs) and checks the files it writes.
// Output goes to a temporary folder — never to site/data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('pipeline writes every file with sources and handles failures honestly', () => {
  const out = mkdtempSync(join(tmpdir(), 'defi-dash-test-'));
  try {
    execFileSync(process.execPath, ['--import', './tests/fixtures/stub-fetch.mjs', 'scripts/fetch-data.mjs'], {
      cwd: ROOT,
      env: { ...process.env, DATA_OUT_DIR: out, WATCHLIST_FILE: 'tests/fixtures/watchlist.test.json', HTTP_NO_PACING: '1', PROBE: '0' },
      stdio: 'pipe',
    });
    const read = (f) => JSON.parse(readFileSync(join(out, f), 'utf8'));
    for (const f of ['market.json', 'catalysts.json', 'index.json', 'meta.json', 'screener.json', 'protocols/alpha.json', 'tokens/alpha-token.json']) {
      assert.ok(existsSync(join(out, f)), `${f} written`);
    }
    const market = read('market.json');
    for (const k of ['tvl', 'stablecoins', 'dexVolume', 'fees']) {
      const h = market.headline[k];
      assert.ok(Number.isFinite(h.value), `${k} has a value`);
      assert.ok(market.sources[h.src]?.api?.startsWith('https://'), `${k} cites an API endpoint`);
      assert.ok(market.sources[h.src]?.fetchedAt, `${k} has fetchedAt`);
    }
    assert.equal(market.topFees.list[0].name, 'Beta');
    assert.ok(market.topFees.list.every((p) => p.name !== 'Ethereum'), 'chains are not ranked as protocols');

    const alpha = read('protocols/alpha.json');
    assert.equal(alpha.about.description, 'alpha is a synthetic test protocol. It exists only in tests.');
    assert.ok(alpha.tvl.series.length > 100);
    assert.ok(alpha.hacks.unavailable, 'Pro-only hacks endpoint is reported as unavailable, not faked');
    assert.ok(alpha.unlocks.unavailable.includes('Pro'), 'unlocks explain why they are missing');
    assert.equal(alpha.governance.proposals.length, 3);
    assert.ok(alpha.derived.mcapToFees.value > 0);
    assert.equal(alpha.sources['calc-mcap-fees'].derived, true);

    const missing = read('tokens/missing-coin.json');
    assert.equal(missing.market.src, 'dl-coin', 'falls back to DefiLlama price when CoinGecko fails');
    assert.ok(missing.market.partial);

    const meta = read('meta.json');
    assert.ok(meta.problems.some((p) => p.message.includes('missing-coin') && p.hint.includes('right-id')), 'suggests the right CoinGecko id');
    assert.ok(meta.problems.some((p) => p.message.includes('Broken Feed')), 'reports broken feeds');

    const cat = read('catalysts.json');
    assert.ok(cat.items.some((i) => i.type === 'governance-vote' && i.status === 'open'));
    assert.ok(cat.items.every((i) => i.url && i.src && cat.sources[i.src]), 'every catalyst has a link and a source');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

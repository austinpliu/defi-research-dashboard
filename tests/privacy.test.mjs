// Notes and sync tokens must never end up in this public repository or the published site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

test('no GitHub tokens anywhere in tracked files (outside the fake ones in tests)', () => {
  const hits = [];
  for (const f of tracked) {
    if (f.startsWith('tests/') || /\.(woff2?|png|jpg|zip)$/.test(f) || f.startsWith('site/vendor/')) continue;
    const text = readFileSync(join(ROOT, f), 'utf8');
    if (/github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,}/.test(text)) hits.push(f);
  }
  assert.deepEqual(hits, []);
});

test('no notes exports or vault folders are tracked', () => {
  assert.deepEqual(tracked.filter((f) => /defi-notes-.*\.zip$|\.vault\.zip$|^(notes|vault|site\/notes)\//.test(f)), []);
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  for (const p of ['defi-notes-*.zip', '/notes/', '/site/notes/']) assert.ok(ignore.includes(p), `.gitignore covers ${p}`);
});

test('the published site is only site/, and it ships no markdown notes', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/publish-site.yml'), 'utf8');
  assert.match(wf, /path:\s*site\s*$/m);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  assert.deepEqual(walk(join(ROOT, 'site')).filter((f) => /\.md$/i.test(f)), []);
});

test('notes code only talks to the network through sync.js, and only to api.github.com', () => {
  const dir = join(ROOT, 'site/assets/js/notes');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8');
    const calls = src.match(/\bfetch\s*\(/g) || [];
    if (f === 'sync.js') {
      assert.equal(calls.length, 1, 'one fetch call, inside the guarded gh() helper');
      assert.match(src, /const API = 'https:\/\/api\.github\.com';/);
      assert.match(src, /if \(!url\.startsWith\(`\$\{API\}\/`\)\) throw/);
      assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*token/i, 'the token is never logged');
    } else {
      assert.equal(calls.length, 0, `${f} makes no network requests`);
      assert.doesNotMatch(src, /sendBeacon|XMLHttpRequest|WebSocket/, `${f} has no other network channel`);
    }
  }
  // the token lives in this browser only: localStorage, never IndexedDB-synced data or the URL
  const sync = readFileSync(join(dir, 'sync.js'), 'utf8');
  assert.match(sync, /localStorage\.setItem\(KEY, JSON\.stringify\(c\)\)/);
  assert.doesNotMatch(sync, /location\.(hash|search)\s*=.*token/);
});

// Fundamentals Checklist settings: validation, defaults + your overrides, the three-way merge used
// by sync, import, and the settings file syncing through the notes repo (against a fake GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveEntries, validateEntry, upsertEntry, removeEntry, entryId, mergeSettings, parseImport, isHttpUrl } from '../site/assets/js/fundamentals/merge.js';
import { effective, normalizeUser } from '../site/assets/js/fundamentals/settings.js';
import { resolveSystemConflict, isSystemPath } from '../site/assets/js/notes/system-files.js';
import { blobSha } from '../site/assets/js/notes/sync-plan.js';

const CONFIG = JSON.parse(readFileSync(new URL('../site/config/fundamentals-thresholds.json', import.meta.url)));
const VA = JSON.parse(readFileSync(new URL('../site/config/value-accrual.json', import.meta.url)));
const TN = JSON.parse(readFileSync(new URL('../site/config/team-notes.json', import.meta.url)));
const plan = (over = {}) => ({ id: 'p1', protocol: 'aave', what: 'Buyback approved', status: 'approved', date: '2026-01-10', source: 'https://governance.example.org/t/1', lastChecked: '2026-11-01', ...over });
const note = (over = {}) => ({ id: 'n1', protocol: 'aave', text: 'Founded in 2017.', sources: ['https://example.org/about'], lastChecked: '2026-11-01', ...over });

test('the shipped default files are valid and empty of unconfirmed entries', () => {
  assert.deepEqual(VA.entries, []);
  assert.deepEqual(TN.entries, []);
  const e = effective({ thresholds: CONFIG, valueAccrual: VA, teamNotes: TN, errors: [] }, normalizeUser(null));
  assert.deepEqual(e.errors, []);
  assert.equal(e.custom, false);
});

test('entry validation: http(s) sources, dates and required fields', () => {
  assert.deepEqual(validateEntry('valueAccrual', plan()), []);
  assert.match(validateEntry('valueAccrual', plan({ source: 'javascript:alert(1)' })).join(' '), /http/);
  assert.match(validateEntry('valueAccrual', plan({ source: 'ftp://x.org' })).join(' '), /http/);
  assert.match(validateEntry('valueAccrual', plan({ lastChecked: '' })).join(' '), /last checked/);
  assert.match(validateEntry('valueAccrual', plan({ lastChecked: '2026-13-45' })).join(' '), /last checked/);
  assert.match(validateEntry('valueAccrual', plan({ what: '  ' })).join(' '), /what was announced/);
  assert.match(validateEntry('valueAccrual', plan({ status: 'rumoured' })).join(' '), /Status/);
  assert.deepEqual(validateEntry('teamNotes', note()), []);
  assert.match(validateEntry('teamNotes', note({ sources: [] })).join(' '), /at least one/);
  assert.match(validateEntry('teamNotes', note({ sources: ['https://ok.org', 'nope'] })).join(' '), /Every source/);
  assert.equal(isHttpUrl('https://a.b/c'), true);
  assert.equal(isHttpUrl('http//broken'), false);
});

test('overrides: add, edit a default, delete a default; later defaults still appear', () => {
  const defaults = [plan({ id: 'd1', protocol: 'sky' }), plan({ id: 'd2', protocol: 'pendle' })];
  let over = { entries: [], deleted: [] };
  over = upsertEntry(over, plan({ id: 'mine', protocol: 'compound-finance' }));
  over = upsertEntry(over, { ...plan({ id: 'd1', protocol: 'sky' }), what: 'Edited by me' });
  over = removeEntry(over, 'd2', true);
  const r = effectiveEntries([...defaults, plan({ id: 'd3', protocol: 'morpho' })], over, 'valueAccrual');
  assert.deepEqual(r.errors, []);
  assert.equal(r.custom, true);
  assert.deepEqual(r.entries.map((e) => [e.id, e.origin]), [['d1', 'edited'], ['d3', 'default'], ['mine', 'yours']]);
  assert.equal(r.entries[0].what, 'Edited by me');
  // deleting one of yours drops it entirely (no tombstone needed)
  const gone = removeEntry(over, 'mine', false);
  assert.equal(gone.entries.some((e) => e.id === 'mine'), false);
  assert.equal(gone.deleted.includes('mine'), false);
  // re-adding a deleted default's id clears the deletion
  assert.equal(upsertEntry(over, plan({ id: 'd2' })).deleted.includes('d2'), false);
});

test('invalid entries are skipped with a message instead of crashing', () => {
  const r = effectiveEntries([plan({ id: 'd1', source: 'not a url' })], { entries: [note({ id: 'x', sources: [] })], deleted: [] }, 'teamNotes');
  assert.equal(r.entries.length, 0);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(effectiveEntries(null, null, 'valueAccrual'), { entries: [], errors: [], custom: false });
});

test('effective(): thresholds override only where valid, and say what changed', () => {
  const user = normalizeUser({ thresholds: { 'size.peStrong': 40, 'liquidity.liqWeak': -1 }, valueAccrual: { entries: [plan()] } });
  const e = effective({ thresholds: CONFIG, valueAccrual: VA, teamNotes: TN, errors: [] }, user);
  assert.equal(e.values['size.peStrong'], 40);
  assert.equal(e.values['liquidity.liqWeak'], 0.5);
  assert.deepEqual(e.changed, ['size.peStrong']);
  assert.equal(e.errors.length, 1);
  assert.equal(e.valueAccrual.length, 1);
  assert.equal(e.custom, true);
  // a missing thresholds file never throws
  const broken = effective({ thresholds: null, errors: ['Couldn’t load'] }, user);
  assert.deepEqual(broken.values, {});
  assert.match(broken.errors[0], /Couldn’t load/);
});

test('normalizeUser turns junk into empty settings', () => {
  for (const junk of [null, 42, 'x', [], { thresholds: [1, 2], valueAccrual: 'no' }]) {
    const u = normalizeUser(junk);
    assert.deepEqual(u.thresholds, {});
    assert.deepEqual(u.valueAccrual, { entries: [], deleted: [] });
  }
});

// ---------- the sync merge ----------
const S = (thresholds = {}, va = [], deleted = []) => ({ version: 1, thresholds, valueAccrual: { entries: va, deleted }, teamNotes: { entries: [], deleted: [] } });
test('mergeSettings: one-sided changes combine; identical changes agree', () => {
  const base = S({ 'size.peStrong': 30 });
  const mine = S({ 'size.peStrong': 30, 'track.ageStrong': 4 });
  const theirs = S({ 'size.peStrong': 20 }, [plan()]);
  const { merged, conflicts } = mergeSettings(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged.thresholds, { 'size.peStrong': 20, 'track.ageStrong': 4 });
  assert.deepEqual(merged.valueAccrual.entries.map(entryId), ['p1']);
  assert.deepEqual(mergeSettings(base, S({ 'size.peStrong': 50 }), S({ 'size.peStrong': 50 })).conflicts, []);
});
test('mergeSettings: a reset on one side (key removed) wins over an untouched other side', () => {
  const { merged, conflicts } = mergeSettings(S({ 'size.peStrong': 30 }), S({}), S({ 'size.peStrong': 30 }));
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged.thresholds, {});
});
test('mergeSettings: both changed the same thing → conflict reported, yours kept, theirs recorded', () => {
  const base = S({ 'size.peStrong': 30 }, [plan()]);
  const mine = S({ 'size.peStrong': 40 }, [plan({ what: 'mine' })]);
  const theirs = S({ 'size.peStrong': 20 }, [], ['p1']);
  const { merged, conflicts } = mergeSettings(base, mine, theirs);
  assert.equal(merged.thresholds['size.peStrong'], 40);
  assert.equal(merged.valueAccrual.entries[0].what, 'mine');
  assert.deepEqual(conflicts.map((c) => [c.kind, c.key, c.theirs]), [['threshold', 'size.peStrong', 20], ['valueAccrual', 'p1', { deleted: true }]]);
});
test('mergeSettings: no common base (first sync of a second device) treats any difference as a conflict', () => {
  const { conflicts, merged } = mergeSettings(null, S({ 'size.peStrong': 40 }), S({ 'size.peStrong': 20, 'track.ageStrong': 5 }));
  assert.deepEqual(conflicts.map((c) => c.key), ['size.peStrong']);
  assert.equal(merged.thresholds['track.ageStrong'], 5);
});

test('resolveSystemConflict: merges JSON, records conflicts, survives unreadable files', () => {
  const p = '.dashboard/fundamentals-settings.json';
  const j = (o) => JSON.stringify(o);
  const clean = resolveSystemConflict(p, j(S()), j(S({ 'size.peStrong': 40 })), j(S({ 'track.ageStrong': 5 })), '2026-11-05 1200');
  assert.equal(clean.conflict, null);
  assert.deepEqual(JSON.parse(clean.text).thresholds, { 'size.peStrong': 40, 'track.ageStrong': 5 });
  const clash = resolveSystemConflict(p, j(S()), j(S({ 'size.peStrong': 40 })), j(S({ 'size.peStrong': 20 })), '2026-11-05 1200');
  assert.equal(JSON.parse(clash.text).thresholds['size.peStrong'], 40);
  assert.equal(clash.conflict.path, '.dashboard/conflicts/fundamentals-settings 2026-11-05 1200.json');
  assert.equal(JSON.parse(clash.conflict.text).conflicts[0].theirs, 20);
  const bad = resolveSystemConflict(p, null, j(S({ a: 1 })), '{broken', 'T');
  assert.equal(bad.text, j(S({ a: 1 })), 'yours is kept as it was');
  assert.equal(JSON.parse(bad.conflict.text).theirs, '{broken', 'theirs is kept whole');
  assert.equal(isSystemPath(p), true);
  assert.equal(isSystemPath('.dashboard/conflicts/x.json'), true);
  assert.equal(isSystemPath('.dashboard/x.md'), false);
  assert.equal(isSystemPath('Notes/.dashboard/x.json'), false);
});

test('parseImport: accepts an export, rejects other files, reports unreadable parts', () => {
  const ok = parseImport(JSON.stringify({ kind: 'defi-dashboard/fundamentals-settings', thresholds: { 'size.peStrong': 40 }, valueAccrual: { entries: [plan()], deleted: [] } }));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.user.thresholds['size.peStrong'], 40);
  assert.equal(parseImport('not json').user, null);
  assert.equal(parseImport('[1,2]').user, null);
  assert.equal(parseImport(JSON.stringify({ kind: 'something-else', thresholds: {} })).user, null);
  assert.equal(parseImport(JSON.stringify({ hello: 1 })).user, null);
  const partial = parseImport(JSON.stringify({ thresholds: [1], teamNotes: { entries: 'x' } }));
  assert.equal(partial.problems.length, 2);
  assert.deepEqual(partial.user.thresholds, {});
});

// ---------- end to end: the settings file syncs through the notes repo ----------
function fakeGitHub() {
  const files = new Map();
  const blobs = new Map(); // every version ever written, like git's object store
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const remember = async (text) => { const sha = await blobSha(text); blobs.set(sha, text); return sha; };
  return {
    files,
    async put(path, text) { files.set(path, { sha: await remember(text), text }); },
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      assert.equal(u.origin, 'https://api.github.com');
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      let m;
      if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) return json(200, { private: true, default_branch: 'main' });
      if (u.pathname.includes('/git/trees/')) return json(200, { truncated: false, tree: [...files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })) });
      if ((m = u.pathname.match(/\/git\/blobs\/(\w+)$/))) return blobs.has(m[1]) ? json(200, { content: Buffer.from(blobs.get(m[1])).toString('base64') }) : json(404, { message: 'Not Found' });
      if ((m = u.pathname.match(/\/contents\/(.+)$/))) {
        const path = m[1].split('/').map(decodeURIComponent).join('/');
        const cur = files.get(path);
        if ((cur?.sha || undefined) !== (body.sha || undefined)) return json(409, { message: 'does not match' });
        if (method === 'DELETE') { files.delete(path); return json(200, {}); }
        const text = Buffer.from(body.content, 'base64').toString('utf8');
        const sha = await remember(text);
        files.set(path, { sha, text });
        return json(200, { content: { sha } });
      }
      return json(404, { message: 'Not Found' });
    },
  };
}

test('sync: the settings file rides along with the notes, merges by content, never overwrites silently', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const gh = fakeGitHub();
  globalThis.fetch = gh.fetch;
  const store = await import('../site/assets/js/notes/store.js');
  const sync = await import('../site/assets/js/notes/sync.js');
  await store.init();
  sync.setConfig(await sync.checkConfig({ repo: 'me/notes', token: 'github_pat_abcdefghijklmnopqrstuvwxyz' }));
  const P = '.dashboard/fundamentals-settings.json';
  const read = () => JSON.parse(store.getSystem(P).body);

  await store.putRaw([{ path: 'Note.md', body: 'hello' }]);
  await store.putSystem(P, JSON.stringify(S({ 'size.peStrong': 30 })));
  let r = await sync.syncNow();
  assert.equal(r.error, undefined);
  assert.equal(r.pushed, 2);
  assert.equal(JSON.parse(gh.files.get(P).text).thresholds['size.peStrong'], 30);
  assert.equal(store.liveNotes().some((n) => n.path.startsWith('.dashboard')), false, 'settings never show up as a note');

  // the other device changes one threshold; this browser changes another → merged, no conflict
  await gh.put(P, JSON.stringify(S({ 'size.peStrong': 30, 'track.ageStrong': 5 })));
  await store.putSystem(P, JSON.stringify(S({ 'size.peStrong': 40 })));
  r = await sync.syncNow();
  assert.equal(r.error, undefined);
  assert.equal(r.merged, 1);
  assert.deepEqual(read().thresholds, { 'size.peStrong': 40, 'track.ageStrong': 5 });
  assert.deepEqual(JSON.parse(gh.files.get(P).text).thresholds, { 'size.peStrong': 40, 'track.ageStrong': 5 });

  // both change the same threshold → yours kept, theirs recorded on both sides for review
  await gh.put(P, JSON.stringify(S({ 'size.peStrong': 20, 'track.ageStrong': 5 })));
  await store.putSystem(P, JSON.stringify(S({ 'size.peStrong': 45, 'track.ageStrong': 5 })));
  r = await sync.syncNow();
  assert.equal(r.conflicts.length, 1);
  assert.equal(read().thresholds['size.peStrong'], 45);
  const rec = r.conflicts[0].copy;
  assert.match(rec, /^\.dashboard\/conflicts\//);
  assert.equal(JSON.parse(store.getSystem(rec).body).conflicts[0].theirs, 20);
  assert.ok(gh.files.has(rec), 'the record is in the repo too');
  assert.deepEqual(store.getMeta('sync-conflicts', []).filter((c) => c.copy === rec), [], 'not listed as a note conflict');

  // dismissing the record deletes it everywhere on the next sync
  await store.deleteSystem(rec);
  r = await sync.syncNow();
  assert.equal(gh.files.has(rec), false);

  // a settings file pulled from the repo appears here
  await gh.put(P, JSON.stringify(S({ 'size.peStrong': 45, 'track.ageStrong': 6 })));
  r = await sync.syncNow();
  assert.equal(read().thresholds['track.ageStrong'], 6);
});

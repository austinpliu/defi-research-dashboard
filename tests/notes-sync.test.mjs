// Notes sync (conflict rules + the GitHub executor against a fake API) and zip export/import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { planSync, blobSha, conflictPath } from '../site/assets/js/notes/sync-plan.js';
import { writeZip, readZip, crc32 } from '../site/assets/js/notes/zip.js';

const M = (o) => new Map(Object.entries(o));
const act = (plan) => Object.fromEntries(plan.map((a) => [a.path, a.action]));

test('blobSha matches git hash-object', async () => {
  assert.equal(await blobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(await blobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('planSync: one-sided changes move in the right direction', () => {
  const base = M({ a: '1', b: '1', c: '1', d: '1' });
  const local = M({ a: '1', b: '2', c: '1', e: 'n' }); // b edited here, d deleted here, e new here
  const remote = M({ a: '1', b: '1', c: '3', d: '1', f: 'r' }); // c edited there, f new there
  assert.deepEqual(act(planSync(local, remote, base)), { b: 'push', c: 'pull', d: 'delete-remote', e: 'push', f: 'pull' });
});

test('planSync: deletions on the other side remove the local copy only if it is unchanged', () => {
  assert.deepEqual(act(planSync(M({ x: '1' }), M({}), M({ x: '1' }))), { x: 'delete-local' });
  // edited here, deleted there: keep the edit (push it back)
  const p = planSync(M({ x: '2' }), M({}), M({ x: '1' }));
  assert.equal(p[0].action, 'push');
  assert.equal(p[0].remoteSha, null);
  // deleted here, edited there: restore it
  assert.deepEqual(act(planSync(M({}), M({ x: '3' }), M({ x: '1' }))), { x: 'pull' });
});

test('planSync: both sides changed means conflict, never an overwrite', () => {
  assert.deepEqual(act(planSync(M({ x: '2' }), M({ x: '3' }), M({ x: '1' }))), { x: 'conflict' });
  // first sync on a second device: same path, different text, no history
  assert.deepEqual(act(planSync(M({ x: 'mine' }), M({ x: 'theirs' }), M({}))), { x: 'conflict' });
  // same text on both sides with no history: just record it
  assert.deepEqual(act(planSync(M({ x: 's' }), M({ x: 's' }), M({}))), { x: 'adopt' });
  assert.equal(planSync(M({ x: 's' }), M({ x: 's' }), M({ x: 's' })).length, 0);
});

test('conflictPath is unique', () => {
  assert.equal(conflictPath('A/Note.md', '2026-11-05 1342'), 'A/Note (conflict 2026-11-05 1342).md');
  assert.equal(conflictPath('A/Note.md', 'T', new Set(['a/note (conflict t).md'])), 'A/Note (conflict T 2).md');
});

test('zip: write and read back, including an Obsidian-style deflated zip', async () => {
  const files = [{ name: 'Folder/', data: '' }, { name: 'Folder/Note.md', data: '# Hi\n[[Other]] é' }, { name: 'Other.md', data: 'x' }];
  const back = await readZip(writeZip(files));
  assert.deepEqual(back.map((f) => [f.name, new TextDecoder().decode(f.data)]), [['Folder/Note.md', '# Hi\n[[Other]] é'], ['Other.md', 'x']]);
  // hand-built zip with a deflate (method 8) entry
  const te = new TextEncoder();
  const name = te.encode('Vault/Deflated.md');
  const raw = te.encode('compressed text '.repeat(20));
  const comp = deflateRawSync(raw);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = 30 + name.length + comp.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOff, 16);
  const zip = Buffer.concat([lh, name, comp, cd, name, end]);
  const r = await readZip(new Uint8Array(zip));
  assert.equal(new TextDecoder().decode(r[0].data), 'compressed text '.repeat(20));
});

// ---------- the executor, against a fake GitHub that enforces sha checks like the real one ----------
function fakeGitHub({ isPrivate = true } = {}) {
  const files = new Map(); // path → { sha, text }
  const calls = [];
  const b64d = (s) => Buffer.from(s, 'base64').toString('utf8');
  const json = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const api = {
    files, calls,
    async put(path, text) { files.set(path, { sha: await blobSha(text), text }); },
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      assert.equal(u.origin, 'https://api.github.com', 'the token only ever goes to api.github.com');
      assert.match(opts.headers.Authorization, /^Bearer github_pat_/);
      const method = opts.method || 'GET';
      calls.push(`${method} ${u.pathname}`);
      const body = opts.body ? JSON.parse(opts.body) : null;
      let m;
      if ((m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/))) return json(200, { private: isPrivate, default_branch: 'main', full_name: m[1] });
      if (u.pathname.includes('/git/trees/')) return json(200, { truncated: false, tree: [...files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })) });
      if ((m = u.pathname.match(/\/git\/blobs\/(\w+)$/))) { const f = [...files.values()].find((x) => x.sha === m[1]); return json(200, { content: Buffer.from(f.text).toString('base64') }); }
      if ((m = u.pathname.match(/\/contents\/(.+)$/))) {
        const path = m[1].split('/').map(decodeURIComponent).join('/');
        const cur = files.get(path);
        if ((cur?.sha || undefined) !== (body.sha || undefined)) return json(409, { message: 'does not match' });
        if (method === 'DELETE') { files.delete(path); return json(200, {}); }
        const text = b64d(body.content);
        const sha = await blobSha(text);
        files.set(path, { sha, text });
        return json(200, { content: { sha } });
      }
      return json(404, { message: 'Not Found' });
    },
  };
  return api;
}

test('sync executor: push, pull, deletions, conflicts kept as copies, and a mid-sync race', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const gh = fakeGitHub();
  globalThis.fetch = gh.fetch;
  const store = await import('../site/assets/js/notes/store.js');
  const sync = await import('../site/assets/js/notes/sync.js');
  await store.init();
  const cfg = await sync.checkConfig({ repo: 'me/notes', token: 'github_pat_abcdefghijklmnopqrstuvwxyz' });
  sync.setConfig(cfg);

  await store.putRaw([{ path: 'A.md', body: 'a1' }, { path: 'F/B.md', body: 'b1' }, { path: 'C.md', body: 'c1' }]);
  let r = await sync.syncNow();
  assert.equal(r.error, undefined);
  assert.equal(r.pushed, 3);
  assert.equal(gh.files.get('F/B.md').text, 'b1', 'folders map to real folders');

  // the other device edits A and deletes C; this browser edits B
  await gh.put('A.md', 'a2');
  gh.files.delete('C.md');
  await store.saveNote('F/B.md', 'b2');
  r = await sync.syncNow();
  assert.deepEqual([r.pulled, r.pushed, r.deletedLocal], [1, 1, 1]);
  assert.equal(store.getNote('A.md').body, 'a2');
  assert.equal(gh.files.get('F/B.md').text, 'b2');
  assert.equal(store.getNote('C.md'), null);

  // both sides edit A: both versions survive, flagged, on both sides
  await gh.put('A.md', 'theirs');
  await store.saveNote('A.md', 'mine');
  r = await sync.syncNow();
  assert.equal(r.conflicts.length, 1);
  const copy = r.conflicts[0].copy;
  assert.equal(store.getNote('A.md').body, 'mine');
  assert.equal(gh.files.get('A.md').text, 'mine');
  assert.match(store.getNote(copy).body, /sync-conflict:[\s\S]*theirs$/);
  assert.equal(gh.files.get(copy).text, store.getNote(copy).body);

  // race: the repo changes after the listing but before the upload → GitHub's 409, nothing overwritten
  await store.saveNote('F/B.md', 'b3-local');
  const realFetch = gh.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/contents/') && opts?.method === 'PUT') await gh.put('F/B.md', 'b3-remote');
    return realFetch(url, opts);
  };
  r = await sync.syncNow();
  assert.match(r.error, /409/);
  assert.equal(gh.files.get('F/B.md').text, 'b3-remote', 'the newer remote version was not overwritten');
  assert.equal(store.getNote('F/B.md').body, 'b3-local', 'and the local edit is still here');
  globalThis.fetch = realFetch;
  // the next run sees both changed and keeps both
  r = await sync.syncNow();
  assert.equal(r.conflicts.length, 1);

  // local delete propagates
  await store.deleteRaw(['A.md']);
  r = await sync.syncNow();
  assert.equal(r.deletedRemote, 1);
  assert.equal(gh.files.has('A.md'), false);
});

test('sync refuses public repos and the dashboard repo', async () => {
  globalThis.fetch = fakeGitHub({ isPrivate: false }).fetch;
  const sync = await import('../site/assets/js/notes/sync.js');
  await assert.rejects(sync.checkConfig({ repo: 'me/open', token: 'github_pat_abcdefghijklmnopqrstuvwxyz' }), /public/);
  await assert.rejects(sync.checkConfig({ repo: 'austinpliu/defidashboard', token: 'github_pat_abcdefghijklmnopqrstuvwxyz' }), /dashboard’s own/);
  await assert.rejects(sync.checkConfig({ repo: 'me/notes', token: 'not-a-token' }), /token/);
});

// Optional sync of notes to YOUR OWN private GitHub repository, as plain markdown files.
// - The token is a fine-grained personal access token limited to that one repository with
//   "Contents: read and write". It is stored only in this browser (localStorage) and sent
//   only to https://api.github.com. It is never part of the dashboard's code or data.
// - Sync refuses public repositories and the dashboard's own repository.
// - Uploads name the version they replace, so GitHub rejects the write if the file changed
//   in the meantime; nothing is overwritten silently (see sync-plan.js for the rules).
import * as store from './store.js';
import { planSync, blobSha, conflictPath } from './sync-plan.js';
import { setFrontmatter, basename } from './model.js';
import { stamp } from './workspace.js';
import { isSystemPath, resolveSystemConflict } from './system-files.js';

const API = 'https://api.github.com';
const KEY = 'notes-sync';
// never sync notes into the public dashboard repository (current and former name)
export const FORBIDDEN_REPOS = ['austinpliu/defidashboard', 'austinpliu/defi-research-dashboard'];

export function getConfig() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.repo && c.token ? c : null; } catch { return null; }
}
export function setConfig(c) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { throw new Error('This browser won’t store settings (private window?)'); }
}
const baseKey = (c) => `sync-base:${c.repo.toLowerCase()}:${c.branch || ''}:${c.dir || ''}`;

/** Parse "owner/repo" or a github.com URL. */
export function parseRepo(text) {
  const m = String(text || '').trim().replace(/\.git$/, '').match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function gh(cfg, path, { method = 'GET', body, allow = [] } = {}) {
  const url = `${API}${path}`;
  if (!url.startsWith(`${API}/`)) throw new Error('Refusing to send the token anywhere but api.github.com');
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (allow.includes(res.status)) return { status: res.status, data: null };
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = `${res.status}: ${j.message || ''}`; } catch { /* not json */ }
    const hint = res.status === 401 ? ' (the token is wrong or expired)' : res.status === 403 ? ' (the token lacks Contents read/write on this repo, or you hit a rate limit)' : res.status === 404 ? ' (no such repo, or the token can’t see it)' : res.status === 409 ? ' (the repo changed during the sync; it will retry)' : '';
    const err = new Error(`GitHub ${msg}${hint}`);
    err.status = res.status;
    throw err;
  }
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const b64 = (text) => { const bytes = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (data) => new TextDecoder().decode(Uint8Array.from(atob(data.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

/** Check the settings before saving them: the repo must exist, be private, and be readable. */
export async function checkConfig(cfg) {
  const repo = parseRepo(cfg.repo);
  if (!repo) throw new Error('Write the repository as owner/name, e.g. yourname/research-notes');
  if (FORBIDDEN_REPOS.includes(repo.toLowerCase())) throw new Error('That’s the dashboard’s own public repository. Notes must go to a separate private repository.');
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(cfg.token || '')) throw new Error('That doesn’t look like a GitHub token (fine-grained tokens start with github_pat_).');
  const { data } = await gh({ ...cfg, repo }, `/repos/${repo}`);
  if (!data.private) throw new Error(`${repo} is public. Notes can only sync to a private repository.`);
  return { ...cfg, repo, branch: cfg.branch || data.default_branch || 'main', dir: (cfg.dir || '').replace(/^\/+|\/+$/g, '') };
}

let running = null;
/** Run one sync. Returns a summary; concurrent calls share the same run. */
export function syncNow() {
  if (!running) running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const cfg = getConfig();
  if (!cfg) return { skipped: true };
  await store.init();
  const prefix = cfg.dir ? `${cfg.dir}/` : '';
  const summary = { pulled: 0, pushed: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], at: new Date().toISOString() };
  try {
    // 1. what's in the repo
    const remote = new Map();
    const tree = await gh(cfg, `/repos/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`, { allow: [404, 409] });
    if (tree.data?.truncated) throw new Error('The repository has too many files for one listing; keep notes in their own repository.');
    for (const e of tree.data?.tree || []) {
      if (e.type !== 'blob' || (prefix && !e.path.startsWith(prefix))) continue;
      const rel = e.path.slice(prefix.length);
      if (/\.md$/i.test(rel) || isSystemPath(rel)) remote.set(rel, e.sha); // notes, plus .dashboard/ settings files
    }
    // 2. what's here, and what both had last time
    const local = new Map();
    for (const n of store.allNotes()) local.set(n.path, await blobSha(n.body));
    for (const f of store.allSystem()) if (isSystemPath(f.path)) local.set(f.path, await blobSha(f.body));
    // system files (dashboard settings) live outside the notes; these route reads and writes
    const readLocal = (p) => (isSystemPath(p) ? store.getSystem(p) : store.getNote(p));
    const writeLocal = (p, body) => (isSystemPath(p) ? store.putSystem(p, body) : store.putRaw([{ path: p, body, updated: Date.now() }]));
    const deleteLocal = (p) => (isSystemPath(p) ? store.deleteSystem(p) : store.deleteRaw([p]));
    const base = new Map(Object.entries(store.getMeta(baseKey(cfg), {}) || {}));
    const plan = planSync(local, remote, base);
    const next = new Map(base);
    const msg = (verb, p) => ({ message: `${verb} ${p} (dashboard notes)`, branch: cfg.branch });
    const getRemote = async (sha) => unb64((await gh(cfg, `/repos/${cfg.repo}/git/blobs/${sha}`)).data.content);
    const put = async (p, text, sha) => (await gh(cfg, `/repos/${cfg.repo}/contents/${enc(prefix + p)}`, { method: 'PUT', body: { ...msg(sha ? 'Update' : 'Add', p), content: b64(text), ...(sha ? { sha } : {}) } })).data.content.sha;
    const taken = new Set([...local.keys(), ...remote.keys()].map((p) => p.toLowerCase()));
    // 3. carry it out, one file at a time (a failure stops the run; the next run picks up)
    for (const a of plan) {
      if (a.action === 'adopt') { next.set(a.path, a.localSha); continue; }
      if (a.action === 'pull') {
        const text = await getRemote(a.remoteSha);
        await writeLocal(a.path, text);
        next.set(a.path, a.remoteSha); summary.pulled += 1;
      } else if (a.action === 'push') {
        const n = readLocal(a.path);
        const sha = await put(a.path, n.body, a.remoteSha);
        next.set(a.path, sha); summary.pushed += 1;
      } else if (a.action === 'delete-remote') {
        await gh(cfg, `/repos/${cfg.repo}/contents/${enc(prefix + a.path)}`, { method: 'DELETE', body: { ...msg('Delete', a.path), sha: a.remoteSha }, allow: [404] });
        next.delete(a.path); summary.deletedRemote += 1;
      } else if (a.action === 'delete-local') {
        // only if it is still exactly what we last synced (checked against the plan's hash)
        const n = readLocal(a.path);
        if (n && await blobSha(n.body) === a.localSha) { await deleteLocal(a.path); summary.deletedLocal += 1; }
        next.delete(a.path);
      } else if (a.action === 'conflict' && isSystemPath(a.path)) {
        // a settings file changed on both sides: merge the two by content (three-way, using the
        // version both last agreed on). Where both changed the same setting, yours is kept and
        // the other device's value is saved in .dashboard/conflicts/ for you to review.
        const theirs = await getRemote(a.remoteSha);
        const baseSha = base.get(a.path);
        let baseText = null;
        if (baseSha) { try { baseText = await getRemote(baseSha); } catch { baseText = null; } }
        const mine = readLocal(a.path).body;
        const res = resolveSystemConflict(a.path, baseText, mine, theirs, stamp(), taken);
        if (res.conflict) {
          taken.add(res.conflict.path.toLowerCase());
          await store.putSystem(res.conflict.path, res.conflict.text);
          next.set(res.conflict.path, await put(res.conflict.path, res.conflict.text, null));
          summary.conflicts.push({ path: a.path, copy: res.conflict.path, system: true });
        }
        if (res.text !== mine) await store.putSystem(a.path, res.text);
        next.set(a.path, await put(a.path, res.text, a.remoteSha));
        if (!res.conflict) summary.merged = (summary.merged || 0) + 1;
      } else if (a.action === 'conflict') {
        // keep both: the repo's version becomes a separate, flagged note on both sides
        const theirs = await getRemote(a.remoteSha);
        const cp = conflictPath(a.path, stamp(), taken);
        taken.add(cp.toLowerCase());
        const flagged = setFrontmatter(theirs, { 'sync-conflict': `The other device's version of ${basename(a.path)}, kept by sync on ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Merge what you need, then delete this note.` });
        await store.putRaw([{ path: cp, body: flagged, updated: Date.now() }]);
        const cpSha = await put(cp, flagged, null);
        next.set(cp, cpSha);
        const mine = store.getNote(a.path);
        const sha = await put(a.path, mine.body, a.remoteSha);
        next.set(a.path, sha);
        summary.conflicts.push({ path: a.path, copy: cp });
      }
      await store.setMeta(baseKey(cfg), Object.fromEntries(next)); // progress survives an interrupted run
    }
    const known = store.getMeta('sync-conflicts', []);
    await store.setMeta('sync-conflicts', [...known, ...summary.conflicts.filter((c) => !c.system)].filter((c) => store.getNote(c.copy)));
    await store.setMeta('sync-last', summary);
    return summary;
  } catch (e) {
    const fail = { ...summary, error: e.message };
    await store.setMeta('sync-last', fail);
    return fail;
  }
}

/** Sync shortly after edits and every few minutes while the tab is open (only if set up). */
let timer = null;
export function startAutoSync() {
  if (!getConfig()) return;
  let changeTimer = null;
  store.subscribe((d) => { if (running || d?.remote) return; clearTimeout(changeTimer); changeTimer = setTimeout(() => syncNow(), 20000); });
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  syncNow();
}

/** Forget the token and sync state in this browser (notes stay). */
export async function turnOff() {
  const cfg = getConfig();
  setConfig(null);
  clearInterval(timer);
  if (cfg) await store.setMeta(baseKey(cfg), null);
}

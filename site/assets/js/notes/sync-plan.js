// What a sync should do, decided from three snapshots of every file's git blob hash:
// this browser (local), the private repo (remote), and the last time the two agreed (base).
// Pure and tested. The rule that matters: never silently overwrite a version that changed.

/** git's blob hash ("git hash-object") of a UTF-8 string, so local files compare with the repo's. */
export async function blobSha(text) {
  const bytes = new TextEncoder().encode(String(text));
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const d = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "Folder/Note.md" → "Folder/Note (conflict 2026-11-05 1342).md" (unique among `taken`). */
export function conflictPath(path, stamp, taken = new Set()) {
  const base = path.replace(/\.md$/i, '');
  let p = `${base} (conflict ${stamp}).md`;
  for (let i = 2; taken.has(p.toLowerCase()); i += 1) p = `${base} (conflict ${stamp} ${i}).md`;
  return p;
}

/**
 * @param {Map<string,string>} local  path → blob sha (notes in this browser, trash included)
 * @param {Map<string,string>} remote path → blob sha (markdown files in the repo)
 * @param {Map<string,string>} base   path → blob sha both sides had after the last sync
 * @returns {Array<{path, action, reason, remoteSha?, localSha?}>} actions:
 *   'push'          upload this browser's version (remoteSha = what we expect to replace, or null)
 *   'pull'          download the repo's version
 *   'delete-remote' delete in the repo (only if it is still the version we last saw)
 *   'delete-local'  delete here (only if this browser hasn't changed it since)
 *   'conflict'      both changed: keep this browser's version here and in the repo, and save the
 *                   repo's version as a separate "(conflict …)" note on both sides
 *   'adopt'         same content on both sides already; just record it as in sync
 */
export function planSync(local, remote, base) {
  const paths = new Set([...local.keys(), ...remote.keys(), ...base.keys()]);
  const out = [];
  for (const path of [...paths].sort()) {
    const L = local.get(path) ?? null;
    const R = remote.get(path) ?? null;
    const B = base.get(path) ?? null;
    if (L === R) {
      if (L !== null && B !== L) out.push({ path, action: 'adopt', reason: 'identical on both sides', localSha: L, remoteSha: R });
      continue;
    }
    const localChanged = L !== B;
    const remoteChanged = R !== B;
    if (!localChanged && remoteChanged) {
      out.push(R === null
        ? { path, action: 'delete-local', reason: 'deleted on another device', localSha: L }
        : { path, action: 'pull', reason: B === null ? 'new on another device' : 'changed on another device', remoteSha: R });
    } else if (localChanged && !remoteChanged) {
      out.push(L === null
        ? { path, action: 'delete-remote', reason: 'deleted in this browser', remoteSha: R }
        : { path, action: 'push', reason: B === null ? 'new in this browser' : 'changed in this browser', remoteSha: R, localSha: L });
    } else if (L === null) {
      // deleted here, edited elsewhere: the edit wins, so bring it back
      out.push({ path, action: 'pull', reason: 'deleted here but changed on another device, so it was restored', remoteSha: R });
    } else if (R === null) {
      // deleted elsewhere, edited here: keep the edit
      out.push({ path, action: 'push', reason: 'deleted on another device but changed here, so it was kept', remoteSha: null, localSha: L });
    } else {
      out.push({ path, action: 'conflict', reason: B === null ? 'exists on both sides with different text' : 'changed on both sides', remoteSha: R, localSha: L });
    }
  }
  return out;
}

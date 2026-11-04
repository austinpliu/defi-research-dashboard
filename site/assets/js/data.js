// Loads the JSON files written by the data script (site/data/*.json).
const cache = new Map();

export async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(`data/${path}`, { cache: 'no-cache' }).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(path);
    throw e;
  }
}

/** Never throws: { data } or { error } with a readable reason. */
export async function loadSafe(path) {
  try {
    return { data: await load(path) };
  } catch (e) {
    return { error: `Could not load data/${path} (${e.message}). If the data workflow hasn't run yet, run "Update data" on GitHub (Actions tab) or "node scripts/fetch-data.mjs" locally.` };
  }
}

export async function loadMany(paths) {
  const out = await Promise.all(paths.map(loadSafe));
  return Object.fromEntries(paths.map((p, i) => [p, out[i]]));
}

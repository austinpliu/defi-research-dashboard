// Reading and updating the #/path?query part of the URL (shareable views).
export function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

/** Update query params without re-rendering the page (history.replaceState). */
export function setQuery(params) {
  const { path, query } = parseHash();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') query.delete(k);
    else query.set(k, v);
  }
  const qs = query.toString();
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}

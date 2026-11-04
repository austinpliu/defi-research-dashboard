// Helpers for describing where every number came from.
//
// Each dataset in the output JSON has a "source" record:
//   { name, label, page, api, fetchedAt, ok, status, error }
// - page: a human page you can open to check the number by hand
// - api:  the exact endpoint the script called
// When a fetch fails we keep the last good copy for up to STALE_MAX_HOURS
// and mark it stale (with the reason), otherwise the site shows "unavailable".

export const STALE_MAX_HOURS = 48;

export function sourceRecord({ name, label, page, res, api, note }) {
  return {
    name,
    label,
    page: page || null,
    api: api || res?.url || null,
    fetchedAt: res?.fetchedAt || null,
    ok: Boolean(res?.ok),
    status: res?.status ?? null,
    error: res?.ok ? null : res?.error || 'Not fetched',
    ...(note ? { note } : {}),
  };
}

/** Derived numbers (ratios, annualised figures) cite the sources they are built from. */
export function derivedRecord({ label, from, formula }) {
  return { name: 'Calculated', label, derived: true, from, formula, ok: true };
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 36e5;
}

/**
 * If `fresh` failed but `prev` (same dataset from the last run) succeeded
 * recently, reuse the previous data and mark the source stale.
 * Returns { data, source }.
 */
export function carryForward({ freshData, freshSource, prevData, prevSource }) {
  if (freshSource.ok) return { data: freshData, source: freshSource };
  const prevOk = prevSource && (prevSource.ok || prevSource.stale) && prevData != null;
  const lastGood = prevSource?.stale ? prevSource.stale.lastGoodAt : prevSource?.fetchedAt;
  if (prevOk && hoursSince(lastGood) <= STALE_MAX_HOURS) {
    return {
      data: prevData,
      source: {
        ...prevSource,
        ok: true,
        stale: {
          lastGoodAt: lastGood,
          lastAttemptAt: freshSource.fetchedAt,
          reason: freshSource.error,
        },
      },
    };
  }
  return { data: null, source: freshSource };
}

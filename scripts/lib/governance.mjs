// Governance votes from Snapshot's public GraphQL hub (https://hub.snapshot.org/graphql, keyless).
// Space ids come from data, not guesses: DefiLlama's governanceID ("snapshot:aave.eth"),
// CoinGecko's links.snapshot_url, or an explicit "snapshot" list in watchlist.json.
import { sourceRecord } from './sources.mjs';
import { truncate, stripHtml, num, roundSmart } from './util.mjs';

export const SNAPSHOT = { hub: 'https://hub.snapshot.org/graphql', site: 'https://snapshot.org' };

export function spacesFromSources({ governanceID = [], snapshotUrl = null, override = [] }) {
  const out = new Set(override);
  for (const g of governanceID) {
    const m = String(g).match(/^snapshot:(.+)$/);
    if (m) out.add(m[1]);
  }
  if (snapshotUrl) {
    // https://snapshot.org/#/aave.eth  or  https://snapshot.box/#/s:aave.eth  or https://snapshot.org/#/s:aave.eth/
    const m = String(snapshotUrl).match(/#\/(?:s:)?([^/?#]+)/);
    if (m && m[1].includes('.')) out.add(m[1]);
  }
  return [...out];
}

const FULL_FIELDS = 'id title start end state author choices scores scores_total votes quorum discussion link space { id name }';
const MIN_FIELDS = 'id title start end state choices scores scores_total votes space { id name }';

// Snapshot's hub allows at most 5 top-level selections per query, so the work is
// split: one query for active/pending/recently-closed proposals + space stats,
// then "latest proposals" for up to 5 spaces per query.
export function mainQuery(fields, withSpaces) {
  return `query Gov($spaces: [String], $since: Int) {
  active: proposals(first: 50, where: { space_in: $spaces, state: "active" }, orderBy: "end", orderDirection: asc) { ${fields} }
  pending: proposals(first: 50, where: { space_in: $spaces, state: "pending" }, orderBy: "start", orderDirection: asc) { ${fields} }
  closed: proposals(first: 60, where: { space_in: $spaces, state: "closed", end_gt: $since }, orderBy: "end", orderDirection: desc) { ${fields} }
  ${withSpaces ? 'spaces(first: 50, where: { id_in: $spaces }) { id name proposalsCount followersCount }' : ''}
}`;
}
export function latestQuery(fields, n) {
  const vars = Array.from({ length: n }, (_, i) => `$s${i}: String`).join(', ');
  const roots = Array.from({ length: n }, (_, i) => `  latest${i}: proposals(first: 8, where: { space: $s${i} }, orderBy: "created", orderDirection: desc) { ${fields} }`).join('\n');
  return `query Latest(${vars}) {\n${roots}\n}`;
}

async function gql(http, query, variables, label) {
  const res = await http.json(SNAPSHOT.hub, {
    method: 'POST',
    label,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    retries: 2,
  });
  if (res.ok && res.data?.errors?.length) {
    return { ...res, ok: false, error: `GraphQL error: ${res.data.errors.map((e) => e.message).join('; ').slice(0, 200)}` };
  }
  return res;
}

export async function fetchProposals(http, spaces, { closedDays = 45 } = {}) {
  if (!spaces.length) return { proposals: [], source: null, spaceInfo: {} };
  const since = Math.floor(Date.now() / 1000) - closedDays * 86400;
  let res = null;
  let fields = FULL_FIELDS;
  for (const f of [FULL_FIELDS, MIN_FIELDS]) {
    fields = f;
    res = await gql(http, mainQuery(f, f === FULL_FIELDS), { spaces, since }, 'Snapshot proposals');
    if (res.ok) break;
  }
  const source = sourceRecord({
    name: 'Snapshot',
    label: 'Governance proposals',
    page: spaces.length === 1 ? `${SNAPSHOT.site}/#/${spaces[0]}` : SNAPSHOT.site,
    res,
    api: `${SNAPSHOT.hub} (POST, spaces: ${spaces.join(', ')})`,
  });
  if (!res.ok) return { proposals: [], source, spaceInfo: {} };
  const latest = [];
  for (let i = 0; i < spaces.length; i += 5) {
    const chunk = spaces.slice(i, i + 5);
    const r = await gql(http, latestQuery(fields, chunk.length), Object.fromEntries(chunk.map((s, j) => [`s${j}`, s])), 'Snapshot latest proposals');
    if (r.ok) chunk.forEach((_, j) => latest.push(...(r.data.data?.[`latest${j}`] || [])));
  }
  // dedupe: the same proposal can be both "closed recently" and "latest"
  const seen = new Set();
  const all = [...(res.data.data?.active || []), ...(res.data.data?.pending || []), ...(res.data.data?.closed || []), ...latest]
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const spaceInfo = Object.fromEntries((res.data.data?.spaces || []).map((sp) => [sp.id, { name: sp.name, proposalsCount: sp.proposalsCount ?? null, followers: sp.followersCount ?? null }]));
  const proposals = all.map((p) => {
    const scores = (p.scores || []).map(num);
    const total = num(p.scores_total) || scores.reduce((s, v) => s + (v || 0), 0);
    let lead = null;
    scores.forEach((v, i) => {
      if (v != null && (lead === null || v > scores[lead])) lead = i;
    });
    return {
      id: p.id,
      space: p.space?.id,
      spaceName: p.space?.name || p.space?.id,
      title: truncate(stripHtml(p.title), 200),
      state: p.state,
      start: p.start,
      end: p.end,
      votes: p.votes ?? null,
      choices: (p.choices || []).slice(0, 8),
      leadingChoice: lead !== null ? p.choices?.[lead] : null,
      leadingShare: lead !== null && total > 0 ? roundSmart((scores[lead] / total) * 100) : null,
      scoresTotal: roundSmart(total),
      quorum: num(p.quorum) || null,
      discussion: p.discussion || null,
      url: p.link || `${SNAPSHOT.site}/#/${p.space?.id}/proposal/${p.id}`,
    };
  });
  return { proposals, source, spaceInfo };
}

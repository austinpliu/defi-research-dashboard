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

function query(fields, withSpaces, nSpaces) {
  const perSpace = Array.from({ length: nSpaces }, (_, i) => `  latest${i}: proposals(first: 8, where: { space: $s${i} }, orderBy: "created", orderDirection: desc) { ${fields} }`).join('\n');
  const vars = Array.from({ length: nSpaces }, (_, i) => `, $s${i}: String`).join('');
  return `query Gov($spaces: [String], $since: Int${vars}) {
${perSpace}
  active: proposals(first: 50, where: { space_in: $spaces, state: "active" }, orderBy: "end", orderDirection: asc) { ${fields} }
  pending: proposals(first: 50, where: { space_in: $spaces, state: "pending" }, orderBy: "start", orderDirection: asc) { ${fields} }
  closed: proposals(first: 60, where: { space_in: $spaces, state: "closed", end_gt: $since }, orderBy: "end", orderDirection: desc) { ${fields} }
  ${withSpaces ? 'spaces(first: 50, where: { id_in: $spaces }) { id name proposalsCount followersCount }' : ''}
}`;
}

export async function fetchProposals(http, spaces, { closedDays = 45 } = {}) {
  if (!spaces.length) return { proposals: [], source: null, spaceInfo: {} };
  const since = Math.floor(Date.now() / 1000) - closedDays * 86400;
  let res = null;
  for (const fields of [FULL_FIELDS, MIN_FIELDS]) {
    res = await http.json(SNAPSHOT.hub, {
      method: 'POST',
      label: 'Snapshot proposals',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query(fields, fields === FULL_FIELDS, spaces.length), variables: { spaces, since, ...Object.fromEntries(spaces.map((s, i) => [`s${i}`, s])) } }),
      retries: 2,
    });
    if (res.ok && res.data?.errors?.length) {
      res = { ...res, ok: false, error: `GraphQL error: ${res.data.errors.map((e) => e.message).join('; ').slice(0, 200)}` };
      continue; // try again with the minimal field set
    }
    break;
  }
  const source = sourceRecord({
    name: 'Snapshot',
    label: 'Governance proposals',
    page: spaces.length === 1 ? `${SNAPSHOT.site}/#/${spaces[0]}` : SNAPSHOT.site,
    res,
    api: `${SNAPSHOT.hub} (POST, spaces: ${spaces.join(', ')})`,
  });
  if (!res.ok) return { proposals: [], source, spaceInfo: {} };
  // latest = most recent proposals per space even if older than the window (dedupe by id)
  const seen = new Set();
  const latest = spaces.flatMap((_, i) => res.data.data?.[`latest${i}`] || []);
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

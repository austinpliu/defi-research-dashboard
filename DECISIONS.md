# Decisions log

Choices made while building this unattended, with the reason for each. Newest at the bottom of each section.

## Environment and verification

- **The build sandbox could not reach any data API.** Its network policy blocked api.llama.fi, api.coingecko.com, api.geckoterminal.com, api.dexscreener.com, hub.snapshot.org, l2beat.com and every API docs site (HTTP 403 from the sandbox proxy). So:
  - I checked endpoints against the official SDK route tables I could download (CoinGecko's official TypeScript SDK `@coingecko/coingecko-typescript` 8.3.1 from npm, which also covers GeckoTerminal's on-chain routes, and the `defillama-sdk` 0.1.4 package from PyPI), plus web-search summaries of the DexScreener and Snapshot docs.
  - I ran the real data fetch on GitHub Actions (which has normal internet access), pulled the JSON it committed, and read the job logs to confirm each endpoint's live response. That's the same path production uses.
  - Source links are checked by `scripts/check-links.mjs`, which also runs on GitHub Actions; the results appear on the site's Sources page.
- **Synthetic test data lives only in `tests/fixtures/`** and is only written to a temporary folder by the tests. Nothing synthetic ever reaches `site/data/`.

## Data sources

- **DefiLlama free endpoints only** (no `pro-api.llama.fi`): `/protocols`, `/protocol/{slug}`, `/v2/chains`, `/v2/historicalChainTvl[/{chain}]`, `/overview/fees`, `/overview/dexs`, `/summary/fees/{slug}` (dataType = dailyFees / dailyRevenue / dailyHoldersRevenue), `stablecoins.llama.fi/stablecoins`, `/stablecoincharts/all`, `yields.llama.fi/pools`, and `coins.llama.fi` as a price fallback.
- **The global raises list and token unlocks are Pro-only on DefiLlama** (the docs list hacks as Pro too, but the free host serves it; see "Learned from the live runs"). The script asks the free host once per run and reports any refusal honestly. Funding raises still appear on protocol pages because the free `/protocol/{slug}` response includes each protocol's own `raises`. DefiLlama's timeline notes ("hallmarks") are shown as an incident/milestone timeline.
- **Unlocks:** no free, keyless, documented source exists (Tokenomist, CryptoRank, Messari and DefiLlama's unlock data all need keys). I did not probe undocumented endpoints. The site shows "unavailable" with this reason, and token pages show the supply breakdown (circulating vs. max), which is the closest live, sourced proxy.
- **Unlocks, checked again (Nov 2026 follow-up): still no keyless source, so Catalysts still has no unlock dates.** DefiLlama's `/emissions` answers HTTP 402 (paid plan) in every run. DropsTab's `/tokenUnlocks` needs a key from its builders program, and Magna's schedules API needs a project key. A wrapper on oanor.com that describes itself as "no key" asks for a key in its own FAQ and caps the free tier at 100 calls a month. Tokenomist's free tier is a website, not an API. Scraping the DefiLlama unlocks page or running DefiLlama's open-source emissions adapters ourselves was ruled out: the first goes against "prefer APIs, respect terms", and the second is building a data source, not using one.
- **Perpetuals volume** (e.g. Hyperliquid) is Pro-only on DefiLlama (`/overview/derivatives`, `/summary/derivatives`), so it isn't shown. Hyperliquid's fees and revenue are free and are shown.
- **L2BEAT skipped:** it has no documented public API (only an internal endpoint used by its own website).
- **CoinGecko keyless public API** (`api.coingecko.com/api/v3`, no key header). Its keyless limit is low and shared per IP, so calls are spaced ~7 s apart with retries. If it fails, prices fall back to DefiLlama's coin price API and the page says which fields are missing.
- **DEX liquidity:** DexScreener `/token-pairs/v1/{chainId}/{address}` first, using a small table that maps CoinGecko platform ids to DexScreener chain ids. GeckoTerminal is the fallback; its `/networks` list maps CoinGecko platform ids to its own network ids, so that mapping isn't guessed. (The first plan was GeckoTerminal first; the live runs showed it rate-limits too quickly.)
- **Governance:** Snapshot's public GraphQL hub. Space ids come from DefiLlama's `governanceID` field or CoinGecko's `links.snapshot_url` (never guessed); `watchlist.json` can add more.
- **News:** RSS feeds from CoinDesk, The Block, Decrypt, Cointelegraph, Blockworks, DL News and The Defiant; protocol governance forums via Discourse's standard `/latest.rss`, and Medium blogs via `/feed`. Feeds that fail are listed on the Sources page with the error. Only headline, date, a short snippet and the link are stored.
- **Repo renamed (Nov 2026):** the repository is now `austinpliu/defidashboard`; README, the site footer and the pipeline's User-Agent use the new name (GitHub redirects the old one).
- **User-Agent:** requests identify as `defidashboard/1.0 (+repo URL)`, with no personal details.

## Data rules

- **No invented numbers.** Every figure comes from a fetch in the latest run, or (see next point) the previous one. Derived figures (annualized fees, market cap ÷ fees, revenue share) are labelled "Calculated" and cite the inputs and formula.
- **Stale data instead of blanks, for at most 48 hours.** If a source fails, the previous run's copy of that section is kept and clearly marked STALE, showing when it was last fetched and why the new fetch failed. After 48 hours it becomes "unavailable" with the reason. A free API hiccup shouldn't blank the page for 6 hours, but an old number shouldn't pass as fresh either.
- **Flow metrics (DEX volume, fees):** the headline value is the last 24 hours. The 7-day and 30-day changes compare rolling windows (last 7 days vs. the 7 before, last 30 vs. the 30 before), using DefiLlama's own `change_7dover7d` / `change_30dover30d` fields, so they match DefiLlama's site.
- **Stock metrics (TVL, stablecoin supply):** changes are point-to-point (today vs. 7/30 days ago) from the daily series.
- **"Stablecoins by issuer"** uses DefiLlama's per-stablecoin list. Each coin is one issuer's product (Tether → USDT, Circle → USDC, …), so coins are shown by name rather than grouped under hand-written issuer labels.
- **Top protocols by fees/revenue** combine child protocols under their parent (Aave V2 + V3 → Aave), the way DefiLlama's own tables do. Blockchains (category "Chain") and CEXs are excluded from protocol rankings.
- **Biggest movers** only count protocols with at least $100M TVL, so tiny protocols with +900% swings don't crowd out meaningful moves.
- **Protocol descriptions** are DefiLlama's own description, trimmed to two sentences (sourced, rather than written by me).

## Watchlist

- Starting slugs: maple, aave, ondo-finance, centrifuge, sky, hyperliquid, pendle. If a slug fails, the script looks it up by name in DefiLlama's protocol list and tells you the correct slug on the Sources page.
- CoinGecko ids: syrup (Maple's SYRUP), aave, ondo-finance, centrifuge-2 (the migrated CFG; `centrifuge` is the retired token), sky, hyperliquid, pendle. If an id is wrong the script runs CoinGecko's search and shows suggestions on the Sources page.
- Added three **peers** (Morpho, Ethena, Compound) so the Compare view has comparison points out of the box. They are in a separate `peers` list, aren't part of the watchlist strip, appear in Catalysts tagged "peer", and can be deleted.
- Docs links in `watchlist.json` are hand-entered (no API offers them), and the link checker verifies them.

## Architecture

- **Static site + scheduled GitHub Action, no build step.** Plain HTML/CSS/JavaScript modules, so there is nothing to compile and any static host works.
- **Three workflows:** `update-data.yml` (every 6 hours at :23 past UTC, the manual "Run workflow" button, and any push that changes `watchlist.json` or the scripts), `publish-site.yml` (publishes `site/` to GitHub Pages from `main`), and `site-check.yml` (opens every page in a browser on site changes). GitHub only shows the "Run workflow" button and runs the schedule once the workflow files are on the default branch.
- **Every push that edits `watchlist.json` refreshes the data**, on any branch, so a new protocol shows up without waiting for the schedule.

## Learned from the live runs

- **DefiLlama free host confirms Pro-only endpoints:** `/raises` and `/emissions` answer HTTP 402 ("Upgrade to the paid API plan"). `/hacks` is free and works (1,300+ incidents); hacks are matched to protocols by DefiLlama protocol id, not just name.
- **Some parent protocols have no combined TVL** (Ondo Finance and Centrifuge returned an empty `tvl` series). The script first adds up the parent's per-chain series, then its sub-protocols' own series, and the page says which it did. If neither has data, the TVL section says "unavailable" with that reason.
- **Parents carry no category or chain list**, so the script takes the category of the children that earn the most fees over 30 days (falling back to TVL when DefiLlama has no fees for any child), and the union of their chains. Weighting by TVL made Hyperliquid a "Bridge", because the deposits behind its exchange sit in its bridge contract ($6.4B of its $8.1B). By fees it comes out as "Derivatives", which matches what the business does. Hovering the category shows the rule and the other categories its sub-protocols cover.
- **CoinGecko renames migrated tokens "[OLD]".** `centrifuge` is "Centrifuge [OLD]"; DefiLlama's id `centrifuge-2` is the live CFG token. The watchlist now uses `centrifuge-2`, and the script switches to DefiLlama's id automatically (with a warning) if it meets an "[OLD]" token again.
- **GeckoTerminal rate-limited** (HTTP 429) even at one call per 2.3 s, so DEX pools now come from DexScreener first (300 calls/min) and GeckoTerminal only covers chains DexScreener doesn't (e.g. Hyperliquid's own chain), at one call per 3.5 s. At most 3 chains per token are searched (Ethereum first), and the page lists which ones.
- **Snapshot space ids from DefiLlama can be stale.** DefiLlama lists `aave.eth` for Aave, but Snapshot has no such space. `aavedao.eth` (in `watchlist.json`) is the live one ("Aave DAO", about 990 proposals), confirmed by the hub in run 12. The script asks the hub which spaces exist. A missing space is noted on the Sources page ("info" if the protocol has another working space, "warn" if not), and the protocol page links only spaces that exist.
- **Snapshot coverage is thin for this watchlist.** Aave (`aavedao.eth`), Compound and Morpho (peers) have Snapshot spaces. Sky, Maple, Pendle, Hyperliquid, Ondo and Centrifuge vote on-chain or elsewhere, and no keyless API for on-chain governance was found (Tally needs a key). Governance forum RSS feeds (Aave, Sky, Maple, Centrifuge) fill the gap in Catalysts.
- **Ondo has no governance forum at forum.ondo.foundation** (DNS doesn't resolve), so that feed was removed.
- **Governance sources for the six watchlist protocols without them (Nov 2026 follow-up).** Only sources that are public and keyless count:
  - **Maple:** nothing could be confirmed. Maple's docs and voting guide point to the Snapshot space `maple.eth`, and Goverland lists its proposals (MIP-019 in Oct 2025, MIP-020 in Jan 2026). But in run 17 Snapshot's hub returned no space and no proposals for that id, so the dashboard would get no data from it, and it was removed again. MIPs are still covered: they are posted on Maple's forum (`community.maple.finance`), which was already in. If the hub starts answering for it, add `"snapshot": ["maple.eth"]` back to Maple's entry.
  - **Ondo:** added the Flux Finance forum (`forum.fluxfinance.com`, Discourse) as Ondo's governance forum. Ondo DAO proposals are posted there before an on-chain vote on Tally, and Tally needs a key. Confirmed in run 17: the feed loaded 30 posts, and recent Ondo DAO proposals now appear in Catalysts. No Ondo Snapshot space was found.
  - **Centrifuge:** nothing to add. Votes happen on OpenSquare (off-chain, Polkadot tooling) and on-chain referenda, not Snapshot, and CP171 paused the DAO's active governance in 2025. Its forum (`gov.centrifuge.io`) was already in.
  - **Sky:** nothing to add. Votes are on-chain at vote.sky.money (no documented keyless API), and its forum was already in.
  - **Hyperliquid:** nothing to add. Validators vote on-chain, and the discussion happens in a Discord governance forum, which has no public feed. Its Medium blog was already in.
  - **Pendle:** nothing to add. Blockworks' token-transparency filing says no DAO exists; vePENDLE voting is on-chain. Its Medium blog was already in.
- **Bridges are excluded from category totals and movers.** DefiLlama's protocol list includes Bridge and Canonical Bridge entries (about $74B) whose assets are already counted on the chains they bridge to; DefiLlama's headline TVL leaves them out too. They stay in the Screener, where you can filter by category.
- **The "launch / upgrade" label** is a keyword rule on headlines (launch, upgrade, mainnet, migration, deploy, goes live, release…). Version numbers like "V3" no longer count, because "Risk Stewards: cap changes on Aave V3" isn't a launch.
- **Fee "vs prior 30 days" changes:** DefiLlama's per-protocol summary often omits them, so they are calculated from the same daily series and the tile says "(calc.)".
- **DefiLlama stablecoin page links** use the slugified coin name (`/stablecoin/sky-dollar`); the gecko id (`/stablecoin/usds`) 404s. Verified with the link checker.
- **Some DefiLlama yield-pool pages 404** even though the pool is in the live API (7 of about 90 checked in run 12, almost all collateral-only pools paying 0%). The API endpoint is cited too, so the number can still be checked, and the link checker's broken list makes the site mark those links "didn't open" where they appear.
- **"Top yield pools" means pools that pay yield.** Pools are listed largest first, but those paying 0% (usually collateral-only, like Compound V3's WBTC) go after every pool that pays something. They used to fill most of Compound's table. The table title says how many 0% pools there are.
- **Link checker:** many sites (DefiLlama, CoinGecko, DexScreener, Etherscan, The Defiant…) sometimes answer automated requests with a bot-check page (HTTP 403 "Just a moment…"). Those links are listed as "check by hand", not "broken", and so are rate limits (429), servers that are overloaded or down at that moment (502/503/504), and connection failures. API requests that failed during the data fetch (the paid-only 402s, or "no data of this type" 400s) are listed as "failed in fetch": they are the reason a section says "unavailable", not broken links. The checker records the page title for links that open, so you can confirm they land on the right protocol. It now checks every link (about 800; it was capped at 600) at one request per second per site, which takes about 3–4 minutes. Two exceptions: DefiLlama's per-pool history endpoint (`yields.llama.fi/chart/…`) rate-limits after a few calls, so only 6 of those are opened and the rest are labelled "not checked one by one"; and an API request that was rate-limited during the data fetch counts as "check by hand", not broken (run 13 listed three GeckoTerminal 429s as broken before this fix).

## Token unlocks: the three routes (Nov 2026)

Rule throughout: no API keys, no paywall workarounds, no scraping against a site's terms, and no estimated or invented unlocks. A token whose schedule can't be confirmed from a real source shows "unconfirmed".

- **Route 1, DefiLlama's open-source emissions adapters: not available.** The repository `github.com/DefiLlama/emissions-adapters` isn't public any more:
  - From this sandbox, every raw.githubusercontent.com path in it returned 404 (package.json and README on master and main), while DefiLlama's other public repos (e.g. dimension-adapters) loaded normally.
  - From GitHub's own Actions runner, which has normal internet access, an anonymous `git ls-remote` was refused with a credentials prompt (GitHub does this for private or missing repos), and the link checker got HTTP 404 for the repo page (run 19).
  - Using an old fork or mirror of a repo its owner has taken private would get around DefiLlama's decision to sell unlock data on its paid API, so it wasn't tried. A sandbox probe of a CDN mirror was also refused by this environment's safety check, rightly.
  - The pipeline still checks once per run (anonymously, outside this repo's checkout, so no token is ever sent), and the result is listed among the Catalysts sources. If the repo becomes public again, the check will say so.

- **Route 2, on-chain vesting contracts: not feasible for these tokens yet.** Reading a schedule from the chain needs the vesting contract's address from an official source. Guessing addresses, or trusting unofficial explorer labels, would be inventing the source.
  - Ethena's "Key Addresses" page lists the ENA and sENA token contracts but no team or investor vesting contract.
  - Morpho's token docs describe the vesting cohorts but publish no vesting contract.
  - No official vesting contract address was found for Ondo, Centrifuge, Maple or Hyperliquid. Hyperliquid's contributor tokens live on HyperCore, its own chain, not in an EVM contract. Pendle's team and investor tokens are fully vested, so there is nothing to read.
  - When a project publishes its vesting contract, a free keyless RPC call can read it from the pipeline, with an explorer link for checking.

- **Route 3, a hand-checked `unlocks.json` from each project's own docs: done.** Each tracked token has a status, a summary, the exact docs pages with a last-checked date, any vesting schedules (monthly or linear) and dated releases.
  - **Amounts:** shares of supply come only from the docs. Token amounts are that share × CoinGecko's max supply (total supply if there is no max), and the page says so. Where the docs give no share, or official figures disagree, the amount is "not published". Examples: Ethena's investor share, Ondo's tranche sizes, and Morpho's cohort 3 (6.7% in the docs, 6.23% in the whitepaper).
  - **Dates:** when the docs say "monthly" without a day, tranches are shown as "During Dec 2026", never on a made-up day. The current month is skipped, because its tranche may already have happened. A linear vest shows its average per month only when the docs give both its start and end dates.
  - **Results on 5 Nov 2026:**
    - ENA, scheduled: core contributors get 0.625% of supply a month until March 2028; investors are on the same cadence, amount unconfirmed.
    - MORPHO, scheduled: founders' 15.2% vests linearly until 21 Nov 2027; cohort 3 has a window only.
    - ONDO, partial: releases on 18 Jan 2027, 2028 and 2029; sizes not published.
    - CFG, partial: vesting windows to Mar 2028, Apr 2029 and May 2030.
    - PENDLE, none: fully vested since Sept 2024.
    - HYPE, SYRUP, AAVE, SKY and COMP, unconfirmed: none of these projects publishes a schedule.
  - **How the docs were read:** this sandbox can't open most websites, so each page was read through web-search results that quote it. Every entry links the page so you can check it yourself. Third-party trackers (Tokenomist, MEXC, KuCoin) were used only to find the official pages, never as the source of a number.
  - **Safety rails:** the pipeline validates the file (status, dates, http(s) links, shares between 0 and 1), lists bad entries on the Sources page, and adds a reminder once `lastChecked` is more than 90 days old. Unlock events in Catalysts carry a "hand-checked" tag. Tranches for one token in the same month (e.g. Ethena's core contributors and investors) are merged into one item, and only the next 6 months are shown (token pages show the full year).

## Category shares (REVIEW item 7, Nov 2026)

- **Categories use the headline's basis.** DefiLlama's headline DeFi TVL leaves out liquid staking and double-counted TVL, so each protocol now adds only what the headline counts. That is its TVL minus DefiLlama's per-protocol `doublecounted` and `liquidstaking` figures, with `dcAndLsOverlap` added back.
  - I couldn't confirm from this sandbox that the protocol list carries those figures. The pipeline's list of non-chain keys already names them, and DefiLlama's site uses them for its "double count" and "liquid staking" toggles.
  - If a run's list lacks them, the pipeline says so on the Sources page and leaves out whole categories by rule: Liquid Staking, Liquid Restaking, Yield, Yield Aggregator, Restaking, Risk Curators and Onchain Capital Allocator.
  - "Staking Pool" ($14.6B in run 26) is not on that list and stays in the category totals. **Its treatment is unconfirmed**: I couldn't find whether DefiLlama's headline counts it, and you chose (5 Nov 2026) to keep it in rather than guess.
  - DefiLlama's undocumented `lite/protocols2` feed would likely close the remaining gap; you chose (5 Nov 2026) to keep to documented sources, so it isn't used.
- **Live result (run 26):** the free protocol list carries no per-protocol double-count data (0 protocols). Category rules bring the total from $198.9B to $108.5B, still 128% of the $84.9B headline. So shares are of the categories' own total, and the Overview note explains why they can't be of the headline. I didn't use DefiLlama's undocumented `lite/protocols2` endpoint to close the gap (same rule as for unlocks: documented endpoints only).
- **Shares are of the headline only when the totals reconcile (within 3%).** Otherwise they are of the categories' own total, and the note under the chart says how far apart the two are and why. A share must never be part of a total it exceeds. The 3% allowance covers DefiLlama totalling each chain separately; chain shares already match the headline to within 0.3%.

## Notes workspace (Nov 2026)

- **Storage:** IndexedDB in the browser, with an in-memory copy for instant reads. If IndexedDB is blocked (some private windows), notes live in memory for the tab, and the page says so and points to Export. Notes are never written to `site/` or the repo. `.gitignore` covers exported vaults and any notes folder, and `tests/privacy.test.mjs` fails if a token, an export or a notes folder is ever tracked, or if notes code calls the network anywhere but sync's GitHub API.
- **Format:** every note is a `.md` file at its folder path.
  - Frontmatter is optional. New notes get `created` and `updated`, and tags typed in the tag field go to `tags:`. Pins are stored as `pinned: true` so they sync. Unknown frontmatter keys are kept as written.
  - Links follow Obsidian: `[[Name]]`, `[[Name|alias]]`, `[[Folder/Name#heading]]`, `![[embeds]]` (shown as links) and `#tags`. Resolution goes path first, then name, then alias, preferring the same folder and then the shortest path.
  - Renames write the shortest unambiguous link (the name, or the path when two notes share a name).
- **Trash:** `.trash/` with the original folder structure, as in Obsidian. Links to a trashed note are left as written, so restoring it reconnects them.
- **Undo:** edits made by toolbar buttons and autocomplete go through `document.execCommand('insertText')`, so the browser's own undo covers them. It is deprecated but still the only way to keep a textarea's undo stack; there is a fallback if it's missing.
- **Quick-capture shortcuts:** **Alt+N** (quick note) and **Alt+M** (panel). Ctrl/⌘+N and Ctrl/⌘+Shift+N belong to the browser (new window, private window), so they can't be used.
- **Preview safety:** the markdown preview is built from DOM nodes, never `innerHTML`. Links must be http(s) or in-dashboard (`#/…`). Remote images aren't loaded (that would tell third parties when a note is opened); they show as links.
- **Graph:** hand-written canvas force layout (no library), coloured by top-level folder with the dashboard's validated categorical palette. "Draw a link" appends `[[target]]` at the end of the source note.
- **Sync:**
  - **Data model:** a three-way comparison of git blob hashes (this browser, the repo, the last agreed state), so it works without timestamps or clocks.
  - **Conflict rules:**
    - Both changed: keep both. The other device's version becomes a flagged "(conflict …)" note on both sides.
    - Deleted on one side, edited on the other: the edit wins.
    - Uploads name the version they replace, so GitHub rejects a write if the repo changed mid-sync, and the next run treats it as a conflict.
  - **API:** the Contents API makes one commit per changed file. That's simpler and safer than building trees, and fine for a notes repo.
  - **Guards:** sync refuses public repos and this dashboard's repo (old and new names).
  - **Token:** kept in localStorage in that browser only and sent only to `api.github.com`. Restricting it to one repository and "Contents" is the user's job, and the README walks through it.
  - **Tests:** sync can't reach GitHub from the build sandbox, so it is tested against a fake GitHub that enforces the same `sha` checks.
- **Import never overwrites:** a different note with the same name comes in as "… (imported)". Obsidian's `.obsidian/` folder and non-markdown files are skipped and counted.

## Fundamentals Checklist (Nov 2026)

A research aid, not a rating or a buy signal. Each check says how the data compares with *your* thresholds, and "no data" (with the reason) whenever a number is missing. Nothing is estimated.

- **Where the work happens:** the pipeline only gathers inputs and their sources into `site/data/fundamentals.json`. The statuses are computed in the browser by `site/assets/js/fundamentals/rules.js`, so a threshold change applies at once. The same file is unit-tested in Node.
- **Thresholds:** one documented file, `site/config/fundamentals-thresholds.json`. Each entry has a label, unit, default, min, max and a one-line explanation, and the "How this works" panel renders straight from it. Strong/weak pairs must stay in order: for "higher is better" the strong cutoff must be higher than the weak one, otherwise lower. Equal cutoffs are rejected too, because they leave no room for ~. A bad value (not a number, negative, out of bounds, or out of order) falls back to the default, with a message saying so. Out-of-order pairs reset both values. Overrides for keys that no longer exist are ignored.
- **Annualized means the last complete 30 days × 365 ÷ 30.** Every window must have every day present, or the number is "no data". Partial windows are never scaled up.
- **1. Revenue reaching holders:** DefiLlama's `dailyHoldersRevenue` from `/summary/fees/{slug}` is keyless. It works for every watchlist protocol except Ethena, which answers HTTP 400.
  - **Statuses:**
    - Revenue of 0 → ✗.
    - Holders revenue of 0 → ✗.
    - Holders' share below the weak line → ✗.
    - Share at or above the strong line *and* at least the minimum yearly dollars → ✓. The dollar floor stops a big share of a tiny revenue from counting.
    - Anything else → ~.
  - **The 90-day trend** compares the last 30 days with days 60–90 before now.
  - **Incentives vs holders revenue is "no data" for all.** Emissions are only on DefiLlama's paid `/emissions` (HTTP 402). There's no keyless source for incentive spend in dollars.
- **2. Revenue relative to size:** market cap ÷ annualized revenue, like a P/E ratio. At or under the strong line → ✓, at or over the weak line → ✗, so a value exactly on a line counts as reaching it.
  - Zero revenue → ✗, because the market cap is backed by no revenue at all.
  - Revenue as a % of TVL is shown alongside but doesn't affect the status: TVL isn't comparable across lending, perps and RWA.
  - The watchlist rank sorts by that ratio, lowest first. Ties share a rank (1, 2, 2, 4), and protocols with no revenue or no market cap are unranked.
- **3. Value-accrual switch:**
  - **Pattern:** annualized revenue ≥ the minimum, and holders' share at or under "little or nothing". This is detected automatically.
  - **Statuses:**
    - The pattern plus a confirmed entry in `site/config/value-accrual.json` (or your Settings) → ✓.
    - The pattern alone → ~.
    - Below the revenue minimum, or value already reaching holders → "n/a" (—), not ✗. There's no option to price in those cases, and calling that "weak" would be misleading.
  - Every entry needs an http(s) source and a "last checked" date. The file ships empty: I didn't record any plans, because each one has to be confirmed by hand from a primary source.
- **4. Supply overhang:**
  - **Inputs:** circulating as % of max supply, market cap ÷ FDV, and unlocks over the next 12 months as % of circulating. Unlocks come from the hand-checked `unlocks.json` and count only events with a published size. Releases of unknown size are listed, not guessed.
  - **If the schedule is unconfirmed:** whatever isn't circulating yet (max − circulating) is the most that could ever unlock. That ceiling settles the question only when it's already under the strong line (e.g. SKY, about 0.2%). Otherwise the overhang stays unknown and the check is ~.
  - **Statuses:** circulating below the weak line, or unlocks above the weak line → ✗. Circulating at or above the strong line (or no max supply) *and* unlocks at or under the strong line → ✓. No max supply and no schedule → "no data".
  - **Range rule:** the longest stretch, ending with the latest week, in which the highest weekly price is at most `supply.rangeBand` × the lowest (2× by default). It uses DefiLlama's weekly price history over up to 5 years, and is shown as years plus the low–high band. It's context only and doesn't change the status, because a long sideways range can mean either quiet accumulation or no interest.
- **5. Liquidity and float:** DEX liquidity (pool reserves from the existing DEX data) and 24h volume across all exchanges, both as % of market cap.
  - DEX liquidity under the weak line → ✗ ("thin").
  - Liquidity at or above the strong line *and* volume at or above its line → ✓.
  - Volume but no reported DEX liquidity → ~, not ✗. HYPE trades mostly on Hyperliquid's own order book, which isn't a DEX pool.
- **6. Track record:**
  - **Inputs:**
    - Age is measured from the first non-zero TVL point on DefiLlama.
    - The drawdown is the worst month-end TVL ÷ its running peak.
    - Hack losses are net of returned funds, from DefiLlama's hacks list.
  - **Statuses:** younger than the weak line, net losses over the line, or a drawdown below the weak line → ✗. Older than the strong line with the drawdown at or above its line → ✓.
  - **Example:** Maple's TVL really did fall to almost nothing for a few weeks in mid-2022 (DefiLlama shows $0 at the end of June 2022), so it is ✗. That's the data, not a glitch: the daily series falls from $150M to $0 over a week.
  - **Team notes** (`site/config/team-notes.json`, or Settings) are context with sources and never change the status.
- **7. Narrative vs fundamentals:**
  - **Measure:** the 90-day price change minus the change in revenue between the last 90 days and the 90 before.
  - **Statuses:** the price ahead by more than `narrative.aheadPts` → ✗. Revenue ahead by more than `narrative.lagPts` → ✓ ("possibly overlooked"). Anything else → ~.
  - 30-day changes are shown too.
  - An incomplete or zero earlier window → "no data", because a % change from zero is meaningless.
- **No overall score.** The overview shows the seven statuses side by side and never adds them up. A total would turn a research aid into a rating.
- **Charts without dual axes:**
  - "Market cap vs revenue" is drawn as a single ratio line: market cap ÷ rolling 30-day annualized revenue.
  - "Price vs revenue" puts price and rolling 30-day revenue on one axis, both indexed to 100.
  - Supply is a bar chart in tokens: circulating, total, max, and unlocks in the next 12 months when their size is known.
- **Deep links use query parameters** (`?check=supply`, `?how=1`), because the site's router owns the `#` part of the URL.
- **"New note from this checklist"** uses the notes workspace's quick capture: an Inbox note with every status, number and source link, a link back to the page, and an empty "My take" section.
- **Nav:** Fundamentals sits after Screener, ahead of the reference pages, but its section number is 10 because it was added last.
- **Settings: defaults vs yours.**
  - The public files in `site/config/` are the defaults. Your edits are stored as overrides on top of them, so they apply to you only:
    - thresholds you changed;
    - entries you added or edited, by id;
    - ids of default entries you deleted.
  - So an entry added to the public file later still shows up for you, unless you deleted it.
  - An empty threshold field, or one set back to its default, removes the override.
- **Settings validation:** threshold edits apply as you type, but an impossible value is never saved. Impossible means not a number, negative, out of bounds, or a ✓ cutoff no stronger than the ✗ one. The checklist keeps the last good value, the field shows why, and the live preview shows the default there.
  - Value-accrual entries need a protocol, a one-sentence description, an http(s) source and a "last checked" date. Team notes need text, at least one http(s) source and a date.
  - A stored entry that fails validation is skipped, with a message, instead of breaking the page.
  - A settings file that can't be read falls back to the defaults and says so. The file itself is kept untouched until you save.
- **Settings storage and sync:**
  - **Where it's stored:** one JSON file, `.dashboard/fundamentals-settings.json`, kept in the notes store's IndexedDB `meta` table (under `sys:`), not with the notes. The notes tree, search, graph, links, backlinks and the zip export never see it. Settings have their own Export and Import.
  - **Sync:** notes sync also lists and uploads `.dashboard/*.json` in the same private repo, with the same token, the same `sha` checks and the same three-way plan.
  - **Conflicts:** when both sides changed the file, it is merged by content, per threshold and per entry id, against the version both last agreed on (fetched from git by its blob hash). One-sided changes combine.
    - If both changed the same setting, your value is kept. The other device's value is saved in `.dashboard/conflicts/…json`, on both sides, and the Settings page offers "Use theirs" for each one.
    - Nothing is overwritten without a record. The merge is unit-tested, and tested end to end against a fake GitHub.
  - **Sync off:** settings save in this browser only, and the Settings page says so, with a button to set up sync.
- **Import replaces your settings only after a confirmation** that says what's in the file and how many values in it are invalid. Export writes only your overrides, not the defaults.
- **Overview takeaway:** names the protocol returning the most holders revenue relative to its market cap (annualized holders revenue ÷ market cap), and how many send none. Two protocols tie when their yields are equal at one decimal, as shown.

## Design

- **Visual language inspired by a16z crypto's State of Crypto 2025, without copying it.** No logos, names, wording or layouts are copied. Borrowed ideas: warm off-white paper, heavy black headlines, one accent per section, a highlighter block behind the key phrase, big numbered section openers with a blocky accent shape, callout boxes for standout numbers, colored table header rows, small source lines.
- **Section accents:** 01 Overview orange, 02 Protocols yellow, 03 Tokens pink, 04 Compare green, 05 Catalysts purple, 06 Screener blue, 07–08 neutral.
- **Fonts:** Inter (text) and Inter Tight 700–900 (headlines), self-hosted from the Fontsource npm packages (SIL Open Font License, included), so PNG exports render the same fonts.
- **Charts:** ECharts 6.1 (Apache-2.0), vendored in `site/vendor/` so the site has no runtime CDN dependency. Hairline horizontal gridlines only, 2 px lines, thin bars with rounded ends, value labels at bar tips and line ends.
- **Colors for multi-series charts** use a palette that passed a colorblind-safety and contrast validator on both the light and dark backgrounds (worst adjacent-pair CVD ΔE 9.1 light / 8.4 dark). Single-series charts use the section accent. Light accents below 3:1 contrast always carry value labels, and every chart has a table view.
- **Direct labels and legends:** lines are labelled at their ends and bars at their tips. Multi-series charts also keep a small legend row so identity never depends on color alone. That's a small departure from "direct labels instead of legends".
- **No dual-axis charts.** Price and volume, or TVL and price, are separate charts. Compare uses one axis, either in dollars or with every series rebased to 100 at the start.
- **"Today in one glance"** at the top of the Overview repeats every chart's generated headline in one numbered list, each jumping to its chart.
- **Dark mode** follows the operating system by default; the toggle remembers your choice in the browser.

## Later additions

- **Catalysts include peers** (tagged "peer"), because the watchlist protocols mostly vote on-chain and Snapshot only has active spaces for Compound and Morpho. Snapshot's "latest proposals" are fetched per space, so one busy space can't crowd out the others.
- **Only http(s) links are ever shown or opened.** Feed links come from third-party RSS, so a `javascript:` URL could otherwise become a clickable link. The pipeline drops such items and the site refuses to render them.
- **A second, sourced description** from CoinGecko appears under DefiLlama's on protocol pages when the two differ (some DefiLlama parent descriptions describe a sub-product).
- **Site check workflow:** every push that changes the site or tests opens all pages in headless Chromium (desktop and phone sizes) and fails on JavaScript errors, empty pages, undrawn charts or sideways scrolling. It pins Playwright 1.49.1 so the browser download is reproducible.
- **The 6-hour schedule only runs on the default branch** (GitHub's rule for scheduled workflows). Until this branch is merged into `main`, data updates happen on pushes and manual runs only.
- **Repository growth:** each data update rewrites about 3 MB of JSON, and git stores only the differences. If the repository ever gets too big, keep only the latest data on a separate branch, or publish data as a Pages artifact without committing it.
- **Saving data never merges.** A run checks out the commit that triggered it. If an earlier run saved data in the meantime, rebasing the two data commits conflicts (run 6 failed this way). Every run rewrites all data files, so the save step now resets to the newest commit on the branch, puts its own data on top and pushes, retrying if the branch moves again. Code commits pushed in the meantime are kept. This was checked with a local simulation of the race before shipping.
- **More coins without more requests per coin.** The Tokens page lists about 400 coins from two keyless CoinGecko calls (`/coins/markets`, the 250 largest by market cap, and the same call with `category=decentralized-finance-defi`). Only watchlist and peer tokens get full pages (each costs several rate-limited calls); the others link to CoinGecko. A coin is tagged "DeFi" when it is in CoinGecko's DeFi category list, and "Unknown" if that list failed.
- **Prediction markets come from Polymarket's public Gamma API** (`/events?tag_slug=crypto&closed=false&order=volume24hr&ascending=false`, all documented at docs.polymarket.com; no key). The 25 busiest crypto events by 24-hour volume are shown with up to three likeliest outcomes. Prices are shown as implied probabilities and labelled "market prices, not forecasts". Closed sub-markets are dropped, and events whose tags aren't crypto are filtered out again on our side in case the API ignores the tag filter. Kalshi also has a public market-data API but few crypto-native markets, so it was left out to keep this small. Prediction-market protocols (Polymarket, etc.) come from DefiLlama's protocol list, which the pipeline already fetches, so they cost no extra request.
- **Text contrast** was measured, not eyeballed: muted text is 5.3:1 on cards (4.8:1 on the page) in light mode and 5.8:1 in dark mode, and ink on every highlighter color is above 9:1.

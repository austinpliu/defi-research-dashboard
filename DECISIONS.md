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
- **Perpetuals volume** (e.g. Hyperliquid) is Pro-only on DefiLlama (`/overview/derivatives`, `/summary/derivatives`), so it isn't shown. Hyperliquid's fees and revenue are free and are shown.
- **L2BEAT skipped:** it has no documented public API (only an internal endpoint used by its own website).
- **CoinGecko keyless public API** (`api.coingecko.com/api/v3`, no key header). Its keyless limit is low and shared per IP, so calls are spaced ~7 s apart with retries. If it fails, prices fall back to DefiLlama's coin price API and the page says which fields are missing.
- **DEX liquidity:** DexScreener `/token-pairs/v1/{chainId}/{address}` first, using a small table that maps CoinGecko platform ids to DexScreener chain ids. GeckoTerminal is the fallback; its `/networks` list maps CoinGecko platform ids to its own network ids, so that mapping isn't guessed. (The first plan was GeckoTerminal first; the live runs showed it rate-limits too quickly.)
- **Governance:** Snapshot's public GraphQL hub. Space ids come from DefiLlama's `governanceID` field or CoinGecko's `links.snapshot_url` (never guessed); `watchlist.json` can add more.
- **News:** RSS feeds from CoinDesk, The Block, Decrypt, Cointelegraph, Blockworks, DL News and The Defiant; protocol governance forums via Discourse's standard `/latest.rss`, and Medium blogs via `/feed`. Feeds that fail are listed on the Sources page with the error. Only headline, date, a short snippet and the link are stored.
- **User-Agent:** requests identify as `defi-research-dashboard/1.0 (+repo URL)`, with no personal details.

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
- **Bridges are excluded from category totals and movers.** DefiLlama's protocol list includes Bridge and Canonical Bridge entries (about $74B) whose assets are already counted on the chains they bridge to; DefiLlama's headline TVL leaves them out too. They stay in the Screener, where you can filter by category.
- **The "launch / upgrade" label** is a keyword rule on headlines (launch, upgrade, mainnet, migration, deploy, goes live, release…). Version numbers like "V3" no longer count, because "Risk Stewards: cap changes on Aave V3" isn't a launch.
- **Fee "vs prior 30 days" changes:** DefiLlama's per-protocol summary often omits them, so they are calculated from the same daily series and the tile says "(calc.)".
- **DefiLlama stablecoin page links** use the slugified coin name (`/stablecoin/sky-dollar`); the gecko id (`/stablecoin/usds`) 404s. Verified with the link checker.
- **Some DefiLlama yield-pool pages 404** even though the pool is in the live API (7 of about 90 checked in run 12, almost all collateral-only pools paying 0%). The API endpoint is cited too, so the number can still be checked, and the link checker's broken list makes the site mark those links "didn't open" where they appear.
- **"Top yield pools" means pools that pay yield.** Pools are listed largest first, but those paying 0% (usually collateral-only, like Compound V3's WBTC) go after every pool that pays something. They used to fill most of Compound's table. The table title says how many 0% pools there are.
- **Link checker:** many sites (DefiLlama, CoinGecko, DexScreener, Etherscan, The Defiant…) sometimes answer automated requests with a bot-check page (HTTP 403 "Just a moment…"). Those links are listed as "check by hand", not "broken", and so are rate limits (429), servers that are overloaded or down at that moment (502/503/504), and connection failures. API requests that failed during the data fetch (the paid-only 402s, or "no data of this type" 400s) are listed as "failed in fetch": they are the reason a section says "unavailable", not broken links. The checker records the page title for links that open, so you can confirm they land on the right protocol. It now checks every link (about 800; it was capped at 600) at one request per second per site, which takes about 3–4 minutes. Two exceptions: DefiLlama's per-pool history endpoint (`yields.llama.fi/chart/…`) rate-limits after a few calls, so only 6 of those are opened and the rest are labelled "not checked one by one"; and an API request that was rate-limited during the data fetch counts as "check by hand", not broken (run 13 listed three GeckoTerminal 429s as broken before this fix).

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
- **Text contrast** was measured, not eyeballed: muted text is 5.3:1 on cards (4.8:1 on the page) in light mode and 5.8:1 in dark mode, and ink on every highlighter color is above 9:1.

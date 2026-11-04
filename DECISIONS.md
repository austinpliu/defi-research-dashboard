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
- **Hacks, raises (global list) and token unlocks are Pro-only on DefiLlama.** The script asks the free host once per run and reports the refusal honestly. Funding raises still appear on protocol pages because the free `/protocol/{slug}` response includes each protocol's own `raises`. DefiLlama's timeline notes ("hallmarks") are shown as an incident/milestone timeline.
- **Unlocks:** no free, keyless, documented source exists (Tokenomist, CryptoRank, Messari and DefiLlama's unlock data all need keys). I did not probe undocumented endpoints. The site shows "unavailable" with this reason, and token pages show the supply breakdown (circulating vs. max), which is the closest live, sourced proxy.
- **Perpetuals volume** (e.g. Hyperliquid) is Pro-only on DefiLlama (`/overview/derivatives`, `/summary/derivatives`), so it isn't shown. Hyperliquid's fees and revenue are free and are shown.
- **L2BEAT skipped:** it has no documented public API (only an internal endpoint used by its own website).
- **CoinGecko keyless public API** (`api.coingecko.com/api/v3`, no key header). Its keyless limit is low and shared per IP, so calls are spaced ~7 s apart with retries. If it fails, prices fall back to DefiLlama's coin price API and the page says which fields are missing.
- **DEX liquidity:** GeckoTerminal first (its `/networks` list maps CoinGecko platform ids to its own network ids, so no guessed mapping), DexScreener `/token-pairs/v1/{chainId}/{address}` as fallback.
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
- CoinGecko ids: syrup (Maple's SYRUP), aave, ondo-finance, centrifuge, sky, hyperliquid, pendle. If an id is wrong the script runs CoinGecko's search and shows suggestions on the Sources page.
- Added three **peers** (Morpho, Ethena, Compound) so the Compare view has comparison points out of the box. They are in a separate `peers` list, aren't part of the watchlist strip or Catalysts, and can be deleted.
- Docs links in `watchlist.json` are hand-entered (no API offers them), and the link checker verifies them.

## Architecture

- **Static site + scheduled GitHub Action, no build step.** Plain HTML/CSS/JavaScript modules, so there is nothing to compile and any static host works.
- **Two workflows:** `update-data.yml` (every 6 hours at :23 past, the manual "Run workflow" button, and any push that changes `watchlist.json` or the scripts) and `publish-site.yml` (publishes `site/` to GitHub Pages from `main`).
- **Every push that edits `watchlist.json` refreshes the data**, on any branch, so a new protocol shows up without waiting for the schedule.

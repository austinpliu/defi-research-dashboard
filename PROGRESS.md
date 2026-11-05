# Progress

_Updated as work happens. Last update: 5 Nov 2026 (session: category double counting fix, then the notes workspace)._

## Done
- **Data pipeline** (`scripts/fetch-data.mjs` + `scripts/lib/`): DefiLlama, CoinGecko, DexScreener/GeckoTerminal, Snapshot and RSS feeds → `site/data/*.json`, with a source record and fetch time for every dataset. Polite pacing, retries, a rate-limit circuit breaker, a 22-minute time budget, and a 48-hour stale fallback. A run takes about 6 minutes and makes about 130 requests. In run 14, 122 of 128 succeeded. The 6 failures were all expected: two paid-only endpoints (402), "no holders-revenue data" for Ethena (400), and three GeckoTerminal rate limits on minor fallback chains (Berachain, Katana, NEAR), which the token pages mark with ✗ in their list of chains searched.
- **Link checker** (`scripts/check-links.mjs`): opens every source link, records page titles, and tells bot protection, rate limits, busy servers and "failed in the data fetch" apart from broken links. It writes `broken-links.json`, and the site marks those links "didn't open" wherever they appear. Run 14: 807 links. 470 opened, with page titles that match (e.g. "Arbitrum - DeFi TVL, Fees, & Revenue - DefiLlama"). 334 need a manual check, mostly DexScreener pair pages behind bot protection plus sampled DefiLlama pool histories. 2 are the paid-only endpoints. 1 is broken: DefiLlama's own page for one 0% Sky pool.
- **GitHub Actions:** `update-data.yml` (every 6 hours once on `main`, the Run workflow button, and any push that changes the watchlist or scripts), `publish-site.yml` (GitHub Pages), and `site-check.yml` (opens every page in a browser). Fourteen live data runs on this branch; the data in `site/data/` is real.
- **Site** (static, no build step): Overview with "What the data says today", Protocols (list plus one page per protocol), Tokens (list plus one page per token), Compare, Catalysts, Screener, Glossary and Sources. Data-driven takeaway headlines, PNG/Table/CSV on every chart, CSV on every table, sort/filter/search, glossary tooltips on stats, table headers and chart titles, light/dark mode, phone layout with no sideways scrolling.
- **Governance:** Snapshot works for Aave (`aavedao.eth`), Morpho and Compound. Queries stay within the hub's limit of 5 top-level selections.
- **More governance sources (follow-up item 3):** added Ondo's governance forum (Flux Finance, `forum.fluxfinance.com`). Run 17 confirmed it: 30 posts, with recent Ondo DAO proposals now in Catalysts. Maple's documented Snapshot space (`maple.eth`) was tried but couldn't be confirmed, because Snapshot's hub returned nothing for it, so it was removed. Maple's MIPs still arrive through its forum. Centrifuge, Sky, Hyperliquid and Pendle have no Snapshot space or public forum feed beyond what was already included (reasons in DECISIONS.md).
- **Tests:** 76 unit and pipeline tests (`node --test 'tests/*.test.mjs'`), plus a browser smoke test (`tests/browser/smoke.mjs`) that opens all pages at desktop and phone width. Both run on GitHub Actions. All 10 protocol pages and 10 token pages were also opened in a browser with no JavaScript errors.
- **Docs:** README (how it works, how to run, how to deploy, how to add a protocol), `DECISIONS.md`.
- **Deployed:** pull request #1 was merged into `main`, and the 6-hour data updates now run there.
- **More coins (follow-up item 1):** the Tokens page lists about 400 coins (CoinGecko's 250 largest plus the 250 largest DeFi coins) with price, 24h/7d/30d change, market cap, FDV and volume, tagged DeFi / other. Two keyless requests per run.
- **Prediction markets (follow-up item 1):** the Catalysts page shows the 25 busiest crypto markets on Polymarket (odds, 24h and all-time volume, liquidity, end date), labelled "market prices, not forecasts", plus prediction-market protocols by TVL and fees from DefiLlama. Verified in run 16: 445 coins (250 tagged DeFi), 25 Polymarket events in 24h-volume order, 12 prediction-market protocols.

- **Category double counting (REVIEW item 7) fixed:** category TVL now leaves out liquid staking and double-counted TVL, like the headline. Shares are of the headline when the two reconcile, and the chart note shows the reconciliation. Verified in run 26: DefiLlama's free list has no per-protocol double-count data, so the category rules apply. They take the category total from $198.9B to $108.5B, still 128% of the $84.9B headline. Shares are therefore of the categories' own total, and the chart note explains why (REVIEW.md item 7).

- **Notes workspace (Nov 2026):** Obsidian-style notes stored in the browser (IndexedDB), never in this repo or the published site.
  - **Editor:** markdown with live preview, autosave, `[[` autocomplete, shortcuts and undo.
  - **Organising:** folders with drag and drop, and a restorable trash. Links and backlinks, with renames rewriting links everywhere. Full-text search with tag and folder filters. Pinned and recent notes, and templates.
  - **Graph view:** drag, zoom, pan, hover neighbours, click to open, folder and tag filters, and drawing links. Simplified on phones.
  - **On every page:** a side panel (Alt+M), quick capture (Alt+N), chart references and page links. "Your notes" on protocol and token pages.
  - **Backup and sync:** zip export and import (an Obsidian vault), and optional sync to your own private GitHub repo with a fine-grained token. Sync handles conflicts safely, keeping both versions.
  - **Tests:** 76 unit tests, covering link parsing, renames, backlinks, sync conflicts against a fake GitHub, zip, and privacy guards. The browser smoke test covers the notes page, the graph and the side panel on desktop and phone.

- **Fundamentals Checklist (Nov 2026, in progress on `claude/fundamentals-checklist`):**
  - **Stage 1 done:** the pipeline writes `site/data/fundamentals.json` with each protocol's inputs and sources, plus 5 years of weekly prices from DefiLlama's coins API.
  - **Stage 2 done:** the rules engine (`site/assets/js/fundamentals/rules.js`), the thresholds config, and the empty hand-edited `value-accrual.json` and `team-notes.json`. 31 unit tests cover every rule, empty data, zero revenue, ties and threshold validation (107 tests in all).
  - **Stage 3 done:** the Fundamentals section (`#/fundamentals`), labelled as a research aid throughout.
    - **Overview:** a sortable, filterable table with the checks as columns, a takeaway headline, and a "How this works" panel that renders every rule and threshold from the config.
    - **Detail page:** one per protocol (`#/fundamentals/<slug>`), with seven check cards (status, sentence, numbers, source links) and four charts, each with PNG, Table and CSV.
    - **Elsewhere:** a compact card on protocol and token pages, the "New note from this checklist" button, and six new glossary entries.
  - **Stage 4 done:** the settings panel (`#/fundamentals/settings`).
    - **Threshold forms:** label, value, default, explanation, per-field reset and reset all. Invalid values are rejected with a message, and changed values are marked.
    - **Live preview:** shows which statuses your values change.
    - **Editors:** value-accrual entries and team notes (add, edit, delete), with http(s) sources required.
    - **Saving and sync:** export, import and reset. Settings save in the browser and sync through the notes repo, with merge-by-content conflict handling.
    - **Tests:** 13 new (120 in all).
  - **Next:** smoke tests, link checks and docs (stage 5).

## Not done / known gaps
- **Notes, not yet:**
  - No attachments: images in notes show as links and aren't stored.
  - No live collaboration: sync is per device, every few minutes.
  - The graph draws every note directly, so it slows down beyond about 1,000 notes.
  - Sync couldn't be run against real GitHub from this sandbox. It's tested against a fake API that enforces GitHub's version checks; try it once with your own repo.
- **Deploy:** GitHub Pages needs the repository owner to merge this branch into `main` and switch Settings → Pages → Source to "GitHub Actions" (see README › How to deploy). The publish workflow is ready but can't be switched on from here. The 6-hour schedule also starts only once the workflow is on `main`.
- **Token unlocks (Nov 2026 deep dive):** live through a hand-checked `unlocks.json` built from each project's own docs (route 3). DefiLlama's open-source emissions adapters (route 1) are no longer public, and no project publishes vesting contracts to read on-chain (route 2), so those routes are closed for now (DECISIONS.md › Token unlocks).
  - Dated unlocks in Catalysts and on token pages: ENA monthly tranches, MORPHO founders' linear vest, and ONDO's January releases (sizes not published). CFG shows vesting windows, and PENDLE has nothing left to unlock. HYPE, SYRUP, AAVE, SKY and COMP are "unconfirmed".
  - Still open: re-check the docs pages by hand every few months (the site reminds you after 90 days), and fill in amounts if a project publishes them (Ethena's investor share, Ondo's tranche sizes).
- **Funding rounds list:** DefiLlama's `/raises` is Pro-only. Protocol pages show the rounds in each protocol's free profile instead.
- **On-chain governance** (Sky, Compound and Aave executive votes): no keyless API. Snapshot plus governance-forum feeds only.
- **Perps volume** (Hyperliquid): Pro-only on DefiLlama.
- **Ondo Finance and Centrifuge TVL:** DefiLlama has no TVL history for them or any of their sub-protocols, so those charts say "unavailable" with that reason. Their fees, token, yields and news still work.
- **Some DefiLlama yield-pool pages 404** (1 in run 14, down from 7 once 0% collateral pools moved to the end of the tables). It's marked on the site, and the API link beside it works.

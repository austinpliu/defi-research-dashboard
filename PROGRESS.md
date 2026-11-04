# Progress

_Updated as work happens._

## Done
- **Data pipeline** (`scripts/fetch-data.mjs` + `scripts/lib/`): DefiLlama, CoinGecko, DexScreener/GeckoTerminal, Snapshot and RSS feeds → `site/data/*.json`, with a source record and fetch time for every dataset. Polite pacing, retries, a rate-limit circuit breaker, a 22-minute time budget, and a 48-hour stale fallback. A run takes about 5–7 minutes.
- **Link checker** (`scripts/check-links.mjs`): opens every source link, records page titles, and tells bot-protection pages apart from broken links.
- **GitHub Actions:** `update-data.yml` (every 6 hours once on `main`, the Run workflow button, and any push that changes the watchlist or scripts), `publish-site.yml` (GitHub Pages), and `site-check.yml` (opens every page in a browser). Several live data runs completed on this branch; the data in `site/data/` is real.
- **Site** (static, no build step): Overview with "What the data says today", Protocols (list plus one page per protocol), Tokens (list plus one page per token), Compare, Catalysts, Screener, Glossary and Sources. Data-driven takeaway headlines, PNG/Table/CSV on every chart, CSV on every table, sort/filter/search, glossary tooltips on stats, table headers and chart titles, light/dark mode, phone layout with no sideways scrolling.
- **Tests:** 38 unit and pipeline tests (`node --test 'tests/*.test.mjs'`), plus a browser smoke test (`tests/browser/smoke.mjs`) that opens all pages at desktop and phone width. Both run on GitHub Actions.
- **Docs:** README rewritten for the expanded scope (how it works, how to run, how to deploy, how to add a protocol), `DECISIONS.md`.

## Not done / known gaps
- **Deploy:** GitHub Pages needs the repository owner to merge this branch into `main` and switch Settings → Pages → Source to "GitHub Actions" (see README › How to deploy). The publish workflow is ready but can't be switched on from here. The 6-hour schedule also starts only once the workflow is on `main`.
- **Token unlocks:** no free, keyless source (DefiLlama's is Pro-only). Shown as "unavailable".
- **On-chain governance** (Aave, Sky, Compound executive votes): no keyless API. Snapshot plus governance-forum feeds only.
- **Perps volume** (Hyperliquid): Pro-only on DefiLlama.
- **Ondo Finance and Centrifuge TVL:** DefiLlama returns no combined TVL for these parents. The pipeline now sums their chains or sub-protocols; check their protocol pages after the latest run to see whether DefiLlama has any TVL for them at all.

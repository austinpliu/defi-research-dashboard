# Progress

_Updated as work happens. Last update: 4 Nov 2026, after data run 12._

## Done
- **Data pipeline** (`scripts/fetch-data.mjs` + `scripts/lib/`): DefiLlama, CoinGecko, DexScreener/GeckoTerminal, Snapshot and RSS feeds → `site/data/*.json`, with a source record and fetch time for every dataset. Polite pacing, retries, a rate-limit circuit breaker, a 22-minute time budget, and a 48-hour stale fallback. A run takes about 6–7 minutes and makes about 130 requests. In run 12, 124 succeeded. The 4 failures were all expected: two paid-only endpoints (402), "no holders-revenue data" for Ethena (400), and one GeckoTerminal rate limit on a fallback chain.
- **Link checker** (`scripts/check-links.mjs`): opens every source link (about 800), records page titles, and tells bot protection, rate limits, busy servers and "failed in the data fetch" apart from broken links. It writes `broken-links.json`, and the site marks those links "didn't open" wherever they appear.
- **GitHub Actions:** `update-data.yml` (every 6 hours once on `main`, the Run workflow button, and any push that changes the watchlist or scripts), `publish-site.yml` (GitHub Pages), and `site-check.yml` (opens every page in a browser). Twelve live data runs on this branch; the data in `site/data/` is real.
- **Site** (static, no build step): Overview with "What the data says today", Protocols (list plus one page per protocol), Tokens (list plus one page per token), Compare, Catalysts, Screener, Glossary and Sources. Data-driven takeaway headlines, PNG/Table/CSV on every chart, CSV on every table, sort/filter/search, glossary tooltips on stats, table headers and chart titles, light/dark mode, phone layout with no sideways scrolling.
- **Governance:** Snapshot works for Aave (`aavedao.eth`), Morpho and Compound (30 proposals in run 12). Queries stay within the hub's limit of 5 top-level selections.
- **Tests:** 41 unit and pipeline tests (`node --test 'tests/*.test.mjs'`), plus a browser smoke test (`tests/browser/smoke.mjs`) that opens all pages at desktop and phone width. Both run on GitHub Actions. All 10 protocol pages and 10 token pages were also opened in a browser with no JavaScript errors.
- **Docs:** README (how it works, how to run, how to deploy, how to add a protocol), `DECISIONS.md`.

## Not done / known gaps
- **Deploy:** GitHub Pages needs the repository owner to merge this branch into `main` and switch Settings → Pages → Source to "GitHub Actions" (see README › How to deploy). The publish workflow is ready but can't be switched on from here. The 6-hour schedule also starts only once the workflow is on `main`.
- **Token unlocks:** no free, keyless source (DefiLlama's is Pro-only). Shown as "unavailable".
- **Funding rounds list:** DefiLlama's `/raises` is Pro-only. Protocol pages show the rounds in each protocol's free profile instead.
- **On-chain governance** (Sky, Compound and Aave executive votes): no keyless API. Snapshot plus governance-forum feeds only.
- **Perps volume** (Hyperliquid): Pro-only on DefiLlama.
- **Ondo Finance and Centrifuge TVL:** DefiLlama has no TVL history for them or any of their sub-protocols, so those charts say "unavailable" with that reason. Their fees, token, yields and news still work.
- **Hyperliquid's category** shows "Bridge" until the next data run, which applies the fees-weighted rule (it should become "Derivatives").
- **Some DefiLlama yield-pool pages 404** (7 in run 12, mostly 0% collateral pools). They're marked on the site, and the API link beside each one works.

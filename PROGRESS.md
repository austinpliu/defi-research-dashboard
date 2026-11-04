# Progress

_Updated as work happens._

## Done
- **Data pipeline** (`scripts/fetch-data.mjs` + `scripts/lib/`): DefiLlama, CoinGecko, DexScreener/GeckoTerminal, Snapshot and RSS feeds → `site/data/*.json`, with a source record and fetch time for every dataset. Polite pacing, retries, a rate-limit circuit breaker, a 22-minute time budget, and 48-hour stale fallback. Runs in about 5–6 minutes.
- **Link checker** (`scripts/check-links.mjs`): every source link, with page titles and bot-protection detection.
- **GitHub Actions:** `update-data.yml` (every 6 hours, Run workflow button, and on watchlist/script changes) and `publish-site.yml` (GitHub Pages). Five live runs completed on the branch; the data in `site/data/` is real.
- **Site** (static, no build step): Overview, Protocols (list + one page per protocol), Tokens (list + one page per token), Compare, Catalysts, Screener, Glossary and Sources pages. Data-driven takeaway headlines, PNG/Table/CSV on every chart, CSV on every table, sort/filter/search, glossary tooltips, light/dark mode, phone layout (no horizontal page scroll).
- **Tests:** 38 automated tests (`node --test 'tests/*.test.mjs'`): pipeline helpers, an offline end-to-end pipeline run against synthetic stubs, takeaway rules, formatting, series math, CSV. The Action runs them before every fetch.
- **Docs:** README rewritten for the expanded scope (how it works, how to run, how to deploy, how to add a protocol); `DECISIONS.md`.

## In progress
- Final verification pass over every page and source link with the latest data.

## Not done / known gaps
- **Deploy:** GitHub Pages needs two clicks by the repository owner (merge to `main`, then Settings → Pages → Source: GitHub Actions). The publish workflow is ready but can't be switched on from here.
- **Token unlocks:** no free keyless source (DefiLlama's is Pro-only). Shown as "unavailable".
- **On-chain governance** (Aave, Sky, Compound executive votes): no keyless API; Snapshot + forum feeds only.
- **Perps volume** (Hyperliquid): Pro-only on DefiLlama.

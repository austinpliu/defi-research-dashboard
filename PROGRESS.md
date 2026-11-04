# Progress

_Updated as work happens. Newest first within each list._

## Done
- Data pipeline (`scripts/fetch-data.mjs` + `scripts/lib/`): DefiLlama, CoinGecko, GeckoTerminal/DexScreener, Snapshot, RSS. Writes `site/data/*.json` with a source record and fetch time for every dataset.
- Link checker (`scripts/check-links.mjs`).
- GitHub Actions: `update-data.yml` (every 6 hours, manual button, push on watchlist change) and `publish-site.yml` (GitHub Pages).
- Tests: 18 unit tests plus an offline end-to-end pipeline test against synthetic stubs (`node --test 'tests/*.test.mjs'`).

## In progress
- First live data run on GitHub Actions.

## Next
1. Static site shell and home page
2. Protocol pages
3. Token pages
4. Comparison view
5. Catalysts
6. Tables, glossary, tooltips, export
7. Design polish, dark mode, phone layout
8. Browser tests, link check, docs, deploy

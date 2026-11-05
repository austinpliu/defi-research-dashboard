# Code review: DeFi research dashboard

_Reviewed 5 Nov 2026 against commit `1f201b4` (main). I read the pipeline, the site logic, `unlocks.json` and the workflows, and re-checked figures against the committed data in `site/data/`. I couldn't reach the live APIs or the projects' docs from this sandbox, so anything that depends on them says "verify"._

**Status key.** **Fixed** means it's a clear bug, the fix is in this branch, and a test covers it where that's practical. **Open** means it's a judgement call or needs a source checked, so it's left for you, with a suggested fix.

**Tests after the fixes:** `node --test 'tests/*.test.mjs'`: 50 of 50 pass (42 before, plus 8 regression tests for the fixes). The browser smoke test (`tests/browser/smoke.mjs`) passes on desktop and phone. I also opened the ENA, MORPHO, CFG and AAVE token pages to check the new wording, with no page errors.

**When the fixes show up:** site-side fixes (headlines, CSV, unlock display) apply as soon as this is merged. Pipeline fixes (fee changes, stale DEX marker, catalyst titles) apply on the next data run. Until then the committed data still shows, for example, Ondo's +19.6% and "0.63% of supply" in Catalysts.

---

## High

### 1. Calculated fee changes compared windows with missing days (Fixed)
`scripts/lib/defillama.mjs:588-589`, `scripts/lib/util.mjs:99`

When DefiLlama omits the "vs prior 30 days" change, the pipeline calculates it from the daily series. `sumLastDays` accepted a window with only 80% of its days, so a 26-day sum was compared with a 30-day sum.

- **Seen in the data:** Ondo's fee series is missing 23–26 Sep 2026, which falls in the earlier window. Its protocol page tile shows **+19.6% vs prior 30d (calc.)**. If the missing days were typical days, the like-for-like change is about **+4%**.
- **Fix:** the calculated 7-day and 30-day changes now need every day in both windows. Otherwise they show "—", which fits "no invented numbers". Only Ondo's figure changes in the current data; every other protocol's figure is identical.
- **Possible follow-up (your call):** compare daily averages instead of sums. That keeps a number when a day is missing, but it assumes the gap is missing data, not zero-fee days.

### 2. DefiLlama's last day of fees is often incomplete, and it flows into 24h, 30-day and ratio figures (Open)
`scripts/lib/defillama.mjs:582-596` (`summarizeFees`)

The newest point in some daily fee series is a partly reported day:

| Protocol | Last day reported | A normal day |
|---|---|---|
| Ethena | $14.07 | about $600K |
| Sky | $6,271 | about $900K |
| Maple | $0 (DefiLlama's `total24h` is also 0) | about $350K |

That day counts in DefiLlama's own `total24h` / `total7d` / `total30d`, which the site shows as-is. So for Ethena and Sky, "Fees, 30 days" is about 3% too low, mcap ÷ fees is about 3% too high, and the 30-day change is pulled down by the same amount. Sky's (calculated, not displayed) 7-day change of −16% is mostly this artifact; with a normal last day it's roughly −2% to −4%.

- **Suggested fix:** treat a final day below, say, 20% of the trailing 7-day median as incomplete. Drop it from window sums and changes, and note "latest day incomplete". This is a heuristic, so it's your call.

### 3. DEX liquidity headline said "across the 15 largest pools" for a total of every pool found (Fixed)
`site/assets/js/takeaways.js:199` (`liquidityTakeaway`)

`totalLiquidity` sums every pool the pipeline found, but the headline used the number of pools listed, which is capped at 15. It was live on 5 token pages (AAVE, COMP, ENA, MORPHO, PENDLE), e.g. "AAVE has $20.7M of DEX liquidity across the 15 largest pools", where the $20.7M actually covers **71** pools.

- **Fix:** now reads "…across the 71 pools found" (uses `poolCount`).

---

## Medium

### 4. Carried-forward DEX sources were marked `stale: true` instead of a stale record (Fixed)
`scripts/fetch-data.mjs:349-356`

When a token's DEX fetch failed and the previous pools were reused, its sources got `stale: true`. Every renderer reads `stale.lastGoodAt` and `stale.reason`, so the source line lost its fetch time and printed **"Latest attempt failed: undefined"**.

- **Fix:** it now stores `{ lastGoodAt, lastAttemptAt, reason }` and keeps the original fetch time across repeated failures. Sources that had already failed are left as they were.

### 5. CSV downloads could run formulas from feed text (Fixed)
`site/assets/js/export.js:15`

Headlines, Snapshot titles, Polymarket titles and coin names go straight into CSV cells. A title such as `=HYPERLINK("http://…","click")` would run as a formula in Excel or Google Sheets.

- **Fix:** text cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'`. Numbers, including negative ones and numeric strings like `-3.5`, are unchanged. Test added.

### 6. Stablecoin "by issuer" adds non-USD stablecoins in their own currency units (Open: verify, then fix)
`scripts/lib/defillama.mjs:297` (also `scripts/fetch-data.mjs:149`)

`sumPegs(a.circulating)` treats every peg's amount as dollars. For `peggedEUR`, `peggedJPY`, `peggedKRW`, `peggedIDR` and so on, DefiLlama's list endpoint gives the amount in the peg's own currency. (The chart endpoint has separate `totalCirculating` and `totalCirculatingUSD` fields for this reason.) A large yen or rupiah coin would be counted at face value: 100B IDR (about $6M) as $100B. It would then distort the shares ("USDT and USDC make up 84%"), the "Other" slice, the issuer ranking and which five coins get a history chart.

- **Today's effect is small:** the list total is $297.1B against $296.5B from the USD chart.
- **Suggested fix:** for `pegType !== 'peggedUSD'`, multiply by `a.price` (requested with `includePrices=true`), and leave out coins with no price. Confirm the unit first in one `PROBE=1` run.

### 7. "TVL by category" shares are of a total twice the size of DeFi TVL (Open)
`scripts/lib/defillama.mjs:237-253`, headline at `site/assets/js/takeaways.js:132`

Categories add up every protocol's own TVL, including liquid staking and double-counted deposits (e.g. curators' vaults that also count as lending). The top 14 categories sum to **$190.5B**, while the headline DeFi TVL is **$85.0B**. The headline "Liquid Staking is DeFi's largest category, with 27% of protocol TVL" is internally consistent. But a reader comparing it with the $85B figure next to it would get 64%.

- **Options:** state the denominator on the chart ("shares of $190B summed protocol TVL, which double-counts"), or leave out liquid staking and DefiLlama's double-counted flags so it matches the headline.

### 8. DefiLlama's 7/30-day totals can cover a day fewer than the chart shows (Open)
`scripts/lib/defillama.mjs:592-593`, used by `scripts/fetch-data.mjs:561-571`

For Hyperliquid and Maple, the daily chart ends on 3 Nov, but `total7d` and `total30d` already include an empty 4 Nov. Confirmed for Hyperliquid: the 7-day gap equals its 28 Oct value exactly, and the 30-day gap equals its 5 Oct value. Hyperliquid's "30-day fees" are **$82.67M**; the last 30 days in the chart sum to **$85.70M** (3.5% more). So annualized fees are 3.5% low, and mcap ÷ fees shows **20.05×** where the chart supports **19.34×**.

- **Suggested fix:** derive 7- and 30-day totals from the series over complete days (same rule as item 1), and keep DefiLlama's figure only as a fallback. This goes with item 2.

### 9. "Fastest-growing top-10 chain" compared only six chains (Fixed)
`site/assets/js/takeaways.js:63`

Only the six largest chains get a 30-day history (`scripts/fetch-data.mjs:144`), so chains 7–10 were never compared. Hyperliquid L1, Arbitrum, Robinhood Chain and Monad have no 30-day figure in the current data.

- **Fix:** the claim now names how many chains were compared ("the fastest-growing of the 6 largest chains"). It says "top-10" only when all ten have data. "More than half" now needs more than 50%, not 50% exactly.

### 10. "Record high" and "below its peak" on a one-year market-cap series (Fixed)
`site/assets/js/takeaways.js:35`, call site `site/assets/js/pages/token.js:86`

The token market-cap card passes CoinGecko's 365-day series to `trendTakeaway`. A token at its highest market cap of the year, but below an older peak, would be called a "record high". It isn't live today; every token is down over 30 days.

- **Fix:** a `span` option, so this card says "1-year high" / "below its 1-year peak". The other call sites pass full histories and are unchanged.

### 11. Compare headlines could claim "every protocol here lost" when that wasn't true (Fixed)
`site/assets/js/takeaways.js:225`, call sites `site/assets/js/pages/home.js:135`, `site/assets/js/pages/protocols.js:48`

There were three edge cases:

- If the best performer was exactly 0%, it still said "every protocol lost".
- The Protocols page dropped rows with no TVL (Ondo, Centrifuge) before calling the rule, so "every protocol here" skipped them.
- The chain-growth card would have said "every **protocol** here" about chains.

- **Fix:** returns no claim when the best is flat; says "All 8 protocols with data" when some rows lack data; takes a `noun` (`'chain'` on the home page).

### 12. Site data isn't marked stale if the scheduled job stops (Open)
`site/assets/js/ui.js:152` (`oneSource`), `site/assets/js/app.js:96`

STALE badges and the 48-hour cut-off are only applied by the pipeline when a fetch fails. If the workflow stops running altogether (disabled schedule, failing tests, an expired permission), every card keeps its last numbers with no STALE badge. Only the header pill changes colour after 24 hours, though each source line does show its fetch time.

- **Suggested fix:** in `oneSource`, add an "Old" badge when `fetchedAt` is more than about 12 hours old. Optionally, show a banner when `meta.generatedAt` is over 48 hours old.

### 13. ENA unlock dates and investor share: please check against Ethena's docs (Open: verify)
`unlocks.json:14`, `:27-28`, `:34-40`

The arithmetic is consistent: 30% × 75% ÷ 36 = 0.625% a month, × 15B max supply = 93.75M ENA. Two inputs look doubtful, and I couldn't open the docs page to confirm either:

- **Launch date.** The entry anchors the cliff to a 5 March 2024 launch. My understanding is that ENA launched on **2 April 2024**, and trackers show the monthly releases on the 2nd. If so, the cliff was April 2025 and the 36 monthly tranches run **May 2025 to April 2028**, not April 2025 to March 2028. Near-term months show the same amounts; the end month moves.
- **Investor share.** The entry says it "wasn't confirmed". The widely quoted combined figure of about 171.88M ENA a month equals (30% + 25%) × 15B × 75% ÷ 36, which points to investors at **25%**. If the page says 25%, set `sharePerPeriod` to `0.0052083` (78.125M ENA a month).

---

## Low

### 14. Unlock shares were rounded away from the documented figure (Fixed)
`scripts/fetch-data.mjs:513`, `site/assets/js/unlocks.js:17`

Ethena's documented 0.625% a month was shown as "0.63%" in Catalyst titles and on the token page.

- **Fix:** 3 significant digits ("0.625%", "15.2%", "12%").

### 15. Month-only dates in unlock text rendered as "—" (Fixed)
`site/assets/js/unlocks.js:19` (`docDate`), used at `:26` and `:60`

The validator allows a linear schedule's `start`/`end` as `YYYY-MM`. Two places parsed it as a full date and would print "vests until —" or "from —". Not live today: Centrifuge's month-only schedules have no start, so they never reach that text.

- **Fix:** one helper handles both forms. Checked on the CFG page ("linear until Apr 2029").

### 16. One bad character code in a description could crash the whole run (Fixed)
`scripts/lib/util.mjs:149`

`String.fromCodePoint` throws on numeric entities above U+10FFFF (e.g. `&#99999999;`). Feeds were protected by a try/catch, but DefiLlama and CoinGecko descriptions are not, so the whole pipeline would exit and no data would be saved.

- **Fix:** invalid code points become `�`. Test added. I deliberately didn't change the order of entity decoding: it decodes `&amp;` before the others, which double-decodes. That's harmless because the site only inserts text, and it rescues feeds that double-escape their titles.

### 17. Funding total implied a complete sum (Fixed)
`site/assets/js/pages/protocol.js:341`

"Ethena has 6 recorded funding rounds, totalling $X" left out the rounds with no published amount.

- **Fix:** adds "(N with no amount published)" when some are missing.

### 18. Empty parentheses in the next-vote headline (Fixed)
`site/assets/js/takeaways.js:238`

A vote with no token symbol read "Next vote to close: Title ()". The parentheses are now dropped when there's no symbol.

### 19. Smaller headline wording issues (Open)
`site/assets/js/takeaways.js`

- `moversTakeaway` (`:110`) says "jumped 0% this week" or "fell 0%" when every eligible move is under 0.5%. Suggest a minimum move, e.g. 1%.
- `leaderTakeaway` (`:83`) says "led all protocols" on an exact tie, and "earned 2.50x more fees" is ambiguous (2.5× as much, or 250% more?). Suggest "2.5× the fees of the next protocol".
- `valuationTakeaway` (`:166`) says "of the N protocols tracked here", but N counts only those with a ratio (8 of 10 if two lack fees or a token).
- `catalystTakeaway` (`:238`) says "about your watchlist", but the count includes peers.

### 20. Snapshot "Result:" ignores quorum (Open)
`scripts/fetch-data.mjs:612`, `scripts/lib/governance.mjs:103`

A closed proposal shows "Result: 'For' (95%)" even if it failed quorum, which on Snapshot means it didn't pass. `quorum` and `scoresTotal` are already fetched.

- **Suggested fix:** say "Most votes: …" for closed proposals, and add "quorum not reached" when `quorum > 0 && scoresTotal < quorum`.

### 21. Ratios are calculated before stale sections are restored (Open)
`scripts/fetch-data.mjs:556-578` vs `:587-597`

- If DefiLlama fees fail and the previous fees are carried forward, mcap ÷ fees shows "—" even though fees are displayed (as stale).
- If CoinGecko fails, a market cap up to 48 hours old is divided by fresh fees, and the "Calculated" source isn't marked stale.

- **Suggested fix:** move the carry-forward block above step 8, and mark a derived record stale when any input is.

### 22. Unlock amounts say "not published" when the supply fetch failed (Open)
`scripts/lib/unlocks.mjs:115-119`, `scripts/fetch-data.mjs:513`

With no CoinGecko supply (after the 48-hour stale window), a documented share produces "amount not published". The docs do publish it; what's missing is the supply.

- **Suggested fix:** in that case, show the share alone ("0.625% of supply; supply unavailable this run").

### 23. Number formatting at unit boundaries (Open)
`site/assets/js/format.js:6` (`usd`), `:30` (`compact`)

$999,950 prints as "$1,000K" and $999.6B as "$1,000B". The values are right, but the units should step up ("$1.0M", "$1.00T").

### 24. Charting helpers (Open)
`site/assets/js/series.js:18`, `:35`

- `weeklySum` drops a short last week but keeps a short first week, so the first bar of the 1Y/2Y weekly charts can look like a dip.
- `rollingSum` counts 30 data points, not 30 calendar days, so it stretches across gaps (Hyperliquid and Ondo have a few).

### 25. Parent fee changes when a child is new (Open)
`scripts/lib/defillama.mjs:81-108` (`groupOverview`)

A child with this week's fees but no prior-week field adds to the numerator only, which inflates the parent's week-over-week change. Suggest summing the prior window only over children that report both windows.

### 26. Housekeeping (Open)
- `scripts/lib/defillama.mjs:599`: `changesCalculated` only reflects the 30-day change. The 7-day one can be calculated without the "(calc.)" label; it isn't displayed today.
- `unlocks.json:196`: SYRUP's summary says the inflation schedule "ends … around September 2026". That date has passed, so it should be past tense.
- `PROGRESS.md:12` says 41 tests. There were 42; there are now 50.

---

## Checked and correct

- **Market cap ÷ annualized fees:** Aave 2.017B ÷ (39.63M × 365 ÷ 30) = 4.18×, matching the file. Hyperliquid 20.05× also matches its inputs; the inputs' window is item 8. FDV ÷ fees, mcap ÷ TVL and revenue share use the same helpers.
- **Units:** DefiLlama raise amounts are millions and the site multiplies by 1e6 (table, CSV, headline). Hack amounts are dollars and are shown as dollars.
- **TVL changes:** 7/30/90-day and 1-year changes are point-to-point. Recomputed from the stored series, they match for all 8 protocols with TVL. Summing per-chain TVL skips `borrowed`, `staking`, `pool2` and the `Chain-borrowed` style keys. The fallback to summing sub-protocols is labelled on the page.
- **7/30-day fee sums:** they match DefiLlama's `total7d` / `total30d` exactly wherever the chart is current (Aave, Compound, Morpho, Ondo, Pendle, Sky, Ethena, Centrifuge).
- **Chain shares:** they use the sum of all chains ($85.2B), which is within 0.3% of the headline TVL.
- **unlocks.json:**
  - ENA: 0.30 × 0.75 ÷ 36 = 0.00625; × 15B = 93.75M.
  - MORPHO: 0.152 × 1B = 152M; ÷ 23.98 months = 6.34M a month. The cliff and vest dates are consistent with the 21 Nov 2024 transferability date.
  - ONDO: the 36/48/60-month dates follow from 18 Jan 2024.
  - CFG: team 0.12 × 680M total supply = 81.6M; 100M from CP149.
  - SYRUP: the stated 1,267,875,000 matches CoinGecko's total supply.
  - Every entry has an http(s) source and a `lastChecked` date.
- **External text:** every string is inserted with `textContent`, never `innerHTML`. Every ECharts tooltip escapes names and titles. Links go through `safeUrl` (http/https only). The pipeline also drops non-http(s) feed links.
- **Workflows:**
  - Tests don't depend on today's date (relative dates, or 2099 in fixtures), so they won't start blocking the refresh as time passes.
  - The save step resets to the branch tip and retries, so concurrent runs don't conflict.
  - The 40-minute job timeout covers the 22-minute fetch budget plus link checks.
  - The remote `main` is at the same commit as this review, so the 6-hour schedule is live there.

## Not reviewed in depth

`scripts/check-links.mjs` (it's `continue-on-error`, so it can't break the refresh), CSS and layout, the glossary text, and the Screener and Sources page rendering beyond the smoke test.

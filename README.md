# DeFi Research Dashboard

A personal research tool for understanding a DeFi protocol or token quickly, pulling charts into articles, and checking every number by hand. It covers TVL, fees, revenue, stablecoins, DEX volume, token prices, DEX liquidity, yields, governance votes, hacks, funding rounds and news, all from free public sources that need **no API key and no login**.

Every number on the page links to the exact page or API endpoint it came from, with the time it was fetched. If a source fails, the page says "unavailable" and gives the reason, instead of showing a made-up value.

## Who it's for

Me: a writer and researcher, not an engineer. I can run commands and read code, but the app should be simple to start, simple to edit, and explained in plain language.

## What's in it

| Section | What it shows |
|---|---|
| **01 Overview** | Headline strip (total DeFi TVL, stablecoin supply, DEX volume, fees, each with 7-day and 30-day change), your watchlist at a glance, TVL history, TVL by chain, chain growth, top protocols by fees and revenue, stablecoin supply by issuer, biggest movers this week, daily DEX volume and fees, TVL by category, upcoming catalysts and latest headlines. |
| **02 Protocols** | A table of your watchlist, plus one page per protocol: a two-sentence description, TVL history (90 days / 1 year / all), TVL by chain and by asset, fees and revenue, token price, market cap, FDV, valuation ratios, supply, top yield pools, governance votes, hacks and timeline notes, funding rounds, news, links (website, docs, X, GitHub, audits) and a list of every source used on the page. |
| **03 Tokens** | One page per token: price, volume, market cap, FDV, all-time high, supply breakdown, DEX pools and liquidity, contract addresses, and the protocol it belongs to. |
| **04 Compare** | Pick 2–5 protocols. Overlay TVL, fees, revenue, token price or market cap (in dollars or "growth since the start = 100"), plus a side-by-side metrics table (TVL growth, fees, revenue, market cap ÷ fees and more). The address bar link saves the view. |
| **05 Catalysts** | Governance votes, scheduled events, launches and upgrades, governance forum posts, protocol blog posts and news about your watchlist, as a dated timeline and a filterable list (token, type, date range, search). Labelled as information, not prediction. |
| **06 Screener** | The ~600 largest DeFi protocols. Sort any column, filter by category and chain, search, export CSV. |
| **07 Glossary** | Every metric explained in one sentence. The same text appears when you hover or tap the (?) next to a number. |
| **08 Sources** | When the data was fetched, which requests failed and why, how to fix them, and an automatic check of every source link (with the page title, so you can tell it lands on the right page). |

On every chart:

- The headline is a claim generated from the live data by simple rules ("DeFi TVL fell 12% in 30 days", "Ethereum still holds more than half of all DeFi TVL"), with the key phrase highlighted. No headline is fixed text, so none can go stale.
- **PNG** downloads the chart with its headline and source line, ready for an article. It uses the theme you're viewing, so switch to light mode first if you want a light image.
- **Table** shows the numbers behind the chart; **CSV** downloads them.
- A source line names the source, links the page and the API endpoint, and shows when it was fetched.

Light and dark mode follow your system; the moon/sun button switches them. It works on a phone.

## How it works (plain English)

Many data sites refuse requests that come straight from a web browser, and a public website can't safely hold API keys. So the work is split in two:

1. **A robot fetches the data.** A GitHub Action (a free scheduled job that GitHub runs for you) runs `scripts/fetch-data.mjs` every 6 hours. You can also run it any time with the **Run workflow** button, and it runs by itself whenever you change `watchlist.json`. The script calls only free, keyless public APIs, spaces out its requests to stay inside their rate limits, and saves everything as JSON files in `site/data/`. For each dataset it records the exact endpoint, a page you can check by hand, and the fetch time.
2. **The website just reads those files.** `site/` is a plain static website (HTML, CSS and JavaScript, no build step). It has no server, no database and no keys, so GitHub Pages can host it for free.

If a source fails, its section on the site says "unavailable" with the reason. If the same data was fetched successfully within the last 48 hours, the site shows that earlier copy instead, clearly marked **STALE** with its original fetch time. After 48 hours it switches to "unavailable".

The script also opens every source link and records whether it works (`site/data/link-check.json`, shown on the Sources page).

### Data sources

| Source | Used for | Key needed? |
|---|---|---|
| [DefiLlama](https://api-docs.defillama.com/) | TVL (total, by chain, by protocol), fees, revenue, DEX volume, stablecoins, yield pools, hacks, funding rounds (from each protocol's profile), timeline notes | No (free endpoints only) |
| [CoinGecko](https://docs.coingecko.com/docs/keyless-public-api) | Token price, market cap, FDV, volume, supply, contract addresses | No (keyless public API) |
| [DexScreener](https://docs.dexscreener.com/api/reference) | DEX pairs and liquidity | No |
| [GeckoTerminal](https://apiguide.geckoterminal.com/) | DEX pools (when DexScreener doesn't cover a chain) | No |
| [Snapshot](https://docs.snapshot.box/tools/api) | Governance proposals and votes | No |
| RSS feeds | News (CoinDesk, The Block, Decrypt, Cointelegraph, Blockworks, DL News, The Defiant), protocol blogs (Medium) and governance forums (Discourse) | No |

What isn't available for free (shown as "unavailable" on the site): **token unlock schedules** and DefiLlama's global **raises list** are on DefiLlama's paid Pro API, and no other keyless source exists. **Perpetuals trading volume** is Pro-only too. L2BEAT has no documented public API, so it isn't used. See `DECISIONS.md` for the details.

## How to run it on your computer

You need [Node.js](https://nodejs.org) version 18 or newer (the "LTS" download is fine). Nothing else to install.

1. Download the code: on GitHub press **Code → Download ZIP** and unzip it, or run:

   ```bash
   git clone https://github.com/austinpliu/defi-research-dashboard.git
   ```

2. Open a terminal in the folder:

   ```bash
   cd defi-research-dashboard
   ```

3. Start the website:

   ```bash
   npx serve site
   ```

   Then open the address it prints (usually http://localhost:3000). If you have Python instead, `python3 -m http.server 8000 --directory site` works too (then open http://localhost:8000).

4. Optional: fetch fresh numbers yourself (takes about 5–10 minutes, because it waits politely between requests):

   ```bash
   node scripts/fetch-data.mjs
   ```

   Then reload the page. To also check the source links: `node scripts/check-links.mjs`.

The data files in `site/data/` are already in the repository (the robot updates them), so step 4 is only needed if you want numbers newer than the last scheduled run.

## How to deploy it (free, on GitHub Pages)

This needs a few one-time clicks on GitHub; after that it updates itself.

1. **Put the code on the `main` branch.** If you're reading this on a branch, open a pull request into `main` and merge it.
2. **Turn on Pages:** in the repository go to **Settings → Pages**. Under **Build and deployment → Source** choose **GitHub Actions**.
3. **Publish the first time:** go to the **Actions** tab, choose **Publish site** on the left, and press **Run workflow** (branch `main`). After a minute or two the site is live. (If you turned on Pages *before* merging, this happens automatically.)

From then on:

- Every 6 hours the **Update data** action fetches fresh numbers, saves them, and publishes the site.
- To update right now: **Actions** tab → **Update data** → **Run workflow**.
- Your site's address appears on the **Settings → Pages** screen (it looks like `https://austinpliu.github.io/defi-research-dashboard/`).

If a run fails, the **Actions** tab shows a red ✗; click it to see which step failed. The website keeps showing the last good data.

## How to add a protocol

Everything the dashboard tracks is in one file, **`watchlist.json`**. You can edit it on GitHub directly (open the file, click the pencil icon, edit, then **Commit changes**). Saving it starts a data update automatically, and the new protocol appears on the site within about 10 minutes.

1. Find the protocol on [DefiLlama](https://defillama.com). Its address looks like `https://defillama.com/protocol/morpho`. The last part (`morpho`) is its **DefiLlama slug**.
2. Optional: find its token on [CoinGecko](https://www.coingecko.com). The address looks like `https://www.coingecko.com/en/coins/morpho`. The last part is the **CoinGecko id**. If you leave it out, the script uses the id DefiLlama knows about.
3. Add an entry to the `"protocols"` list in `watchlist.json` (mind the commas between entries):

   ```json
   {
     "name": "Morpho",
     "defillama": "morpho",
     "coingecko": "morpho",
     "symbol": "MORPHO",
     "keywords": ["Morpho", "MORPHO"],
     "links": { "docs": "https://docs.morpho.org" },
     "feeds": [
       { "name": "Morpho forum", "url": "https://forum.morpho.org/latest.rss", "type": "governance-forum" }
     ],
     "snapshot": ["morpho.eth"]
   }
   ```

   Only `name` and `defillama` are required. What the optional fields do:

   - `coingecko`: the token's CoinGecko id (for price, market cap, supply, DEX pools).
   - `symbol`: the token ticker, shown in labels.
   - `keywords`: words that mark a news headline as being about this protocol. Words written in CAPITALS (tickers like `HYPE`) only match in capitals, so ordinary words like "hype" don't count.
   - `links.docs`: a docs link (no API provides one).
   - `feeds`: RSS feeds for the protocol's blog (`"type": "blog"`) or governance forum (`"type": "governance-forum"`). Most governance forums run on Discourse, whose feed is the forum address plus `/latest.rss`. Medium blogs use `https://medium.com/feed/<publication>`.
   - `snapshot`: Snapshot space ids for governance votes, if DefiLlama and CoinGecko don't already know them (the id is the part after `#/` in a snapshot.org address).

4. To remove a protocol, delete its entry. Its page disappears on the next update.

The `"peers"` list works the same way. Peers get full pages and appear in Compare, but not in your watchlist strip or Catalysts. The `"newsFeeds"` list holds the news sites' RSS feeds.

If something is wrong (a slug or id DefiLlama or CoinGecko doesn't recognise, a feed that doesn't load), the **Sources** page lists it under "Problems this run", usually with the fix. For example, it suggests the right CoinGecko id from CoinGecko's own search.

## Project layout

```
watchlist.json                 ← what to track (edit this)
scripts/fetch-data.mjs         ← fetches all data into site/data/
scripts/check-links.mjs        ← opens every source link and records the result
scripts/lib/                   ← one file per data source + helpers
site/index.html                ← the website
site/assets/js/pages/          ← one file per page
site/assets/js/takeaways.js    ← the rules that write chart headlines
site/data/                     ← the fetched data (written by the robot)
.github/workflows/             ← the scheduled data update and the Pages publish
tests/                         ← automated checks (run: node --test 'tests/*.test.mjs')
DECISIONS.md                   ← every judgement call made while building this
PROGRESS.md                    ← what's done and what's next
```

## Out of scope (for now)

User accounts, saved portfolios, alerts, paid data sources, and anything that needs a server.

## Ideas for later

Notes per protocol, adding a protocol by searching for it in the site (today it's one edit to `watchlist.json`), wallet or on-chain data, token unlock schedules if a free source appears, and on-chain governance (Aave, Sky and Compound vote on-chain as well as on Snapshot).

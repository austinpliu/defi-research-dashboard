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
| **03 Tokens** | One page per token: price, volume, market cap, FDV, all-time high, supply breakdown, DEX pools and liquidity, contract addresses, and the protocol it belongs to. The list page also has about 400 more coins (CoinGecko's 250 largest plus the 250 largest DeFi coins), sortable, searchable and filterable by DeFi / other. |
| **04 Compare** | Pick 2–5 protocols. Overlay TVL, fees, revenue, token price or market cap (in dollars or "growth since the start = 100"), plus a side-by-side metrics table (TVL growth, fees, revenue, market cap ÷ fees and more). The address bar link saves the view. |
| **05 Catalysts** | Governance votes, scheduled events, launches and upgrades, governance forum posts, protocol blog posts and news about your watchlist, as a dated timeline and a filterable list (token, type, date range, search). Labelled as information, not prediction. Below it, prediction markets: the busiest crypto markets on Polymarket with their current odds, and the prediction-market protocols on DefiLlama. |
| **06 Screener** | The ~600 largest DeFi protocols. Sort any column, filter by category and chain, search, export CSV. |
| **10 Fundamentals** | A fundamentals-first checklist for every watchlist protocol and token, labelled as a research aid, not a rating or a buy signal. It has seven checks: revenue reaching holders, revenue relative to size, the fee-switch option, supply overhang, liquidity and float, track record, and narrative vs fundamentals. Each check shows ✓ strong, ~ mixed, ✗ weak or "no data" (with the reason), plus the numbers, a one-sentence explanation and source links. The section has a sortable, filterable overview, a detail page per protocol with four charts, a compact card on protocol and token pages, and a Settings panel for your own thresholds. See [Fundamentals Checklist](#fundamentals-checklist) below. |
| **07 Glossary** | Every metric explained in one sentence. The same text appears when you hover or tap the (?) next to a number. |
| **09 Notes** | Your research notes, Obsidian-style: markdown with live preview, `[[links]]`, backlinks, #tags, folders, templates, search and a graph view. Open them from any page with the notes button, and add a chart or the current page to a note. Notes stay in your browser, with optional sync to your own private GitHub repository. See [Notes](#notes) below. |
| **08 Sources** | When the data was fetched, which requests failed and why, how to fix them, and an automatic check of every source link (with the page title, so you can tell it lands on the right page). |

On every chart:

- The headline is a claim generated from the live data by simple rules ("DeFi TVL fell 12% in 30 days", "Ethereum still holds more than half of all DeFi TVL"), with the key phrase highlighted. No headline is fixed text, so none can go stale.
- **PNG** downloads the chart with its headline and source line, ready for an article. It uses the theme you're viewing, so switch to light mode first if you want a light image.
- **Table** shows the numbers behind the chart; **CSV** downloads them.
- A source line names the source, links the page and the API endpoint, and shows when it was fetched.

Light and dark mode follow your system; the moon/sun button switches them. It works on a phone.

## How it works (plain English)

Many data sites refuse requests that come straight from a web browser, and a public website can't safely hold API keys. So the work is split in two:

1. **A robot fetches the data.** A GitHub Action (a free scheduled job that GitHub runs for you) runs `scripts/fetch-data.mjs` every 6 hours. You can also run it any time with the **Run workflow** button, and it runs by itself whenever you change `watchlist.json`. (GitHub only runs the schedule and shows the button once the code is on the `main` branch.) The script calls only free, keyless public APIs, spaces out its requests to stay inside their rate limits, and saves everything as JSON files in `site/data/`. For each dataset it records the exact endpoint, a page you can check by hand, and the fetch time.
2. **The website just reads those files.** `site/` is a plain static website (HTML, CSS and JavaScript, no build step). It has no server, no database and no keys, so GitHub Pages can host it for free.

If a source fails, its section on the site says "unavailable" with the reason. If the same data was fetched successfully within the last 48 hours, the site shows that earlier copy instead, clearly marked **STALE** with its original fetch time. After 48 hours it switches to "unavailable".

The script also opens every source link and records whether it works (`site/data/link-check.json`, shown on the Sources page). A link that didn't open is marked "didn't open" wherever it appears on the site.

### Data sources

| Source | Used for | Key needed? |
|---|---|---|
| [DefiLlama](https://api-docs.defillama.com/) | TVL (total, by chain, by protocol), fees, revenue, DEX volume, stablecoins, yield pools, hacks, funding rounds (from each protocol's profile), timeline notes | No (free endpoints only) |
| [CoinGecko](https://docs.coingecko.com/docs/keyless-public-api) | Token price, market cap, FDV, volume, supply, contract addresses, and the market-wide coin list | No (keyless public API) |
| [DexScreener](https://docs.dexscreener.com/api/reference) | DEX pairs and liquidity | No |
| [GeckoTerminal](https://apiguide.geckoterminal.com/) | DEX pools (when DexScreener doesn't cover a chain) | No |
| [Snapshot](https://docs.snapshot.box/) | Governance proposals and votes | No |
| [Polymarket](https://docs.polymarket.com/) | Crypto prediction markets: outcome prices (odds), volume, liquidity, end dates | No (public Gamma API) |
| RSS feeds | News (CoinDesk, The Block, Decrypt, Cointelegraph, Blockworks, DL News, The Defiant), protocol blogs (Medium) and governance forums (Discourse) | No |

What isn't available for free (shown as "unavailable" on the site): **token unlock schedules** and DefiLlama's global **raises list** are on DefiLlama's paid Pro API, and no other keyless source exists. **Perpetuals trading volume** is Pro-only too. L2BEAT has no documented public API, so it isn't used. See `DECISIONS.md` for the details.

## How to run it on your computer

You need [Node.js](https://nodejs.org) version 18 or newer (the "LTS" download is fine). Nothing else to install.

1. Download the code: on GitHub press **Code → Download ZIP** and unzip it, or run:

   ```bash
   git clone https://github.com/austinpliu/defidashboard.git
   ```

2. Open a terminal in the folder:

   ```bash
   cd defidashboard
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
- Your site's address appears on the **Settings → Pages** screen (it looks like `https://austinpliu.github.io/defidashboard/`).

If a run fails, the **Actions** tab shows a red ✗; click it to see which step failed. The website keeps showing the last good data.

## Token unlocks

Upcoming unlocks come from **`unlocks.json`**, a hand-checked file built from each project's own tokenomics docs. No free API publishes unlock schedules: DefiLlama sells them on its paid plan, and its open-source adapters are no longer public. Each token page has an **Unlocks** card, and dated unlocks appear in Catalysts tagged "hand-checked". Every entry links the docs page it comes from and says when it was last checked.

- **Statuses:** *scheduled* (dated tranches with amounts from the docs), *partial* (dates or vesting windows, but not every amount), *none* (the docs say nothing is left to unlock), *unconfirmed* (the project publishes no schedule we could confirm).
- **Amounts** are the docs' share of supply × CoinGecko's max supply. If the docs give no share, the site says "not published" rather than guessing.
- **Dates:** if the docs only say "monthly", the site shows the month ("During Dec 2026"), not a made-up day.

To update an entry: open the linked page, compare, and edit the token's entry in `unlocks.json` (shares are fractions: 0.00625 = 0.625%). Then set `lastChecked` to today's date. Schedule types are `monthly` (with `from`/`to` as YYYY-MM and `sharePerPeriod`) and `linear` (with `start`/`end` dates and a `share` or `tokens` total). One-off releases go in `events` (with a `date` and an optional `share`). If an entry is malformed, the Sources page says so, and the token falls back to "unconfirmed".

## Notes

The **Notes** section (and the notes button at the top right of every page) is a research notebook that works like a small Obsidian.

### What it does

- **Write in markdown** with a live preview. The editor saves itself as you type. Shortcuts: Ctrl/⌘+B bold, +I italic, +K link a note, +E preview, +Z undo.
- **Link notes** by typing `[[`: pick a note from the list, or type a new name to create it when you click the link. `[[Note|other words]]` shows other words; `#tags` tag a note.
- **Links and backlinks:** under each note you see what it links to and which notes link back. Renaming a note updates every link to it.
- **Folders:** create, rename, move and delete folders and notes in the sidebar, by drag and drop or the ⋯ menu. Deleting moves a note to the **Trash**, where you can restore it.
- **Graph view:** an interactive map of your notes and their links. Drag notes around, zoom and pan, hover to see a note's neighbours, click to open, and filter by folder or tag. With **Draw a link** on (or holding Shift), drag from one note to another to add a link.
- **Search** every note's text, filtered by tag or folder. **Pinned** and **Recent** notes sit at the top of the sidebar.
- **Templates:** protocol research, token thesis, catalyst watch and daily log. Any note you put in a folder called `Templates` becomes a template too.
- **While you browse:**
  - The notes button (or **Alt+M**) opens a side panel without leaving the page.
  - **Alt+N** starts a quick note from anywhere (it goes in `Inbox/`).
  - Each chart has a **Note** button that pastes the chart's headline, page link and source into your note. **Link page** adds a link to the page you're on.
  - Protocol and token pages show **Your notes** about them, with **New note about this**, which pre-fills a link back to the page.

### Where your notes live (privacy)

- Notes are saved **in this browser only** (in its IndexedDB storage). They are never added to this repository and never published with the site. The code that saves them has no way to reach either.
- Clearing the browser's site data deletes them. So use **Export** now and then, or turn on sync.
- In a private window, the browser may refuse to store anything. The Notes page then warns you, and notes last only until the tab closes.

### Backup: export and import

- **Export** downloads every note as a zip of `.md` files, keeping your folders. Unzip it and open the folder in Obsidian ("Open folder as vault"), and it works as a vault: links, tags and folders included.
- **Import** takes such a zip (or an Obsidian vault you zipped yourself) or individual `.md` files. It never overwrites anything: if a different note already has the same name, the incoming one is saved next to it as "… (imported)".

### Sync between your devices (optional)

Sync keeps the same notes on your phone and laptop. It copies them as plain markdown files to **a private GitHub repository you create**. The dashboard never sees them: the browser talks straight to GitHub.

**One-time setup**

1. On GitHub, create a **new private repository** (for example `research-notes`). Tick "Private". Adding a README is fine.
2. Create a token that can touch only that repository:
   1. GitHub → your photo → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   2. Name it (e.g. "dashboard notes") and pick an expiry. A year is reasonable; you'll redo step 3 when it expires.
   3. **Repository access:** choose **Only select repositories**, and select your notes repository. Nothing else.
   4. **Permissions → Repository permissions → Contents: Read and write.** Leave everything else as "No access". (GitHub adds "Metadata: Read-only" by itself; that's required and harmless.)
   5. **Generate token** and copy it (it starts with `github_pat_`). GitHub shows it only once.
3. On the dashboard: **Notes** → **Sync: off** → paste the repository (`yourname/research-notes`) and the token → **Save and sync**. The dashboard checks that the repository is private before using it. It refuses public repositories and this dashboard's own repository.

**On a second device** (for example your phone):

1. Open the dashboard in the browser you'll use for notes.
2. Go to **Notes** → **Sync: off**.
3. Enter the same repository and token, then **Save and sync**. Your notes download.

You can reuse the same token on both devices, or create a second one with the same settings.

**How it behaves**

- It syncs when you open the dashboard, about 20 seconds after you stop typing, and every 5 minutes while the tab is open. **Sync now** runs it straight away.
- Folders map to real folders in the repository, and every note is a `.md` file. You can also open the repository's contents in Obsidian or edit them on github.com.
- **Conflicts:** if the same note changed on both devices since the last sync, nothing is overwritten.
  - Your version stays as the note.
  - The other device's version is saved next to it as "Note (conflict 2026-11-05 1342)", with a `sync-conflict` line at the top.
  - A banner on the Notes page lists these. Merge what you need, then delete the conflict copy.
  - If a note was deleted on one device but edited on the other, the edit wins and the note comes back.
- The token is stored only in that browser (its local storage) and is only ever sent to `api.github.com`. Anyone with access to that browser profile could read it, which is why it is limited to one repository and only "Contents".

**To stop syncing or revoke access**

- On a device: **Notes** → **Sync** → **Turn off**. This forgets the token in that browser; your notes stay.
- To cut off access completely: GitHub → **Settings** → **Developer settings** → **Fine-grained tokens** → pick the token → **Delete**. Every device using it stops syncing at once, and nothing else on your account is affected.

## Fundamentals Checklist

A research aid, not a rating or a buy signal. It shows how public numbers compare with thresholds you choose. There's no overall score, and it never estimates a missing number: it says "no data" and why.

- **The rules** are in `site/assets/js/fundamentals/rules.js` and run in your browser, so changing a threshold updates every status at once. The page's "How this works" panel lists every rule and threshold. DECISIONS.md › Fundamentals Checklist explains each choice, including the "narrow price range" rule.
- **The defaults** are in `site/config/fundamentals-thresholds.json`. Each threshold has a label, default, allowed range and a one-line explanation. Edit that file to change the defaults for everyone.
- **Your own settings** (Fundamentals › Settings) override the defaults for you only.
  - **Where they live:** your browser. If notes sync is on, they also go to the same private repo as your notes, as `.dashboard/fundamentals-settings.json`, with no new token. If sync is off, they stay in this browser, and the Settings page says so.
  - **Conflicts:** if two devices change the same setting, yours is kept and the other value is shown for you to pick. Nothing is overwritten silently.
  - **Validation:** impossible values aren't saved, for example negative numbers or a ✓ cutoff weaker than the ✗ one.
  - **Backup:** use Export / Import settings to keep a copy.
- **Fill these in by hand** (in the public files for everyone, or in Settings for just you):
  - `site/config/value-accrual.json`: announced fee switches, buybacks or revenue sharing, used by check 3. Add a plan only after confirming it from a primary source, such as a passed vote or an official announcement. Each entry needs `protocol` (the slug from `watchlist.json`), `what`, `status` (proposed, approved or live), `source` (an http(s) link) and `lastChecked` (YYYY-MM-DD), plus an optional `date` and `id`.

    ```json
    { "id": "aave-buyback", "protocol": "aave", "what": "One sentence on what was approved.", "status": "approved", "date": "2026-01-01", "source": "https://…", "lastChecked": "2026-11-05" }
    ```

  - `site/config/team-notes.json`: optional team background for check 6, shown as context only. Each entry needs `protocol`, `text`, `sources` (a list of http(s) links) and `lastChecked`.
  - Both files ship empty, because every entry has to be confirmed by a person.
- **Not available without a key:** token incentive emissions. DefiLlama's `/emissions` endpoint is paid, so "incentives vs holders revenue" always shows "no data". Ethena has no holders-revenue data on DefiLlama (HTTP 400).

## How to add a protocol

Everything the dashboard tracks is in one file, **`watchlist.json`**. You can edit it on GitHub directly (open the file, click the pencil icon, edit, then **Commit changes**). Saving it starts a data update automatically, and the new protocol appears on the site within about 10 minutes.

1. Find the protocol on [DefiLlama](https://defillama.com). Its address looks like `https://defillama.com/protocol/morpho`. The last part (`morpho`) is its **DefiLlama slug**.
2. Optional: find its token on [CoinGecko](https://www.coingecko.com). The address looks like `https://www.coingecko.com/en/coins/morpho`. The last part is the **CoinGecko id**. If you leave it out, the script uses the id DefiLlama knows about.
3. Add an entry to the `"protocols"` list in `watchlist.json` (mind the commas between entries). An example (the docs and forum addresses are illustrative; copy the real ones from the protocol's website):

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

The `"peers"` list works the same way. Peers get full pages and appear in Compare and Catalysts (tagged "peer"), but not in your watchlist strip. The `"newsFeeds"` list holds the news sites' RSS feeds.

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
site/assets/js/fundamentals/   ← the Fundamentals Checklist: rules, settings, sync merge
site/config/                   ← checklist defaults you can edit (thresholds, value accrual, team notes)
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

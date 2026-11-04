# DeFi Research Dashboard

A personal research tool for tracking the DeFi protocols I write about. I use it to pull current numbers and charts for articles, research competitions, and investment-club discussions without digging through several websites each time.

## Who it's for

Me: a writer and researcher, not an engineer. I can run commands and read code, but the app should be simple to start, simple to edit, and explained in plain language.

## What version 1 needs to do

**A watchlist of protocols.** The protocols live in one plain config file (for example `watchlist.json`) that I can edit by hand. Start with Maple Finance (token: SYRUP), Aave, Ondo Finance, Centrifuge, and Sky (formerly MakerDAO).

**A card for each protocol** showing:
- Total value locked (TVL) right now, plus the change over 7 and 30 days
- A TVL chart for the last 90 days, with a toggle for 1 year
- The protocol's category and the chains it runs on
- Its token price and 30-day price change, if it has a token
- Its top yield pools by size, with the current APY

**A comparison view** where I pick 2–4 protocols and see their TVL on one chart.

**Plain-language labels.** Every metric gets a short hover tooltip explaining what it means in one sentence (TVL, APY, market cap, and so on). Assume the reader is smart but new to finance terms.

**Chart export.** A button on each chart that downloads it as a PNG, so I can drop it into an article.

**Freshness.** Show when the data was last fetched, and handle errors gracefully: if a source is down, the card says so instead of breaking the page.

## Data sources

Use free, public sources that need no API key. DefiLlama is the main one (protocol TVL, yields, and token prices). Check the current DefiLlama API docs rather than guessing endpoints.

## Technical preferences

- Keep the stack as simple as possible. A static site that fetches data in the browser is ideal, so no server or database is needed.
- It should be deployable for free (GitHub Pages or Vercel) with clear steps.
- It must work on a phone screen.
- Clean, readable design: light and dark mode, no clutter.

## Out of scope for version 1

User accounts, saved portfolios, alerts, paid data sources, and anything that needs a backend.

## Ideas for later

Adding a protocol by searching for it in the UI, notes per protocol, a "what changed this week" summary, and wallet or on-chain data.

---
inclusion: fileMatch
fileMatchPattern: ["apps/poltergeist/**/*"]
---

# Price sources

Price Poltergeist reads prices through a `PriceSource` (`apps/poltergeist/sources/`). Every source must follow its provider's terms. Read them again before changing a source.

## CheapShark

Source: CheapShark's own API docs at [apidocs.cheapshark.com](https://apidocs.cheapshark.com/), read 2026-11-19. Summary in our words:

- **Free, no key.** The one condition: links that send users to a deal must be CheapShark links. Never use our own affiliate links for any store CheapShark tracks. Mentioning that the app uses CheapShark is appreciated, so the board's subtitle says "CheapShark".
- **Deal links** have the form `https://www.cheapshark.com/redirect?dealID={dealID}`. The `dealID` from the API is already URL-encoded, so don't encode it again. The redirect page is for people, not code: it blocks automated access, so the app never fetches it. Approving a haunt only opens it in the user's browser.
- **User-Agent is required.** It should be descriptive and specific to the app, ideally with a contact. Ours is `CryptKit-PricePoltergeist/<version> (+https://github.com/ericklg/crypt-kit)`, plus `CHEAPSHARK_CONTACT` when it's set.
- **Rate limits.** Too many requests in a short time return `429` and a temporary block. The `Retry-After` header gives the seconds left. All clients share the same limits. On `429` the source stops calling until `Retry-After` has passed, and the poll fails loudly rather than reporting a partial list.
- **No bulk crawling.** The API is meant for answering user actions. Building a cached catalog with automated requests leads to rate limiting and can get a client blocked for good. So:
  - Polls read only the watchlist, through Multiple Game Lookup (`/games?ids=`, at most 25 IDs per call), never the deals catalog.
  - Responses are cached on the server for 1 hour. Prices update about hourly anyway, so polling more often gains nothing.
  - Requests go one at a time.
  - Search (`/games?title=`) runs only when a user types a query.
- **Data.** Prices are in USD. Dates are Unix seconds. Flags are `0`/`1`. Game Lookup gives `cheapestPriceEver`, which we pass to the agent as the historic low. Deals list `storeID`, `price`, `retailPrice` and `savings`.
- **Development.** Tests use recorded fixtures, never the live API, as the docs suggest using a mock.

## Best Buy (stretch, 8.6)

Not built yet. It's keyed by SKU and needs `BESTBUY_API_KEY` (free: 50,000 calls a day, 5 a second). The key stays in server env, and the source is hidden when no key is set. Read Best Buy's API terms before building it and add them here.

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
  - Responses are cached for 1 hour, in the shared database (`poltergeist_kv`), so every server instance shares one cache. Prices update about hourly anyway, so polling more often gains nothing.
  - Requests go one at a time within an instance. A `429`'s pause is stored in the same table, so other instances honor it too.
  - Search (`/games?title=`) runs only when a user types a query.
- **Data.** Prices are in USD. Dates are Unix seconds. Flags are `0`/`1`. Game Lookup gives `cheapestPriceEver`, which we pass to the agent as the historic low. Deals list `storeID`, `price`, `retailPrice` and `savings`.
- **Development.** Tests use recorded fixtures, never the live API, as the docs suggest using a mock.

## Best Buy

Source: Best Buy's [API Terms of Service and Branding Guidelines](https://developer.bestbuy.com/legal) (last updated 2021-02-23) and its [API documentation](https://bestbuyapis.github.io/api-documentation/), read 2026-11-19. Summary in our words:

- **Key.** It needs a free key, `BESTBUY_API_KEY`, which lives in server env only. The terms forbid disclosing it to anyone, so it's added to the request URL only at the moment the request is sent. It never appears in cache keys, logs, error messages or the page.
- **Limits.** 50,000 calls a day and 5 a second. Requests start at least 250 ms apart, and lookups batch SKUs with `sku in(...)`, which Best Buy recommends for avoiding per-second errors. Over the limit, the API returns `403` (also used for a bad key) or `429`. A `429` pauses calls everywhere, like CheapShark's.
- **Caching.** Content may be cached only temporarily, at most 72 hours, to speed up display. We cache for 1 hour.
- **Branding.** Every page, screen or widget that shows Best Buy data must show the Best Buy logo, where that data appears. Use only their asset: `<a href="https://developer.bestbuy.com"><img src="https://developer.bestbuy.com/images/bestbuy-logo.png" alt="Best Buy Developer API"/></a>`. Don't alter it, and don't make it larger than the app's own name or so small it can't be identified. The board header and the watchlist drawer both show it.
- **Attribution and links.** Credit Best Buy as the source ("Prices from Best Buy"). Don't modify or obscure links to bestbuy.com, so the product `url` is used exactly as sent.
- **Music and movies.** Their data may only be used together with Best Buy's affiliate program, so products of type Music or Movie are left out.
- **Checkout wording.** The terms require specific wording only on checkout through the Commerce Gateway API. Poltergeist never buys anything, so it doesn't apply.
- **Search.** Keyword search takes whole words (`search=word&search=word`). Typed text is reduced to letters and digits, so it can't change the query.

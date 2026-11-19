# Price Poltergeist

PC games on your watchlist that drop to your target price become poltergeists on a haunted board, each with a buy-or-wait verdict. Claiming one opens the deal in a new tab. Nothing is ever bought.

Prices come from [CheapShark](https://www.cheapshark.com/) (no API key). Its usage notes are in `.kiro/steering/price-sources.md`.

## Setup

| Variable | Required | What it is |
| --- | --- | --- |
| `CRYPT_MODEL_ID` | yes | Model for verdicts. See `@crypt-kit/agent` (`CRYPT_MODEL_PROVIDER`, credentials) |
| `POLTERGEIST_SOURCE` | no | `fixture` (default: demo prices, no network) or `cheapshark` (live) |
| `POLTERGEIST_WATCHLIST` | for `cheapshark` | `gameId:target` pairs, e.g. `612:3, 128:15.50`. Game IDs are CheapShark's |
| `CHEAPSHARK_CONTACT` | no | Added to the User-Agent CheapShark sees, e.g. an email |
| `CRYPT_BOARD_PASSWORD` | one of these two | At least 12 characters. The browser asks for it, and every action checks it |
| `CRYPT_PUBLIC_DEMO=1` | one of these two | Anyone may act. Fine with fixture prices |
| `CRYPT_DB_URL`, `CRYPT_DB_AUTH_TOKEN` | no | libSQL database. Default `file:crypt-kit.db`; use Turso on Vercel |
| `CRON_SECRET` | no | Turns on the daily scheduled check at `/api/cron` |

With neither a password nor the public demo set, the board is readable but every action is refused.

```sh
pnpm install
pnpm typecheck          # builds the packages the app imports
pnpm --filter @crypt-kit/poltergeist dev
```

## Demo data without a model

```sh
pnpm typecheck
CRYPT_DB_URL=file:/tmp/poltergeist-demo.db node apps/poltergeist/scripts/seed-demo.mjs
```

Then start the app with the same `CRYPT_DB_URL`.

## How it works

- `sources/` holds the `PriceSource` interface, the fixture source and the CheapShark source. CheapShark responses are cached for an hour, requests go one at a time, and a `429` pauses all calls until its `Retry-After` has passed.
- `detectors/price-drops.ts` emits a finding only when a watched game is at or under its target, keyed `source:gameId@price`, so a further drop is a new haunt.
- `prompt.ts` asks for "Buy now." or "Wait." with a short reason, using the historic low when there is one.
- `actions/open-deal.ts` hands the board the CheapShark redirect link, which the board opens in a new tab. It never fetches the link.
- Prices are checked once a day by cron (Vercel Hobby's limit) and whenever you press Check prices.

# Exorcist

Stale GitHub issues and pull requests become ghosts on a haunted board, each with a drafted triage comment. Nothing is posted until you banish it.

## Setup

| Variable | Required | What it is |
| --- | --- | --- |
| `EXORCIST_REPOS` | yes | Comma-separated `owner/repo` list to watch |
| `GITHUB_TOKEN` | yes | Fine-grained token limited to those repos, with **Issues** and **Pull requests** read/write |
| `CRYPT_MODEL_ID` | yes | Model for drafts. See `@crypt-kit/agent` (`CRYPT_MODEL_PROVIDER`, credentials) |
| `CRYPT_BOARD_PASSWORD` | one of these two | At least 12 characters. The browser asks for it, and every action checks it |
| `CRYPT_PUBLIC_DEMO=1` | one of these two | Anyone may act. Only for a sandbox repo |
| `EXORCIST_STALE_DAYS` | no | Days without activity before an item is stale. Default 30 |
| `CRYPT_DB_URL`, `CRYPT_DB_AUTH_TOKEN` | no | libSQL database. Default `file:crypt-kit.db`; use Turso on Vercel |
| `CRON_SECRET` | no | Turns on the daily scheduled run at `/api/cron` |

With neither a password nor the public demo set, the board is readable but every action is refused.

```sh
pnpm install
pnpm typecheck          # builds the packages the app imports
pnpm --filter @crypt-kit/exorcist dev
```

## Demo data without GitHub or a model

```sh
pnpm typecheck
CRYPT_DB_URL=file:/tmp/exorcist-demo.db node apps/exorcist/scripts/seed-demo.mjs
```

Then start the app with the same `CRYPT_DB_URL` and `EXORCIST_REPOS=acme/lantern,acme/ember`.

## How it works

- `detectors/stale-items.ts` lists open issues and PRs with no activity for N days, oldest first, keyed `owner/repo#number`. No model calls.
- `prompt.ts` is the triage prompt: one short comment, and a close recommendation only when the thread shows the item is done.
- `actions/comment-and-close.ts` posts the comment and closes the item only if you kept the close option. Each comment carries a hidden marker, so a retried approval doesn't post twice.
- `app/actions.ts` gates every action: access mode, then the password, then Vercel BotID.

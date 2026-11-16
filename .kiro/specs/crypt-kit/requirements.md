# Requirements: Crypt Kit

Kiroween 2026, Skeleton Crew category. Submission deadline: Friday, Dec 4, 2026, 2:00 PM PT.

## Introduction

Crypt Kit is a lean TypeScript template for "watch, then act" apps. Every app built on it follows one loop:

1. **Detect** deterministically. Plain code polls a source and emits findings with stable keys. No AI here.
2. **Remember.** A tracker dedupes findings so each one is handled once.
3. **Hand off.** Only after detection, an AI agent drafts an action for each new finding.
4. **Decide.** A human approves or rejects the draft on a spooky, game-like board. Nothing outside the app changes without approval.

The kit ships with two distinct demo apps built from the same skeleton:

- **Exorcist**: open GitHub issues and PRs that have gone stale appear as ghosts. The agent drafts a triage comment. You banish the ghost (post the comment, optionally close it) or spare it.
- **Price Poltergeist**: products on a watchlist haunt you when their price drops below a target. The agent writes a buy-or-wait verdict. You claim the deal (open the link) or let it rest.

Eligibility: all code is written fresh during the submission period. No code is copied from existing projects.

## Glossary

- **Source**: an external system a detector reads (GitHub API, a product page).
- **Detector**: a pure function from source data to findings.
- **Finding**: one detected item, with a stable `key`, a `kind`, a severity, and a typed payload.
- **Tracker**: persistent storage of seen finding keys and their status.
- **Draft**: the agent's proposed action for a finding.
- **Haunt**: a finding plus its draft, shown on the board.
- **Action**: the side effect a draft performs once approved.

## Requirements

### R1. Detector contract

**User story:** As a developer building on the kit, I want one small detector interface, so that a new app needs only a detector, an action and a theme.

1. The kit SHALL define a `Detector<TPayload>` interface with an `id`, a `poll(ctx)` method and a payload schema.
2. WHEN `poll` runs, the detector SHALL return findings without calling any AI model.
3. Each finding SHALL have a `key` that is stable across runs for the same real-world item.
4. IF a finding's payload fails its schema, THEN the runner SHALL drop it and log a validation error.
5. The kit SHALL provide a contract test helper that any detector can run against recorded fixtures.

### R2. Tracker and dedup

**User story:** As a user, I want each haunt to appear once, so that I am not shown the same item every run.

1. WHEN the runner receives a finding whose key the tracker has not seen, the tracker SHALL record it as `new`.
2. WHEN the runner receives a finding whose key is already tracked, the runner SHALL NOT request a new draft.
3. WHEN a tracked finding is absent from a later run, the tracker SHALL mark it `resolved` and the board SHALL show it as laid to rest.
4. The tracker SHALL persist across restarts using a local SQLite file by default.
5. The tracker SHALL expose a storage adapter interface so an app can swap SQLite for another store.

### R3. Agent handoff

**User story:** As a developer, I want AI used only after detection, so that cost stays predictable and detection stays testable.

1. WHEN a finding is recorded as `new`, the runner SHALL send that finding alone to the app's agent prompt and store the returned draft.
2. The agent SHALL return a structured draft validated by a schema (summary, proposed action, reasoning).
3. IF the model call fails or returns an invalid draft, THEN the haunt SHALL show "draft unavailable" with a retry control. Detection results SHALL still be shown.
4. The kit SHALL cap agent calls per run with a configurable limit (default 20).
5. The model provider SHALL be configurable through environment variables. The default SHALL be Amazon Bedrock.
6. API keys SHALL be read only from environment variables and SHALL NOT appear in logs, client bundles or the repo.

### R4. Human approval gate

**User story:** As a user, I want to approve every action, so that the agent never does something I did not choose.

1. The kit SHALL NOT run any action without an explicit user approval on that haunt.
2. WHEN the user approves, the kit SHALL run the action once and record the result on the haunt.
3. WHEN the user rejects, the kit SHALL mark the haunt `spared` and SHALL NOT draft it again unless its payload changes.
4. The user SHALL be able to edit a draft's text before approving.
5. IF an action fails, THEN the board SHALL show the error and keep the haunt open.

### R5. Haunted board UI

**User story:** As a user, I want a board that makes triage feel like a game, so that a dull chore is fun to clear.

1. The kit SHALL provide board components driven by a per-app theme: creature art, copy, colors and motion.
2. New haunts SHALL enter with an animation. Approved haunts SHALL leave with a banish animation.
3. The board SHALL show a counter of open haunts and a score for haunts cleared this week.
4. All motion SHALL respect `prefers-reduced-motion`.
5. The board SHALL be keyboard operable (approve, reject, edit, next) and meet WCAG 2.2 AA contrast.
6. Each app's UI SHALL be designed through mockups first and match the chosen mockup.

### R6. Exorcist app

**User story:** As a maintainer, I want stale issues and PRs surfaced with a drafted comment, so that I can clear my backlog quickly.

1. The detector SHALL list open issues and PRs in configured repos with no activity for N days (default 30).
2. The key SHALL be `owner/repo#number`.
3. The draft SHALL be a triage comment and an optional close recommendation.
4. WHEN approved, the action SHALL post the comment and close the item only if the user kept the close option.
5. The app SHALL use a fine-grained GitHub token scoped to the configured repos.

### R7. Price Poltergeist app

**User story:** As a shopper, I want to know when a watched product drops below my target price, with a plain verdict.

1. The detector SHALL read prices for watchlist items from a pluggable `PriceSource`. The demo SHALL ship a fixture source and a live CheapShark source (PC game deals, no API key).
2. A finding SHALL be emitted only WHEN the current price is at or below the target.
3. The key SHALL be `<source>:<item-id>@<price>`, so a further drop creates a new haunt.
4. The draft SHALL be a buy-or-wait verdict with a short reason. WHERE the source provides a historic low, the agent SHALL receive it as context.
5. WHEN approved, the action SHALL open the product link in the form the source's terms require. The app SHALL NOT make purchases.
6. The CheapShark source SHALL follow CheapShark's published usage notes (rate limiting, caching, User-Agent, link format) and SHALL cache responses.
7. (Stretch) The app SHOULD add a Best Buy Products API source behind the same interface, enabled only WHEN `BESTBUY_API_KEY` is set. The app SHALL work fully without it.

### R8. Kiro integration

**User story:** As a judge, I want to see how Kiro was used throughout the build.

1. The repo SHALL include the `.kiro/` directory with this spec, steering files and hooks.
2. Steering SHALL document the detector contract and the "no AI before detection" rule for anyone extending the kit.
3. A hook SHALL run a detector's contract tests whenever its file is saved.
4. The kit SHALL include an MCP server that exposes open haunts and lets Kiro draft or approve them, with approval still required.
5. A `create-crypt-app` scaffold SHALL generate a new app with a detector stub, an action stub and a theme.

### R9. Submission

1. The repo SHALL be public with an OSI-approved open-source license.
2. Both apps SHALL have a public live demo.
3. The submission SHALL include a demo video under 3 minutes showing both apps and the Kiro workflow.
4. The README SHALL explain how to build a third app in under 15 minutes.

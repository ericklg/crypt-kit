# Crypt Kit

A lean TypeScript template for "watch, then act" apps, built with Kiro for Kiroween 2026 (Skeleton Crew).

Every Crypt Kit app runs the same loop:

1. **Detect.** Plain code polls a source and emits findings with stable keys. No AI.
2. **Remember.** A tracker dedupes findings so each one is handled once.
3. **Hand off.** An AI agent drafts an action for each new finding.
4. **Decide.** You approve or reject the draft on a haunted board. Nothing happens without your approval.

Two apps are built from the kit:

- **Exorcist**: stale GitHub issues and PRs appear as ghosts with a drafted triage comment.
- **Price Poltergeist**: PC game price drops (via CheapShark) appear as poltergeists with a buy-or-wait verdict.

Status: in development. The spec lives in [`.kiro/specs/crypt-kit`](.kiro/specs/crypt-kit).

## License

[MIT](LICENSE)

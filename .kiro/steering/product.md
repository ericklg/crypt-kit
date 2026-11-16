---
inclusion: always
---

# Product

Crypt Kit is a lean TypeScript template for "watch, then act" apps, built for Kiroween 2026 (Skeleton Crew).

Every app runs one loop: **detect** (plain code, no AI) → **remember** (dedupe by stable key) → **hand off** (an AI agent drafts an action per new finding) → **decide** (a human approves or rejects on a haunted board).

Two demo apps prove the template is reusable:

- **Exorcist**: stale GitHub issues and PRs become ghosts with a drafted triage comment.
- **Price Poltergeist**: PC game price drops (CheapShark) become poltergeists with a buy-or-wait verdict.

Non-negotiables:

- No action leaves the app without explicit human approval. This holds when Kiro drives the app through MCP too.
- The kit must stay small. A developer should be able to build a third app from it in under 15 minutes.
- Only code written during the submission period (Oct 30 – Dec 4, 2026) goes in this repo. Don't copy code from other projects.

Source of truth: #[[file:.kiro/specs/crypt-kit/requirements.md]]

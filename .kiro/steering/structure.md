---
inclusion: always
---

# Structure

```
packages/core/            contracts + runner (no React, no I/O beyond injected deps)
packages/store-sqlite/    default TrackerStore adapter
packages/board/           React board components + theme contract
packages/mcp/             MCP server over haunts
packages/create-crypt-app/ scaffold CLI
apps/exorcist/            GitHub stale issues and PRs
apps/poltergeist/         price-drop watchlist
```

Rules:

- `packages/core` must not depend on any other workspace package, framework or model SDK. Apps and adapters depend on core, never the reverse.
- An app adds only a detector (`detectors/`), an action (`actions/`), an agent prompt (`prompt.ts`) and a theme (`theme.ts`). If an app needs more, the kit is missing something: add it to a package instead.
- File names are kebab-case. One exported concept per file.
- Work happens on feature branches with PRs into `main`. Commits follow Conventional Commits.

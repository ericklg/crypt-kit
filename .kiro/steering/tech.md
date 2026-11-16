---
inclusion: always
---

# Tech stack

- **Runtime:** Node 26 (`.nvmrc`), ESM only (`"type": "module"`).
- **Package manager:** pnpm workspace (`packages/*`, `apps/*`). Use `pnpm add --filter <pkg>`; never npm or yarn.
- **Language:** TypeScript 7, strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Use `import type` for type-only imports and `.js` extensions in relative imports (NodeNext).
- **Validation:** Zod at every trust boundary (detector payloads, agent drafts, env, request bodies).
- **Tests:** Vitest. Tests sit next to source as `*.test.ts`. Run `pnpm test`; `pnpm typecheck` runs `tsc -b`.
- **Apps (later tasks):** Next.js on Vercel. Server components by default; `'use client'` only for real interactivity. Vercel BotID gates every route that triggers an action.
- **AI:** Vercel AI SDK `generateObject`, provider from env (`CRYPT_MODEL_PROVIDER`, default Bedrock).

Security:

- Secrets come from env vars only. Never log them, ship them to the client, or commit them.
- Text from sources (issue bodies, product titles) is untrusted. Pass it to models as data, and never execute model output.

# Tasks: Crypt Kit

Target: feature-complete Nov 30, polish and video Dec 1-3, submit by Dec 4 2:00 PM PT. Leave a day of slack before the deadline.

- [x] 1. Repo setup (Nov 17)
  - [x] 1.1 New public repo, pnpm workspace, TypeScript strict, Vitest, MIT license
  - [x] 1.2 Commit `.kiro/` with this spec, steering files and hooks
  - _Requirements: R8.1, R8.2, R9.1_

- [x] 2. Core contracts and runner (Nov 17-19)
  - [x] 2.1 `Finding`, `Detector`, `Draft`, `Agent`, `Action`, `TrackerStore` types and Zod schemas
  - [x] 2.2 Runner: poll, validate, diff, cap, draft, persist
  - [x] 2.3 Approve and spare with a per-haunt lock and payload-hash re-draft
  - [x] 2.4 Contract test helper and runner tests (dedup, resolve, cap, double approve, no model calls in poll)
  - _Requirements: R1, R2.1-R2.3, R3.3-R3.4, R4_

- [x] 3. Storage adapters (Nov 19)
  - [x] 3.1 `store-sqlite` (local) and libSQL/Turso (deployed) behind `TrackerStore`
  - [x] 3.2 Close the duplicate-action gap from the PR #2 Copilot review: `approve` runs the action, then saves `approved`. If the save fails or the process dies in between, the haunt stays `drafted` and a retry runs the action again. Persist an `approving` intent atomically before the action (a conditional update, so only one process can claim the haunt). Haunts stuck in `approving` show "check the source before retrying" on the board instead of a plain approve button.
  - [x] 3.3 Cross-process locking: the per-key lock in core is in-process only, so the adapters claim haunts with a conditional write
  - _Requirements: R2.4, R2.5, R4.1, R4.2_

- [ ] 4. Agent (Nov 20)
  - [ ] 4.1 AI SDK `generateObject` agent, provider from env (Bedrock default)
  - [ ] 4.2 Untrusted-input prompt wrapping, error -> `draft_failed` + retry
  - _Requirements: R3_

- [ ] 5. Board mockups (Nov 20-21)
  - [ ] 5.1 2-3 distinct board mockups per app as HTML; pick one each
  - _Requirements: R5.6_

- [ ] 6. Board components (Nov 21-23)
  - [ ] 6.1 Theme contract, haunt list/card, draft editor, counter + weekly score
  - [ ] 6.2 Enter/banish motion, reduced-motion fallback, keyboard shortcuts, AA contrast
  - [ ] 6.3 Server components by default; client only for interactive parts
  - _Requirements: R5_

- [ ] 7. Exorcist app (Nov 23-25)
  - [ ] 7.1 GitHub stale detector + fixtures + contract test
  - [ ] 7.2 Triage prompt, comment/close action, sandbox demo repo
  - [ ] 7.3 Theme matched to the chosen mockup; BotID on action routes
  - _Requirements: R6, R4_

- [ ] 8. Price Poltergeist app (Nov 25-27)
  - [ ] 8.1 Read CheapShark usage notes; record them in `steering/price-sources.md`
  - [ ] 8.2 `PriceSource` interface, fixture source, CheapShark source with server-side cache
  - [ ] 8.3 Price-drop detector + contract test, verdict prompt (with historic low), open-link action
  - [ ] 8.4 Watchlist search/add via `PriceSource.search`
  - [ ] 8.5 Theme matched to the chosen mockup; BotID on action routes
  - [ ] 8.6 (Stretch, only if on schedule by Nov 28) Best Buy source behind `BESTBUY_API_KEY`
  - _Requirements: R7, R4_

- [ ] 9. Kiro extras (Nov 27-28)
  - [ ] 9.1 MCP server (`list_haunts`, `get_haunt`, `redraft_haunt`, `request_approval`)
  - [ ] 9.2 `create-crypt-app` scaffold; verify a third app builds from it
  - _Requirements: R8.3-R8.5, R9.4_

- [ ] 10. Verify (Nov 29-30)
  - [ ] 10.1 Playwright smoke per app; screenshots and a recording of the banish flow
  - [ ] 10.2 New-user usability review by a fresh sub-agent; fold in findings
  - [ ] 10.3 Pixel compare each app against its chosen mockup
  - _Requirements: R5_

- [ ] 11. Ship (Dec 1-3)
  - [ ] 11.1 Deploy both apps on Vercel
  - [ ] 11.2 README: the loop, both apps, "build a third app in 15 minutes"
  - [ ] 11.3 Demo video under 3 minutes: both apps, scaffold, Kiro specs, hooks and MCP
  - [ ] 11.4 Devpost submission, Skeleton Crew category
  - _Requirements: R9_

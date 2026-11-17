---
inclusion: fileMatch
fileMatchPattern: ["packages/board/**/*", "apps/**/*.tsx", "apps/**/*.css"]
---

# UI rules

- **Mockups first.** Each app's board gets 2–3 distinct mockups before code. The chosen mockup is the visual spec; build to match it and pixel-compare the result.
- **Theme contract.** Apps restyle the board only through `{ creature, palette, copy, motion }`. Don't fork board components per app.
- **Server first.** Board data loads in server components. Client components are limited to haunt actions, the draft editor and animations.
- **Motion.** New haunts animate in and approved haunts banish out. Every animation has a `prefers-reduced-motion` fallback.
- **Drafting.** A haunt in `drafting` shows a working state, with spare still available. No approve button until a draft exists.
- **Stuck approvals.** A haunt in `approving` (see `NEEDS_CHECK_STATUSES`) never shows an approve button. It explains that the action may have run, links to the source, and offers "It happened" (`settle(key, 'done')`) and "It didn't happen" (`settle(key, 'not_done')`). Those buttons stay disabled, with the time they unlock, until `settleAfterMs` has passed since the claim. `settle()` refuses earlier calls anyway.
- **Keyboard.** `A` approve, `R` spare, `E` edit, `J`/`K` next/previous. Every shortcut also has a visible button.
- **Accessibility.** WCAG 2.2 AA contrast, visible focus, and labeled controls. Spooky must stay readable.
- **Icons** come from an icon library, not emoji.

# Full-review fixes — implementation plan

**Scope:** the 26 defects confirmed by `tests/review-findings.spec.js` (all red as of
`fix/review-findings`). Every fix turns its test green; the file is the acceptance criteria.

**Source:** whole-file review of `index.html` (2026-07-25) — my own pass plus five
area agents (worker/async, solve-UI, codecs, config-UI, url/history). Cleanup and
efficiency findings are deliberately NOT here — see
`docs/review/2026-07-25-improvements.md`.

**Order:** batches are sequenced so earlier ones shrink later ones. Commit per batch,
run the whole suite (`npx playwright test`) before moving on.

---

## Batch 1 — `validatePlates` becomes a real gate

Fixes **F7, F14, F14b, F8, F8b, F23**; makes F9/F21 unreachable from app state.

Today `validatePlates` accepts configs no other part of the app can handle: ids in any
array order, fractional positions, an unbounded hole count, and `steps` larger than the
lock. Every consumer then assumes array index == id − 1 and exactly 7 holes.

- Require `plates[i].id === i + 1` (not just "the sorted id set is 1..n"). Strict
  rejection over silent normalisation: every codec already emits ordered arrays, so an
  out-of-order array means hand-edited/corrupt input.
- `Number.isInteger` on `positions` and `currentPos` (already applied to `targetId`/`steps`).
- **Decision needed:** pin `positions === DEFAULT_POSITIONS` (7). The whole app hardcodes
  7 — `dotted`/`gothic`/`bytearray` parse, `posStripHTML`, `entryToPlates`, the drum. The
  alternative (teach every codec a hole count) is a real feature, not a fix; if we ever
  want non-7 locks it should be its own task. Recommend pinning to 7 and stating it in the
  JSDoc.
- Require `d.steps <= positions - 1` (a larger step can never be legal, and today it
  silently freezes the plate and reports the lock unsolvable).

## Batch 2 — codec contract honesty

Fixes **F2, F11, F21, F24**, and F9 falls out of F21/F2.

- **F2 (`gothic` can't read its own export).** `gothic.parse` requires both a digit-run
  and a rule token (that's what keeps the four formats disjoint), but `gothic.serialize`
  emits a bare positions string for a dep-free config — including the default startup
  config, so plain Ctrl+C → Ctrl+V fails. Fix on the serialize side: return `null` for a
  config with no dependencies ("not representable in this format") and let the export /
  Ctrl+C path fall through to the next codec (`dotted`, which round-trips it exactly).
  Keeps parse strict and the disjointness tests intact.
- **F11.** `gothic.parse` clamps out-of-range digits with `Math.min(POSITIONS, …)`,
  fabricating a config the user never typed. Drop the clamp and return `null` when a digit
  exceeds `POSITIONS - 1`.
- **F21.** `bytearray.serialize` packs the pin into 3 bits with no range check, silently
  truncating 8 → 0. Return `null` when `currentPos - 1 > 7` (or `positions !== 7`).
- **F24.** `json`/`dotted`/`bytearray` call `.trim()` on the raw argument, so a non-string
  caller gets a `TypeError` from a method whose contract says it never throws. Coerce with
  `String(str)` like `gothic` does (one line each).

## Batch 3 — one writer for config + URL, one id for in-flight solves

Fixes **F5, F1, F4, F10**.

- **F5 (random config never reaches the URL).** The `random-found` handler inlines
  `applyPlates`' body minus its `urlReplace`. Replace the inlined block with
  `applyPlates(data.plates)` followed by `state.cachedSolution = data.solution` — removes
  the duplication and the omission at once. Add the same stage guard the solve branch has
  (`if (state.stage !== 'config') return;`) — that also closes the tail finding about a
  late pool result rewriting the config on the solve stage.
- **F1 (search result applied while solving).** `applySearchResult` applies the entry and
  *then* calls `switchToConfig`, which restores `state.plates` from the pre-solve snapshot
  and clobbers it. Swap the order: `switchToConfig()` first, then `applyEntry(entry)` —
  the order `urlReconcile` already uses.
- **F4 (in-flight solve accepted after a config swap).** `applyPlates` nulls
  `cachedSolution` but never invalidates the pending worker result. Bump `solveId` in
  `applyPlates` (the guard at `onWorkerMessage` then drops the stale result). Additionally
  gate the global Ctrl+V and ⌘K openers on the computing overlay, so a config cannot be
  swapped mid-solve in the first place.
- **F10 (unsolvable `&solve` link).** On `data.solution === null` the handler toasts and
  returns, leaving `&solve` in the URL so every reload repeats the BFS and the toast.
  Reconcile the URL to the config stage there (`urlReplace(state.plates, 'config')`).

## Batch 4 — auto-play and the explore state machine

Fixes **F3, F3b, F22, F12, F18, F19, F28**.

- **Extract `stopAutoPlay()`** (clear the interval, null the handle, restore the button
  label) and call it from every place that currently clears the interval by hand:
  `switchToSolve`, `switchToConfig`, the keyboard detach path, the Auto button, and the
  new call sites below. One helper kills F3, F22 and the label drift together.
- **F3.** `jumpToStep` (and therefore `solveStepBack`, `returnToSolution` and every step
  card) must `stopAutoPlay()` first — today a surviving interval resumes playback after the
  user navigates, while the Stop button is disabled.
- **F3b.** Stop inside the tick that plays the last step instead of noticing one tick
  later (check `solverStep >= solution.length` after `solveStepForward()`).
- **F12.** When `addExploreMove` collapses the history to empty, return to following mode
  (`returnToSolution(state.detachStep)`) instead of leaving all three nav buttons disabled
  in a state that is bit-identical to the detach point.
- **F18.** `switchToConfig` must reset `solveMode`/`exploreHistory`/`detachStep` like
  `switchToSolve` does — extract the reset so the two cannot drift.
- **F19.** The notation string marks `i === solverStep` (the next move) while the card list
  marks `i + 1 === solverStep` (the played move), and explore mode adds a third convention.
  Pick one — "the step just played" matches the 3D scene highlight — and derive both
  renderers from a single helper.
- **F28.** With an empty solution both endpoint cards resolve to step 0 and both go active;
  make the end endpoint inactive when `solution.length === 0`.

## Batch 5 — robustness

Fixes **F15, F16, F27** plus three tail items without dedicated tests.

- **F15.** The global paste handler opens the dialog for any clipboard text; gate it on
  `looksLikeImportConfig(text)` as the design doc specifies.
- **F16.** `new Fuse(chestDb.entries, …)` sits outside `loadChestDb`'s `try` and the guard
  only rejects `null`, so a DB response that parses but has no `entries` array leaves the
  search reported as *available* while every ⌘K throws. Validate the shape
  (`Array.isArray(chestDb.entries)`) inside the try and resolve `false`.
- **F27.** `entry.img[0]` is interpolated straight into a `src` attribute while `name`
  and `tags` next to it go through `escapeHtml`. Escape it (or build the node with
  `setAttribute`). Latent today — all 391 entries have `img: []` — but `chests.ini` is
  externally sourced and the DB is re-read from `localStorage`.
- **No test yet (verify by probe after fixing):**
  - Random-pool workers have no `onerror`/`onmessageerror`, so a dead worker leaves the
    overlay and the difficulty buttons disabled forever. Mirror the solve worker's
    `worker.onerror = workerError` and count a failed worker as exhausted.
  - `startSolve` reuses the shared worker without terminating the previous run, so a
    superseded solve blocks the new one (a worker is serial). Reuse the Cancel handler's
    terminate-and-recreate.
  - `progress` messages carry no `solveId` and are handled before the guard, so an
    abandoned solve inflates the new run's counter. Tag progress with the `solveId` and
    drop stale ones.

## Verification

- Per batch: `npx playwright test` (the whole suite — these fixes touch shared paths).
- After Batch 1 and 2, re-run the DB corpus once: `npm run test:corpus` (the stricter
  `validatePlates` must not reject any real chest).
- The branch may not be pushed until `tests/review-findings.spec.js` is fully green — the
  pre-push hook runs the whole suite.

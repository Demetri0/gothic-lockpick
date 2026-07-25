# Full-review fixes — implementation plan

**Scope:** the 24 defects confirmed by `tests/review-findings.spec.js` (all red as of
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
- Pin `positions === DEFAULT_POSITIONS` (7). **Not an open question — already decided:**
  `docs/superpowers/plans/2026-07-17-review-followups.md:10` ("I3 stays 7-hole") and the
  codec design spec states "Hole count assumed 7" for both gothic and dotted. Today that
  decision is only a comment; this makes it enforced, which is what the spec already
  assumes when it says a non-7 config "round-trips only through json/gothic".
- Require `d.steps <= positions - 1` (a larger step can never be legal, and today it
  silently freezes the plate and reports the lock unsolvable).

## Batch 2 — codec contract honesty

Fixes **F11, F24**; F9 becomes unreachable once Batch 1 pins the hole count.

**Checked against `docs/superpowers/specs/2026-07-17-config-format-parsers-design.md`
first — two of the original findings were wrong and are withdrawn:**

- ~~**F21** (`bytearray.serialize` truncating a pin > 7)~~ — **not a defect.** The spec
  says serialize returns `null` only for `n < 3`, and non-7 hole counts are an explicitly
  accepted constraint ("round-trips only through json/gothic"), enforced by
  `validatePlates`. Batch 1 makes the truncating path unreachable anyway.
- ~~**F2** (Ctrl+C → Ctrl+V of a dep-free config reports «Невалидный конфиг»)~~ — **not a
  defect of its own; a symptom of F15.** The spec covers this twice: gothic's *Known
  limitation* ("a dependency-less config serialises to bare positions, which gothic.parse
  will not re-import … not special-cased"), and the routing table — "Bare digits
  (`3055665`) match none → **not an import config, consistent with the drum-input path
  being separate**". So bare digits are *supposed* to go through the drum, where
  `posReplaceAll` applies them as positions. The only wrong part is the bogus error toast,
  which comes from the global paste not being gated on `looksLikeImportConfig` (F15). Do
  **not** change the copy format or the codec: after F15 the global paste is a no-op for
  bare digits and pasting them onto a drum cell restores the positions, which is the
  documented design.
- **F11 — and the same rule for `entryToPlates`.** Decided principle: **never clamp
  individual digits.** A 0-based run is shifted **as a whole** (`+1` for every digit) or the
  input is **rejected** — clamping only the out-of-range ones fabricates a config the user
  never typed, and after Batch 1 the clamped value (7) is still *valid*, so nothing
  downstream catches it.
  - `gothic.parse` (`index.html:2005`): drop `Math.max(1, Math.min(POSITIONS, …))`; shift
    all digits and return `null` if any lands outside `1..POSITIONS`.
  - `entryToPlates` (`index.html:2719`): same — drop the clamp, shift all. A DB entry with
    an out-of-range `pos` then fails `validatePlates` and `applyEntry` reports it instead
    of silently shifting one disc. (The DB is 0-based; the curated corpus is all `0..6`, so
    this is a guard, not a behaviour change for real data — re-run `npm run test:corpus`.)
  - The gothic **codec itself stays strictly 0-based**; base inference belongs outside it
    (the drum, `posReplaceAll`), which is where it now lives.
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
- **F12.** When the explore history collapses back to empty, return to following mode
  (`returnToSolution(state.detachStep)`) instead of leaving all three nav buttons disabled
  in a state that is bit-identical to the detach point.
- **F18.** `switchToConfig` must reset `solveMode`/`exploreHistory`/`detachStep` like
  `switchToSolve` does — extract the reset so the two cannot drift.
- **F19.** Unify **to the card convention** (`i + 1 === solverStep`, "the step just
  played") and change the **notation string** to match it. Direction matters: the card
  convention is pinned by existing tests (`solve-flow.spec.js` expects `step-1` active
  after one step and `step-end` at the end), so touching the cards instead would break
  them. Explore mode already highlights the last move made, i.e. the same convention.
- **F28.** With an empty solution both endpoint cards resolve to step 0 and both go active;
  make the end endpoint inactive when `solution.length === 0`.

## Batch 5 — paste discipline and robustness

Fixes **F6, F15, F16, F27** plus three tail items without dedicated tests.

**Decided paste rules (they differ by surface — this is the point):**

- **Global `Ctrl+V` never overwrites the config silently — it always goes through the
  confirmation dialog.** Combined with F15 that means: a valid config opens the dialog
  (as today), and anything that is *not* a config does nothing at all (today it opens the
  dialog and then reports «Невалидный конфиг»).
- **A drum paste applies a whole clipboard config only when the matrix is empty** (no dep
  anywhere) — the existing guard. **With any dep set it takes only the digits and tells the
  user the config was not applied**, so the matrix is not overwritten behind their back.
  That notification is the F6 fix; a new i18n key in all three locales.
- **F6.** Today the digits path (`posReplaceAll`) rebuilds the whole set unconditionally,
  so a digits-only paste still wipes the matrix and says nothing. Apply the digits **in
  place while the plate count is unchanged** (deps survive), rebuild only when the count
  itself changes (deps then reset by necessity), and show the "config not applied" toast in
  both cases. Base inference stays as just shipped.
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

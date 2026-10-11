# Gothic Lockpick — Project Conventions

## Project

Disc-lock puzzle solver (BFS) + 3D visualizer, plus a searchable database of real Gothic 1 Remake chest locks. Single file `index.html`, no deps, no build. `chests.ini` is never committed.

- All app code lives in `index.html`, split into `<script>` blocks with **semantic ids** — `solver-src`, `state`, `ui-utils`, `game-logic`, `render-scene`, `render-preview`, `codecs`, `url`, `config`, `solve-ui`, `keyboard`, `init`, `worker-src`, `worker-host`, `db-search`. Grep `id="<name>"` to pull a specific block before editing.
- **The CSS is split the same way** — `<style>` blocks with semantic ids: `style-base`, `style-layout`, `style-preview`, `style-controls`, `style-config`, `style-notation`, `style-search`, `style-solve`, `style-overlay`, `style-tokens`, `style-scene`, `style-responsive`. Several blocks apply in document order exactly as one concatenated sheet, so **moving a rule between blocks changes the cascade** — add rules to the block that owns the zone, and treat a cross-block move as a behaviour change. Two consequences of that ordering worth knowing: `style-tokens` (the `:root` palette) sits late but works because custom properties resolve at computed-value time, and `.hidden` (in `style-base`) is declared before component rules, so a component that sets its own `display` needs an explicit `.component.hidden { display: none }` (see `.solution-list.hidden`) rather than relying on the utility. No `!important` anywhere — keep it that way.
- **Solver logic lives only in the `solver-src` block** — it executes in the page (unit-testable globals) and its `textContent` is prepended to the worker Blob by `createWorker()`. Never re-define solver functions in the worker entry (`worker-src`) or elsewhere; edit `solver-src` and both consumers pick it up.
- **Config import/export goes through the codec registry (`codecs` block)** — the four format codecs live under the `Codecs` namespace (`Codecs.gothic`, `Codecs.json`, `Codecs.dotted`, `Codecs.bytearray`), each a self-contained stateless object `{ id, parse(str)→plates|null, serialize(plates)→string|null }`; neither method throws, `null` means "not this format"/"not representable". The registry + facade — `PARSERS` (ordered codec list), `parseConfig`, `looksLikeImportConfig`, and the shared `validatePlates` invariant — are module-level globals, not on `Codecs`. Add a new format as a `Codecs` codec **and** into the `PARSERS` order, never special-case one inline in the import handler. `validatePlates` (universal invariants) runs once in `parseConfig`; `Codecs.gothic.parseRules` is the single rule-string parser (reused by `entryToPlates` and the hint renderer). It is whitespace/case tolerant but **strict on rule content**: a dependency must state a direction (`+`/`-`) — there is no third kind — so a direction-less or malformed token makes the whole parse invalid (`null`), never a silent drop (consumers guard the null with `|| {}`).
- Chest DB pipeline: `chests.ini` (raw, uncommitted) + `tools/db-decisions.json` (committed "rerere" layer: drops/overrides/additions/translations, keyed by canonical lock key) → `chests.json` via `npm run build:db`. **DB `pos` is 0-based** (`0..6` for the app's 7 holes) — `entryToPlates` converts with `+1`; never clamp individual digits, shift the whole run or reject the entry. **Never hand-edit `chests.json`** — it is fully regenerated; record changes as decisions instead (merge/enrich via `npm run review:db`, translations via `tools/translate-gaps.cjs` export→Google Translate→import→AI verification→finalize). `drops` excludes bad/unfixable ini entries by canonical key so a re-imported ini can't reintroduce them — never edit `chests.ini` (it may come from outside). Duplicate groups without a decision are reported `REVIEW-NEEDED`, never merged silently. The app's own config parsers never read `chests.ini` syntax (no `start_pos=`/`rules=`/INI keys) — INI parsing is DB-pipeline-only (`tools/ini2json.cjs`).
- **External catalog cross-check & agreement score: `npm run sync:catalogs`** (`tools/sync-catalogs.cjs`; the whole DB-update workflow is the `update-chest-db` skill in `.agents/skills/`, symlinked into `.claude/skills/`). Fetches the community lock catalogs (dsazz/gothic-remake-lockbreaker, unlockmyloot, religiosa1/gothic-lockpick-emulator) into the gitignored `tools/catalogs/`, groups every record into physical locks and replays our solution on each other variant (`wall@N` = the pick breaks on press N). Writes `report.txt`, `matrix.json` and `lock-matrix.html` there. Each source **declares its orientation** (`R` reversed plate order, `T` links stored target→source, `X` mirrored positions) and a `weight`; the run re-derives the orientation from the data and aborts on a mismatch, so a changed upstream format can't silently feed a mirrored matrix. `--add-missing` appends locks we lack to `additions`; `--write-evidence` rewrites the derived `evidence` section, which the build turns into entry fields `conf` (Σ agreeing − Σ disagreeing source weights), `doubt`, `alt` (id of a better-agreeing variant of the same lock) and `game` (in-game asset id/name/place). The app ranks search and hints by `conf`, marks `doubt` entries with a warning glyph, and shows the solve-stage notice `#solve-doubt` (found structurally via `findIdenticalChest`, so it also fires for imports and `?lock=` links). Wording rule: dsazz is weighted highest but unproven, so UI text states what was compared ("other sources describe this lock differently"), never "verified"/"wrong". The tool never writes `drops`. A wrong variant is still a solvable lock, so the corpus sweep can't catch it; only this cross-check does.
- Tests: `tests/*.spec.js`, Playwright, run via `npx playwright test`. The full-DB solvability sweep (`tests/corpus.spec.js`, ~3 min) is gated behind `RUN_CORPUS` — run it when the solver changes (`npm run test:corpus`); `CHEST=<id-substring>` targets one/few chests with full failing-input diagnostics.
- **State that several places unwind must have exactly one unwinder.** A full review found the same failure shape five times over: a hand-written teardown copied to N call sites, and different sites forgetting different parts. The single points are `posSetPlateValue` (one plate's position), `applyPlates` (whole config — also invalidates any in-flight solve by bumping `solveId`), `stopAutoPlay` (interval **and** the button label), `resetExploreState` (`solveMode`/`exploreHistory`/`detachStep`), `isComputing` (the "a solve is running" gate), `loadEntry` (load a DB entry from any stage — leaves the solve stage before `applyEntry`; search results and the solve-stage "open the other entry" button both use it), and `lastPlayedIndex` in `renderSolvePanel` (the one cursor every step renderer reads). Never re-implement one of these inline — extend the helper.
- **Shareable state lives only in the URL query string (`url` block), never `history.state`** — `?lock=<dotted>` (the initial config; the solution is recomputed) plus an optional value-less `&solve`. `urlQueryFor`/`urlReadConfig` are pure (config passed in, DOM-free); `urlReplace`/`urlPush` are the only writers and no-op while `syncingFromUrl` (set during load + popstate reconciliation to avoid write-back loops). Config edits `replaceState` from the four mutation points; entering/leaving solve `pushState` (so browser Back/Forward toggle stage — `pushState` clears the forward stack, so no stale entries). On the solve stage always serialize the config snapshot (`solveStartPositions`), never the mutated playback `state.plates`. `urlApplyOnLoad` (in `init`) applies `?lock` silently — no import dialog — and defers the `&solve` auto-solve to the `load` event (the worker block runs after `init`). The single `popstate` listener (`urlReconcile`) is the only place that reads the URL back into the view. explore deviations and playback steps are never written.
- **Read-only config visuals live in the `render-preview` block** (`plates → HTML`, no DOM/state reads) — `posStripHTML` (positions strip, reused by search cards) and `depMatrixHTML(plates, renderCell)` with pluggable `depCellColorHTML`/`depCellIconHTML`; `depDirIcon` lives here too. The `Ctrl+V` import dialog previews the pending config with these and shows an identical-lock card via `findIdenticalChest` (structural match: plate count + positions + edges, not the build-time `canonicalKey`).
- **Changing one plate's position always goes through `posSetPlateValue(id, value)`** (`config` block) — the single entry point that clamps, syncs the input/buttons, updates the 3D scene, invalidates the cached solution, and re-renders the chest hints. Never mutate `plate.currentPos` directly in a handler; route new position-editing gestures through it so those side effects can't be forgotten. Config-stage `A`/`D` disc moves route through it too — a single disc, **dependencies ignored**: deps are a solve-stage rule, applied (and able to block) only during playback/explore, never while authoring the initial config.
- **A multi-digit paste into the drum infers its base** (`posReplaceAll`): every wire format (`gothic`/`dotted`/DB `pos`) is 0-based while the drum displays 1-based values, so a `0` in the run means 0-based (range 0–6) and a `7` means 1-based (range 1–7); digits 1–6 alone are ambiguous and read as **1-based** — the drum sets the values it shows. Single-digit entry (typing or a one-char paste) is always the displayed 1-based value. Note the contrast with the DB position *search*, which is a matcher and so tries both readings (`searchByPosition`), and with the hint matcher, which is deterministically 0-based by design.

## Testing

### Selectors
Always use `data-test-id` attributes to locate elements in tests. Never use CSS classes, tag names, text content, or IDs as selectors — they are implementation details that change without notice.

```js
// ✓ correct
page.getByTestId('btn-start')
page.locator('[data-test-id="pos-val-1"]')

// ✗ wrong
page.locator('#btn-start')
page.locator('.btn-primary')
page.getByText('РЕШЕНИЕ')
```

When an element needs to be tested but has no `data-test-id`, add one to `index.html` first.

### Language
Write all test descriptions (`test('...')`) and inline comments in **English**.

```js
// ✓ correct
test('D moves the active plate right', async ({ page }) => {
  // First go right so we can verify A goes back
  ...
});

// ✗ wrong
test('D двигает активную плашку вправо', async ({ page }) => {
  // Сначала вправо, чтобы убедиться что A двигает обратно
  ...
});
```

## Localization

Any user-visible text added to `index.html` must be added to **all three locales** (`ru`, `en`, `uk`) in the `TRANSLATIONS` object. Never hardcode a display string in HTML or JS without a corresponding translation key — use `data-i18n` on the element and `t('key')` in JS.

The only exception is locale-independent symbols (e.g. `·`, `↩`) that carry the same meaning in all languages.

This is enforced, not just conventional — `tests/i18n.spec.js` fails on a key missing from any locale, a blank value, a `data-i18n` attribute with no dictionary entry, and on `t()` falling back to returning the key. Adding a string to one locale only turns the suite red.

### Style
- `{ force: true }` on clicks inside the 3D scene (CSS 3D transforms affect hit-testing)
- Don't assert transient UI states (overlay appearing then disappearing in <5 ms is not reliably catchable — assert the result instead)
- Keep `beforeEach` to `page.goto('/')` only; per-test setup goes inside the test

### Gotchas

**Disabled buttons don't fire hover events in Chromium** — a `title` on a `disabled` `<button>` never shows as a tooltip. If a disabled control needs an explanatory tooltip, wrap it in a non-disabled `<span>` and put the `title` there instead (see `#btn-search-db-wrap`).

**`page.route().fulfill()` mocks can survive a re-navigation in the same test.** If a test does `goto()` once with a successful mock, then registers a new (failing) route and `goto()`s again to test the failure path, the browser's HTTP cache can serve the first response again — bypassing the new route entirely. Either set `headers: { 'Cache-Control': 'no-store' }` on the success mock, or wait for the first load to fully settle (e.g. `expect(...).toBeEnabled()`) before clearing `localStorage`/re-navigating.

**A fire-and-forget async startup check (`let ready = false; checkSomething().then(...)`) races against anything that reads the flag synchronously before the check resolves** (e.g. a global keyboard shortcut pressed right after page load). Expose the promise itself (`const ready = checkSomething();`) and `await` it at the point of use instead of reading the boolean directly.

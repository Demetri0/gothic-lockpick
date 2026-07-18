# Gothic Lockpick — Project Conventions

## Project

Disc-lock puzzle solver (BFS) + 3D visualizer, plus a searchable database of real Gothic 1 Remake chest locks. Single file `index.html`, no deps, no build. `chests.ini` is never committed.

- All app code lives in `index.html`, split into `<script>` blocks with **semantic ids** — `solver-src`, `state`, `ui-utils`, `game-logic`, `render-scene`, `render-preview`, `codecs`, `url`, `config`, `solve-ui`, `keyboard`, `init`, `worker-src`, `worker-host`, `db-search`. Grep `id="<name>"` to pull a specific block before editing.
- **Solver logic lives only in the `solver-src` block** — it executes in the page (unit-testable globals) and its `textContent` is prepended to the worker Blob by `createWorker()`. Never re-define solver functions in the worker entry (`worker-src`) or elsewhere; edit `solver-src` and both consumers pick it up.
- **Config import/export goes through the codec registry (`codecs` block)** — the four format codecs live under the `Codecs` namespace (`Codecs.gothic`, `Codecs.json`, `Codecs.dotted`, `Codecs.bytearray`), each a self-contained stateless object `{ id, parse(str)→plates|null, serialize(plates)→string|null }`; neither method throws, `null` means "not this format"/"not representable". The registry + facade — `PARSERS` (ordered codec list), `parseConfig`, `looksLikeImportConfig`, and the shared `validatePlates` invariant — are module-level globals, not on `Codecs`. Add a new format as a `Codecs` codec **and** into the `PARSERS` order, never special-case one inline in the import handler. `validatePlates` (universal invariants) runs once in `parseConfig`; `Codecs.gothic.parseRules` is the single rule-string parser (reused by `entryToPlates` and the hint renderer).
- Chest DB pipeline: `chests.ini` (raw, uncommitted) + `tools/db-decisions.json` (committed "rerere" layer: overrides/additions/translations, keyed by canonical lock key) → `chests.json` via `npm run build:db`. **Never hand-edit `chests.json`** — it is fully regenerated; record changes as decisions instead (merge/enrich via `npm run review:db`, translations via `tools/translate-gaps.cjs` export→Google Translate→import→AI verification→finalize). Duplicate groups without a decision are reported `REVIEW-NEEDED`, never merged silently. The app's own config parsers never read `chests.ini` syntax (no `start_pos=`/`rules=`/INI keys) — INI parsing is DB-pipeline-only (`tools/ini2json.cjs`).
- Tests: `tests/*.spec.js`, Playwright, run via `npx playwright test`.
- **Shareable state lives only in the URL query string (`url` block), never `history.state`** — `?lock=<dotted>` (the initial config; the solution is recomputed) plus an optional value-less `&solve`. `urlQueryFor`/`urlReadConfig` are pure (config passed in, DOM-free); `urlReplace`/`urlPush` are the only writers and no-op while `syncingFromUrl` (set during load + popstate reconciliation to avoid write-back loops). Config edits `replaceState` from the four mutation points; entering/leaving solve `pushState` (so browser Back/Forward toggle stage — `pushState` clears the forward stack, so no stale entries). On the solve stage always serialize the config snapshot (`solveStartPositions`), never the mutated playback `state.plates`. `urlApplyOnLoad` (in `init`) applies `?lock` silently — no import dialog — and defers the `&solve` auto-solve to the `load` event (the worker block runs after `init`). The single `popstate` listener (`urlReconcile`) is the only place that reads the URL back into the view. explore deviations and playback steps are never written.
- **Read-only config visuals live in the `render-preview` block** (`plates → HTML`, no DOM/state reads) — `posStripHTML` (positions strip, reused by search cards) and `depMatrixHTML(plates, renderCell)` with pluggable `depCellColorHTML`/`depCellIconHTML`; `depDirIcon` lives here too. The `Ctrl+V` import dialog previews the pending config with these and shows an identical-lock card via `findIdenticalChest` (structural match: plate count + positions + edges, not the build-time `canonicalKey`).
- **Changing one plate's position always goes through `posSetPlateValue(id, value)`** (`config` block) — the single entry point that clamps, syncs the input/buttons, updates the 3D scene, invalidates the cached solution, and re-renders the chest hints. Never mutate `plate.currentPos` directly in a handler; route new position-editing gestures through it so those side effects can't be forgotten.

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

### Style
- `{ force: true }` on clicks inside the 3D scene (CSS 3D transforms affect hit-testing)
- Don't assert transient UI states (overlay appearing then disappearing in <5 ms is not reliably catchable — assert the result instead)
- Keep `beforeEach` to `page.goto('/')` only; per-test setup goes inside the test

### Gotchas

**Disabled buttons don't fire hover events in Chromium** — a `title` on a `disabled` `<button>` never shows as a tooltip. If a disabled control needs an explanatory tooltip, wrap it in a non-disabled `<span>` and put the `title` there instead (see `#btn-search-db-wrap`).

**`page.route().fulfill()` mocks can survive a re-navigation in the same test.** If a test does `goto()` once with a successful mock, then registers a new (failing) route and `goto()`s again to test the failure path, the browser's HTTP cache can serve the first response again — bypassing the new route entirely. Either set `headers: { 'Cache-Control': 'no-store' }` on the success mock, or wait for the first load to fully settle (e.g. `expect(...).toBeEnabled()`) before clearing `localStorage`/re-navigating.

**A fire-and-forget async startup check (`let ready = false; checkSomething().then(...)`) races against anything that reads the flag synchronously before the check resolves** (e.g. a global keyboard shortcut pressed right after page load). Expose the promise itself (`const ready = checkSomething();`) and `await` it at the point of use instead of reading the boolean directly.

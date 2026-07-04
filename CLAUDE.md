# Gothic Lockpick — Project Conventions

## Project

Disc-lock puzzle solver (BFS) + 3D visualizer, plus a searchable database of real Gothic 1 Remake chest locks. Single file `index.html`, no deps, no build. `chests.ini` is never committed.

- All app code lives in `index.html`, split into numbered `<script>` blocks (`Script #1` … `#10`) — grep for `Script #` to find the right one before editing.
- `chests.ini` (raw, uncommitted) → `chests.json` (committed, fetched by the app) via `tools/ini2json.cjs` (`npm run build:db`); translations via `tools/translate.sh` (`npm run translate:db`).
- Tests: `tests/*.spec.js`, Playwright, run via `npx playwright test`.
- **Changing one plate's position always goes through `posSetPlateValue(id, value)`** (Script #5) — the single entry point that clamps, syncs the input/buttons, updates the 3D scene, invalidates the cached solution, and re-renders the chest hints. Never mutate `plate.currentPos` directly in a handler; route new position-editing gestures through it so those side effects can't be forgotten.

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

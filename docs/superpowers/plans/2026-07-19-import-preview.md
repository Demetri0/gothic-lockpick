# Import-Preview + Identical-Lock Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a read-only visualization (positions strip + dependency matrix) of the pending config inside the `Ctrl+V` import-confirmation dialog, plus a card for an identical chest if the DB has one.

**Architecture:** New pure `render-preview` block holds `plates → HTML` primitives (positions strip, dep-matrix grid with a pluggable cell renderer). `db-search` gains a structural `findIdenticalChest`. The `config` block orchestrates: `openImportDialog` renders both matrix variants (icons vs colour, A/B) + the identical card into `#import-preview`.

**Tech Stack:** Single-file `index.html`, no build. Playwright tests (`npx playwright test`).

## Global Constraints

- All app code in `index.html`, `<script>` blocks with semantic ids; grep `id="<name>"` before editing.
- Tests use `data-test-id` selectors only; English test names; add `data-test-id` to any element a test needs.
- Any user-visible string added to `index.html` goes into all three locales (`ru`/`en`/`uk`) in `TRANSLATIONS` via `data-i18n`/`t('key')`. Locale-independent glyphs (icons/colours) need no key.
- `render-preview` is pure `plates → HTML`, no DOM/state reads. Dependency direction: `config` → {`render-preview`, `db-search`}; `render-preview` depends on nothing.
- `chestDb.entries` is the DB array; `chestDb` may be null before the DB loads — guard.
- Entry positions are 0-based (`entry.pos[i]`); plate positions are 1-based (`plate.currentPos`).
- Run the FULL suite (`npx playwright test`) before the final commit; existing tests must stay green.

---

### Task 1: `render-preview` block with `posStripHTML`; rename `render`→`render-scene`

**Files:**
- Modify: `index.html` — rename `<script id="render">` → `<script id="render-scene">`; add a new `<script id="render-preview">` block immediately after it.
- Test: `tests/render-preview.spec.js` (create)

**Interfaces:**
- Produces: `posStripHTML(positions0, idPrefix)` → HTML string. `positions0` is an array of 0-based active-hole indices (one per plate); `idPrefix` prefixes test-ids. Emits one `.sr-plate` row per entry (test-id `${idPrefix}-plate-${row}`) containing 7 `.sr-hole` spans (test-id `${idPrefix}-hole-${row}-${i}`, `data-active="true"` on the active hole, class `active` on it).

- [ ] **Step 1: Write the failing test** — `tests/render-preview.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('posStripHTML emits one row per plate with the active hole marked', async ({ page }) => {
  const html = await page.evaluate(() => posStripHTML([6, 4, 0], 'x'));
  await page.setContent(html);
  await expect(page.locator('[data-test-id="x-plate-0"]')).toBeVisible();
  await expect(page.locator('[data-test-id="x-plate-2"]')).toBeVisible();
  await expect(page.locator('[data-test-id="x-plate-3"]')).toHaveCount(0);   // only 3 plates
  await expect(page.locator('[data-test-id="x-hole-0-6"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-test-id="x-hole-0-5"]')).toHaveAttribute('data-active', 'false');
  await expect(page.locator('[data-test-id="x-hole-2-0"]')).toHaveAttribute('data-active', 'true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/render-preview.spec.js`
Expected: FAIL — `posStripHTML is not defined`.

- [ ] **Step 3: Rename the render block and add render-preview**

In `index.html` change the opening tag `  <script id="render">` to `  <script id="render-scene">` (leave its body unchanged). Immediately after that block's `</script>`, insert:

```html
  <script id="render-preview">
// ── render-preview — pure read-only config visuals (plates → HTML) ──────────
/** A row of 7 holes per plate, the active one filled. `positions0` is 0-based. */
function posStripHTML(positions0, idPrefix) {
  return positions0.map((p, row) => {
    const holes = Array.from({ length: 7 }, (_, i) =>
      `<span class="sr-hole${i === p ? ' active' : ''}"`
      + ` data-test-id="${idPrefix}-hole-${row}-${i}" data-active="${i === p}"></span>`
    ).join('');
    return `<div class="sr-plate" data-test-id="${idPrefix}-plate-${row}">${holes}</div>`;
  }).join('');
}
  </script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/render-preview.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/render-preview.spec.js
git commit -m "feat(render-preview): posStripHTML + rename render block to render-scene"
```

---

### Task 2: Route `buildResultCard` through `posStripHTML` (behaviour-preserving)

**Files:**
- Modify: `index.html` — `buildResultCard` (in `db-search`, ~`function buildResultCard(entry, idx)`).

**Interfaces:**
- Consumes: `posStripHTML(positions0, idPrefix)` (Task 1).

- [ ] **Step 1: Confirm the existing test that guards the markup**

Run: `npx playwright test tests/search-db.spec.js -g "digit-only query"`
Expected: PASS (asserts `search-result-0-hole-*` `data-active` counts — this is our regression guard for the refactor).

- [ ] **Step 2: Replace the inline holes with `posStripHTML`**

In `buildResultCard`, replace the `const plateRows = entry.pos.map(...)...join('');` block with:

```js
  const plateRows = posStripHTML(entry.pos, `search-result-${idx}`);
```

Leave the `<div class="sr-preview">${plateRows}</div>` line unchanged.

- [ ] **Step 3: Run the search-db suite to verify unchanged behaviour**

Run: `npx playwright test tests/search-db.spec.js`
Expected: PASS (all — the emitted test-ids `search-result-${idx}-hole-${row}-${i}` and `-plate-${row}` are identical to before).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "refactor(db-search): buildResultCard uses posStripHTML"
```

---

### Task 3: `depMatrixHTML` + colour/icon cell renderers; move `depDirIcon` into `render-preview`

**Files:**
- Modify: `index.html` — move `depDirIcon` from `config` to the `render-preview` block; add `depMatrixHTML`, `depCellColorHTML`, `depCellIconHTML` to `render-preview`; add small CSS for the mini matrix.
- Test: `tests/render-preview.spec.js` (extend)

**Interfaces:**
- Consumes: `depDirIcon(dir)` → SVG string (moved here).
- Produces:
  - `depMatrixHTML(plates, renderCell)` → HTML string: an N×N grid (`.mini-matrix`, test-id `mini-matrix`). Cell `(r,c)` has test-id `mini-cell-${r}-${c}` and `data-dep` = `'self'` when `r===c`, else the dependency dir from plate `r+1` to plate `c+1` (`'same'`/`'opposite'`/`'none'`). Non-diagonal cell inner HTML = `renderCell(dir)`.
  - `depCellColorHTML(dir)` → `''` (colour comes from CSS on `data-dep`).
  - `depCellIconHTML(dir)` → `depDirIcon(dir)` for same/opposite, else `''`.

- [ ] **Step 1: Write the failing test** — append to `tests/render-preview.spec.js`:

```js
const cfg = () => ([
  { id: 1, positions: 7, currentPos: 6, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 4, deps: [{ targetId: 3, direction: 'opposite', steps: 1 }] },
  { id: 3, positions: 7, currentPos: 2, deps: [] },
]);

test('depMatrixHTML marks self/same/opposite/none per cell (colour variant)', async ({ page }) => {
  const html = await page.evaluate((p) => depMatrixHTML(p, depCellColorHTML), cfg());
  await page.setContent(html);
  await expect(page.locator('[data-test-id="mini-cell-0-0"]')).toHaveAttribute('data-dep', 'self');
  await expect(page.locator('[data-test-id="mini-cell-0-1"]')).toHaveAttribute('data-dep', 'same');
  await expect(page.locator('[data-test-id="mini-cell-1-2"]')).toHaveAttribute('data-dep', 'opposite');
  await expect(page.locator('[data-test-id="mini-cell-0-2"]')).toHaveAttribute('data-dep', 'none');
});

test('depMatrixHTML icon variant renders a dep-icon in linked cells', async ({ page }) => {
  const html = await page.evaluate((p) => depMatrixHTML(p, depCellIconHTML), cfg());
  await page.setContent(html);
  await expect(page.locator('[data-test-id="mini-cell-0-1"] [data-test-id="dep-icon"]')).toHaveAttribute('data-dep', 'same');
  await expect(page.locator('[data-test-id="mini-cell-0-2"] [data-test-id="dep-icon"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/render-preview.spec.js`
Expected: FAIL — `depMatrixHTML is not defined`.

- [ ] **Step 3: Move `depDirIcon` and add the matrix builders**

In the `config` block delete the whole `function depDirIcon(s) { ... }` definition (the SVG glyph helper). Paste it into the `render-preview` block, then add the matrix builders below it:

```js
/** Read-only N×N dependency grid; each non-diagonal cell delegates to renderCell(dir). */
function depMatrixHTML(plates, renderCell) {
  const dirOf = (from, to) => {
    const d = plates[from].deps.find(x => x.targetId === plates[to].id);
    return d ? d.direction : 'none';
  };
  const rows = plates.map((_, r) =>
    plates.map((_, c) => {
      const dep = r === c ? 'self' : dirOf(r, c);
      const inner = r === c ? '' : renderCell(dep);
      return `<span class="mini-cell" data-test-id="mini-cell-${r}-${c}" data-dep="${dep}">${inner}</span>`;
    }).join('')
  ).join('');
  return `<div class="mini-matrix" data-test-id="mini-matrix" style="--n:${plates.length}">${rows}</div>`;
}

/** Colour variant: the look is CSS on [data-dep]; no inner content. */
function depCellColorHTML() { return ''; }

/** Icon variant: reuse the directed-dependency glyph for linked cells. */
function depCellIconHTML(dir) { return dir === 'same' || dir === 'opposite' ? depDirIcon(dir) : ''; }
```

- [ ] **Step 4: Add the mini-matrix CSS**

In the `<style>` block (near the other `.dep-*` rules), add:

```css
.mini-matrix { display: grid; grid-template-columns: repeat(var(--n), 12px); gap: 2px; }
.mini-cell { width: 12px; height: 12px; border-radius: 2px; background: var(--bg-inset);
             display: flex; align-items: center; justify-content: center; }
.mini-cell[data-dep="self"] { background: var(--border); }
.mini-cell[data-dep="same"] { background: #3f6f3f; }
.mini-cell[data-dep="opposite"] { background: #7a3a3a; }
.mini-cell[data-dep="none"] { background: var(--bg-inset); }
.mini-cell .dep-icon { width: 10px; height: 8px; }
```

- [ ] **Step 5: Run tests (render-preview + config-ui matrix guard)**

Run: `npx playwright test tests/render-preview.spec.js tests/config-ui.spec.js`
Expected: PASS (config-ui still sees `dep-icon` via `depCellHTML`, which now calls the moved `depDirIcon`).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/render-preview.spec.js
git commit -m "feat(render-preview): read-only depMatrixHTML with colour/icon cell renderers"
```

---

### Task 4: `findIdenticalChest` — structural exact match

**Files:**
- Modify: `index.html` — add `findIdenticalChest` to the `db-search` block (next to `runChestSearch`).
- Test: `tests/import.spec.js` (extend)

**Interfaces:**
- Consumes: `chestDb.entries`, `entryEdges(entry)`, `buildUserEdges(plates)` (all existing in `db-search`).
- Produces: `findIdenticalChest(plates)` → the identical entry object, or `null`.

- [ ] **Step 1: Write the failing test** — append to `tests/import.spec.js`:

```js
test('findIdenticalChest returns the entry whose positions and edges match exactly', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    const entry = chestDb.entries[0];
    const plates = entryToPlates(entry);              // reconstruct the exact config
    const hit = findIdenticalChest(plates);
    const miss = findIdenticalChest(plates.map((p, i) => i === 0 ? { ...p, currentPos: (p.currentPos % 7) + 1 } : p));
    return { hitName: hit && entryName(hit), sameEntry: hit === entry, missIsNull: miss === null };
  });
  expect(res.sameEntry).toBe(true);
  expect(res.missIsNull).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/import.spec.js -g "findIdenticalChest"`
Expected: FAIL — `findIdenticalChest is not defined`.

- [ ] **Step 3: Implement `findIdenticalChest`**

Add to the `db-search` block, right after `runChestSearch`:

```js
/** Exact structural match against the DB: same plate count, positions and edges. */
function findIdenticalChest(plates) {
  if (!chestDb) return null;
  const userEdges = buildUserEdges(plates);
  return chestDb.entries.find(entry => {
    if (entry.pos.length !== plates.length) return false;
    if (!entry.pos.every((p, i) => p === plates[i].currentPos - 1)) return false;
    const e = entryEdges(entry);
    if (e.size !== userEdges.size) return false;
    for (const [k, v] of userEdges) if (e.get(k) !== v) return false;
    return true;
  }) || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/import.spec.js -g "findIdenticalChest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/import.spec.js
git commit -m "feat(db-search): findIdenticalChest structural exact match"
```

---

### Task 5: Import-dialog container + i18n keys

**Files:**
- Modify: `index.html` — add `#import-preview` to `#import-dialog`; add three i18n keys to each locale in `TRANSLATIONS`.

**Interfaces:**
- Produces: an empty `<div id="import-preview" data-test-id="import-preview">` between the dialog `<p>` and `.dialog-buttons`; i18n keys `import-found-in-db`, `import-variant-icons`, `import-variant-color`.

- [ ] **Step 1: Add the container**

In `#import-dialog`, immediately after the `<p data-i18n="dialog-import-body">…</p>` line, insert:

```html
    <div id="import-preview" data-test-id="import-preview"></div>
```

- [ ] **Step 2: Add i18n keys**

In `TRANSLATIONS`, add to the `ru` block:

```js
    'import-found-in-db': 'Найдено в базе:',
    'import-variant-icons': 'Иконки',
    'import-variant-color': 'Цвет',
```

to `en`:

```js
    'import-found-in-db': 'Found in database:',
    'import-variant-icons': 'Icons',
    'import-variant-color': 'Colour',
```

to `uk`:

```js
    'import-found-in-db': 'Знайдено в базі:',
    'import-variant-icons': 'Іконки',
    'import-variant-color': 'Колір',
```

- [ ] **Step 3: Run a smoke test (page still loads, keys resolve)**

Run: `npx playwright test tests/import.spec.js -g "findIdenticalChest"`
Expected: PASS (proves the page still parses/loads with the new markup + translations).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(import): #import-preview container + i18n keys"
```

---

### Task 6: `renderImportPreview` / `clearImportPreview` + wire the dialog

**Files:**
- Modify: `index.html` — add `renderImportPreview`/`clearImportPreview` to the `config` block; call `renderImportPreview` from `openImportDialog` and `clearImportPreview` from the dialog `close` handler (which fires for ok, cancel and Esc).
- Test: `tests/import.spec.js` (extend)

**Interfaces:**
- Consumes: `posStripHTML`, `depMatrixHTML`, `depCellIconHTML`, `depCellColorHTML` (render-preview); `findIdenticalChest`, `buildResultCard` (db-search); `parseConfig` (codecs); `t` (state).
- Produces: fills `#import-preview` with two variant cards (`import-variant-icons`, `import-variant-color`) each = posStrip + depMatrix, plus a `#import-found` card when identical.

- [ ] **Step 1: Write the failing tests** — append to `tests/import.spec.js`:

```js
test('the import dialog previews the pending config (both matrix variants)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await expect(page.getByTestId('import-variant-icons')).toBeVisible();
  await expect(page.getByTestId('import-variant-color')).toBeVisible();
  await expect(page.getByTestId('import-variant-color').locator('[data-test-id="mini-matrix"]')).toBeVisible();
});

test('the import dialog shows a found-in-DB card for an identical lock', async ({ page }) => {
  await page.goto('/');
  // An exact-match paste string built from a real DB entry via the gothic codec.
  const gothicStr = await page.evaluate(() => Codecs.gothic.serialize(entryToPlates(chestDb.entries[0])));
  await page.evaluate((s) => openImportDialog(s), gothicStr);
  await expect(page.getByTestId('import-found')).toBeVisible();
});

test('no found-in-DB card when the config matches nothing', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));   // synthetic, not in DB
  await expect(page.getByTestId('import-found')).toHaveCount(0);
});

test('closing the import dialog clears the preview', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));
  await page.getByTestId('import-dialog-cancel').click();
  await expect(page.getByTestId('import-preview')).toBeEmpty();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/import.spec.js -g "import dialog previews|found-in-DB|clears the preview"`
Expected: FAIL — `#import-preview` stays empty (no `renderImportPreview` yet).

- [ ] **Step 3: Add the orchestration**

In the `config` block, above `function openImportDialog`, add:

```js
function importVariantCard(labelKey, plates, renderCell) {
  return `<div class="import-variant" data-test-id="${labelKey}">`
    + `<div class="import-variant-label">${t(labelKey)}</div>`
    + `<div class="sr-preview">${posStripHTML(plates.map(p => p.currentPos - 1), labelKey)}</div>`
    + depMatrixHTML(plates, renderCell)
    + `</div>`;
}

function renderImportPreview(plates) {
  const box = document.getElementById('import-preview');
  if (!plates) { box.innerHTML = ''; return; }
  let html = importVariantCard('import-variant-icons', plates, depCellIconHTML)
           + importVariantCard('import-variant-color', plates, depCellColorHTML);
  const hit = findIdenticalChest(plates);
  if (hit) html += `<div class="import-found-label">${t('import-found-in-db')}</div>`
                 + `<div id="import-found" data-test-id="import-found">${buildResultCard(hit, 'found')}</div>`;
  box.innerHTML = html;
}

function clearImportPreview() { document.getElementById('import-preview').innerHTML = ''; }
```

- [ ] **Step 4: Wire it into `openImportDialog` and the close handlers**

Change `openImportDialog` to:

```js
function openImportDialog(text) {
  _importPending = text;
  renderImportPreview(parseConfig(text));
  document.getElementById('import-dialog').showModal();
}
```

In the `import-dialog` `close` event handler (the one that resets `_importPending = null`), add `clearImportPreview();` alongside the reset.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/import.spec.js`
Expected: PASS (all, including the four new tests).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/import.spec.js
git commit -m "feat(import): preview pending config + identical-lock card in the dialog"
```

---

### Task 7: Docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`.

- [ ] **Step 1: Update CLAUDE.md**

In the semantic-id list, change `render` to `render-scene` and add `render-preview` right after it. Add a bullet after the codecs/url bullets:

```markdown
- **Read-only config visuals live in the `render-preview` block** (`plates → HTML`, no DOM/state) — `posStripHTML` (positions strip, reused by search cards) and `depMatrixHTML(plates, renderCell)` with pluggable `depCellColorHTML`/`depCellIconHTML`. The `Ctrl+V` import dialog previews the pending config with these and shows an identical-lock card via `findIdenticalChest` (structural match: plate count + positions + edges, not the build-time `canonicalKey`).
```

- [ ] **Step 2: Update the README architecture map**

Change the `render` line to `render-scene` and add:

```
render-preview  posStripHTML(), depMatrixHTML(+depCellColor/Icon) — read-only виз
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: render-preview block + import preview convention"
```

---

### Task 8: Full-suite verification

- [ ] **Step 1: Run the whole suite**

Run: `npx playwright test`
Expected: PASS (all — existing + `render-preview.spec.js` + the new `import.spec.js` tests).

- [ ] **Step 2: If anything fails, fix and re-run before proceeding.**

---

## After Phase 1 (you pick the winning variant)

Phase 1 ships both matrix variants stacked in the dialog so you can compare live. Once you choose, a short cleanup collapses to one:

- Delete the losing `depCell<X>HTML` from `render-preview` (keep the winner).
- In `renderImportPreview`, drop the losing `importVariantCard(...)` call and the `import-variant-*` label wrapper; render a single unlabelled card `[posStrip + depMatrix(winner)]`.
- Remove the now-unused `import-variant-icons` / `import-variant-color` i18n keys from all three locales.
- Update the Task-6 tests that assert both variants to assert the single card.
- If the icon variant lost, `depDirIcon` is still used by `depCellHTML` (config matrix) — keep it.

## Self-review notes

- Spec coverage: posStrip (T1/T2), dep matrix + variants (T3), identical lookup (T4), dialog container/i18n (T5), orchestration + integration (T6), docs (T7), render-* rename (T1/T7), verify (T8). All spec sections covered.
- `render-preview` purity holds: `depDirIcon` moved in, no state/DOM reads in the primitives.
- Names consistent across tasks: `posStripHTML`, `depMatrixHTML`, `depCellColorHTML`, `depCellIconHTML`, `findIdenticalChest`, `renderImportPreview`, `clearImportPreview`.

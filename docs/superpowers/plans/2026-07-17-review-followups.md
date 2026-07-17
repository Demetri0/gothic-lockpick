# Review Follow-ups — Implementation Plan

> Consolidates three code reviews (functional/bug, organizational, documentation) on the config-format-parser work, plus the user's decisions. Executed in **phases across separate branches**.

## Decisions locked
- **tools/ ↔ index.html duplication is accepted** (index.html is self-contained: only Fuse + chests.json). No cross-boundary dedup. Dedup only *within* index.html.
- **I2 paste policy:** global Ctrl+V → always the confirmation dialog (already true). Drum-input Ctrl+V → **digits only**, except: a valid **gothic** paste applied whole *only when the current config has zero dependencies* (nothing to clobber).
- **Script blocks → semantic `id`s** (drop the `#N`-in-comments numbering); each `<script>` gets an `id` an agent can grep to pull that block.
- **Docs last**, reflecting every change.
- Apply all parser minors: M4, M5, M6 reject; I3 stays 7-hole.

## Phase sequencing
- **Phase 1** — parser bug/robustness fixes → **current branch `feat/config-format-parsers`**, then merge.
- **Phase 2** — code reorganization (blocks + ids + moves) → **new branch** after Phase 1 merges.
- **Phase 3** — test consolidation → with Phase 2.
- **Phase 4** — documentation → **new branch**, last, after Phases 1–3 land.

---

## PHASE 1 — Parser fixes (current branch)

All changes in `index.html` parser region + `tests/config-parsers.spec.js`. TDD each.

### Task 1.1 — C1: `validatePlates` must not throw on non-object elements (contract crash)

**Bug:** `parseConfig('[null,null]')` throws `TypeError` (validatePlates dereferences `p.id`/`d.targetId` without an object check); fires unguarded on paste paths.

- [ ] **RED** — add to `tests/config-parsers.spec.js` (`validatePlates` describe):
```js
test('does not throw on non-object array elements (contract)', async ({ page }) => {
  const r = await page.evaluate(() => ({
    a: parseConfig('[null,null]'),
    b: parseConfig('[1,2,3]'),
    c: parseConfig('[{"id":1,"positions":7,"currentPos":4,"deps":[null]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'),
    like: looksLikeImportConfig('[null,null]'),
  }));
  expect(r.a).toBeNull(); expect(r.b).toBeNull(); expect(r.c).toBeNull(); expect(r.like).toBe(false);
});
```
Run `npx playwright test config-parsers -g "non-object"` → FAIL (throws).

- [ ] **GREEN** — in `validatePlates` (index.html), after the length check add:
```js
  if (plates.some(p => !p || typeof p !== 'object')) return null;
```
and at the top of the `for (const d of p.deps)` loop body add:
```js
    if (!d || typeof d !== 'object') return null;
```
Run → PASS. Commit `fix: validatePlates rejects non-object elements without throwing (contract)`.

### Task 1.2 — I2: drum-input paste no longer silent-applies arbitrary formats

**Bug:** the poslock paste handler applies ANY `looksLikeImportConfig` match with no dialog → a ~2–4% false-positive byte-array token silently overwrites the config.

- [ ] **RED** — add tests:
```js
test.describe('drum paste policy', () => {
  test('a random alnum token pasted in the drum does not replace the config', async ({ page }) => {
    // pick a 7-char token that byte-array would previously mis-decode; assert plate count unchanged
    await page.evaluate(() => { const inp = document.querySelector('[data-test-id="pos-val-1"]'); inp.focus();
      const dt = new DataTransfer(); dt.setData('text', 'AAAAAAA');
      inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
    await expect(page.getByTestId('val-plates')).toHaveText('7'); // default, unchanged
  });
  test('valid gothic pasted in the drum applies whole ONLY when no deps are set', async ({ page }) => {
    const paste = (s) => { const inp = document.querySelector('[data-test-id="pos-val-1"]'); inp.focus();
      const dt = new DataTransfer(); dt.setData('text', s);
      inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); };
    // fresh config has no deps → full gothic applies
    await page.evaluate(paste, '040615 A:B-,C+;D:E-');
    await expect(page.getByTestId('val-plates')).toHaveText('6');
  });
});
```
(Confirm the actual poslock input `data-test-id`; the tests use `pos-val-1`. Verify against index.html and adjust.)
Run → the first test FAILS (token currently applies).

- [ ] **GREEN** — replace the body of the `posCont.addEventListener('paste', …)` handler (index.html ~2176) so the full-config branch is gothic-only + guarded by zero current deps:
```js
    const text = (e.clipboardData || window.clipboardData).getData('text') || '';
    // Full-config apply from the drum is deliberately narrow: only an unambiguous
    // gothic paste, and only when nothing would be clobbered (no deps set yet).
    if (state.plates.every(p => p.deps.length === 0)) {
      const plates = validatePlates(gothic.parse(text));
      if (plates) { applyPlates(plates); showToast(t('toast-applied')); return; }
    }
    const digits = text.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) { posReplaceAll(digits); return; }
    const d = parseInt(digits, 10);
    const digit = e.target.closest('.poslock-digit');
    if (digit) posSetPlateValue(parseInt(digit.dataset.id, 10), d);
    else posAppendPlate(d);
```
Run → PASS. Full suite green. Commit `fix: drum paste applies only gothic (deps-free), never silent byte-array (I2)`.

### Task 1.3 — M4/M5/M6: parser robustness (reject the dubious cases)

- [ ] **RED** — add tests:
```js
test.describe('parser strictness (M4/M5/M6)', () => {
  test('dotted rejects non-canonical spellings', async ({ page }) => {
    const r = await page.evaluate(() => [dotted.parse('03.531.saaoaa'), dotted.parse('3.531.SAAOAA')]);
    expect(r).toEqual([null, null]);
  });
  test('gothic rejects a rule whose source plate does not exist', async ({ page }) => {
    expect(await page.evaluate(() => gothic.parse('01 C:A-'))).toBeNull();
  });
  test('validatePlates rejects duplicate/conflicting deps to one target', async ({ page }) => {
    expect(await page.evaluate(() => validatePlates([
      { id: 1, positions: 7, currentPos: 4, deps: [
        { targetId: 2, direction: 'opposite', steps: 1 }, { targetId: 2, direction: 'same', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ]))).toBeNull();
  });
});
```
Run → FAIL.

- [ ] **GREEN M4** — `dotted.parse`: drop the `/i` flag (`/^(\d+)\.(\d+)\.([sao]+)$/`), remove `.toLowerCase()`, and after parsing `n` add `if (String(n) !== m[1]) return null;` (reject leading-zero N; positions field keeps per-digit zeros, which are legitimate positions).
- [ ] **GREEN M5** — `gothic.parse`: after `const depMap = gothic.parseRules(...)`, before building plates:
```js
    const n = rawPos.length;
    for (const src of Object.keys(depMap)) if (src.charCodeAt(0) - 65 >= n) return null;
```
- [ ] **GREEN M6** — `validatePlates`: inside `for (const p of plates)`, before the deps loop add `const seenTargets = new Set();`; inside the deps loop, after the field checks, add `if (seenTargets.has(d.targetId)) return null; seenTargets.add(d.targetId);`.
Run → PASS. Full suite green. Commit `fix: reject non-canonical dotted, out-of-range gothic source, duplicate deps (M4/M5/M6)`.

### Task 1.4 — I3: document the 7-hole assumption (no behavior change)

- [ ] Add a comment in `bytearray.parse` at the pin read: `// pin is 0–7 (3 bits) but the app is 7-hole; pin 7 → currentPos 8 → validatePlates rejects (deliberate).` No test/logic change (already returns null via validatePlates). Fold into the M-series commit or its own trivial doc commit.

### Task 1.5 — Merge Phase 1

- [ ] Full suite green → finish the branch (merge + push per finishing-a-development-branch). This closes the parser feature.

---

## PHASE 2 — Code reorganization (new branch)

Pure text motion in `index.html` (no build graph); tests hit globals by name and are block-insensitive, so risk is low. Do NOT change behavior.

### Target block layout (semantic `id` on each `<script>`)

Replace `<!-- Script #N -->` comments + `// ── Script #N ── ` banners with `<script id="…">` + a `// ── <id> — <purpose> ── ` banner. Proposed blocks, in load order:

| `id` | Contents (moved from) |
|---|---|
| `core-solver` | BFS core (was #0, `solver-src`) — unchanged, still worker-shared |
| `i18n` | `TRANSLATIONS`, `t`, `setLanguage` (from #1) |
| `state` | px constants, `makePlate`, `state` (from #1) |
| `game-logic` | `applyMove`, `getBlockingPlateId`, `addExploreMove`, `returnToSolution` (from #2/#6) |
| `render-3d` | `buildScene`, `updateScene`, geometry (was #4) |
| `render-matrix` | `renderMatrix` + **moved** `depCellTitle`/`depDirIcon`/`depCellHTML` (out of #2) |
| `parsers` | `validatePlates`, `json`/`gothic`/`dotted`/`bytearray`, `PARSERS`, `parseConfig`, `entryToPlates`, `applyEntry`, `applyPlates` (**extracted from #5**) |
| `ui-utils` | `showToast`, `copyToClipboard` (hoisted from #5; used by solve/worker/db too) |
| `config-ui` | poslock render/edit, matrix cycling, export handler, import dialog, paste/copy listeners (rest of #5) |
| `solve-ui` | solve panel (was #6) |
| `keyboard` | `KEY_MAP`, keydown (was #7) |
| `worker` | worker entry (`worker-src`) — unchanged |
| `worker-host` | `createWorker`, solve messaging, overlay, **+ moved** random-pool trigger to sit with `createRandomPool`/`onRandomPoolMessage` (was #9 + trigger from #5) |
| `db-search` | DB load/search + live hints (was #10) |
| `init` | bootstrap (was #8) |

- [ ] Move blocks/functions per the table; keep every function's **name and global visibility** (tests depend on names, not location). Verify with `grep -n "Script #" index.html` returns nothing afterward and `grep -n 'script id=' index.html` lists the new ids.
- [ ] **Dedup `parseRuleGroups` → `gothic.parseRules`** (org #2): rewrite `parseRuleGroups` (db-search block) as a thin adapter over `gothic.parseRules` (`Object.entries` preserves insertion order for the `{from, tokens:[{to,dir}]}` shape `renderRulesLine` needs). One rule-regex in index.html instead of two.
- [ ] **Drop the `parseImportConfig` alias** (org #9): rename the registry function everywhere to `parseConfig`; update the remaining index.html caller (`applyImportedConfig`) and the test call sites (`import.spec.js`, `solver.spec.js`, `reference-configs.spec.js`) from `parseImportConfig` → `parseConfig`.
- [ ] Add a forward-ref comment at any cross-block call that now spans blocks (mirroring the existing `// Defined later (…)` convention).
- [ ] Run the full suite after each move batch; commit in small, behavior-preserving steps.

### CLAUDE.md note (in Phase 4, but decided here)
Blocks are now `<script id="…">`; agents pull a block with `grep -n 'id="<name>"' index.html`.

---

## PHASE 3 — Test consolidation (with Phase 2)

- [ ] Move the validation-invariant tests out of `import.spec.js` (the ~13 "…is rejected" JSON-via-dialog tests that duplicate `describe('validatePlates')` in `config-parsers.spec.js`). Keep in `import.spec.js` only genuinely UI-level cases: dialog open/apply/toast, Escape-cancel, clipboard-permission flow, and the format-applies-via-dialog tests. Invariants live once, in `config-parsers.spec.js`, asserted directly on `validatePlates`.
- [ ] Full suite green.

---

## PHASE 4 — Documentation (new branch, last)

Apply against final code. Concrete edits (from the doc review):

- [ ] **README.md** — (a) solve-nav buttons: replace `← Шаг`/`Шаг →` with `‹ Шаг`/`Шаг ›` (chevrons) or drop the glyphs. (b) matrix narrow view: "иконка направления (стрелки в одну сторону = прямо, врозь = обратно), цвет наследует ячейку" — not "однобуквенное сокращение". (c) add step-card description (`Элемент N · [значок] Вправо ×4 · 4D4`, зелёный=вправо/красный=влево). (d) restructure "Форматы конфигурации" into per-format subsections `json`/`gothic`/`dotted`/`bytearray`; note paste auto-detects all four via `parseConfig`, export stays gothic+JSON. (e) first mention of "gothic": add the clause "условное название нотации, **не** формат игры/экспорта; из Gothic 1 Remake пришли только данные БД". (f) fix migration count `508 → 394` (verify actual `chests.json` entry count first).
- [ ] **CLAUDE.md** — add: parser-registry convention (self-contained `{id, parse→plates|null, serialize→string|null}` units, null-never-throw, add formats to `PARSERS`); the app never parses `chests.ini` (INI = DB pipeline only); blocks now carry semantic `<script id="…">` (grep to pull one).
- [ ] **CHANGELOG.md** — add `## [Unreleased]` with the July-17 UI batch (cards, 3D highlight-follow, matrix direction icons, «Элемент» term, chevron buttons) **and** the parser feature (json/gothic/dotted/bytearray import; unlockmyloot v2 codes import directly).
- [ ] **docs/superpowers/** — one-line header/README noting specs & plans are point-in-time records; source of truth is README/CLAUDE + code.

---

## Open items already tracked elsewhere
- #8 URL-persist and #11 Share now have their codecs ready (`dotted`/`bytearray` serialize/parse).

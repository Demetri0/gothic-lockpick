# Solution Step Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each solution-step `<li>` in the solve panel from a bare chess-notation string (`2D3`) into a human-readable card — `Плашка 2 · [‹/› direction ×N] · [notation]` — and make the 3D scene highlight the plate that each played step moves.

**Architecture:** Introduce one shared DOM builder `buildStepLi(move, opts)` (plus a tiny `stepDirIcon(dir)` helper) used by both render paths in `renderSolvePanel` (following + exploring). Endpoints ("Начало/Конец") and the top notation chain (`#solution-string`) are unchanged. Playback functions (`solveStepForward`, `jumpToStep`) set `state.activePlate` to the just-moved plate so the existing `.active` 3D highlight follows the walkthrough and free-solo detach starts on the right plate.

**Tech Stack:** Single-file `index.html`, no build. Playwright tests in `tests/*.spec.js`. Selectors via `data-test-id` only. New user-visible strings localized to ru/en/uk in `TRANSLATIONS`.

## Global Constraints

- All app code lives in `index.html`; solution rendering is in Script #7 area (`renderSolvePanel`, ~line 2554) and playback (`jumpToStep` ~2663, `solveStepForward` ~2681).
- Never mutate `plate.currentPos` directly in a handler; playback already routes through `applyMove` — do not change that.
- Any new user-visible text goes into all three locales (ru/en/uk) via `t('key')`; locale-independent symbols (`×`, `‹`, `›` SVG chevrons) need no key.
- Tests: English descriptions/comments; `data-test-id` selectors only; `{ force: true }` for clicks inside the 3D scene.
- Direction mapping is fixed by the solver: `A = left`, `D = right`. Color: **right (D) → green**, **left (A) → red** (reuse the matrix hues `#78b078`/`#456845`/`#1c2e1e` green and `#b07878`/`#684545`/`#2e1c1c` red).
- **Non-goal this pass:** mobile/responsive hiding of card columns. Build desktop-first; if columns overflow narrow panels we handle it in a later pass. Do not add breakpoints now.

## File Structure

- `index.html` — Modify: add 3 i18n keys per locale (~1420–1530); add CSS for `.step-card`/`.step-plate`/`.step-dir`/`.step-notation` after line 604; add `stepDirIcon` + `buildStepLi` helpers near `toNotation` (~1161) or just above `renderSolvePanel`; rewire the three `li` construction sites in `renderSolvePanel`; add `state.activePlate` follow in `solveStepForward` and `jumpToStep`.
- `tests/solution-cards.spec.js` — Create: card structure, direction color token, localization, and 3D-follow tests.

---

### Task 1: Card builder + following-mode render + i18n + CSS

**Files:**
- Modify: `index.html` (i18n ~1429/1474/1519; CSS after ~604; helpers near ~1161; following-mode loop ~2641-2648)
- Test: `tests/solution-cards.spec.js` (create)

**Interfaces:**
- Consumes: globals `t(key)`, `toNotation(plateId, dir, steps)`, `parseNotation(str)` (Script #0).
- Produces:
  - `stepDirIcon(dir: 'left'|'right') => string` (inline SVG chevron markup).
  - `buildStepLi(move: {plateId:number, dir:'left'|'right', steps:number}, opts: {testId:string, active?:boolean, opacity?:number, onClick?:Function}) => HTMLLIElement` — an `<li class="step-card">` with children `.step-plate`, `.step-dir[data-dir]`, `.step-notation`.

- [ ] **Step 1: Write the failing test**

Create `tests/solution-cards.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { startSolve } from './helpers.js';

// Deterministic reference lock: solution[0] === '4D4' (plate 4, right, ×4).
const CONFIG = '3055665 A:C+,D+;B:A-,E-,G+;D:B-;E:D-;F:B-;G:A+,B-';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test.describe('solution step cards (following mode)', () => {
  test('a step renders as a card: plate label, colored direction pill, notation', async ({ page }) => {
    await startSolve(page, CONFIG);
    const card = page.getByTestId('step-1');
    // Human-readable plate label (localized ru default)
    await expect(card.locator('.step-plate')).toHaveText('Плашка 4');
    // Direction pill: right → data-dir=right, contains localized word + ×N
    const dir = card.locator('.step-dir');
    await expect(dir).toHaveAttribute('data-dir', 'right');
    await expect(dir).toContainText('Вправо');
    await expect(dir).toContainText('×4');
    await expect(dir.locator('svg')).toHaveCount(1);
    // Notation badge keeps the chess code
    await expect(card.locator('.step-notation')).toHaveText('4D4');
  });

  test('a left-move step gets the red direction token', async ({ page }) => {
    await startSolve(page, CONFIG);
    // solution === ['4D4','5D3','2D3','1D4','3A2','5D3','6D3','7A'] → step 5 is '3A2'
    const dir = page.getByTestId('step-5').locator('.step-dir');
    await expect(dir).toHaveAttribute('data-dir', 'left');
    await expect(dir).toContainText('Влево');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test solution-cards --project=chromium`
Expected: FAIL — `.step-plate` locator resolves to 0 elements (step `<li>` currently holds bare text `4D4`).

- [ ] **Step 3: Add i18n keys**

In the `ru` block (after line 1429, near `'step-start'`):

```js
    'plate': 'Плашка',            'dir-left': 'Влево',       'dir-right': 'Вправо',
```

In the `en` block (near line 1474):

```js
    'plate': 'Plate',            'dir-left': 'Left',        'dir-right': 'Right',
```

In the `uk` block (near line 1519):

```js
    'plate': 'Плашка',            'dir-left': 'Ліворуч',     'dir-right': 'Праворуч',
```

- [ ] **Step 4: Add CSS**

After line 604 (`.solution-list li.endpoint.active { ... }`):

```css
.solution-list li.step-card { display: flex; align-items: center; gap: 8px; }
.step-plate { min-width: 5.2em; color: var(--text); }
.step-dir {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border: 1px solid; border-radius: 10px;
  font-size: 0.92em; white-space: nowrap;
}
.step-dir svg { display: block; }
.step-dir[data-dir="right"] { color: #78b078; border-color: #456845; background: #1c2e1e; }
.step-dir[data-dir="left"]  { color: #b07878; border-color: #684545; background: #2e1c1c; }
.step-notation {
  margin-left: auto;
  font-family: 'Courier New', monospace; font-size: 0.92em;
  color: var(--text-soft); background: var(--bg-inset);
  border: 1px solid var(--border-control); border-radius: 3px; padding: 1px 6px;
}
```

- [ ] **Step 5: Add the `stepDirIcon` + `buildStepLi` helpers**

Immediately above `function renderSolvePanel` (search for it; it owns `#solution-steps`). Insert:

```js
function stepDirIcon(dir) {
  const path = dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6';
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" `
       + `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
       + `<path d="${path}"></path></svg>`;
}

/** Build one solution-step <li> card from a move object. */
function buildStepLi(move, opts = {}) {
  const { plateId, dir, steps } = move;
  const li = document.createElement('li');
  li.className = 'step-card';
  li.dataset.testId = opts.testId;
  if (opts.active) li.classList.add('active');
  if (opts.opacity != null) li.style.opacity = String(opts.opacity);
  const dirKey = dir === 'left' ? 'dir-left' : 'dir-right';
  li.innerHTML =
    `<span class="step-plate">${t('plate')} ${plateId}</span>`
  + `<span class="step-dir" data-dir="${dir}">${stepDirIcon(dir)}`
  +   `<span>${t(dirKey)}</span> ×${steps}</span>`
  + `<span class="step-notation">${toNotation(plateId, dir, steps)}</span>`;
  if (opts.onClick) li.addEventListener('click', opts.onClick);
  return li;
}
```

- [ ] **Step 6: Rewire the following-mode step loop**

Replace the following-mode loop (currently ~2641-2648):

```js
    state.solution.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = s;
      li.dataset.testId = `step-${i + 1}`;
      if (i + 1 === state.solverStep) li.classList.add('active');
      li.addEventListener('click', () => jumpToStep(i + 1));
      list.appendChild(li);
    });
```

with:

```js
    state.solution.forEach((s, i) => {
      list.appendChild(buildStepLi(parseNotation(s), {
        testId: `step-${i + 1}`,
        active: i + 1 === state.solverStep,
        onClick: () => jumpToStep(i + 1),
      }));
    });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx playwright test solution-cards --project=chromium`
Expected: PASS (both tests).

Run the full regression touched by this change:
`npx playwright test reference-configs solve-flow keyboard --project=chromium`
Expected: PASS — the `step-N` `toContainText('4D4')` assertions still hold because `.step-notation` contains the code.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/solution-cards.spec.js
git commit -m "feat: render solution steps as human-readable cards (following mode)"
```

---

### Task 2: Apply cards to exploring mode

**Files:**
- Modify: `index.html` — exploring-mode "done steps" loop (~2584-2591) and "explore history" loop (~2602-2608) in `renderSolvePanel`.
- Test: `tests/solution-cards.spec.js` (append)

**Interfaces:**
- Consumes: `buildStepLi`, `parseNotation` (Task 1); `state.exploreHistory` entries are already `{plateId, dir, steps}` objects; `state.detachStep`, `state.solution`.

- [ ] **Step 1: Write the failing test**

Append to `tests/solution-cards.spec.js`:

```js
test.describe('solution step cards (exploring mode)', () => {
  const SIMPLE = JSON.stringify([
    { positions: [0, 1, 2], currentPos: 0, deps: [] },
    { positions: [0, 1, 2], currentPos: 0, deps: [] },
  ]);

  test('a free-solo move renders as a direction-pill card', async ({ page }) => {
    await startSolve(page, SIMPLE);
    await page.keyboard.press('d'); // enter explore, move active plate right
    const dir = page.getByTestId('explore-step-1').locator('.step-dir');
    await expect(dir).toHaveAttribute('data-dir', 'right');
    await expect(dir).toContainText('Вправо');
  });

  test('a completed BFS step in explore view is also a card', async ({ page }) => {
    await startSolve(page, SIMPLE);
    await page.getByTestId('btn-step').click(); // advance one BFS step
    await page.keyboard.press('d');             // detach into explore
    await expect(page.getByTestId('step-done-1').locator('.step-notation')).toHaveCount(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test solution-cards --project=chromium -g "exploring mode"`
Expected: FAIL — `explore-step-1`/`step-done-1` still hold bare text, `.step-dir`/`.step-notation` resolve to 0.

- [ ] **Step 3: Rewire the "done steps" loop**

Replace (currently ~2584-2591):

```js
    for (let i = 0; i < state.detachStep; i++) {
      const li = document.createElement('li');
      li.textContent = state.solution[i];
      li.style.opacity = '0.35';
      li.dataset.testId = `step-done-${i + 1}`;
      li.addEventListener('click', () => returnToSolution(i + 1));
      list.appendChild(li);
    }
```

with:

```js
    for (let i = 0; i < state.detachStep; i++) {
      list.appendChild(buildStepLi(parseNotation(state.solution[i]), {
        testId: `step-done-${i + 1}`,
        opacity: 0.35,
        onClick: () => returnToSolution(i + 1),
      }));
    }
```

- [ ] **Step 4: Rewire the "explore history" loop**

Replace (currently ~2602-2608):

```js
    state.exploreHistory.forEach((m, i) => {
      const li = document.createElement('li');
      li.textContent = toNotation(m.plateId, m.dir, m.steps);
      li.dataset.testId = `explore-step-${i + 1}`;
      if (i === state.exploreHistory.length - 1) li.classList.add('active');
      list.appendChild(li);
    });
```

with:

```js
    state.exploreHistory.forEach((m, i) => {
      list.appendChild(buildStepLi(m, {
        testId: `explore-step-${i + 1}`,
        active: i === state.exploreHistory.length - 1,
      }));
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test solution-cards keyboard --project=chromium`
Expected: PASS — including the existing `keyboard.spec.js` explore tests (`toContainText('2')`/`('3')` still match the plate label / ×N inside the card).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/solution-cards.spec.js
git commit -m "feat: render explore-mode steps as cards too via shared builder"
```

---

### Task 3: 3D scene highlights the played plate

**Files:**
- Modify: `index.html` — `solveStepForward` (~2681-2688) and `jumpToStep` (~2663-2678).
- Test: `tests/solution-cards.spec.js` (append)

**Interfaces:**
- Consumes: `parseNotation`, `state.solution`, `state.solverStep`, `state.activePlate`, `updateScene`.
- Behavior: after any playback movement, `state.activePlate` equals the plate id of the most recently applied step; at step 0 it is left unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/solution-cards.spec.js`:

```js
test.describe('3D highlight follows playback', () => {
  const CONFIG = '3055665 A:C+,D+;B:A-,E-,G+;D:B-;E:D-;F:B-;G:A+,B-';

  test('stepping forward makes the moved plate the active one in the scene', async ({ page }) => {
    await startSolve(page, CONFIG);
    await page.getByTestId('btn-step').click(); // plays solution[0] === '4D4' → plate 4
    const active = await page.evaluate(() => state.activePlate);
    expect(active).toBe(4);
    await expect(page.locator('#scene-solve-inner .plate[data-id="4"]')).toHaveClass(/active/);
  });

  test('jumping to a later step highlights that step\'s plate', async ({ page }) => {
    await startSolve(page, CONFIG);
    await page.getByTestId('step-5').click(); // solution[4] === '3A2' → plate 3
    const active = await page.evaluate(() => state.activePlate);
    expect(active).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test solution-cards --project=chromium -g "follows playback"`
Expected: FAIL — `state.activePlate` stays at its config value (1), not 4/3.

- [ ] **Step 3: Set active plate in `solveStepForward`**

In `solveStepForward`, after `state.solverStep++;` and before `updateScene(...)`:

```js
  state.activePlate = parseNotation(state.solution[state.solverStep - 1]).plateId;
```

- [ ] **Step 4: Set active plate in `jumpToStep`**

In `jumpToStep`, after the replay `for` loop and before `buildScene(...)`:

```js
  if (targetStep > 0) state.activePlate = parseNotation(state.solution[targetStep - 1]).plateId;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test solution-cards --project=chromium`
Expected: PASS (all describes).

Run regression: `npx playwright test keyboard solve-flow reference-configs --project=chromium`
Expected: PASS — `W switches the active plate` still holds (no step is played before W there, so playback never overrides the manual selection).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/solution-cards.spec.js
git commit -m "feat: 3D scene highlights the plate each played step moves"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npx playwright test`
Expected: PASS — all suites green, no regressions.

- [ ] **Step 2: Visual sanity check on the real DB**

Manually (or via the run skill) open the solve stage for the reference config, confirm the cards read `Плашка N · [chevron dir ×N] · [notation]`, the active step highlights, direction pills are green (right) / red (left), and the played plate glows in 3D. Note: mobile layout is out of scope this pass.

- [ ] **Step 3: Commit any doc/CHANGELOG touch-ups if the project convention requires them** (optional; skip if none).
```

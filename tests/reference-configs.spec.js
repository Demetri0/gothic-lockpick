import { test, expect } from '@playwright/test';
import { expectPosDigit, startSolve } from './helpers.js';

// Reference configs taken from the real game — each describe pins one known
// lock end-to-end: gothic-string parsing → dependency matrix → start positions
// → the exact solver output. These are characterization tests: bfsSolve is
// deterministic, so the full move sequence is stable and any change to solver
// iteration order or parsing will show up here.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Import a gothic-format config through the real import dialog. */
async function importConfig(page, cfg) {
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();
}

/** Assert every off-diagonal dep cell matches the expected {from: {to: dir}} map. */
async function expectMatrix(page, plateCount, deps) {
  for (let from = 1; from <= plateCount; from++) {
    for (let to = 1; to <= plateCount; to++) {
      if (from === to) continue;
      const expected = deps[from]?.[to] ?? 'none';
      await expect(page.getByTestId(`dep-${from}-${to}`),
        `dep ${from}→${to}`).toHaveAttribute('data-state', expected);
    }
  }
}

test.describe('reference: 3055665 A:C+,D+;B:A-,E-,G+;D:B-;E:D-;F:B-;G:A+,B-', () => {
  const CONFIG = '3055665 A:C+,D+;B:A-,E-,G+;D:B-;E:D-;F:B-;G:A+,B-';
  // A known-valid 23-keypress solution for this lock (game-verified reference
  // data) — used to cross-check the engine physics, not tied to solver output.
  const KNOWN_SOLUTION = [
    '1D3', '3A2', '4D2', '5D', '2D', '1D', '5D', '2D',
    '4D', '5D', '2D', '4D', '5D3', '6D3', '7A',
  ];

  test('parses into the expected dependency matrix', async ({ page }) => {
    await importConfig(page, CONFIG);
    await expectMatrix(page, 7, {
      1: { 3: 'same', 4: 'same' },
      2: { 1: 'opposite', 5: 'opposite', 7: 'same' },
      4: { 2: 'opposite' },
      5: { 4: 'opposite' },
      6: { 2: 'opposite' },
      7: { 1: 'same', 2: 'opposite' },
    });
  });

  test('sets the expected start positions', async ({ page }) => {
    await importConfig(page, CONFIG);
    // start_pos "3055665" is 0-based → display digits are +1
    const digits = [4, 1, 6, 6, 7, 7, 6];
    for (let i = 0; i < digits.length; i++) {
      await expectPosDigit(page, i + 1, digits[i]);
    }
    await expect(page.getByTestId('pos-input-8')).toHaveCount(0); // exactly 7 plates
  });

  test('the known solution replays to all-centered without blocking', async ({ page }) => {
    // Validates the reference data itself, independent of the solver
    const result = await page.evaluate(({ cfg, steps }) => {
      const plates = parseImportConfig(cfg);
      for (const step of steps) {
        const { plateId, dir, steps: n } = parseNotation(step);
        for (let i = 0; i < n; i++) {
          if (!applyMove(plates, plateId, dir)) return { blocked: step };
        }
      }
      return { final: plates.map(p => p.currentPos) };
    }, { cfg: CONFIG, steps: KNOWN_SOLUTION });

    expect(result.blocked).toBeUndefined();
    expect(result.final).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  test('the solve stage shows the group-optimized sequence step by step', async ({ page }) => {
    // The SOLVE path uses the grouped solver: same minimal 23 keypresses as the
    // plain-BFS sequence above, but packed into the optimal 8 groups.
    await startSolve(page, CONFIG);
    const shown = await page.evaluate(() => state.solution);
    const raw = await page.evaluate(() => state.solution.reduce((a, s) => a + parseNotation(s).steps, 0));
    expect(raw).toBe(23);
    expect(shown.length).toBe(8);
    // Characterization: the solver is deterministic, so pin the exact sequence
    expect(shown).toEqual(['4D4', '5D3', '2D3', '1D4', '3A2', '5D3', '6D3', '7A']);
    // Each solution entry is rendered as its own step row, in order
    for (let i = 0; i < shown.length; i++) {
      await expect(page.getByTestId(`step-${i + 1}`)).toContainText(shown[i]);
    }
    await expect(page.getByTestId(`step-${shown.length + 1}`)).toHaveCount(0);
  });
});

test.describe('reference: 040615 A:C-;B:C+,D-;D:E-,C+;E:F-;F:E+,B- (unlockmyloot.com)', () => {
  const CONFIG = '040615 A:C-;B:C+,D-;D:E-,C+;E:F-;F:E+,B-';
  // The sequence unlockmyloot.com shows for this lock (11 groups, 41 keypresses),
  // translated to our notation: their ВЛЕВО maps to A, ВПРАВО to D.
  const SITE_SOLUTION = ['3A5', '4D5', '3A6', '2D3', '6D4', '5D2', '4D3', '3A6', '2D2', '3A2', '1A3'];

  test('parses into the expected dependency matrix', async ({ page }) => {
    await importConfig(page, CONFIG);
    await expectMatrix(page, 6, {
      1: { 3: 'opposite' },
      2: { 3: 'same', 4: 'opposite' },
      4: { 5: 'opposite', 3: 'same' },
      5: { 6: 'opposite' },
      6: { 5: 'same', 2: 'opposite' },
    });
  });

  test('sets the expected start positions', async ({ page }) => {
    await importConfig(page, CONFIG);
    const digits = [1, 5, 1, 7, 2, 6]; // "040615" is 0-based
    for (let i = 0; i < digits.length; i++) {
      await expectPosDigit(page, i + 1, digits[i]);
    }
    await expect(page.getByTestId('pos-input-7')).toHaveCount(0);
  });

  test("the site's published solution replays to all-centered in our engine", async ({ page }) => {
    // Independent cross-validation: two solvers agree on the physics of this lock
    const result = await page.evaluate(({ cfg, steps }) => {
      const plates = parseImportConfig(cfg);
      for (const step of steps) {
        const { plateId, dir, steps: n } = parseNotation(step);
        for (let i = 0; i < n; i++) {
          if (!applyMove(plates, plateId, dir)) return { blocked: step };
        }
      }
      return { final: plates.map(p => p.currentPos) };
    }, { cfg: CONFIG, steps: SITE_SOLUTION });
    expect(result.blocked).toBeUndefined();
    expect(result.final).toEqual([4, 4, 4, 4, 4, 4]);
  });

  test('our grouped solver matches the site: 41 keypresses in 11 groups', async ({ page }) => {
    const res = await page.evaluate((cfg) => {
      const sol = bfsSolveGrouped(parseImportConfig(cfg)).solution;
      return { sol, groups: sol.length, raw: sol.reduce((a, s) => a + parseNotation(s).steps, 0) };
    }, CONFIG);
    expect(res.raw).toBe(41);
    expect(res.groups).toBe(11); // same optimum the site's exact solver reports
    // Characterization: a different but equally-optimal sequence than the site's
    expect(res.sol).toEqual(['3A3', '1A3', '3A6', '6D', '4D6', '3A6', '2D5', '3A4', '5D2', '4D2', '6D3']);
  });
});

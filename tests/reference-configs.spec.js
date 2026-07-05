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
  const EXPECTED_SOLUTION = [
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

  test('the expected sequence replays to all-centered without blocking', async ({ page }) => {
    // Validates the reference solution itself, independent of the solver
    const result = await page.evaluate(({ cfg, steps }) => {
      const plates = parseImportConfig(cfg);
      for (const step of steps) {
        const { plateId, dir, steps: n } = parseNotation(step);
        for (let i = 0; i < n; i++) {
          if (!applyMove(plates, plateId, dir)) return { blocked: step };
        }
      }
      return { final: plates.map(p => p.currentPos) };
    }, { cfg: CONFIG, steps: EXPECTED_SOLUTION });

    expect(result.blocked).toBeUndefined();
    expect(result.final).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  test('bfsSolve produces exactly the expected move sequence', async ({ page }) => {
    const solution = await page.evaluate((cfg) => bfsSolve(parseImportConfig(cfg)).solution, CONFIG);
    expect(solution).toEqual(EXPECTED_SOLUTION);
  });

  test('the solve stage shows the expected sequence step by step', async ({ page }) => {
    await startSolve(page, CONFIG);
    const shown = await page.evaluate(() => state.solution);
    expect(shown).toEqual(EXPECTED_SOLUTION);
    // Each solution entry is rendered as its own step row, in order
    for (let i = 0; i < EXPECTED_SOLUTION.length; i++) {
      await expect(page.getByTestId(`step-${i + 1}`)).toContainText(EXPECTED_SOLUTION[i]);
    }
    await expect(page.getByTestId(`step-${EXPECTED_SOLUTION.length + 1}`)).toHaveCount(0);
  });
});

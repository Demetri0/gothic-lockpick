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

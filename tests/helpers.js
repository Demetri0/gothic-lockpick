import { expect } from '@playwright/test';

// The position lock renders one input per plate (data-test-id="pos-input-<id>"),
// plus edge ghost controls (poslock-ghost-del / poslock-ghost-add).

/** Current value of plate `i` (1-based) as a string digit. */
export async function posDigit(page, i) {
  return page.getByTestId(`pos-input-${i}`).inputValue();
}

/** Assert plate `i` (1-based) shows `val`. */
export async function expectPosDigit(page, i, val) {
  await expect(page.getByTestId(`pos-input-${i}`)).toHaveValue(String(val));
}

/** Assert plate `i` (1-based) is the active (framed) plate. */
export async function expectActivePlate(page, i) {
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', String(i));
}

/** Import `cfg`, run SOLVE, and wait for the solve stage. */
export async function startSolve(page, cfg) {
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
}

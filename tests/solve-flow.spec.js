import { test, expect } from '@playwright/test';
import { startSolve, expectActivePlate } from './helpers.js';

const SIMPLE_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 6, deps: [] },
  { id: 2, positions: 7, currentPos: 6, deps: [] },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('page loads in config stage', async ({ page }) => {
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

test('BFS finds a solution and solve stage opens', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();

  // Don't assert the overlay's transient "active" state — for a simple 2-plate config
  // the solve can finish (and remove the class) faster than this can reliably catch it.
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('stage-config')).toBeHidden();
});

test('step forward and backward through the solution', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await expect(page.getByTestId('step-start')).toHaveClass(/active/);

  await page.getByTestId('btn-step').click();
  await expect(page.getByTestId('step-1')).toHaveClass(/active/);

  await page.getByTestId('btn-prev').click();
  await expect(page.getByTestId('step-start')).toHaveClass(/active/);
});

test('clicking a step in the list jumps to it', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
});

test('the ← Step button is disabled at the start, enabled after stepping forward', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await expect(page.getByTestId('step-start')).toHaveClass(/active/);
  await expect(page.getByTestId('btn-prev')).toBeDisabled();   // nothing before the start
  await page.getByTestId('btn-step').click();
  await expect(page.getByTestId('btn-prev')).toBeEnabled();
});

test('the Step → / Auto buttons are disabled at the end', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
  await expect(page.getByTestId('btn-step')).toBeDisabled();   // nothing after the end
  await expect(page.getByTestId('btn-auto')).toBeDisabled();
});

test('"End" is highlighted on the last step', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Jump to end via click
  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
  await expect(page.getByTestId('step-start')).not.toHaveClass(/active/);
});

test('auto-play toggles the button to Stop and back', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Assert the actual play state rather than the localized button label, which
  // would re-encode a display string and break on any translation rewording.
  await page.getByTestId('btn-auto').click();
  expect(await page.evaluate(() => state.autoInterval !== null)).toBe(true);

  await page.getByTestId('btn-auto').click();
  expect(await page.evaluate(() => state.autoInterval !== null)).toBe(false);
});

test('returning to config repaints the active-plate highlight', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('pos-input-2').click();   // make plate 2 the active plate on config
  await expectActivePlate(page, 2);

  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('btn-back').click();

  // switchToConfig resets activePlate to 1 — the poslock highlight must follow
  await expectActivePlate(page, 1);
});

test('Back button returns to config stage', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-back').click();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

test('Solve reuses the cached solution when config is unchanged', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Return to config
  await page.getByTestId('btn-back').click();

  // Press Solve again — overlay must not appear (cache hit)
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/);
  await expect(page.getByTestId('stage-solve')).toBeVisible();
});

// ── Notation help dialog ──────────────────────────────────────────────────────

test('? button opens the notation help dialog', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-notation-help').click();
  await expect(page.getByTestId('notation-dialog')).toBeVisible();
});

test('notation dialog close button dismisses it', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-notation-help').click();
  await expect(page.getByTestId('notation-dialog')).toBeVisible();

  await page.getByTestId('btn-notation-close').click();
  await expect(page.getByTestId('notation-dialog')).toBeHidden();
});

test('notation dialog body contains content after opening', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-notation-help').click();
  const body = page.getByTestId('notation-dialog-body');
  await expect(body).not.toBeEmpty();
});

// ── Copy solution button ──────────────────────────────────────────────────────

test('copy button shows a success toast', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
  });
  await page.goto('/');
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-copy-solution').click();
  // The copy toast is the newest one (the setup's "applied" toast may still linger)
  await expect(page.locator('[data-test-id="toast"][data-test-type="success"]').last()).toBeVisible();
});

test('copy solution shows an error toast when clipboard is unavailable', async ({ page }) => {
  // Older/insecure contexts have no navigator.clipboard; writeText would throw
  // synchronously, bypassing the .catch. The copy must fail gracefully with a toast.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-copy-solution').click();
  await expect(page.locator('[data-test-id="toast"][data-test-type="error"]')).toBeVisible();
});

test('copy button writes solution steps joined with ➝ separator', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__copiedText = text; return Promise.resolve(); } },
      configurable: true,
    });
  });
  await page.goto('/');
  await startSolve(page, SIMPLE_CONFIG);

  await page.getByTestId('btn-copy-solution').click();
  const copied = await page.evaluate(() => window.__copiedText);
  expect(copied).toBeTruthy();
  // Multi-step solutions use ➝ as separator; single-step has no separator but is still a string
  const steps = copied.split(' ➝ ');
  expect(steps.length).toBeGreaterThanOrEqual(1);
  expect(steps.every(s => /^\d+[AD]\d*$/.test(s))).toBe(true);
});

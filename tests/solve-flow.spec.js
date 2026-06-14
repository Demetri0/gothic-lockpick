import { test, expect } from '@playwright/test';

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

  await expect(page.getByTestId('overlay')).toHaveClass(/active/);
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('stage-config')).toBeHidden();
});

test('step forward and backward through the solution', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await expect(page.getByTestId('step-start')).toHaveClass(/active/);

  await page.getByTestId('btn-step').click();
  await expect(page.getByTestId('step-1')).toHaveClass(/active/);

  await page.getByTestId('btn-prev').click();
  await expect(page.getByTestId('step-start')).toHaveClass(/active/);
});

test('clicking a step in the list jumps to it', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
});

test('"End" is highlighted on the last step', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  // Jump to end via click
  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
  await expect(page.getByTestId('step-start')).not.toHaveClass(/active/);
});

test('auto-play toggles the button to Stop and back', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('btn-auto').click();
  await expect(page.getByTestId('btn-auto')).toContainText('Стоп');

  await page.getByTestId('btn-auto').click();
  await expect(page.getByTestId('btn-auto')).toContainText('Авто');
});

test('Back button returns to config stage', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('btn-back').click();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

test('Solve reuses the cached solution when config is unchanged', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  // Return to config
  await page.getByTestId('btn-back').click();

  // Press Solve again — overlay must not appear (cache hit)
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/);
  await expect(page.getByTestId('stage-solve')).toBeVisible();
});

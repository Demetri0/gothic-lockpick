import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const VALID_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 5, deps: [] },
]);

test('valid config is applied', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), VALID_CONFIG);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('2');
});

test('invalid JSON is rejected', async ({ page }) => {
  await page.evaluate(() => openImportDialog('{broken json'));
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('ids not starting from 1 are rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 2, positions: 7, currentPos: 3, deps: [] },
    { id: 3, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('self-dependency in deps is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 1, direction: 'same', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('invalid direction in dep is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'sideways', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('different positions across plates are rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [] },
    { id: 2, positions: 5, currentPos: 3, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('currentPos out of range is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 0, deps: [] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('even positions count is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 4, currentPos: 2, deps: [] },
    { id: 2, positions: 4, currentPos: 2, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('Escape closes the dialog without applying config', async ({ page }) => {
  const platesBefore = await page.getByTestId('val-plates').textContent();

  await page.evaluate(() => openImportDialog('[{"id":1,"positions":7,"currentPos":3,"deps":[]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'));
  await expect(page.getByTestId('import-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  await expect(page.getByTestId('val-plates')).toHaveText(platesBefore);
});

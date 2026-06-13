import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const VALID_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 5, deps: [] },
]);

test('валидный конфиг применяется, показывается тост «Конфиг применён»', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), VALID_CONFIG);
  await page.locator('#import-dialog-ok').click();

  await expect(page.locator('.toast')).toContainText('Конфиг применён');
  // Количество плашек обновилось
  await expect(page.locator('#val-plates')).toHaveText('2');
});

test('невалидный JSON отклоняется', async ({ page }) => {
  await page.evaluate(() => openImportDialog('{broken json'));
  await page.locator('#import-dialog-ok').click();

  await expect(page.locator('.toast-error')).toContainText('Невалидный конфиг');
});

test('id не с 1 — отклоняется', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 2, positions: 7, currentPos: 3, deps: [] },
    { id: 3, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.locator('#import-dialog-ok').click();

  await expect(page.locator('.toast-error')).toContainText('Невалидный конфиг');
});

test('самозависимость в deps — отклоняется', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 1, direction: 'same', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.locator('#import-dialog-ok').click();

  await expect(page.locator('.toast-error')).toContainText('Невалидный конфиг');
});

test('невалидный direction в dep — отклоняется', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'sideways', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.locator('#import-dialog-ok').click();

  await expect(page.locator('.toast-error')).toContainText('Невалидный конфиг');
});

test('разные positions у плашек — отклоняется', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [] },
    { id: 2, positions: 5, currentPos: 3, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.locator('#import-dialog-ok').click();

  await expect(page.locator('.toast-error')).toContainText('Невалидный конфиг');
});

test('Escape закрывает диалог без применения конфига', async ({ page }) => {
  // Запоминаем текущее количество плашек
  const platesBefore = await page.locator('#val-plates').textContent();

  await page.evaluate(() => openImportDialog('[{"id":1,"positions":7,"currentPos":3,"deps":[]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'));
  await expect(page.locator('#import-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#import-dialog')).toBeHidden();

  // Конфиг не изменился
  await expect(page.locator('#val-plates')).toHaveText(platesBefore);
});

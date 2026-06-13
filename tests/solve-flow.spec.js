import { test, expect } from '@playwright/test';

// Простая конфигурация: 2 плашки без зависимостей, обе на позиции 3 (центр = 4).
// Решение: 1D 2D (каждая плашка одним ходом вправо в центр).
const SIMPLE_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 3, deps: [] },
  { id: 2, positions: 7, currentPos: 3, deps: [] },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('страница загружается в режиме настроек', async ({ page }) => {
  await expect(page.locator('#stage-config')).toBeVisible();
  await expect(page.locator('#stage-solve')).toBeHidden();
});

test('импорт конфига, BFS находит решение, открывается экран решения', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.locator('#import-dialog-ok').click();
  await page.locator('#btn-start').click();

  // Оверлей появляется
  await expect(page.locator('#computing-overlay')).toHaveClass(/active/);
  // Ждём пока BFS завершится и откроется экран решения
  await expect(page.locator('#stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#stage-config')).toBeHidden();
});

test('шаг вперёд и назад по решению', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.locator('#import-dialog-ok').click();
  await page.locator('#btn-start').click();
  await expect(page.locator('#stage-solve')).toBeVisible({ timeout: 15000 });

  const stepList = page.locator('#solution-steps');
  // В начале активен элемент «Начало» (шаг 0)
  await expect(stepList.locator('.active')).toHaveText('Начало');

  // Шаг вперёд
  await page.locator('#btn-step').click();
  await expect(stepList.locator('.active')).not.toHaveText('Начало');

  // Шаг назад
  await page.locator('#btn-prev').click();
  await expect(stepList.locator('.active')).toHaveText('Начало');
});

test('кнопка «Вернуться» возвращает в настройки', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.locator('#import-dialog-ok').click();
  await page.locator('#btn-start').click();
  await expect(page.locator('#stage-solve')).toBeVisible({ timeout: 15000 });

  await page.locator('#btn-back').click();
  await expect(page.locator('#stage-config')).toBeVisible();
  await expect(page.locator('#stage-solve')).toBeHidden();
});

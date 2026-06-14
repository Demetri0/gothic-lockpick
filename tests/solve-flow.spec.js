import { test, expect } from '@playwright/test';

const SIMPLE_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 6, deps: [] },
  { id: 2, positions: 7, currentPos: 6, deps: [] },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('страница загружается в режиме настроек', async ({ page }) => {
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

test('BFS находит решение, открывается экран решения', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();

  await expect(page.getByTestId('overlay')).toHaveClass(/active/);
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('stage-config')).toBeHidden();
});

test('шаг вперёд и назад по решению', async ({ page }) => {
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

test('клик по шагу в списке — прыжок к нему', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
});

test('«Конец» подсвечивается на последнем шаге', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  // Переходим к концу через клик
  await page.getByTestId('step-end').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/);
  await expect(page.getByTestId('step-start')).not.toHaveClass(/active/);
});

test('авто-воспроизведение — кнопка меняется на «Стоп» и обратно', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('btn-auto').click();
  await expect(page.getByTestId('btn-auto')).toContainText('Стоп');

  await page.getByTestId('btn-auto').click();
  await expect(page.getByTestId('btn-auto')).toContainText('Авто');
});

test('кнопка «Вернуться» возвращает в настройки', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('btn-back').click();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

test('РЕШЕНИЕ использует кеш при повторном нажатии без изменений', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  // Возвращаемся в настройки
  await page.getByTestId('btn-back').click();

  // Повторно нажимаем РЕШЕНИЕ — оверлей не должен появляться (кеш)
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/);
  await expect(page.getByTestId('stage-solve')).toBeVisible();
});

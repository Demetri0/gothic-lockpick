import { test, expect } from '@playwright/test';

const SIMPLE_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 3, deps: [] },
  { id: 2, positions: 7, currentPos: 3, deps: [] },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// ── Config stage ─────────────────────────────────────────────────────────────

test('D двигает активную плашку вправо', async ({ page }) => {
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.keyboard.press('d');
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before + 1));
});

test('A двигает активную плашку влево', async ({ page }) => {
  // Сначала вправо, чтобы можно было влево
  await page.keyboard.press('d');
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.keyboard.press('a');
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before - 1));
});

test('W/S переключают активную плашку', async ({ page }) => {
  // Изначально активна плашка 1
  await expect(page.getByTestId('pos-item-1')).toHaveClass(/active/);

  await page.keyboard.press('w');
  await expect(page.getByTestId('pos-item-2')).toHaveClass(/active/);

  await page.keyboard.press('s');
  await expect(page.getByTestId('pos-item-1')).toHaveClass(/active/);
});

test('стрелки работают как WASD в настройках', async ({ page }) => {
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before + 1));
});

test('WASD не работает во время оверлея', async ({ page }) => {
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());

  // Активируем оверлей напрямую — не зависим от скорости генерации
  await page.evaluate(() => document.getElementById('computing-overlay').classList.add('active'));
  await page.keyboard.press('d');

  // Позиция не изменилась
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before));

  await page.evaluate(() => document.getElementById('computing-overlay').classList.remove('active'));
});

// ── Solve stage ──────────────────────────────────────────────────────────────

test('D/A в режиме решения шагают вперёд/назад по решению', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  await expect(page.getByTestId('step-start')).toHaveClass(/active/);

  await page.keyboard.press('d');
  await expect(page.getByTestId('step-1')).toHaveClass(/active/);

  await page.keyboard.press('a');
  await expect(page.getByTestId('step-start')).toHaveClass(/active/);
});

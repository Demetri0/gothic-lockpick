import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// ── Dep cell responsive text ──────────────────────────────────────────────────

test('ячейка матрицы: на широком экране показывает полный текст', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('dep-1-2').click(); // none → same

  const cell = page.getByTestId('dep-1-2');
  await expect(cell.locator('.dep-full')).toBeVisible();
  await expect(cell.locator('.dep-short')).toBeHidden();
});

test('ячейка матрицы: на узком экране показывает сокращённый текст', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.getByTestId('dep-1-2').click(); // none → same

  const cell = page.getByTestId('dep-1-2');
  await expect(cell.locator('.dep-full')).toBeHidden();
  await expect(cell.locator('.dep-short')).toBeVisible();
  await expect(cell.locator('.dep-short')).toHaveText('П');
});

// ── Plate count ──────────────────────────────────────────────────────────────

test('кнопка + увеличивает количество плашек', async ({ page }) => {
  const before = parseInt(await page.getByTestId('val-plates').textContent());
  await page.getByTestId('btn-plates-inc').click();
  await expect(page.getByTestId('val-plates')).toHaveText(String(before + 1));
});

test('кнопка − уменьшает количество плашек', async ({ page }) => {
  const before = parseInt(await page.getByTestId('val-plates').textContent());
  await page.getByTestId('btn-plates-dec').click();
  await expect(page.getByTestId('val-plates')).toHaveText(String(before - 1));
});

test('кнопка + отключается при 8 плашках', async ({ page }) => {
  // Дефолт 4 — кликаем ровно 4 раза чтобы дойти до 8
  for (let i = 0; i < 4; i++) await page.getByTestId('btn-plates-inc').click();
  await expect(page.getByTestId('val-plates')).toHaveText('8');
  await expect(page.getByTestId('btn-plates-inc')).toBeDisabled();
});

test('кнопка − отключается при 2 плашках', async ({ page }) => {
  // Дефолт 4 — кликаем ровно 2 раза чтобы дойти до 2
  for (let i = 0; i < 2; i++) await page.getByTestId('btn-plates-dec').click();
  await expect(page.getByTestId('val-plates')).toHaveText('2');
  await expect(page.getByTestId('btn-plates-dec')).toBeDisabled();
});

// ── Position count ───────────────────────────────────────────────────────────

test('кнопка + увеличивает позиции на 2 (только нечётные)', async ({ page }) => {
  const before = parseInt(await page.getByTestId('val-positions').textContent());
  await page.getByTestId('btn-pos-inc').click();
  await expect(page.getByTestId('val-positions')).toHaveText(String(before + 2));
});

test('кнопка − уменьшает позиции на 2', async ({ page }) => {
  const before = parseInt(await page.getByTestId('val-positions').textContent());
  await page.getByTestId('btn-pos-dec').click();
  await expect(page.getByTestId('val-positions')).toHaveText(String(before - 2));
});

test('кнопка − позиций отключается при 3', async ({ page }) => {
  // Дефолт 7 — 2 клика чтобы дойти до 3 (7→5→3)
  await page.getByTestId('btn-pos-dec').click();
  await page.getByTestId('btn-pos-dec').click();
  await expect(page.getByTestId('val-positions')).toHaveText('3');
  await expect(page.getByTestId('btn-pos-dec')).toBeDisabled();
});

// ── Position strip ───────────────────────────────────────────────────────────

test('стрип позиций: ► увеличивает позицию плашки', async ({ page }) => {
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.getByTestId('pos-inc-1').click();
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before + 1));
});

test('стрип позиций: ◄ уменьшает позицию плашки', async ({ page }) => {
  // Сначала сдвинем вправо, чтобы кнопка ◄ не была заблокирована
  await page.getByTestId('pos-inc-1').click();
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.getByTestId('pos-dec-1').click();
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before - 1));
});

test('стрип позиций: кнопки не проверяют зависимости и не блокируются ими', async ({ page }) => {
  // Устанавливаем зависимость: плашка 1 → плашка 2 (прямо, 1 шаг)
  // Это означает: движение плашки 1 вправо тянет плашку 2 вправо тоже
  await page.getByTestId('dep-1-2').click(); // none → same

  // Ставим плашку 2 в максимальную позицию через стрип (7 кликов с позиции 4)
  for (let i = 0; i < 3; i++) await page.getByTestId('pos-inc-2').click();
  await expect(page.getByTestId('pos-val-2')).toHaveText('7');

  // Теперь двигаем плашку 1 вправо через стрип — если бы шла проверка зависимостей,
  // движение было бы заблокировано (плашка 2 уже на максимуме).
  // Но стрип работает напрямую: плашка 1 обязана сдвинуться, плашка 2 — остаться на месте.
  const pos1Before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.getByTestId('pos-inc-1').click();

  await expect(page.getByTestId('pos-val-1')).toHaveText(String(pos1Before + 1));
  await expect(page.getByTestId('pos-val-2')).toHaveText('7'); // не изменилась
});

// ── Dependency matrix ────────────────────────────────────────────────────────

test('ЛКМ по ячейке матрицы циклически меняет состояние: нет → прямо → обратно → нет', async ({ page }) => {
  const cell = page.getByTestId('dep-1-2');

  await expect(cell).toHaveAttribute('data-state', 'none');

  await cell.click();
  await expect(cell).toHaveAttribute('data-state', 'same');

  await cell.click();
  await expect(cell).toHaveAttribute('data-state', 'opposite');

  await cell.click();
  await expect(cell).toHaveAttribute('data-state', 'none');
});

test('ПКМ по ячейке матрицы циклически меняет состояние в обратную сторону', async ({ page }) => {
  const cell = page.getByTestId('dep-1-2');

  await expect(cell).toHaveAttribute('data-state', 'none');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-state', 'opposite');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-state', 'same');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-state', 'none');
});

// ── Random generation ────────────────────────────────────────────────────────

test('кнопка Лёгкий показывает оверлей и находит конфиг', async ({ page }) => {
  await page.getByTestId('btn-easy').click();
  await expect(page.getByTestId('overlay')).toHaveClass(/active/);
  // Ждём исчезновения оверлея — генерация завершилась
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/, { timeout: 30000 });
  // Конфиг изменился — плашек теперь 2+
  const count = parseInt(await page.getByTestId('val-plates').textContent());
  expect(count).toBeGreaterThanOrEqual(2);
});

test('Cancel закрывает оверлей', async ({ page }) => {
  // Активируем оверлей напрямую — не зависим от скорости генерации
  await page.evaluate(() => document.getElementById('computing-overlay').classList.add('active'));
  await expect(page.getByTestId('overlay')).toHaveClass(/active/);
  await page.getByTestId('btn-cancel').click();
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/);
});

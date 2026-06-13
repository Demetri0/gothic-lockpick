import { test, expect } from '@playwright/test';

// Инжектируем computeMove из страницы и гоняем логику в её контексте.
// page.evaluate() выполняется в браузере, где функция уже определена.

test('computeMove не транзитивный: движение A затрагивает только прямые зависимости, не цепочку', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(() => {
    // A -> B (same), B -> C (same)
    // Движение A должно затронуть только A и B, но не C
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 3, deps: [{ targetId: 3, direction: 'same', steps: 1 }] },
      { id: 3, positions: 7, currentPos: 3, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  const movedIds = result.map(e => e.plateId).sort();
  expect(movedIds).toEqual([1, 2]);       // только A и B
  expect(movedIds).not.toContain(3);      // C не трогаем
});

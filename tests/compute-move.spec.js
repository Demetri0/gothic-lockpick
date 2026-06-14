import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('не транзитивный: A→B→C, движение A затрагивает только A и B', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 3, deps: [{ targetId: 3, direction: 'same', steps: 1 }] },
      { id: 3, positions: 7, currentPos: 3, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  const movedIds = result.map(e => e.plateId).sort();
  expect(movedIds).toEqual([1, 2]);
  expect(movedIds).not.toContain(3);
});

test('без зависимостей: двигается только сама плашка', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [] },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toEqual([{ plateId: 1, newPos: 2 }]);
});

test('обратная зависимость: dep двигается в противоположную сторону', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'opposite', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toContainEqual({ plateId: 1, newPos: 3 });
  expect(result).toContainEqual({ plateId: 2, newPos: 5 });
});

test('блокировка: ход за границу возвращает null', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [{ id: 1, positions: 7, currentPos: 1, deps: [] }];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toBeNull();
});

test('all-or-nothing: если dep выходит за границу — весь ход заблокирован', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 1, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toBeNull();
});

test('зависимость с steps > 1', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'same', steps: 2 }] },
      { id: 2, positions: 7, currentPos: 2, deps: [] },
    ];
    return computeMove(plates, 1, 'left');
  });

  expect(result).toContainEqual({ plateId: 1, newPos: 5 });
  expect(result).toContainEqual({ plateId: 2, newPos: 4 });
});

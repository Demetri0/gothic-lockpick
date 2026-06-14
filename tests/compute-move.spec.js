import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('non-transitive: A→B→C, moving A affects only A and B', async ({ page }) => {
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

test('no dependencies: only the moved plate moves', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [] },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toEqual([{ plateId: 1, newPos: 2 }]);
});

test('opposite dependency: dep moves in the reverse direction', async ({ page }) => {
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

test('blocked: move beyond boundary returns null', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [{ id: 1, positions: 7, currentPos: 1, deps: [] }];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toBeNull();
});

test('all-or-nothing: if dep goes out of bounds the whole move is blocked', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 1, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toBeNull();
});

test('multiple deps on one plate: all affected plates move', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 4, deps: [
        { targetId: 2, direction: 'same',     steps: 1 },
        { targetId: 3, direction: 'opposite', steps: 1 },
      ]},
      { id: 2, positions: 7, currentPos: 4, deps: [] },
      { id: 3, positions: 7, currentPos: 4, deps: [] },
    ];
    return computeMove(plates, 1, 'right');
  });

  expect(result).toContainEqual({ plateId: 1, newPos: 3 });
  expect(result).toContainEqual({ plateId: 2, newPos: 3 }); // same → right → −1
  expect(result).toContainEqual({ plateId: 3, newPos: 5 }); // opposite → left → +1
});

test('opposite dependency with steps > 1', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'opposite', steps: 2 }] },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ];
    return computeMove(plates, 1, 'left');
  });

  expect(result).toContainEqual({ plateId: 1, newPos: 5 }); // left → +1
  expect(result).toContainEqual({ plateId: 2, newPos: 2 }); // opposite × 2 → −2
});

test('dependency with steps > 1', async ({ page }) => {
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

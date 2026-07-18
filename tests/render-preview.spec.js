import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('posStripHTML emits one row per plate with the active hole marked', async ({ page }) => {
  const info = await page.evaluate(() => {
    const el = document.createElement('div');
    el.innerHTML = posStripHTML([6, 4, 0], 'x');
    return {
      plates: el.querySelectorAll('.sr-plate').length,
      hasRow2: !!el.querySelector('[data-test-id="x-plate-2"]'),
      hasRow3: !!el.querySelector('[data-test-id="x-plate-3"]'),
      a06: el.querySelector('[data-test-id="x-hole-0-6"]').dataset.active,
      a05: el.querySelector('[data-test-id="x-hole-0-5"]').dataset.active,
      a20: el.querySelector('[data-test-id="x-hole-2-0"]').dataset.active,
    };
  });
  expect(info.plates).toBe(3);
  expect(info.hasRow2).toBe(true);
  expect(info.hasRow3).toBe(false);
  expect(info.a06).toBe('true');
  expect(info.a05).toBe('false');
  expect(info.a20).toBe('true');
});

const cfg = () => ([
  { id: 1, positions: 7, currentPos: 6, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 4, deps: [{ targetId: 3, direction: 'opposite', steps: 1 }] },
  { id: 3, positions: 7, currentPos: 2, deps: [] },
]);

test('depMatrixHTML marks self/same/opposite/none per cell', async ({ page }) => {
  const cells = await page.evaluate((p) => {
    const el = document.createElement('div');
    el.innerHTML = depMatrixHTML(p, depCellIconHTML);
    const dep = (r, c) => el.querySelector(`[data-test-id="mini-cell-${r}-${c}"]`).dataset.dep;
    return { c00: dep(0, 0), c01: dep(0, 1), c12: dep(1, 2), c02: dep(0, 2) };
  }, cfg());
  expect(cells.c00).toBe('self');
  expect(cells.c01).toBe('same');
  expect(cells.c12).toBe('opposite');
  expect(cells.c02).toBe('none');
});

test('depMatrixHTML icon variant renders a dep-icon in linked cells only', async ({ page }) => {
  const r = await page.evaluate((p) => {
    const el = document.createElement('div');
    el.innerHTML = depMatrixHTML(p, depCellIconHTML);
    return {
      linkedIconDep: el.querySelector('[data-test-id="mini-cell-0-1"] [data-test-id="dep-icon"]').dataset.dep,
      noneHasIcon: !!el.querySelector('[data-test-id="mini-cell-0-2"] [data-test-id="dep-icon"]'),
    };
  }, cfg());
  expect(r.linkedIconDep).toBe('same');
  expect(r.noneHasIcon).toBe(false);
});

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

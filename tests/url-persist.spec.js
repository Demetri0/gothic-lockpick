import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

const cfg = () => ([
  { id: 1, positions: 7, currentPos: 6, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 4, deps: [] },
]);

test('urlQueryFor encodes a config and round-trips through urlReadConfig', async ({ page }) => {
  const r = await page.evaluate((plates) => {
    const q = urlQueryFor(plates, 'config');
    const parsed = urlReadConfig(q);
    return { q, plates: parsed && parsed.plates, wantSolve: parsed && parsed.wantSolve };
  }, cfg());
  expect(r.q).toMatch(/^\?lock=/);
  expect(r.wantSolve).toBe(false);
  expect(r.plates).toEqual(cfg());
});

test('the solve stage adds a value-less &solve flag, read back via wantSolve', async ({ page }) => {
  const r = await page.evaluate((plates) => {
    const q = urlQueryFor(plates, 'solve');
    return { q, wantSolve: urlReadConfig(q).wantSolve };
  }, cfg());
  expect(r.q).toContain('&solve');
  expect(r.q).not.toContain('&solve=');   // value-less, not &solve=1
  expect(r.wantSolve).toBe(true);
});

test('urlReadConfig returns null for a malformed lock and for an absent one', async ({ page }) => {
  const r = await page.evaluate(() => ({
    garbage: urlReadConfig('?lock=not-a-real-lock'),
    empty: urlReadConfig('?foo=bar'),
    none: urlReadConfig(''),
  }));
  expect(r.garbage).toBeNull();
  expect(r.empty).toBeNull();
  expect(r.none).toBeNull();
});

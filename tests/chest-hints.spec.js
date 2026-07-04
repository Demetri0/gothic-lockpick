import { test, expect } from '@playwright/test';

// Controlled fixture — must not depend on the real chests.json (it is regenerated
// independently). At the default config (4 plates, all centre → user0 [3,3,3,3]):
//   exact4  L=4, 4 plates → not dim, ranked first
//   longer6 L=4, 6 plates → dim, ranked second (exact-count tie-break)
//   apply2  L=2, 4 plates → ranked third
//   nomatch L=0            → excluded
const FIXTURE_DB = {
  v: 1,
  updated: '2026-01-01T00:00:00Z',
  entries: [
    { id: 'nomatch', name: { ru: 'Мимо', en: 'Miss', de: 'Miss', uk: 'Мимо' }, cells: 4, rules: '', pos: [0, 1, 2, 3], tags: ['x'], img: [] },
    { id: 'apply2', name: { ru: 'Замок Два', en: 'Lock Two', de: 'Schloss Zwei', uk: 'Замок Два' }, cells: 4, rules: 'A:B-', pos: [3, 3, 1, 0], tags: ['two'], img: [] },
    { id: 'longer6', name: { ru: 'Длинный', en: 'Longer', de: 'Länger', uk: 'Довгий' }, cells: 6, rules: '', pos: [3, 3, 3, 3, 3, 3], tags: ['six'], img: [] },
    { id: 'exact4', name: { ru: 'Точный', en: 'Exact', de: 'Genau', uk: 'Точний' }, cells: 4, rules: 'A:B+', pos: [3, 3, 3, 3], tags: ['four'], img: [] },
  ],
};

async function mockChestDb(page, db = FIXTURE_DB) {
  await page.route('**/chests.json', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(db),
    }));
}

// ── Pure ranking logic ─────────────────────────────────────────────────────
// computeChestHints(entries, user0, plateCount, limit) ranks DB entries whose
// disc positions match the user's current positions (0-based) by a left prefix.

test('computeChestHints ranks candidates by leading-prefix match length', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(() => {
    const entries = [
      { id: 'p3', pos: [1, 2, 3, 4], cells: 4, name: {}, tags: [], rules: '' }, // L=4
      { id: 'p2', pos: [1, 2, 9, 9], cells: 4, name: {}, tags: [], rules: '' }, // L=2
      { id: 'p1', pos: [1, 9, 9, 9], cells: 4, name: {}, tags: [], rules: '' }, // L=1 → excluded
      { id: 'p0', pos: [9, 9, 9, 9], cells: 4, name: {}, tags: [], rules: '' }, // L=0 → excluded
    ];
    return computeChestHints(entries, [1, 2, 3, 4], 4, 4).map(e => e.id);
  });
  expect(ids).toEqual(['p3', 'p2']);
});

test('computeChestHints ranks exact plate-count above a mismatched count at equal prefix', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(() => {
    const entries = [
      { id: 'longer', pos: [3, 3, 3, 3, 3, 3], cells: 6, name: {}, tags: [], rules: '' }, // L=2, count 6
      { id: 'exact', pos: [3, 3, 3, 3], cells: 4, name: {}, tags: [], rules: '' },         // L=2, count 4
    ];
    return computeChestHints(entries, [3, 3, 5, 5], 4, 4).map(e => e.id);
  });
  expect(ids).toEqual(['exact', 'longer']);
});

test('computeChestHints caps results at the limit', async ({ page }) => {
  await page.goto('/');
  const count = await page.evaluate(() => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`, pos: [2, 2, i, 0], cells: 4, name: {}, tags: [], rules: '',
    }));
    return computeChestHints(entries, [2, 2, 2, 2], 4, 4).length;
  });
  expect(count).toBe(4);
});

// ── Rendering (integration) ──────────────────────────────────────────────────

test('matching chests render as hint cards ranked by prefix', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // Default config (all centre) matches exact4, longer6, apply2 (nomatch excluded)
  await expect(page.getByTestId('chest-hints')).toBeVisible();
  await expect(page.getByTestId('chest-hint-0-name')).toHaveText('Точный');
  await expect(page.getByTestId('chest-hint-1-name')).toHaveText('Длинный');
  await expect(page.getByTestId('chest-hint-2-name')).toHaveText('Замок Два');
  await expect(page.getByTestId('chest-hint-3')).toHaveCount(0);
});

test('a chest with a different plate count is dimmed', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // exact4 (4 plates, matches current 4) not dim; longer6 (6 plates) dim
  await expect(page.getByTestId('chest-hint-0')).toHaveAttribute('data-dim', 'false');
  await expect(page.getByTestId('chest-hint-1')).toHaveAttribute('data-dim', 'true');
});

test('clicking a hint applies its positions and dependency rules', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // apply2: pos [3,3,1,0] → currentPos [4,4,2,1]; rules A:B- → dep 1→2 opposite
  await page.getByTestId('chest-hint-2').click();
  await expect(page.getByTestId('pos-input-3')).toHaveValue('2');
  await expect(page.getByTestId('pos-input-4')).toHaveValue('1');
  await expect(page.getByTestId('dep-1-2')).toHaveAttribute('data-state', 'opposite');
});

test('fewer than 2 matching leading discs hides the hints', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  await expect(page.getByTestId('chest-hints')).toBeVisible();
  // Drop plate 1 to position 1 (user0[0] = 0): no fixture entry shares ≥2 leading discs
  await page.getByTestId('pos-dec-1').click();
  await page.getByTestId('pos-dec-1').click();
  await page.getByTestId('pos-dec-1').click();
  await expect(page.getByTestId('chest-hints')).toBeHidden();
});

test('hints stay hidden when the database fails to load', async ({ page }) => {
  await page.route('**/chests.json', route => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('plates-matrix')).toBeVisible();
  await expect(page.getByTestId('chest-hints')).toBeHidden();
  // Config still works: positions editable, SOLVE reachable
  await page.getByTestId('pos-dec-1').click();
  await expect(page.getByTestId('pos-input-1')).toHaveValue('3');
  await expect(page.getByTestId('btn-start')).toBeEnabled();
});

test('hint names follow the active language', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  await expect(page.getByTestId('chest-hint-0-name')).toHaveText('Точный');
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('chest-hint-0-name')).toHaveText('Exact');
});

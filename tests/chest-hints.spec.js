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

// Combined match score = prefix * (0.7 + 0.3 * count), where prefix = L / N and
// count = 1 / (1 + |plates - N|). An entry is included only when score > 0.25.
// Returns [{ entry, score }] ranked by score descending.

test('computeChestHints excludes weak matches and ranks by combined score', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    const mk = (id, pos) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules: '' });
    const entries = [
      mk('l4', [1, 2, 3, 4]), // L=4 → prefix 1.00 → score 1.00
      mk('l2', [1, 2, 9, 9]), // L=2 → prefix 0.50 → score 0.50
      mk('l1', [1, 9, 9, 9]), // L=1 → prefix 0.25 → score 0.25 → excluded (not > 0.25)
      mk('l0', [9, 9, 9, 9]), // L=0 → excluded
    ];
    return computeChestHints(entries, [1, 2, 3, 4], 4, 4).map(r => ({ id: r.entry.id, score: r.score }));
  });
  expect(res.map(r => r.id)).toEqual(['l4', 'l2']);
  expect(res[0].score).toBeCloseTo(1);
  expect(res[1].score).toBeCloseTo(0.5);
});

test('a differing plate count lowers the score at equal prefix', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    const mk = (id, pos) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules: '' });
    const entries = [
      mk('longer', [3, 3, 3, 3, 3, 3]), // L=2, 6 plates → count 1/3 → score 0.40
      mk('exact', [3, 3, 3, 3]),        // L=2, 4 plates → count 1   → score 0.50
    ];
    return computeChestHints(entries, [3, 3, 5, 5], 4, 4).map(r => ({ id: r.entry.id, score: r.score }));
  });
  expect(res.map(r => r.id)).toEqual(['exact', 'longer']);
  expect(res[0].score).toBeCloseTo(0.5);
  expect(res[1].score).toBeCloseTo(0.4);
});

test('computeChestHints excludes entries with a single leading match', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(() => {
    const mk = (id, pos) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules: '' });
    const entries = [
      mk('one', [3, 9, 9, 9]),  // L=1, exact count → score 0.25 → excluded
      mk('zero', [9, 9, 9, 9]), // L=0 → excluded
    ];
    return computeChestHints(entries, [3, 3, 3, 3], 4, 4).map(r => r.entry.id);
  });
  expect(ids).toEqual([]);
});

test('computeChestHints caps results at the limit', async ({ page }) => {
  await page.goto('/');
  const count = await page.evaluate(() => {
    const mk = (id, pos) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules: '' });
    const entries = Array.from({ length: 6 }, (_, i) => mk(`e${i}`, [2, 2, i, 0]));
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

test('cards fade by combined match score', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // exact4: score 1.00 → 100; longer6: score 0.80 → 80; apply2: score 0.50 → 50
  await expect(page.getByTestId('chest-hint-0')).toHaveAttribute('data-score', '100');
  await expect(page.getByTestId('chest-hint-1')).toHaveAttribute('data-score', '80');
  await expect(page.getByTestId('chest-hint-2')).toHaveAttribute('data-score', '50');
  // Opacity is driven by the score: a higher-scoring card is more opaque
  const [o0, o2] = await page.evaluate(() =>
    ['chest-hint-0', 'chest-hint-2'].map(id =>
      parseFloat(getComputedStyle(document.querySelector(`[data-test-id="${id}"]`)).opacity)));
  expect(o0).toBeGreaterThan(o2);
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

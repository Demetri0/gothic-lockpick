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

test('computeChestHints caps results at the default limit of 3', async ({ page }) => {
  await page.goto('/');
  const count = await page.evaluate(() => {
    const mk = (id, pos) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules: '' });
    const entries = Array.from({ length: 6 }, (_, i) => mk(`e${i}`, [2, 2, i, 0]));
    return computeChestHints(entries, [2, 2, 2, 2], 4).length; // no explicit limit → default
  });
  expect(count).toBe(3);
});

// ── Dependency-aware scoring ─────────────────────────────────────────────────
// When the user has entered dependencies (userEdges), they modulate the score:
//   match +0.5, missing -0.2, conflict -1.5 (clamped >= 0). Empty → no effect.

test('a matching user dependency boosts a chest over an identical one without it', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    const mk = (id, pos, rules) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules });
    const entries = [
      mk('plain', [3, 3, 3, 3], ''),       // full prefix, no rules → user's dep is "missing"
      mk('withdep', [3, 3, 3, 3], 'A:B+'), // full prefix, has 1->2 same → matches the user
    ];
    const userEdges = new Map([['1>2', 'same']]);
    return computeChestHints(entries, [3, 3, 3, 3], 4, 3, userEdges).map(r => r.entry.id);
  });
  expect(res).toEqual(['withdep', 'plain']);
});

test('a conflicting user dependency drops a chest out of the list', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    const mk = (id, pos, rules) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules });
    const entries = [
      mk('conflict', [3, 3, 3, 3], 'A:B-'), // 1->2 opposite vs user 1->2 same → conflict → excluded
      mk('plain', [3, 3, 3, 3], ''),        // missing → mild penalty, still shown
    ];
    const userEdges = new Map([['1>2', 'same']]);
    return computeChestHints(entries, [3, 3, 3, 3], 4, 3, userEdges).map(r => r.entry.id);
  });
  expect(res).toEqual(['plain']);
});

test('matches must strongly outweigh a conflict to keep a chest', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    const mk = (id, pos, rules) => ({ id, pos, cells: pos.length, name: {}, tags: [], rules });
    const entries = [
      // user asserts 1->2, 1->3, 1->4 all same
      mk('rescued', [3, 3, 3, 3], 'A:B-,C+,D+'), // conflict(1>2) + 2 matches(1>3,1>4) → depMult 0.5 → kept
      mk('doomed', [3, 3, 3, 3], 'A:B-,C+'),     // conflict(1>2) + 1 match + 1 missing → depMult 0 → dropped
    ];
    const userEdges = new Map([['1>2', 'same'], ['1>3', 'same'], ['1>4', 'same']]);
    return computeChestHints(entries, [3, 3, 3, 3], 4, 3, userEdges).map(r => r.entry.id);
  });
  expect(res).toEqual(['rescued']);
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

test('chest rules render as a gothic-format line, colored against entered deps', async ({ page }) => {
  const DEP_DB = {
    v: 1, updated: '2026-01-01T00:00:00Z',
    entries: [
      { id: 'mixed', name: { ru: 'Микс', en: 'Mixed', de: 'Mix', uk: 'Мікс' },
        cells: 4, rules: 'A:B+,C+,D-', pos: [3, 3, 3, 3], tags: ['m'], img: [] },
    ],
  };
  await mockChestDb(page, DEP_DB);
  await page.goto('/');
  await expect(page.getByTestId('chest-hint-0')).toBeVisible();
  // With no deps entered yet, the rules line is present but every token is neutral
  await expect(page.getByTestId('chest-hint-0-rules')).toBeVisible();
  await expect(page.getByTestId('chest-hint-0-rule-1-2')).toHaveAttribute('data-rel', 'none');

  // Enter 1->2, 1->3, 1->4 all "same" via the matrix (each LMB click: none → same)
  await page.getByTestId('dep-1-2').click();
  await page.getByTestId('dep-1-3').click();
  await page.getByTestId('dep-1-4').click();

  // chest has 1->2 same, 1->3 same, 1->4 opposite → two matches (green) + one conflict (red)
  await expect(page.getByTestId('chest-hint-0-rule-1-2')).toHaveAttribute('data-rel', 'match');
  await expect(page.getByTestId('chest-hint-0-rule-1-3')).toHaveAttribute('data-rel', 'match');
  await expect(page.getByTestId('chest-hint-0-rule-1-4')).toHaveAttribute('data-rel', 'conflict');
});

test('the visible hint count follows the panel width, not the viewport', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // Wide viewport, wide panel → 3
  await expect(page.getByTestId('chest-hint-2')).toBeVisible();
  // Still a wide (desktop) viewport, but the config panel is only half of it
  // (panels sit side by side) → the narrow panel drops to 2 cards
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.getByTestId('chest-hint-2')).toBeHidden();
  await expect(page.getByTestId('chest-hint-1')).toBeVisible();
  // Narrow, stacked panel → 1
  await page.setViewportSize({ width: 380, height: 800 });
  await expect(page.getByTestId('chest-hint-1')).toBeHidden();
  await expect(page.getByTestId('chest-hint-0')).toBeVisible();
});

test('no horizontal page scroll at viewport widths >= 320px', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  await expect(page.getByTestId('chest-hint-0')).toBeVisible(); // hints rendered — a common overflow culprit
  for (const width of [320, 360, 400, 480, 600, 768, 820, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
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

test('a full match pulls further ahead in opacity than partials do from each other', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // exact4 is a full match (score 1); longer6 and apply2 are partials. The gap
  // between full and the best partial must exceed the gap between partials.
  await expect(page.getByTestId('chest-hint-2')).toBeVisible();
  const [o0, o1, o2] = await page.evaluate(() =>
    ['chest-hint-0', 'chest-hint-1', 'chest-hint-2'].map(id =>
      parseFloat(getComputedStyle(document.querySelector(`[data-test-id="${id}"]`)).opacity)));
  expect(o0 - o1).toBeGreaterThan(o1 - o2);
});

test('matching discs in a hint preview are highlighted', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // exact4 (card 0): every plate matches the user's centre positions
  await expect(page.getByTestId('chest-hint-0-hole-0-3')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('chest-hint-0-hole-3-3')).toHaveAttribute('data-match', 'true');
  // apply2 (card 2, pos [3,3,1,0]): first two plates match (L=2), plate 2 does not
  await expect(page.getByTestId('chest-hint-2-hole-0-3')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('chest-hint-2-hole-2-1')).toHaveAttribute('data-match', 'false');
});

test('a hint card exposes the full name as a title tooltip', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  // The name is ellipsis-truncated in the UI, so the untruncated name lives in a title
  await expect(page.getByTestId('chest-hint-0')).toHaveAttribute('title', 'Точный');
  await expect(page.getByTestId('chest-hint-0-tags')).toHaveAttribute('title', 'four');
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

test('clicking a hole in the 3D preview updates the hints', async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
  await expect(page.getByTestId('chest-hints')).toBeVisible();
  // Set plate 1 to position 1 (user0[0] = 0) via the 3D scene: no fixture entry
  // shares ≥2 leading discs any more, so the hints must disappear.
  await page.getByTestId('hole-1-1').click({ force: true });
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

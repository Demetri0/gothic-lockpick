import { test, expect } from '@playwright/test';

// Agreement with external catalogs (build-time `conf` / `doubt` / `alt` on DB entries):
// search and hint ranking, the warning glyph, and the solve-stage notice.

// Two recorded variants of one lock plus an unrelated doubtful lock. The doubtful
// variant is listed FIRST so that any ranking we observe is the app's, not the file's.
const DB = {
  v: 1, updated: '2026-10-11T00:00:00.000Z',
  entries: [
    { id: 'bad-chest', name: { ru: 'Сомнительный сундук', en: 'Doubtful chest' }, cells: 3,
      rules: 'A:B-', pos: [3, 3, 4], tags: [], img: [], conf: -3, doubt: true, alt: 'good-chest' },
    { id: 'good-chest', name: { ru: 'Надёжный сундук', en: 'Reliable chest' }, cells: 3,
      rules: 'A:B+', pos: [3, 3, 4], tags: [], img: [], conf: 3,
      game: { id: 'OC_Chest_Test_Lock', name: 'Test Chest', place: 'Old Camp' } },
    { id: 'lone-chest', name: { ru: 'Одинокий сундук', en: 'Lonely chest' }, cells: 3,
      rules: 'B:C-', pos: [5, 1, 4], tags: [], img: [], conf: -3, doubt: true },
  ],
};

async function openWithDb(page) {
  await page.route('**/chests.json', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(DB),
  }));
  await page.goto('/');
  await expect(page.getByTestId('btn-search-db')).toBeEnabled();
}

async function search(page, query) {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill(query);
  await expect(page.getByTestId('search-result-0')).toBeVisible();
}

async function loadAndSolve(page, name) {
  await search(page, name);
  await page.getByTestId('search-result-0').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
}

test('a position search lists the better-agreeing variant first', async ({ page }) => {
  await openWithDb(page);
  await search(page, '3,3,4');
  await expect(page.getByTestId('search-result-0-name')).toHaveText('Надёжный сундук');
  await expect(page.getByTestId('search-result-1-name')).toHaveText('Сомнительный сундук');
});

test('only doubtful results carry the warning glyph', async ({ page }) => {
  await openWithDb(page);
  await search(page, '3,3,4');
  await expect(page.getByTestId('search-result-0-doubt')).toHaveCount(0);
  await expect(page.getByTestId('search-result-1-doubt')).toBeVisible();
});

test('the in-game asset id is searchable', async ({ page }) => {
  await openWithDb(page);
  await search(page, 'OC_Chest_Test_Lock');
  await expect(page.getByTestId('search-result-0-name')).toHaveText('Надёжный сундук');
});

test('a hint card for a doubtful entry carries the warning glyph', async ({ page }) => {
  await openWithDb(page);
  await search(page, 'Одинокий');
  await page.getByTestId('search-result-0').click();
  // Positions 5,1,4 (0-based) match only the lonely chest, which then shows as a hint
  await expect(page.getByTestId('chest-hint-0-name')).toHaveText('Одинокий сундук');
  await expect(page.getByTestId('chest-hint-0-doubt')).toBeVisible();
});

test('solving a doubtful entry with a better variant offers to open it', async ({ page }) => {
  await openWithDb(page);
  await loadAndSolve(page, 'Сомнительный');
  await expect(page.getByTestId('solve-doubt')).toBeVisible();
  await expect(page.getByTestId('solve-doubt-text-alt')).toBeVisible();
  await expect(page.getByTestId('solve-doubt-text')).toBeHidden();

  await page.getByTestId('btn-open-alt').click();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  // The reliable variant is loaded: solving it shows no notice
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('solve-doubt')).toBeHidden();
});

test('solving a doubtful entry without an alternative shows the plain notice', async ({ page }) => {
  await openWithDb(page);
  await loadAndSolve(page, 'Одинокий');
  await expect(page.getByTestId('solve-doubt-text')).toBeVisible();
  await expect(page.getByTestId('solve-doubt-text-alt')).toBeHidden();
  await expect(page.getByTestId('btn-open-alt')).toBeHidden();
});

test('a lock that is not a doubtful entry shows no notice', async ({ page }) => {
  await openWithDb(page);
  await loadAndSolve(page, 'Надёжный');
  await expect(page.getByTestId('solve-doubt')).toBeHidden();
});

test('the notice is localized', async ({ page }) => {
  await openWithDb(page);
  await page.getByTestId('lang-en').click();
  await loadAndSolve(page, 'Doubtful');
  await expect(page.getByTestId('solve-doubt')).toContainText('This entry may contain an error.');
  await expect(page.getByTestId('btn-open-alt')).toHaveText('Open the other entry');
});

import { test, expect } from '@playwright/test';

// Controlled fixture — tests must not depend on the real chests.json content,
// since that database is regenerated independently and will keep changing.
const FIXTURE_DB = {
  v: 1,
  updated: '2026-01-01T00:00:00Z',
  entries: [
    {
      id: 'fixture-arena',
      name: { ru: 'Тестовая арена', en: 'Test Arena', de: 'Test-Arena', uk: 'Тестова арена' },
      rules: 'A:B+,C-;B:A-;C:B-,D+;D:C-;E:F-;F:E+',
      pos: [1, 2, 3, 5, 5, 6],
      tags: ['арена', 'тест'],
      img: [],
    },
    {
      id: 'fixture-camp',
      name: { ru: 'Тестовый лагерь', en: 'Test Camp', de: 'Test-Lager', uk: 'Тестовий табір' },
      rules: 'A:B+;B:A-,C-;C:B+',
      pos: [0, 0, 2, 0, 6],
      tags: ['лагерь', 'тест'],
      img: [],
    },
  ],
};

const SIMPLE_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 6, deps: [] },
  { id: 2, positions: 7, currentPos: 6, deps: [] },
]);

async function mockChestDb(page, db = FIXTURE_DB) {
  await page.route('**/chests.json', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(db) }));
}

test.beforeEach(async ({ page }) => {
  await mockChestDb(page);
  await page.goto('/');
});

// ── Opening the dialog ───────────────────────────────────────────────────────

test('search button opens the search dialog', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
});

test('Ctrl+K opens the search dialog', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('search-dialog')).toBeVisible();
});

test('search input is focused after opening', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-input')).toBeFocused();
});

test('reopening the dialog resets the input and results', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();

  await page.getByTestId('btn-search-close').click();
  await expect(page.getByTestId('search-dialog')).toBeHidden();

  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-input')).toHaveValue('');
  await expect(page.getByTestId('search-result-0')).toBeHidden();
});

// ── Closing the dialog ───────────────────────────────────────────────────────

test('close button closes the dialog', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('btn-search-close').click();
  await expect(page.getByTestId('search-dialog')).toBeHidden();
});

test('Escape closes the dialog', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('search-dialog')).toBeHidden();
});

test('a single Escape press closes the dialog while the search input is focused and has text', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await expect(page.getByTestId('search-input')).toBeFocused();

  await page.getByTestId('search-input').press('Escape');
  await expect(page.getByTestId('search-dialog')).toBeHidden();
});

test('blurring the search input to nowhere (Firefox-style Escape) closes the dialog', async ({ page }) => {
  // Firefox blurs a focused input on Escape natively, without dispatching any keydown/keyup
  // to page script — so the app falls back to reacting to the blur itself. Simulate that
  // exact native effect directly, independent of which engine actually runs this test.
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await page.evaluate(() => document.getElementById('search-input').blur());
  await expect(page.getByTestId('search-dialog')).toBeHidden();
});

test('clicking the dialog title does not close it, even though it blurs the input', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await page.getByTestId('search-dialog-title').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
});

test('clicking outside the dialog (backdrop) closes it', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
  // Click far outside the dialog's content box, still inside the viewport — hits the backdrop
  await page.mouse.click(5, 5);
  await expect(page.getByTestId('search-dialog')).toBeHidden();
});

test('clicking inside the dialog content does not close it', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
});

test('clicking the card\'s own padding (not a specific child element) does not close it', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-dialog')).toBeVisible();
  // Click near the top-left corner of the visible card — its padding area, not a child element
  const box = await page.getByTestId('search-dialog-inner').boundingBox();
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(page.getByTestId('search-dialog')).toBeVisible();
});

// ── Keyboard isolation from puzzle controls ─────────────────────────────────

test('WASD/arrow keys do not move plates while the dialog is open and the input is focused', async ({ page }) => {
  const before = await page.getByTestId('pos-val-1').textContent();
  await page.getByTestId('btn-search-db').click();
  await page.keyboard.press('d');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pos-val-1')).toHaveText(before);
});

test('WASD/arrow keys stay blocked even after focus leaves the input to another dialog element', async ({ page }) => {
  const before = await page.getByTestId('pos-val-1').textContent();

  await page.getByTestId('btn-search-db').click();
  // .focus() moves focus deterministically, sidestepping the dialog's native Tab-order quirks
  await page.getByTestId('btn-search-close').focus();
  await expect(page.getByTestId('btn-search-close')).toBeFocused();

  await page.keyboard.press('d');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('search-dialog')).toBeVisible(); // sanity: still open, not closed
  await expect(page.getByTestId('pos-val-1')).toHaveText(before);
});

// ── Text search ──────────────────────────────────────────────────────────────

test('typing a name shows matching results', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await expect(page.getByTestId('search-results').locator('> div')).toHaveCount(1);
});

test('empty query shows no results and no empty-state message', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-results').locator('> div')).toHaveCount(0);
  await expect(page.getByTestId('search-empty')).toBeHidden();
});

test('nonsense query shows the no-results message', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  // Sanity check first: the database actually loaded and can return real matches —
  // otherwise this test would also pass on a fetch failure for the wrong reason.
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();

  await page.getByTestId('search-input').fill('zzqxxnonexistent999');
  await expect(page.getByTestId('search-empty')).toBeVisible();
  await expect(page.getByTestId('search-results').locator('> div')).toHaveCount(0);
});

test('shows an error toast when the database fails to load', async ({ page }) => {
  await page.route('**/chests.json', route => route.abort('failed'));
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('toast')).toHaveAttribute('data-test-type', 'error');
});

// ── Position search ──────────────────────────────────────────────────────────

test('a digit-only query searches by position instead of fuzzy text', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('1,2,3,5,5,6');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await expect(page.getByTestId('search-results').locator('> div')).toHaveCount(1);
  const activeHoles = page.locator('[data-test-id^="search-result-0-hole-"][data-active="true"]');
  await expect(activeHoles).toHaveCount(6);
});

test('a compact digit string with no separators is parsed one digit per position', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('123556');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  const activeHoles = page.locator('[data-test-id^="search-result-0-hole-"][data-active="true"]');
  await expect(activeHoles).toHaveCount(6);
});

test('a +1-shifted compact query still matches the stored 0-based position', async ({ page }) => {
  // Fixture stored as [1,2,3,5,5,6]; typing the same shifted up by one ("234667")
  // must still find it, covering users who count positions starting from 1.
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('234667');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  const activeHoles = page.locator('[data-test-id^="search-result-0-hole-"][data-active="true"]');
  await expect(activeHoles).toHaveCount(6);
});

// ── Keyboard navigation ──────────────────────────────────────────────────────

test('ArrowDown moves selection without losing focus from the input', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('тест'); // matches both fixture entries
  await expect(page.getByTestId('search-results').locator('> div')).toHaveCount(2);

  await expect(page.getByTestId('search-result-0')).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('search-input').press('ArrowDown');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await expect(page.getByTestId('search-result-1')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('search-result-0')).toHaveAttribute('data-selected', 'false');
});

test('ArrowUp wraps from the first to the last result', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('тест');
  await expect(page.getByTestId('search-results').locator('> div')).toHaveCount(2);

  await page.getByTestId('search-input').press('ArrowUp'); // from index 0, wraps to last (index 1)
  await expect(page.getByTestId('search-result-1')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('search-input')).toBeFocused();
});

test('Enter applies the currently selected result', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('search-dialog')).toBeHidden();
});

// ── Applying a result ────────────────────────────────────────────────────────

test('clicking a result loads its config and closes the dialog', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('тестовый лагерь');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await page.getByTestId('search-result-0').click();
  await expect(page.getByTestId('search-dialog')).toBeHidden();
  await expect(page.getByTestId('stage-config')).toBeVisible();
});

test('applying a result updates the plate count to match the entry', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('1,2,3,5,5,6');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await page.getByTestId('search-result-0').click();
  await expect(page.getByTestId('val-plates')).toHaveText('6');
});

test('applying a result shows a success toast', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await page.getByTestId('search-result-0').click();
  await expect(page.getByTestId('toast')).toHaveAttribute('data-test-type', 'success');
});

test('applying a search result while on the solve stage switches back to config', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), SIMPLE_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

  // The search button lives in the config panel only — Ctrl+K is the only way in from solve
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('search-dialog')).toBeVisible();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await page.getByTestId('search-result-0').click();

  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

// ── Result card layout ───────────────────────────────────────────────────────

test('result card shows an image placeholder when entry has no image', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('арена');
  await expect(page.getByTestId('search-result-0-placeholder')).toBeVisible();
});

test('result card preview renders one plate row per cell with one active hole each', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('1,2,3,5,5,6');
  await expect(page.getByTestId('search-result-0')).toBeVisible();

  const plates = page.locator('[data-test-id^="search-result-0-plate-"]');
  const holes = page.locator('[data-test-id^="search-result-0-hole-"]');
  const activeHoles = page.locator('[data-test-id^="search-result-0-hole-"][data-active="true"]');
  await expect(plates).toHaveCount(6);
  await expect(holes).toHaveCount(6 * 7);
  await expect(activeHoles).toHaveCount(6);
});

// ── Localization ─────────────────────────────────────────────────────────────

test('search dialog texts switch to English', async ({ page }) => {
  await page.getByTestId('lang-en').click();
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-dialog-title')).toHaveText('Search the database');
  await expect(page.getByTestId('search-input')).toHaveAttribute('placeholder', 'Name, tag, or positions...');
});

test('search dialog texts switch to Ukrainian', async ({ page }) => {
  await page.getByTestId('lang-uk').click();
  await page.getByTestId('btn-search-db').click();
  await expect(page.getByTestId('search-dialog-title')).toHaveText('Пошук по базі');
  await expect(page.getByTestId('search-input')).toHaveAttribute('placeholder', 'Назва, тег або позиції...');
});

test('no-results message is localized to English', async ({ page }) => {
  await page.getByTestId('lang-en').click();
  await page.getByTestId('btn-search-db').click();
  await page.getByTestId('search-input').fill('zzqxxnonexistent999');
  await expect(page.getByTestId('search-empty')).toHaveText('No results found');
});

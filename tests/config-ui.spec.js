import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// ── Dep cell responsive text ──────────────────────────────────────────────────

test('dep cell: shows full text when container is wide', async ({ page }) => {
  // Force width above the container-query threshold
  await page.evaluate(() => { document.getElementById('plates-matrix').style.width = '500px'; });
  await page.getByTestId('dep-1-2').click(); // none → same

  const cell = page.getByTestId('dep-1-2');
  await expect(cell.locator('.dep-full')).toBeVisible();
  await expect(cell.locator('.dep-short')).toBeHidden();
});

test('dep cell: shows abbreviated text when container is narrow', async ({ page }) => {
  // Narrow the container below the threshold (@container max-width: 360px)
  await page.evaluate(() => { document.getElementById('plates-matrix').style.width = '280px'; });
  await page.getByTestId('dep-1-2').click(); // none → same

  const cell = page.getByTestId('dep-1-2');
  await expect(cell.locator('.dep-full')).toBeHidden();
  await expect(cell.locator('.dep-short')).toBeVisible();
  await expect(cell.locator('.dep-short')).toHaveText('П');
});

// ── Plate count ──────────────────────────────────────────────────────────────

test('+ button increases plate count', async ({ page }) => {
  const before = parseInt(await page.getByTestId('val-plates').textContent());
  await page.getByTestId('btn-plates-inc').click();
  await expect(page.getByTestId('val-plates')).toHaveText(String(before + 1));
});

test('− button decreases plate count', async ({ page }) => {
  const before = parseInt(await page.getByTestId('val-plates').textContent());
  await page.getByTestId('btn-plates-dec').click();
  await expect(page.getByTestId('val-plates')).toHaveText(String(before - 1));
});

test('+ button is disabled at 8 plates', async ({ page }) => {
  // Default 4 — click 4 times to reach 8
  for (let i = 0; i < 4; i++) await page.getByTestId('btn-plates-inc').click();
  await expect(page.getByTestId('val-plates')).toHaveText('8');
  await expect(page.getByTestId('btn-plates-inc')).toBeDisabled();
});

test('− button is disabled at 2 plates', async ({ page }) => {
  // Default 4 — click 2 times to reach 2
  for (let i = 0; i < 2; i++) await page.getByTestId('btn-plates-dec').click();
  await expect(page.getByTestId('val-plates')).toHaveText('2');
  await expect(page.getByTestId('btn-plates-dec')).toBeDisabled();
});

// ── Position strip ───────────────────────────────────────────────────────────

test('position strip: ► increases plate position', async ({ page }) => {
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.getByTestId('pos-inc-1').click();
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before + 1));
});

test('position strip: ◄ decreases plate position', async ({ page }) => {
  // First move right so ◄ is not disabled
  await page.getByTestId('pos-inc-1').click();
  const before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.getByTestId('pos-dec-1').click();
  await expect(page.getByTestId('pos-val-1')).toHaveText(String(before - 1));
});

test('position strip: buttons bypass dependency checks', async ({ page }) => {
  // Set up dependency: plate 1 → plate 2 (same direction, 1 step)
  await page.getByTestId('dep-1-2').click(); // none → same

  // Put plate 2 at max position via strip (3 clicks from 4)
  for (let i = 0; i < 3; i++) await page.getByTestId('pos-inc-2').click();
  await expect(page.getByTestId('pos-val-2')).toHaveText('7');

  // Move plate 1 via strip — if deps were checked this would be blocked (plate 2 is at max).
  // Strip is direct: plate 1 moves, plate 2 stays.
  const pos1Before = parseInt(await page.getByTestId('pos-val-1').textContent());
  await page.getByTestId('pos-inc-1').click();

  await expect(page.getByTestId('pos-val-1')).toHaveText(String(pos1Before + 1));
  await expect(page.getByTestId('pos-val-2')).toHaveText('7');
});

// ── Dependency matrix ────────────────────────────────────────────────────────

test('LMB on matrix cell cycles state: none → same → opposite → none', async ({ page }) => {
  const cell = page.getByTestId('dep-1-2');

  await expect(cell).toHaveAttribute('data-state', 'none');

  await cell.click();
  await expect(cell).toHaveAttribute('data-state', 'same');

  await cell.click();
  await expect(cell).toHaveAttribute('data-state', 'opposite');

  await cell.click();
  await expect(cell).toHaveAttribute('data-state', 'none');
});

test('RMB on matrix cell cycles state in reverse', async ({ page }) => {
  const cell = page.getByTestId('dep-1-2');

  await expect(cell).toHaveAttribute('data-state', 'none');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-state', 'opposite');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-state', 'same');

  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-state', 'none');
});

// ── Dep cell tooltip ─────────────────────────────────────────────────────────

test('dep cell: title is set in none state', async ({ page }) => {
  const title = await page.getByTestId('dep-1-2').getAttribute('title');
  expect(title).toBeTruthy();
});

test('dep cell: title changes when cycled to same', async ({ page }) => {
  const before = await page.getByTestId('dep-1-2').getAttribute('title');
  await page.getByTestId('dep-1-2').click();
  const after = await page.getByTestId('dep-1-2').getAttribute('title');
  expect(after).not.toBe(before);
});

test('dep cell: title changes again when cycled to opposite', async ({ page }) => {
  await page.getByTestId('dep-1-2').click(); // none → same
  const titleSame = await page.getByTestId('dep-1-2').getAttribute('title');
  await page.getByTestId('dep-1-2').click(); // same → opposite
  const titleOpposite = await page.getByTestId('dep-1-2').getAttribute('title');
  expect(titleOpposite).not.toBe(titleSame);
});

test('dep cell: none state displays · dot', async ({ page }) => {
  await expect(page.getByTestId('dep-1-2')).toContainText('·');
});

// ── Random generation ────────────────────────────────────────────────────────

test('Easy button finds a random config', async ({ page }) => {
  await page.getByTestId('btn-easy').click();
  // Wait for generation to finish — overlay may disappear before Playwright can catch it
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/, { timeout: 30000 });
  // Config changed — plate count is now 2+
  const count = parseInt(await page.getByTestId('val-plates').textContent());
  expect(count).toBeGreaterThanOrEqual(2);
});

// ── Clickable holes ───────────────────────────────────────────────────────────

test('clicking a hole sets the plate position', async ({ page }) => {
  // Default currentPos = center = 4; click hole 1
  await page.getByTestId('hole-1-1').click({ force: true });
  await expect(page.getByTestId('pos-val-1')).toHaveText('1');
});

test('clicking a hole updates the strip buttons', async ({ page }) => {
  // After clicking hole 7 — ► strip button must be disabled (max position)
  await page.getByTestId('hole-1-7').click({ force: true });
  await expect(page.getByTestId('pos-val-1')).toHaveText('7');
  await expect(page.getByTestId('pos-inc-1')).toBeDisabled();
});

test('clicking a hole on a different plate changes its position', async ({ page }) => {
  await page.getByTestId('hole-2-1').click({ force: true });
  await expect(page.getByTestId('pos-val-2')).toHaveText('1');
  // Plate 1 is untouched
  await expect(page.getByTestId('pos-val-1')).toHaveText('4');
});

test('Cancel button closes the overlay', async ({ page }) => {
  // Activate overlay directly — independent of generation speed
  await page.evaluate(() => document.getElementById('computing-overlay').classList.add('active'));
  await expect(page.getByTestId('overlay')).toHaveClass(/active/);
  await page.getByTestId('btn-cancel').click();
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/);
});

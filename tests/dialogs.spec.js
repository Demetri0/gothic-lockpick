import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('clicking the backdrop closes the import dialog', async ({ page }) => {
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));
  const dlg = page.getByTestId('import-dialog');
  await expect(dlg).toBeVisible();
  const box = await dlg.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y / 2);   // backdrop above the centred dialog
  await expect(dlg).toBeHidden();
});

test('clicking inside the import dialog keeps it open', async ({ page }) => {
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
});

test('clicking the backdrop closes the search dialog', async ({ page }) => {
  await page.getByTestId('btn-search-db').click();
  const dlg = page.getByTestId('search-dialog');
  await expect(dlg).toBeVisible();
  const box = await dlg.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y / 2);
  await expect(dlg).toBeHidden();
});

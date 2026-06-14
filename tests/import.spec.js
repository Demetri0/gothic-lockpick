import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const VALID_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 5, deps: [] },
]);

test('valid config is applied', async ({ page }) => {
  await page.evaluate((cfg) => openImportDialog(cfg), VALID_CONFIG);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('2');
});

test('invalid JSON is rejected', async ({ page }) => {
  await page.evaluate(() => openImportDialog('{broken json'));
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('ids not starting from 1 are rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 2, positions: 7, currentPos: 3, deps: [] },
    { id: 3, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('self-dependency in deps is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 1, direction: 'same', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('invalid direction in dep is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'sideways', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('different positions across plates are rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [] },
    { id: 2, positions: 5, currentPos: 3, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('currentPos out of range is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 0, deps: [] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('even positions count is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 4, currentPos: 2, deps: [] },
    { id: 2, positions: 4, currentPos: 2, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

// ── Gothic INI / informal format parser ──────────────────────────────────────

test('gothic format: compact digits + rules (digits first)', async ({ page }) => {
  // "02556 , A:D-; C:A-,D-; D:C-; E:C+"  → 5 plates, pos 1,3,6,6,7
  const result = await page.evaluate(() =>
    parseGothicFormat('02556 , A:D-; C:A-,D-; D:C-; E:C+')
  );
  expect(result).toHaveLength(5);
  expect(result[0].currentPos).toBe(1); // 0+1
  expect(result[1].currentPos).toBe(3); // 2+1
  expect(result[4].currentPos).toBe(7); // 6+1
  // A → D opposite
  expect(result[0].deps).toContainEqual({ targetId: 4, direction: 'opposite', steps: 1 });
  // C → A same
  expect(result[2].deps).toContainEqual({ targetId: 1, direction: 'opposite', steps: 1 });
  // E → C same
  expect(result[4].deps).toContainEqual({ targetId: 3, direction: 'same', steps: 1 });
});

test('gothic format: compact digits + rules (digits first, no comma)', async ({ page }) => {
  // "605410 A:B-,C-,F+;D:A-,F+;E:D+,F-;F:B+"  → 6 plates
  const result = await page.evaluate(() =>
    parseGothicFormat('605410 A:B-,C-,F+;D:A-,F+;E:D+,F-;F:B+')
  );
  expect(result).toHaveLength(6);
  expect(result[0].currentPos).toBe(7); // 6+1
  expect(result[3].currentPos).toBe(5); // 4+1
  expect(result[4].currentPos).toBe(2); // 1+1
  expect(result[5].currentPos).toBe(1); // 0+1
  expect(result[0].deps).toContainEqual({ targetId: 6, direction: 'same', steps: 1 });
});

test('gothic format: rules first, digits at end', async ({ page }) => {
  // "A:B+;B:C-,D-;D:A-,B-,C-,E-;E:A+,B-,C- 52401"
  const result = await page.evaluate(() =>
    parseGothicFormat('A:B+;B:C-,D-;D:A-,B-,C-,E-;E:A+,B-,C- 52401')
  );
  expect(result).toHaveLength(5);
  expect(result[0].currentPos).toBe(6); // 5+1
  expect(result[4].currentPos).toBe(2); // 1+1
  expect(result[0].deps).toContainEqual({ targetId: 2, direction: 'same', steps: 1 });
  expect(result[3].deps).toContainEqual({ targetId: 5, direction: 'opposite', steps: 1 });
});

test('gothic format: rules with explicit start_pos= key', async ({ page }) => {
  // "A:B-,C+;C:A+,E-;D:B-,C-,F+;E:D-,F+;F:A+;\nstart_pos=134644"
  const result = await page.evaluate(() =>
    parseGothicFormat('A:B-,C+;C:A+,E-;D:B-,C-,F+;E:D-,F+;F:A+;\nstart_pos=134644')
  );
  expect(result).toHaveLength(6);
  expect(result[0].currentPos).toBe(2); // 1+1
  expect(result[2].currentPos).toBe(5); // 4+1
  expect(result[5].currentPos).toBe(5); // 4+1
  expect(result[2].deps).toContainEqual({ targetId: 1, direction: 'same', steps: 1 });
});

test('gothic format: full INI entry', async ({ page }) => {
  const ini = `[старый_лагерь]
name="Старый лагерь, сундук"
cells=6
rules="B:D-;C:B-,D-,E-;D:E-;E:A+,B-,D-;F:D-"
start_pos="1,2,3,5,5,6"
tags="старый лагерь"`;
  const result = await page.evaluate((s) => parseGothicFormat(s), ini);
  expect(result).toHaveLength(6);
  expect(result[0].currentPos).toBe(2); // 1+1
  expect(result[5].currentPos).toBe(7); // 6+1
  // B → D opposite
  expect(result[1].deps).toContainEqual({ targetId: 4, direction: 'opposite', steps: 1 });
  // E → A same
  expect(result[4].deps).toContainEqual({ targetId: 1, direction: 'same', steps: 1 });
});

test('gothic format: no positions defaults to center (4)', async ({ page }) => {
  const result = await page.evaluate(() =>
    parseGothicFormat('A:B+;B:C-')
  );
  expect(result).toHaveLength(3);
  expect(result.every(p => p.currentPos === 4)).toBe(true);
});

test('gothic format: applied via import dialog', async ({ page }) => {
  await page.evaluate(() => openImportDialog('02556 , A:D-; C:A-,D-; D:C-; E:C+'));
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('5');
});

test('Escape closes the dialog without applying config', async ({ page }) => {
  const platesBefore = await page.getByTestId('val-plates').textContent();

  await page.evaluate(() => openImportDialog('[{"id":1,"positions":7,"currentPos":3,"deps":[]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'));
  await expect(page.getByTestId('import-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  await expect(page.getByTestId('val-plates')).toHaveText(platesBefore);
});

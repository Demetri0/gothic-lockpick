import { test, expect } from '@playwright/test';
import { expectPosDigit } from './helpers.js';

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

test('positions below 3 are rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 1, currentPos: 1, deps: [] },
    { id: 2, positions: 1, currentPos: 1, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('fewer than 2 plates is rejected', async ({ page }) => {
  const cfg = JSON.stringify([{ id: 1, positions: 7, currentPos: 4, deps: [] }]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('more than 8 plates is rejected', async ({ page }) => {
  const cfg = JSON.stringify(
    Array.from({ length: 9 }, (_, i) => ({ id: i + 1, positions: 7, currentPos: 4, deps: [] }))
  );
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('JSON that is not an array is rejected', async ({ page }) => {
  await page.evaluate(() => openImportDialog('{"id":1,"positions":7,"currentPos":4,"deps":[]}'));
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('dependency targetId out of range is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 5, direction: 'same', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Невалидный конфиг');
});

test('dependency with steps below 1 is rejected', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 0 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
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

// INI-entry / rules-only / positions-defaulting parsing was removed from the app
// (the parser now requires both positions and rules and knows nothing about
// chests.ini). Those cases are covered by parseRules unit tests in
// tests/config-parsers.spec.js and by the DB pipeline's own parser.

test('gothic format: applied via import dialog', async ({ page }) => {
  await page.evaluate(() => openImportDialog('02556 , A:D-; C:A-,D-; D:C-; E:C+'));
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('5');
});

test('dotted format: applied via import dialog', async ({ page }) => {
  await page.evaluate(() => openImportDialog('3.531.saaoaa'));
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('3');
});

test('bytearray (unlockmyloot v2) code applied via import dialog', async ({ page }) => {
  await page.evaluate(() => openImportDialog('gBDXAECQhAAQAQAIRAA'));
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('7');
});

// ── Gothic export (serializeGothicFormat) ────────────────────────────────────

test('export: gothic format contains position digits and rules', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 1, deps: [{ targetId: 3, direction: 'opposite', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 5, deps: [{ targetId: 3, direction: 'same',     steps: 1 }] },
      { id: 3, positions: 7, currentPos: 1, deps: [] },
    ];
    return serializeGothicFormat(plates);
  });
  // positions: currentPos-1 → 0,4,0 → "040"
  expect(result).toMatch(/^040 /);
  // A→C opposite, B→C same
  expect(result).toContain('A:C-');
  expect(result).toContain('B:C+');
});

test('export: gothic format round-trips through parser', async ({ page }) => {
  const original = [
    { id: 1, positions: 7, currentPos: 2, deps: [{ targetId: 2, direction: 'same',     steps: 1 }] },
    { id: 2, positions: 7, currentPos: 6, deps: [{ targetId: 1, direction: 'opposite', steps: 1 }] },
    { id: 3, positions: 7, currentPos: 4, deps: [] },
  ];
  const reparsed = await page.evaluate((plates) => {
    const gothic = serializeGothicFormat(plates);
    return parseGothicFormat(gothic);
  }, original);
  expect(reparsed).toHaveLength(3);
  expect(reparsed[0].currentPos).toBe(2);
  expect(reparsed[1].currentPos).toBe(6);
  expect(reparsed[0].deps).toContainEqual({ targetId: 2, direction: 'same',     steps: 1 });
  expect(reparsed[1].deps).toContainEqual({ targetId: 1, direction: 'opposite', steps: 1 });
});

// ── Complex parser scenarios ──────────────────────────────────────────────────

test('gothic format: real example (040615 multiline)', async ({ page }) => {
  // The actual puzzle shared by user: 040615 / e:f-;f:b-,e+;d:c+,e-;b:c+,d-;a:c-
  const result = await page.evaluate(() =>
    parseGothicFormat('040615\ne:f-;f:b-,e+;d:c+,e-;b:c+,d-;a:c-;')
  );
  expect(result).toHaveLength(6);
  // positions: 0,4,0,6,1,5 → +1 → 1,5,1,7,2,6
  expect(result[0].currentPos).toBe(1);
  expect(result[1].currentPos).toBe(5);
  expect(result[2].currentPos).toBe(1);
  expect(result[3].currentPos).toBe(7);
  expect(result[4].currentPos).toBe(2);
  expect(result[5].currentPos).toBe(6);
  // a:c-  → A→C opposite
  expect(result[0].deps).toContainEqual({ targetId: 3, direction: 'opposite', steps: 1 });
  // b:c+,d-  → B→C same, B→D opposite
  expect(result[1].deps).toContainEqual({ targetId: 3, direction: 'same',     steps: 1 });
  expect(result[1].deps).toContainEqual({ targetId: 4, direction: 'opposite', steps: 1 });
  // d:c+,e-  → D→C same, D→E opposite
  expect(result[3].deps).toContainEqual({ targetId: 3, direction: 'same',     steps: 1 });
  expect(result[3].deps).toContainEqual({ targetId: 5, direction: 'opposite', steps: 1 });
  // e:f-  → E→F opposite
  expect(result[4].deps).toContainEqual({ targetId: 6, direction: 'opposite', steps: 1 });
  // f:b-,e+  → F→B opposite, F→E same
  expect(result[5].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 });
  expect(result[5].deps).toContainEqual({ targetId: 5, direction: 'same',     steps: 1 });
  // c has no deps
  expect(result[2].deps).toHaveLength(0);
});

test('gothic format: plate with many deps (D has 4 targets)', async ({ page }) => {
  // D:A-,B-,C-,E- — one plate driving 4 others
  const result = await page.evaluate(() =>
    parseGothicFormat('A:B+;B:C-,D-;D:A-,B-,C-,E-;E:A+,B-,C- 52401')
  );
  expect(result[3].deps).toHaveLength(4);
  expect(result[3].deps).toContainEqual({ targetId: 1, direction: 'opposite', steps: 1 });
  expect(result[3].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 });
  expect(result[3].deps).toContainEqual({ targetId: 3, direction: 'opposite', steps: 1 });
  expect(result[3].deps).toContainEqual({ targetId: 5, direction: 'opposite', steps: 1 });
});

test('gothic format: tabs as separators between digits and rules', async ({ page }) => {
  const result = await page.evaluate(() =>
    parseGothicFormat('33241\tA:B-,C+;D:E+')
  );
  expect(result).toHaveLength(5);
  expect(result[0].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 });
  expect(result[3].deps).toContainEqual({ targetId: 5, direction: 'same', steps: 1 });
});

test('gothic format: multiple spaces between tokens', async ({ page }) => {
  const result = await page.evaluate(() =>
    parseGothicFormat('33241   A:B-,  C+;  D:E+')
  );
  expect(result).toHaveLength(5);
  expect(result[0].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 });
  expect(result[0].deps).toContainEqual({ targetId: 3, direction: 'same',     steps: 1 });
});

test('gothic format: tabs inside rules around colon and comma', async ({ page }) => {
  const result = await page.evaluate(() =>
    parseGothicFormat('33241 A:\tB-,\tC+;\tD:E+')
  );
  expect(result).toHaveLength(5);
  expect(result[0].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 });
  expect(result[0].deps).toContainEqual({ targetId: 3, direction: 'same',     steps: 1 });
});

test('gothic format: leading/trailing whitespace and newlines around rules', async ({ page }) => {
  const result = await page.evaluate(() =>
    parseGothicFormat('  \n  33241  \n  A:B-,C+;D:E+  \n  ')
  );
  expect(result).toHaveLength(5);
  expect(result[0].currentPos).toBe(4); // 3+1
  expect(result[0].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 });
});

test('gothic format: all-lowercase rules parse identically to uppercase', async ({ page }) => {
  const upper = await page.evaluate(() => parseGothicFormat('33241 A:B-,C+;D:E+'));
  const lower = await page.evaluate(() => parseGothicFormat('33241 a:b-,c+;d:e+'));
  expect(lower).toEqual(upper);
});

test('gothic format: mixed-case rules are normalised correctly', async ({ page }) => {
  // a:B- and A:b- and a:b- should all produce the same dep
  const result = await page.evaluate(() =>
    parseGothicFormat('3333 a:B-;C:d+')
  );
  expect(result[0].deps).toContainEqual({ targetId: 2, direction: 'opposite', steps: 1 }); // a→B
  expect(result[2].deps).toContainEqual({ targetId: 4, direction: 'same',     steps: 1 }); // C→d
});

test('gothic format: plates with no rules produce empty deps', async ({ page }) => {
  // Only A and C have rules; B, D, E have none
  const result = await page.evaluate(() =>
    parseGothicFormat('33333 A:B+;C:D-')
  );
  expect(result[1].deps).toHaveLength(0); // B
  expect(result[3].deps).toHaveLength(0); // D
  expect(result[4].deps).toHaveLength(0); // E
});

test('gothic format: fewer positions than rule letters is rejected', async ({ page }) => {
  // 2 positions but rules mention A, B, C → dep targetId out of range → validatePlates rejects
  const r = await page.evaluate(() => parseImportConfig('04 A:B-,C+'));
  expect(r).toBeNull();
});

test('gothic format: more than 8 positions is rejected', async ({ page }) => {
  // a 9-digit run cannot be a valid positions field → no config recognised
  const r = await page.evaluate(() => parseImportConfig('123456789 A:B-'));
  expect(r).toBeNull();
});

// ── Complex export / round-trip scenarios ─────────────────────────────────────

test('export: no-deps config serializes to digits only', async ({ page }) => {
  const result = await page.evaluate(() => {
    const plates = [
      { id: 1, positions: 7, currentPos: 3, deps: [] },
      { id: 2, positions: 7, currentPos: 5, deps: [] },
      { id: 3, positions: 7, currentPos: 7, deps: [] },
    ];
    return serializeGothicFormat(plates);
  });
  expect(result).toBe('246'); // currentPos-1: 2,4,6
});

test('export: round-trip preserves complex 6-plate config', async ({ page }) => {
  // Use the 040615 example and verify full round-trip
  const original = await page.evaluate(() =>
    parseGothicFormat('040615\ne:f-;f:b-,e+;d:c+,e-;b:c+,d-;a:c-;')
  );
  const reparsed = await page.evaluate((plates) => {
    const gothic = serializeGothicFormat(plates);
    return parseGothicFormat(gothic);
  }, original);
  expect(reparsed).toHaveLength(6);
  for (let i = 0; i < 6; i++) {
    expect(reparsed[i].currentPos).toBe(original[i].currentPos);
    expect(reparsed[i].deps).toEqual(expect.arrayContaining(original[i].deps));
    expect(reparsed[i].deps).toHaveLength(original[i].deps.length);
  }
});

test('gothic format: applied via dialog updates plate count and positions', async ({ page }) => {
  // 040615 = 6 plates; plate 4 (D) should be at pos 7
  await page.evaluate(() => openImportDialog('040615\ne:f-;f:b-,e+;d:c+,e-;b:c+,d-;a:c-;'));
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Конфиг применён');
  await expect(page.getByTestId('val-plates')).toHaveText('6');
  await expectPosDigit(page, 4, 7);
  await expectPosDigit(page, 1, 1);
});

test('Escape closes the dialog without applying config', async ({ page }) => {
  const platesBefore = await page.getByTestId('val-plates').textContent();

  await page.evaluate(() => openImportDialog('[{"id":1,"positions":7,"currentPos":3,"deps":[]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'));
  await expect(page.getByTestId('import-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  await expect(page.getByTestId('val-plates')).toHaveText(platesBefore);
});

test('8-plate Gothic export round-trips a dependency on plate H', async ({ page }) => {
  // serialize emits letters up to H for plate 8; the parser must accept H too,
  // otherwise any dependency touching plate 8 is silently dropped on re-import.
  const ok = await page.evaluate(() => {
    const plates = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, positions: 7, currentPos: 4, deps: [] }));
    plates[0].deps.push({ targetId: 8, direction: 'opposite', steps: 1 }); // A -> H opposite
    const parsed = parseImportConfig(serializeGothicFormat(plates));
    const p1 = parsed && parsed.find(p => p.id === 1);
    return !!p1 && p1.deps.some(d => d.targetId === 8 && d.direction === 'opposite');
  });
  expect(ok).toBe(true);
});

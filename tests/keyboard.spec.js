import { test, expect } from '@playwright/test';
import { posDigit, expectPosDigit, expectActivePlate, startSolve } from './helpers.js';

const SIMPLE_CONFIG = JSON.stringify([
  { id: 1, positions: 7, currentPos: 6, deps: [] },
  { id: 2, positions: 7, currentPos: 6, deps: [] },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// ── Config stage ─────────────────────────────────────────────────────────────

test('D moves the active plate right', async ({ page }) => {
  const before = parseInt(await posDigit(page, 1));
  await page.keyboard.press('d');
  await expectPosDigit(page, 1, before - 1);
});

test('A moves the active plate left', async ({ page }) => {
  // First press D so A has room to move back
  await page.keyboard.press('d');
  const before = parseInt(await posDigit(page, 1));
  await page.keyboard.press('a');
  await expectPosDigit(page, 1, before + 1);
});

test('W/S switch the active plate', async ({ page }) => {
  // Plate 1 is active by default
  await expectActivePlate(page, 1);

  await page.keyboard.press('w');
  await expectActivePlate(page, 2);

  await page.keyboard.press('s');
  await expectActivePlate(page, 1);
});

test('arrows drive the position lock in config (↓ value, → selection)', async ({ page }) => {
  // ArrowDown decreases the active plate's value (like its − button)
  const before = parseInt(await posDigit(page, 1));
  await page.keyboard.press('ArrowDown');
  await expectPosDigit(page, 1, before - 1);

  // ArrowRight moves the selection to the next plate (does not change values)
  await page.keyboard.press('ArrowRight');
  await expectActivePlate(page, 2);
});

test('ArrowUp increases the active plate value; arrows do not move plates', async ({ page }) => {
  const before = parseInt(await posDigit(page, 1));
  await page.keyboard.press('ArrowUp');
  await expectPosDigit(page, 1, before + 1);
});

test('global Backspace removes the active plate without a focused input', async ({ page }) => {
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expect(page.getByTestId('pos-input-4')).toHaveCount(0);
});

test('config stage: A/D moves only the active plate — dependencies are neither applied nor blocking', async ({ page }) => {
  // Plate 1 depends on plate 2 (same). Plate 2 sits at the max, so a linked move
  // WOULD be blocked if config-stage moves applied dependencies. They must not:
  // editing the initial config moves one disc freely, ignoring the puzzle rules.
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 7, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await page.keyboard.press('a');            // left → plate 1 4→5; a same-dep would push plate 2 7→8 (blocked)
  await expectPosDigit(page, 1, 5);          // active plate moved freely
  await expectPosDigit(page, 2, 7);          // dependency neither applied nor blocking
});

test('solve stage: A/D applies dependencies to linked plates', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await startSolve(page, cfg);
  await page.keyboard.press('d');            // right → plate 1 4→3, same-dep drags plate 2 4→3
  const pos = await page.evaluate(() => state.plates.map(p => p.currentPos));
  expect(pos).toEqual([3, 3]);               // dependency applied on the solve stage
});

test('D at the left boundary does not move the plate', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 1, deps: [] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await page.evaluate((c) => openImportDialog(c), cfg);
  await page.getByTestId('import-dialog-ok').click();

  await page.keyboard.press('d');
  await expectPosDigit(page, 1, 1);
});

test('WASD is suppressed while the computing overlay is active', async ({ page }) => {
  const before = parseInt(await posDigit(page, 1));

  // Activate overlay directly — independent of generation speed
  await page.evaluate(() => document.getElementById('computing-overlay').classList.add('active'));
  await page.keyboard.press('d');

  // Position must not change
  await expectPosDigit(page, 1, before);

  await page.evaluate(() => document.getElementById('computing-overlay').classList.remove('active'));
});

// ── Solve stage ──────────────────────────────────────────────────────────────

test('D in solve stage enters explore mode and moves the plate', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Before press — following mode, at start step
  await expect(page.getByTestId('step-start')).toHaveClass(/active/);

  // D → enters explore mode; separator appears
  await page.keyboard.press('d');
  await expect(page.getByTestId('explore-separator')).toBeVisible();
});

test('a blocked first solve-stage move stays in following mode', async ({ page }) => {
  const cfg = JSON.stringify([
    { id: 1, positions: 7, currentPos: 1, deps: [] },   // active plate at the min
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]);
  await startSolve(page, cfg);
  await page.keyboard.press('d');   // right → plate 1 would go to 0: blocked, no move happens
  expect(await page.evaluate(() => state.solveMode)).toBe('following');
  await expect(page.getByTestId('explore-separator')).toBeHidden();
});

test('A in explore mode collapses the opposite move', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // D then A — two moves cancel each other
  await page.keyboard.press('d');
  await expect(page.getByTestId('explore-step-1')).toBeVisible();
  await page.keyboard.press('a');
  // After collapse, explore history is empty
  await expect(page.getByTestId('explore-step-1')).not.toBeAttached();
});

test('clicking the separator returns to following mode', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  await page.keyboard.press('d');
  await expect(page.getByTestId('explore-separator')).toBeVisible();

  await page.getByTestId('explore-separator').click();
  // Separator gone — back in following mode
  await expect(page.getByTestId('explore-separator')).not.toBeAttached();
  await expect(page.getByTestId('step-start')).toHaveClass(/active/);
});

test('clicking a completed BFS step returns to following mode at that step', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Advance to BFS step 1, then enter explore
  await page.getByTestId('btn-step').click();
  await page.keyboard.press('d');
  await expect(page.getByTestId('explore-separator')).toBeVisible();

  // Click the completed step 1 (step-done-1)
  await page.getByTestId('step-done-1').click();
  await expect(page.getByTestId('explore-separator')).not.toBeAttached();
  await expect(page.getByTestId('step-1')).toHaveClass(/active/);
});

test('W switches the active plate in solve stage', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Switch to plate 2, then enter explore — notation should reference plate 2
  await page.keyboard.press('w');
  await page.keyboard.press('d');
  await expect(page.getByTestId('explore-step-1')).toContainText('2');
});

test('repeated D on the same plate collapses into one entry with step count', async ({ page }) => {
  await startSolve(page, SIMPLE_CONFIG);

  // Three D presses — exactly one history entry
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await expect(page.getByTestId('explore-step-1')).toBeVisible();
  await expect(page.getByTestId('explore-step-2')).not.toBeAttached();
  // Notation must contain the digit 3
  await expect(page.getByTestId('explore-step-1')).toContainText('3');
});

import { test, expect } from '@playwright/test';
import { posDigit, expectPosDigit } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Dispatch a synthetic paste of `text` onto the element behind `locator`. */
async function pasteInto(locator, text) {
  await locator.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

// ── Dep cell responsive text ──────────────────────────────────────────────────

test('dep cell: shows full text when container is wide', async ({ page }) => {
  // Force width above the container-query threshold
  await page.evaluate(() => { document.getElementById('plates-matrix').style.width = '500px'; });
  await page.getByTestId('dep-1-2').click(); // none → same

  const cell = page.getByTestId('dep-1-2');
  await expect(cell.getByTestId('dep-full')).toBeVisible();
  await expect(cell.getByTestId('dep-short')).toBeHidden();
});

test('dep cell: shows a direction icon when container is narrow', async ({ page }) => {
  // Narrow the container below the threshold (@container max-width: 360px)
  await page.evaluate(() => { document.getElementById('plates-matrix').style.width = '280px'; });
  const cell = page.getByTestId('dep-1-2');
  const short = cell.getByTestId('dep-short');

  await cell.click(); // none → same
  await expect(cell.getByTestId('dep-full')).toBeHidden();
  await expect(short).toBeVisible();
  await expect(short.getByTestId('dep-icon')).toHaveAttribute('data-dep', 'same');

  await cell.click(); // same → opposite
  await expect(short.getByTestId('dep-icon')).toHaveAttribute('data-dep', 'opposite');

  await cell.click(); // opposite → none — falls back to the · dot, no icon
  await expect(short.getByTestId('dep-icon')).toHaveCount(0);
  await expect(short).toHaveText('·');
});

// ── Position lock ────────────────────────────────────────────────────────────

test('position lock: + increases plate position', async ({ page }) => {
  const before = parseInt(await posDigit(page, 1));
  await page.getByTestId('pos-inc-1').click();
  await expectPosDigit(page, 1, before + 1);
});

test('position lock: − decreases plate position', async ({ page }) => {
  // First move right so − is not disabled
  await page.getByTestId('pos-inc-1').click();
  const before = parseInt(await posDigit(page, 1));
  await page.getByTestId('pos-dec-1').click();
  await expectPosDigit(page, 1, before - 1);
});

test('position lock: buttons bypass dependency checks', async ({ page }) => {
  // Set up dependency: plate 1 → plate 2 (same direction, 1 step)
  await page.getByTestId('dep-1-2').click(); // none → same

  // Put plate 2 at max position via the lock (3 clicks from 4)
  for (let i = 0; i < 3; i++) await page.getByTestId('pos-inc-2').click();
  await expectPosDigit(page, 2, 7);

  // Move plate 1 via the lock — if deps were checked this would be blocked (plate 2 is at max).
  // The lock is direct: plate 1 moves, plate 2 stays.
  const pos1Before = parseInt(await posDigit(page, 1));
  await page.getByTestId('pos-inc-1').click();

  await expectPosDigit(page, 1, pos1Before + 1);
  await expectPosDigit(page, 2, 7);
});

test('position lock: typing a digit into a cell sets the value and advances focus', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await page.keyboard.press('1');
  await expectPosDigit(page, 1, 1);
  // Focus advanced to plate 2 → it becomes active
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '2');
});

test('position lock: out-of-range digit is clamped to positions max', async ({ page }) => {
  // positions = 7, so typing 9 clamps to 7
  await page.getByTestId('pos-input-1').focus();
  await page.keyboard.press('9');
  await expectPosDigit(page, 1, 7);
});

test('position lock: global digit sets the active plate without focusing a cell', async ({ page }) => {
  // Nothing focused: plate 1 is active by default
  await page.keyboard.press('5');
  await expectPosDigit(page, 1, 5);
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '2'); // advanced
});

test('position lock: global typing past the last plate appends new plates', async ({ page }) => {
  // Default 4 plates; typing 6 digits with nothing focused fills then grows to 6
  await page.keyboard.type('123456');
  await expect(page.getByTestId('val-plates')).toHaveText('6');
  await expectPosDigit(page, 1, 1);
  await expectPosDigit(page, 5, 5);
  await expectPosDigit(page, 6, 6);
});

// ── Position lock: edge ghosts / append / backspace / paste ────────────────────

test('position lock: typing on the add-ghost appends a plate', async ({ page }) => {
  await page.getByTestId('poslock-ghost-add').focus();
  await page.keyboard.press('5');
  await expect(page.getByTestId('val-plates')).toHaveText('5');
  await expectPosDigit(page, 5, 5);
});

test('position lock: typing several digits on the add-ghost appends several plates', async ({ page }) => {
  await page.getByTestId('poslock-ghost-add').focus();
  await page.keyboard.type('56');
  await expect(page.getByTestId('val-plates')).toHaveText('6');
  await expectPosDigit(page, 5, 5);
  await expectPosDigit(page, 6, 6);
});

test('position lock: clicking the add-ghost appends a centred plate', async ({ page }) => {
  await expect(page.getByTestId('poslock-ghost-add')).toBeVisible();
  await page.getByTestId('poslock-ghost-add').click();
  await expect(page.getByTestId('val-plates')).toHaveText('5');
  await expectPosDigit(page, 5, 4); // centre of 7 positions
});

test('position lock: clicking the del-ghost removes the last plate', async ({ page }) => {
  await expect(page.getByTestId('poslock-ghost-del')).toBeVisible();
  await page.getByTestId('poslock-ghost-del').click();
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expect(page.getByTestId('pos-input-4')).toHaveCount(0);
});

test('position lock: Backspace in a cell deletes that plate and shrinks the count', async ({ page }) => {
  await page.getByTestId('pos-input-3').focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expect(page.getByTestId('pos-input-4')).toHaveCount(0);
});

test('position lock: Backspace stops at the minimum of 2 plates', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '12'); // → 2 plates
  await page.getByTestId('pos-input-1').focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('val-plates')).toHaveText('2');
});

test('position lock: del-ghost is hidden at the minimum of 2 plates', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '12'); // → 2 plates
  await expect(page.getByTestId('poslock-ghost-del')).toHaveCount(0);
});

test('position lock: PageUp/PageDown set the active plate to max/min', async ({ page }) => {
  await page.keyboard.press('PageUp');
  await expectPosDigit(page, 1, 7);
  await page.keyboard.press('PageDown');
  await expectPosDigit(page, 1, 1);
});

test('position lock: Home/End jump the selection to the first/last plate', async ({ page }) => {
  await page.keyboard.press('End');
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '4');
  await page.keyboard.press('Home');
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '1');
});

test('position lock: Ctrl+Arrow jumps to the first/last plate', async ({ page }) => {
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '4');
  await page.keyboard.press('Control+ArrowLeft');
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '1');
});

test('position lock: Delete removes the active plate (forward)', async ({ page }) => {
  await page.keyboard.press('Delete'); // active plate 1 removed; count drops
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expect(page.getByTestId('pos-input-4')).toHaveCount(0);
});

test('position lock: ArrowUp at the max value does not change it', async ({ page }) => {
  await page.keyboard.press('PageUp');    // plate 1 → 7 (max)
  await expectPosDigit(page, 1, 7);
  await page.keyboard.press('ArrowUp');   // stays at max
  await expectPosDigit(page, 1, 7);
});

test('position lock: ArrowDown at the min value does not change it', async ({ page }) => {
  await page.keyboard.press('PageDown');  // plate 1 → 1 (min)
  await expectPosDigit(page, 1, 1);
  await page.keyboard.press('ArrowDown'); // stays at min
  await expectPosDigit(page, 1, 1);
});

test('position lock: Up/Down bypass dependency checks', async ({ page }) => {
  await page.getByTestId('dep-1-2').click();                 // plate 1 → plate 2 (same)
  for (let i = 0; i < 3; i++) await page.getByTestId('pos-inc-2').click(); // plate 2 → max
  await expectPosDigit(page, 2, 7);
  await page.keyboard.press('Home');                         // active → plate 1
  const before = parseInt(await posDigit(page, 1));
  await page.keyboard.press('ArrowUp');                      // bumps plate 1 despite the dep
  await expectPosDigit(page, 1, before + 1);
  await expectPosDigit(page, 2, 7);                          // plate 2 untouched
});

test('position lock: global typing does not append past 8 plates', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '12345678'); // → 8 plates (max)
  await page.getByTestId('pos-input-8').evaluate((el) => el.blur()); // nothing focused → global keys
  await page.keyboard.press('End');   // active → plate 8
  await page.keyboard.press('3');     // sets plate 8; no append at max
  await expect(page.getByTestId('val-plates')).toHaveText('8');
  await expectPosDigit(page, 8, 3);
});

test('position lock: add-ghost is hidden at 8 plates, del-ghost stays', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '12345678'); // → 8 plates
  await expect(page.getByTestId('poslock-ghost-add')).toHaveCount(0);
  await expect(page.getByTestId('poslock-ghost-del')).toHaveCount(1);
});

test('position lock: Delete stops at the minimum of 2 plates', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '12'); // → 2 plates
  await page.getByTestId('pos-input-1').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('val-plates')).toHaveText('2');
});

test('position lock: Delete keeps the index — the next plate slides into place', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '1234'); // [1,2,3,4]
  await page.getByTestId('pos-input-2').focus();
  await page.keyboard.press('Delete');                      // remove plate 2 (value 2)
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expectPosDigit(page, 1, 1);
  await expectPosDigit(page, 2, 3); // old plate 3 → id 2
  await expectPosDigit(page, 3, 4); // old plate 4 → id 3
});

test('position lock: Backspace removes the active plate and selects the left neighbour', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '1234'); // [1,2,3,4]
  await page.getByTestId('pos-input-3').focus();
  await page.keyboard.press('Backspace');                  // remove plate 3 (value 3)
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '2'); // left neighbour
  await expectPosDigit(page, 2, 2); // plate 2 unchanged
  await expectPosDigit(page, 3, 4); // old plate 4 → id 3
});

test('position lock: ArrowLeft on the first cell is a no-op', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('pos-input-1')).toBeFocused();
});

test('position lock: ArrowRight on the last cell focuses the add-ghost', async ({ page }) => {
  await page.getByTestId('pos-input-4').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('poslock-ghost-add')).toBeFocused();
});

test('position lock: ArrowLeft on the add-ghost focuses the last plate', async ({ page }) => {
  await page.getByTestId('poslock-ghost-add').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('pos-input-4')).toBeFocused();
});

test('position lock: typing in the last cell hands focus to the add-ghost (so it appends)', async ({ page }) => {
  await page.getByTestId('pos-input-4').focus();
  await page.keyboard.press('5');                          // sets plate 4, focus → ghost
  await expect(page.getByTestId('poslock-ghost-add')).toBeFocused();
  await page.keyboard.press('6');                          // appends via the ghost
  await expect(page.getByTestId('val-plates')).toHaveText('5');
  await expectPosDigit(page, 4, 5);
  await expectPosDigit(page, 5, 6);
});

test('position lock: Backspace on the add-ghost removes the last plate', async ({ page }) => {
  await page.getByTestId('poslock-ghost-add').focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('val-plates')).toHaveText('3');
});

test('position lock: Home/End move focus between cells when one is focused', async ({ page }) => {
  await page.getByTestId('pos-input-2').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('pos-input-4')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('pos-input-1')).toBeFocused();
});

test('position lock: PageUp/PageDown set the value of the focused cell', async ({ page }) => {
  await page.getByTestId('pos-input-2').focus();
  await page.keyboard.press('PageUp');
  await expectPosDigit(page, 2, 7);
  await page.keyboard.press('PageDown');
  await expectPosDigit(page, 2, 1);
});

test('position lock: pasting digits replaces the whole set and resizes', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '1-2-3-4-5'); // separators stripped → "12345"
  await expect(page.getByTestId('val-plates')).toHaveText('5');
  await expectPosDigit(page, 1, 1);
  await expectPosDigit(page, 5, 5);
});

test('position lock: pasting more than 8 digits keeps the first 8 and hides the add-ghost', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '1234567654'); // 10 digits
  await expect(page.getByTestId('val-plates')).toHaveText('8');
  await expectPosDigit(page, 8, 6);
  await expect(page.getByTestId('poslock-ghost-add')).toHaveCount(0); // no append slot at max
});

test('position lock: pasting a single digit into a cell edits only that cell', async ({ page }) => {
  await page.getByTestId('pos-input-2').focus();
  await pasteInto(page.getByTestId('pos-input-2'), '7');
  await expectPosDigit(page, 2, 7);
  await expect(page.getByTestId('val-plates')).toHaveText('4'); // count unchanged
});

test('position lock: pasting a single digit into the add-ghost appends a plate', async ({ page }) => {
  await page.getByTestId('poslock-ghost-add').focus();
  await pasteInto(page.getByTestId('poslock-ghost-add'), '7');
  await expect(page.getByTestId('val-plates')).toHaveText('5');
  await expectPosDigit(page, 5, 7);
});

test('position lock: pasting a full import config (with rules) applies it whole', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '040615 A:B-,C+;D:E-'); // gothic: positions (0-based) + rules
  await expect(page.getByTestId('val-plates')).toHaveText('6');
  await expectPosDigit(page, 1, 1); // 0 (0-based) → 1
  await expectPosDigit(page, 4, 7); // 6 → 7
  // Rules applied too: A→B opposite, A→C same
  await expect(page.getByTestId('dep-1-2')).toHaveAttribute('data-state', 'opposite');
  await expect(page.getByTestId('dep-1-3')).toHaveAttribute('data-state', 'same');
});

test('position lock: an import-looking but invalid config falls back to digit extraction', async ({ page }) => {
  // 2 positions but rules reference 3 plates (A,B,C) → invalid gothic → digits only ("04")
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), '04 A:B-,C+');
  await expect(page.getByTestId('val-plates')).toHaveText('2');
  await expectPosDigit(page, 1, 1); // 0 → clamped to 1
  await expectPosDigit(page, 2, 4);
  await expect(page.getByTestId('dep-1-2')).toHaveAttribute('data-state', 'none'); // rules NOT applied
});

test('position lock: pasting text with no digits and no config does nothing', async ({ page }) => {
  await page.getByTestId('pos-input-1').focus();
  await pasteInto(page.getByTestId('pos-input-1'), 'hello world');
  await expect(page.getByTestId('val-plates')).toHaveText('4');
  await expectPosDigit(page, 1, 4); // unchanged
});

// ── Dependency matrix ────────────────────────────────────────────────────────

test('matrix diagonal (self-dependency) has no clickable cell', async ({ page }) => {
  // A plate can't depend on itself — the diagonal is striped, with no dep-cell button
  await expect(page.getByTestId('dep-1-1')).toHaveCount(0);
  await expect(page.getByTestId('dep-2-2')).toHaveCount(0);
});

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
  await expectPosDigit(page, 1, 1);
});

test('clicking a hole updates the lock buttons', async ({ page }) => {
  // After clicking hole 7 — + button must be disabled (max position)
  await page.getByTestId('hole-1-7').click({ force: true });
  await expectPosDigit(page, 1, 7);
  await expect(page.getByTestId('pos-inc-1')).toBeDisabled();
});

test('position lock: − is disabled at the minimum position', async ({ page }) => {
  await page.getByTestId('hole-1-1').click({ force: true }); // plate 1 → min position 1
  await expectPosDigit(page, 1, 1);
  await expect(page.getByTestId('pos-dec-1')).toBeDisabled();
  await expect(page.getByTestId('pos-inc-1')).toBeEnabled();
});

test('clicking a hole on a different plate changes its position', async ({ page }) => {
  await page.getByTestId('hole-2-1').click({ force: true });
  await expectPosDigit(page, 2, 1);
  // Plate 1 is untouched
  await expectPosDigit(page, 1, 4);
});

test('mouse wheel over a position digit increments and decrements', async ({ page }) => {
  await expectPosDigit(page, 1, 4); // default centre
  await page.getByTestId('pos-input-1').hover();
  await page.mouse.wheel(0, -100);  // scroll up → +1
  await expectPosDigit(page, 1, 5);
  await page.mouse.wheel(0, 120);   // scroll down → −1
  await expectPosDigit(page, 1, 4);
});

test('mouse wheel over a position digit clamps and activates its plate', async ({ page }) => {
  await page.getByTestId('pos-input-2').hover();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120); // scroll well past the minimum
  await expectPosDigit(page, 2, 1); // clamped at 1
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', '2');
});

test('Cancel button closes the overlay', async ({ page }) => {
  // Activate overlay directly — independent of generation speed
  await page.evaluate(() => document.getElementById('computing-overlay').classList.add('active'));
  await expect(page.getByTestId('overlay')).toHaveClass(/active/);
  await page.getByTestId('btn-cancel').click();
  await expect(page.getByTestId('overlay')).not.toHaveClass(/active/);
});

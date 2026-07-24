import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

const cfg = () => ([
  { id: 1, positions: 7, currentPos: 6, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 4, deps: [] },
]);

test('urlQueryFor encodes a config and round-trips through urlReadConfig', async ({ page }) => {
  const r = await page.evaluate((plates) => {
    const q = urlQueryFor(plates, 'config');
    const parsed = urlReadConfig(q);
    return { q, plates: parsed && parsed.plates, wantSolve: parsed && parsed.wantSolve };
  }, cfg());
  expect(r.q).toMatch(/^\?lock=/);
  expect(r.wantSolve).toBe(false);
  expect(r.plates).toEqual(cfg());
});

test('the solve stage adds a value-less &solve flag, read back via wantSolve', async ({ page }) => {
  const r = await page.evaluate((plates) => {
    const q = urlQueryFor(plates, 'solve');
    return { q, wantSolve: urlReadConfig(q).wantSolve };
  }, cfg());
  expect(r.q).toContain('&solve');
  expect(r.q).not.toContain('&solve=');   // value-less, not &solve=1
  expect(r.wantSolve).toBe(true);
});

test('urlReadConfig returns null for a malformed lock and for an absent one', async ({ page }) => {
  const r = await page.evaluate(() => ({
    garbage: urlReadConfig('?lock=not-a-real-lock'),
    empty: urlReadConfig('?foo=bar'),
    none: urlReadConfig(''),
  }));
  expect(r.garbage).toBeNull();
  expect(r.empty).toBeNull();
  expect(r.none).toBeNull();
});

// ── Applying the URL on load ─────────────────────────────────────────────────

test('opening ?lock=<dotted> applies that config on load', async ({ page }) => {
  await page.goto('/?lock=3.531.saaoaa');   // 3 plates, positions 6/4/2
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('val-plates')).toHaveText('3');
  await expect(page.getByTestId('pos-input-1')).toHaveValue('6');
  await expect(page.getByTestId('pos-input-2')).toHaveValue('4');
  await expect(page.getByTestId('pos-input-3')).toHaveValue('2');
});

test('a malformed ?lock is ignored, keeping the default config', async ({ page }) => {
  await page.goto('/?lock=not-a-real-lock');
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('val-plates')).toHaveText('4');   // default plate count
});

test('a malformed ?lock shows a corrupted-link toast', async ({ page }) => {
  await page.goto('/?lock=not-a-real-lock');
  await expect(page.getByTestId('toast')).toContainText('повреждена');
});

test('a bare visit shows no toast', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveCount(0);   // nothing to complain about
});

// ── Live persistence of config edits ─────────────────────────────────────────

test('a bare visit stays / until the first edit, which writes ?lock', async ({ page }) => {
  await page.goto('/');
  expect(new URL(page.url()).search).toBe('');   // default config does not touch the URL
  await page.getByTestId('pos-inc-1').click();
  await expect(page).toHaveURL(/\?lock=/);
  // the written URL round-trips to the current live config
  const matches = await page.evaluate(() => {
    const r = urlReadConfig();
    return !!r && r.plates.length === state.plates.length
      && r.plates.every((p, i) => p.currentPos === state.plates[i].currentPos);
  });
  expect(matches).toBe(true);
});

test('toggling a dependency persists it into ?lock', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dep-1-2').click();   // none → same
  await expect(page).toHaveURL(/\?lock=/);
  const hasDep = await page.evaluate(() =>
    urlReadConfig().plates[0].deps.some(d => d.targetId === 2 && d.direction === 'same'));
  expect(hasDep).toBe(true);
});

test('adding a plate persists the new count into ?lock', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('poslock-ghost-add').click();   // append a centred plate: 4 → 5
  await expect(page.getByTestId('val-plates')).toHaveText('5');
  await expect(page).toHaveURL(/\?lock=/);
  const urlCount = await page.evaluate(() => urlReadConfig().plates.length);
  expect(urlCount).toBe(5);
});

test('importing a config persists it into ?lock', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));   // 6 plates
  await page.getByTestId('import-dialog-ok').click();
  await expect(page.getByTestId('val-plates')).toHaveText('6');
  await expect(page).toHaveURL(/\?lock=/);
  const urlCount = await page.evaluate(() => urlReadConfig().plates.length);
  expect(urlCount).toBe(6);
});

// ── Solve stage & history ────────────────────────────────────────────────────

test('clicking Solve pushes a &solve flag onto the URL', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/\?lock=[^&]*&solve/);
  expect(await page.evaluate(() => urlReadConfig().wantSolve)).toBe(true);
});

test('browser Back after Solve returns to the config stage', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await page.goBack();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page.getByTestId('stage-solve')).toBeHidden();
});

test('opening ?lock=..&solve lands on the solve stage and keeps the flag', async ({ page }) => {
  const lock = await page.evaluate(() =>
    Codecs.dotted.serialize([1, 2, 3].map(id => ({ id, positions: 7, currentPos: 4, deps: [] }))));
  await page.goto('/?lock=' + lock + '&solve');
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/&solve/);   // load must not clobber the flag
});

test('the in-app Back button returns to config and drops &solve from the URL', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('btn-back').click();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await expect(page).toHaveURL(/\?lock=/);
  expect(new URL(page.url()).searchParams.has('solve')).toBe(false);
});

test('stepping through the solution does not change the URL', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => openImportDialog('040615 A:B-,C+;D:E-'));   // has a real solution
  await page.getByTestId('import-dialog-ok').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  const atSolve = page.url();
  await page.getByTestId('btn-step').click();
  await page.getByTestId('btn-step').click();
  expect(page.url()).toBe(atSolve);   // playback moves plates but must not touch the URL
});

test('browser Forward after Back re-enters the solve stage', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
  await page.goBack();
  await expect(page.getByTestId('stage-config')).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });
});

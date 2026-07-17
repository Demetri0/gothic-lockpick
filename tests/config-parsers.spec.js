import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

const good = () => ([
  { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
  { id: 2, positions: 7, currentPos: 4, deps: [] },
]);

test.describe('validatePlates', () => {
  test('accepts a well-formed config', async ({ page }) => {
    expect(await page.evaluate((p) => validatePlates(p) !== null, good())).toBe(true);
  });
  const bad = {
    'ids not 1..N':      (p) => { p[1].id = 3; return p; },
    'even positions':    (p) => { p.forEach(x => x.positions = 6); return p; },
    'positions < 3':     (p) => { p.forEach(x => x.positions = 1); return p; },
    'unequal positions': (p) => { p[1].positions = 5; return p; },
    'currentPos 0':      (p) => { p[0].currentPos = 0; return p; },
    'currentPos > pos':  (p) => { p[0].currentPos = 8; return p; },
    'self-dep':          (p) => { p[0].deps = [{ targetId: 1, direction: 'same', steps: 1 }]; return p; },
    'targetId oob':      (p) => { p[0].deps = [{ targetId: 9, direction: 'same', steps: 1 }]; return p; },
    'bad direction':     (p) => { p[0].deps = [{ targetId: 2, direction: 'x', steps: 1 }]; return p; },
    'steps < 1':         (p) => { p[0].deps = [{ targetId: 2, direction: 'same', steps: 0 }]; return p; },
    'length < 2':        (p) => [p[0]],
    'length > 8':        () => Array.from({ length: 9 }, (_, i) => ({ id: i + 1, positions: 7, currentPos: 4, deps: [] })),
  };
  for (const [name, mut] of Object.entries(bad)) {
    test(`rejects: ${name}`, async ({ page }) => {
      expect(await page.evaluate(({ p }) => validatePlates(p), { p: mut(good()) })).toBeNull();
    });
  }
});

test.describe('parseRules', () => {
  test('parses per-source directed deps', async ({ page }) => {
    const r = await page.evaluate(() => parseRules('A:B-,C+;D:E-'));
    expect(r.A).toEqual([
      { targetId: 2, direction: 'opposite', steps: 1 },
      { targetId: 3, direction: 'same', steps: 1 },
    ]);
    expect(r.D).toEqual([{ targetId: 5, direction: 'opposite', steps: 1 }]);
  });
  test('is case-insensitive and whitespace-tolerant', async ({ page }) => {
    const r = await page.evaluate(() => parseRules('a: b- , c+'));
    expect(r.A).toEqual([
      { targetId: 2, direction: 'opposite', steps: 1 },
      { targetId: 3, direction: 'same', steps: 1 },
    ]);
  });
  test('ignores non-rule tokens', async ({ page }) => {
    expect(await page.evaluate(() => parseRules('040615'))).toEqual({});
  });
});

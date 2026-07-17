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

test.describe('gothic parser', () => {
  test('parses positions + rules (digits first)', async ({ page }) => {
    const p = await page.evaluate(() => gothic.parse('040615 A:B-,C+;D:E-'));
    expect(p.map(x => x.currentPos)).toEqual([1, 5, 1, 7, 2, 6]);
    expect(p[0].deps).toEqual([
      { targetId: 2, direction: 'opposite', steps: 1 },
      { targetId: 3, direction: 'same', steps: 1 },
    ]);
    expect(p[3].deps).toEqual([{ targetId: 5, direction: 'opposite', steps: 1 }]);
  });
  test('parses rules-first, digits-at-end (order lenient)', async ({ page }) => {
    const p = await page.evaluate(() => gothic.parse('A:B-,C+;D:E- 040615'));
    expect(p.map(x => x.currentPos)).toEqual([1, 5, 1, 7, 2, 6]);
  });
  for (const [name, s] of Object.entries({
    'positions only':     '040615',
    'rules only':         'A:B-;D:E-',
    'no digit run':       'A:B-,C+',
    'INI start_pos= key': 'start_pos="1,2,3,4,5,6"',
    'empty':              '   ',
  })) {
    test(`returns null: ${name}`, async ({ page }) => {
      expect(await page.evaluate((x) => gothic.parse(x), s)).toBeNull();
    });
  }
  test('round-trips a deps config through serialize', async ({ page }) => {
    const eq = await page.evaluate(() => {
      const orig = gothic.parse('040615 A:B-,C+;D:E-');
      return JSON.stringify(gothic.parse(gothic.serialize(orig))) === JSON.stringify(orig);
    });
    expect(eq).toBe(true);
  });
});

test.describe('json parser', () => {
  test('parses the export array shape', async ({ page }) => {
    const p = await page.evaluate(() =>
      json.parse('[{"id":1,"positions":7,"currentPos":4,"deps":[]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'));
    expect(p.length).toBe(2);
  });
  for (const [name, s] of Object.entries({
    'not bracket/brace': '040615 A:B-',
    'broken JSON':       '[{"id":1,',
  })) {
    test(`returns null: ${name}`, async ({ page }) => {
      expect(await page.evaluate((x) => json.parse(x), s)).toBeNull();
    });
  }
  test('serialize omits view-only fields', async ({ page }) => {
    const s = await page.evaluate(() => json.serialize([
      { id: 1, positions: 7, currentPos: 4, deps: [], _x: 1 },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ]));
    expect(s).not.toContain('_x');
  });
});

test.describe('parseConfig routing (json + gothic)', () => {
  test('gothic string routes to a valid config', async ({ page }) => {
    expect(await page.evaluate(() => parseConfig('040615 A:B-,C+;D:E-') !== null)).toBe(true);
  });
  test('bare positions do not route (not an import config)', async ({ page }) => {
    expect(await page.evaluate(() => parseConfig('040615'))).toBeNull();
  });
  test('looksLikeImportConfig agrees with parseConfig', async ({ page }) => {
    const r = await page.evaluate(() => [
      looksLikeImportConfig('040615 A:B-,C+;D:E-'), looksLikeImportConfig('040615'), looksLikeImportConfig('hello'),
    ]);
    expect(r).toEqual([true, false, false]);
  });
});

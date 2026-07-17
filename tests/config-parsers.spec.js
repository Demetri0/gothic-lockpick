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
  test('does not throw on non-object array elements (contract)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      a: parseConfig('[null,null]'),
      b: parseConfig('[1,2,3]'),
      c: parseConfig('[{"id":1,"positions":7,"currentPos":4,"deps":[null]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]'),
      like: looksLikeImportConfig('[null,null]'),
    }));
    expect(r.a).toBeNull();
    expect(r.b).toBeNull();
    expect(r.c).toBeNull();
    expect(r.like).toBe(false);
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

test.describe('gothic.parseRules', () => {
  test('parses per-source directed deps', async ({ page }) => {
    const r = await page.evaluate(() => gothic.parseRules('A:B-,C+;D:E-'));
    expect(r.A).toEqual([
      { targetId: 2, direction: 'opposite', steps: 1 },
      { targetId: 3, direction: 'same', steps: 1 },
    ]);
    expect(r.D).toEqual([{ targetId: 5, direction: 'opposite', steps: 1 }]);
  });
  test('is case-insensitive and whitespace-tolerant', async ({ page }) => {
    const r = await page.evaluate(() => gothic.parseRules('a: b- , c+'));
    expect(r.A).toEqual([
      { targetId: 2, direction: 'opposite', steps: 1 },
      { targetId: 3, direction: 'same', steps: 1 },
    ]);
  });
  test('ignores non-rule tokens', async ({ page }) => {
    expect(await page.evaluate(() => gothic.parseRules('040615'))).toEqual({});
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

test.describe('dotted parser', () => {
  test('decodes the 3-plate example exactly', async ({ page }) => {
    const p = await page.evaluate(() => dotted.parse('3.531.saaoaa'));
    expect(p.map(x => x.currentPos)).toEqual([6, 4, 2]);
    expect(p[0].deps).toEqual([{ targetId: 2, direction: 'same', steps: 1 }]);      // A:B+
    expect(p[1].deps).toEqual([{ targetId: 3, direction: 'opposite', steps: 1 }]);  // B:C-
    expect(p[2].deps).toEqual([]);
  });
  test('decodes the 7-plate example (positions)', async ({ page }) => {
    const p = await page.evaluate(() => dotted.parse('7.5313505.ssossaossosasossoaasossasasosassasoasssaso'));
    expect(p.map(x => x.currentPos)).toEqual([6, 4, 2, 4, 6, 1, 6]);
  });
  test('round-trips (parse->serialize->parse) and emits the canonical string', async ({ page }) => {
    const ok = await page.evaluate(() => {
      for (const s of ['3.531.saaoaa', '7.5313505.ssossaossosasossoaasossasasosassasoasssaso']) {
        const a = dotted.parse(s);
        if (JSON.stringify(dotted.parse(dotted.serialize(a))) !== JSON.stringify(a)) return false;
        if (dotted.serialize(a) !== s) return false;
      }
      return true;
    });
    expect(ok).toBe(true);
  });
  for (const [name, s] of Object.entries({
    'wrong dot count':       '3.531',
    'extra dot':             '3.531.saa.oo',
    'N != positions length': '3.5313.saaoaa',
    'pairs too short':       '3.531.saaoa',
    'pairs too long':        '3.531.saaoaaa',
    'illegal pair char':     '3.531.saaoax',
    'non-digit N':           'x.531.saaoaa',
    'empty pairs':           '3.531.',
  })) {
    test(`returns null: ${name}`, async ({ page }) => {
      expect(await page.evaluate((x) => dotted.parse(x), s)).toBeNull();
    });
  }
});

test.describe('bytearray parser', () => {
  // Verified vector (tests/sync-uml.spec.js): pins 0-based [0,0,2,0,6,5,6],
  // rules A:F-;B:C+,E-,G+;C:D-;D:E-;E:D-;F:D+;G:A-,C-
  test('decodes the verified unlockmyloot v2 code', async ({ page }) => {
    const p = await page.evaluate(() => bytearray.parse('gBDXAECQhAAQAQAIRAA'));
    expect(p.length).toBe(7);
    expect(p.map(x => x.currentPos)).toEqual([1, 1, 3, 1, 7, 6, 7]);
    expect(p[0].deps).toEqual([{ targetId: 6, direction: 'opposite', steps: 1 }]); // A:F-
    expect(p[6].deps).toEqual([                                                     // G:A-,C-
      { targetId: 1, direction: 'opposite', steps: 1 },
      { targetId: 3, direction: 'opposite', steps: 1 },
    ]);
  });
  test('round-trips state and emits a canonical length', async ({ page }) => {
    const ok = await page.evaluate(() => {
      const a = bytearray.parse('gBDXAECQhAAQAQAIRAA');
      const s = bytearray.serialize(a);
      return [5,7,10,14,19,24].includes(s.length) && JSON.stringify(bytearray.parse(s)) === JSON.stringify(a);
    });
    expect(ok).toBe(true);
  });
  test('serialize refuses a 2-plate config (null)', async ({ page }) => {
    const r = await page.evaluate(() => bytearray.serialize([
      { id: 1, positions: 7, currentPos: 4, deps: [] },
      { id: 2, positions: 7, currentPos: 4, deps: [] },
    ]));
    expect(r).toBeNull();
  });
  for (const [name, s] of Object.entries({
    'invalid length (8)':  'gBDXAECQ',
    'one char short (18)': 'gBDXAECQhAAQAQAIRA',
    'contains ":"':        'gB:DXAECQhAAQAQAIRAA',
    'pure digits':         '3055665',
  })) {
    test(`returns null: ${name}`, async ({ page }) => {
      expect(await page.evaluate((x) => bytearray.parse(x), s)).toBeNull();
    });
  }
  test('non-zero pad bits are rejected (canonicity)', async ({ page }) => {
    const rejected = await page.evaluate(() => {
      const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const code = bytearray.serialize(bytearray.parse('gBDXAECQhAAQAQAIRAA'));
      const last = code[code.length - 1];
      const tampered = code.slice(0, -1) + ABC[(ABC.indexOf(last) | 1)]; // set lowest pad bit
      return tampered !== code ? bytearray.parse(tampered) : 'nochange';
    });
    expect(rejected).toBeNull();
  });
});

test.describe('cross-format routing + disjointness', () => {
  const vectors = {
    json:      '[{"id":1,"positions":7,"currentPos":4,"deps":[]},{"id":2,"positions":7,"currentPos":4,"deps":[]}]',
    dotted:    '3.531.saaoaa',
    gothic:    '040615 A:B-,C+;D:E-',
    bytearray: 'gBDXAECQhAAQAQAIRAA',
  };
  for (const [owner, s] of Object.entries(vectors)) {
    test(`${owner} vector: only ${owner} claims it, and parseConfig accepts it`, async ({ page }) => {
      const res = await page.evaluate(({ s }) => ({
        claims: ['json', 'dotted', 'gothic', 'bytearray'].filter(id => ({ json, dotted, gothic, bytearray })[id].parse(s) !== null),
        routed: parseConfig(s) !== null,
      }), { s });
      expect(res.claims).toEqual([owner]);   // disjoint: exactly one parser claims each vector
      expect(res.routed).toBe(true);
    });
  }
});

test.describe('near-miss non-routing (must end at parseConfig -> null)', () => {
  for (const [name, s] of Object.entries({
    'broken dotted':          '3.531.saax',
    'bare positions':         '040615',
    'bare rules':             'A:B-;D:E-',
    'bytearray wrong length':  'gBDXAECQhAAQAQAIRA',   // len 18
    'valid JSON invalid cfg': '[1,2,3]',
    'random word':            'hello',
    'another word':           'config',
  })) {
    test(`no parser silently claims: ${name}`, async ({ page }) => {
      const r = await page.evaluate((x) => ({ pc: parseConfig(x), like: looksLikeImportConfig(x) }), s);
      expect(r.pc).toBeNull();
      expect(r.like).toBe(false);
    });
  }
});

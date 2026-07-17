# Config Format Parsers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor config import into four self-contained format-parser units (`json`, `gothic`, `dotted`, `bytearray`) behind a registry, dropping the app's INI parsing, and add the `dotted` and `bytearray` (unlockmyloot v2) formats — the codecs #8/#11 will later consume.

**Architecture:** Each parser is a stateless object `{ id, parse(str)→plates|null, serialize(plates)→string|null }`. Neither method throws (contract). A registry `parseConfig(str)` tries each parser in order, running the shared `validatePlates` on the first non-null decode. `looksLikeImportConfig = parseConfig(text) !== null`. All code lives in `index.html` **Script #5** alongside the existing import functions.

**Tech Stack:** Single-file `index.html`, no build. Playwright tests (`data-test-id` selectors, English descriptions). Parser logic is plain JS exercised directly via `page.evaluate`.

**Design spec:** `docs/superpowers/specs/2026-07-17-config-format-parsers-design.md` — the authority; this plan implements it.

## Global Constraints

- Canonical state: `{ id:1..N, positions:odd>=3 (app uses 7), currentPos:1-based, deps:[{targetId, direction:'same'|'opposite', steps>=1}] }`.
- **No exceptions in the happy path:** `parse`→`plates|null`, `serialize`→`string|null`. `null` = "can't" (not-my-format / not-representable). Never throw; callers branch on `null`, never `try/catch`.
- Positions in dotted/bytearray/gothic are **0-based** on the wire (`digit`/`pin` = `currentPos−1`); hole count assumed **7**.
- Direction encoding: gothic `+`=same/`−`=opposite; dotted `s`=same/`o`=opposite/`a`=absent; bytearray pair `1`=same/`2`=opposite/`0`=none.
- `gothic` requires **both** positions and rules; it knows **nothing** about `chests.ini` (no `rules=`/`start_pos=`/`cells=`/`name=`/`tags=` keys).
- `bytearray` = unlockmyloot v2 base64url; alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_`; canonical (length ∈ {5,7,10,14,19,24}, zero pad bits); `serialize` returns `null` for `< 3` plates.
- Registry order: `[json, dotted, gothic, bytearray]`.
- Tests: English descriptions/comments; `data-test-id` for DOM; parser units tested via `page.evaluate`.

## File Structure

- `index.html` — Script #5 (~2284–2503): replace `serializeGothicFormat`/`parseGothicFormat`/`parseImportConfig`/`looksLikeImportConfig` with `validatePlates`, `parseRules`, the four parser objects, `PARSERS`, `parseConfig` (+ `parseImportConfig` alias), and the `looksLikeImportConfig` rewrite. `serializeGothicFormat` stays (referenced by `gothic.serialize` and the export/copy handlers).
- `tests/config-parsers.spec.js` — new; all parser-unit + routing tests.
- `tests/import.spec.js` — migrate throw→null assertions; delete INI/rules-only/positions-only tests (see Task 2).

---

### Task 1: Extract `validatePlates` and `parseRules` (behavior-preserving)

**Files:**
- Modify: `index.html` Script #5 — extract from `parseImportConfig` (2417–2443) and `parseGothicFormat` (2358–2373).
- Test: `tests/config-parsers.spec.js` (create).

**Interfaces — Produces:**
- `validatePlates(plates) -> plates | null` — universal invariants.
- `parseRules(str) -> { [SRC letter]: [{targetId, direction, steps}] }` — parses only the rule half.

- [ ] **Step 1: Write failing tests**

Create `tests/config-parsers.spec.js`:

```js
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
    'length > 8':        (p) => Array.from({ length: 9 }, (_, i) => ({ id: i+1, positions:7, currentPos:4, deps:[] })),
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
```

- [ ] **Step 2: Run to verify RED**

Run: `npx playwright test config-parsers` → FAIL (`validatePlates`/`parseRules` are not defined).

- [ ] **Step 3: Add `validatePlates`** in Script #5, just above `parseImportConfig`:

```js
function validatePlates(plates) {
  if (!Array.isArray(plates) || plates.length < 2 || plates.length > 8) return null;
  const positions0 = plates[0]?.positions;
  const sortedIds = plates.map(p => p.id).slice().sort((a, b) => a - b);
  if (!sortedIds.every((id, i) => id === i + 1)) return null;
  for (const p of plates) {
    if (typeof p.id !== 'number' ||
        typeof p.positions !== 'number' || p.positions % 2 === 0 || p.positions < 3 ||
        p.positions !== positions0 ||
        typeof p.currentPos !== 'number' || p.currentPos < 1 || p.currentPos > p.positions ||
        !Array.isArray(p.deps)) return null;
    for (const d of p.deps) {
      if (typeof d.targetId !== 'number' || !Number.isInteger(d.targetId) ||
          d.targetId < 1 || d.targetId > plates.length || d.targetId === p.id ||
          (d.direction !== 'same' && d.direction !== 'opposite') ||
          typeof d.steps !== 'number' || !Number.isInteger(d.steps) || d.steps < 1) return null;
    }
  }
  return plates;
}
```

- [ ] **Step 4: Add `parseRules`** just above `parseGothicFormat`:

```js
/** Parse only the rule half of the notation, e.g. "A:B-,C+;D:E-". */
function parseRules(str) {
  const depMap = {};
  for (const token of str.split(';')) {
    const m = token.trim().match(/([A-H])\s*:\s*(.+)$/i);
    if (!m) continue;
    const src = m[1].toUpperCase();
    if (!depMap[src]) depMap[src] = [];
    for (const part of m[2].split(',')) {
      const pm = part.trim().match(/^([A-H])\s*([+\-])$/i);
      if (!pm) continue;
      depMap[src].push({
        targetId: pm[1].toUpperCase().charCodeAt(0) - 64,
        direction: pm[2] === '+' ? 'same' : 'opposite',
        steps: 1,
      });
    }
  }
  return depMap;
}
```

Then, so nothing regresses yet, make the current code reuse them: in `parseImportConfig`, replace the inline validation block (2417–2443) with `return validatePlates(plates);` after the array/`JSON.parse`/`parseGothicFormat` decode; in `parseGothicFormat`, replace the inline rule loop (step 5, 2358–2373) with `const depMap = parseRules(rulesStr);`.

- [ ] **Step 5: Run to verify GREEN + no regression**

Run: `npx playwright test config-parsers import` → PASS (new unit tests green; existing import tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/config-parsers.spec.js
git commit -m "refactor: extract validatePlates and parseRules (behavior-preserving)"
```

---

### Task 2: Parser registry (json + gothic), drop INI, null contract

**Files:**
- Modify: `index.html` Script #5 — introduce `json`/`gothic` parser objects, `PARSERS`, `parseConfig` (+ `parseImportConfig` alias), rewrite `looksLikeImportConfig`; retire the INI/rules-only/positions-only paths in `parseGothicFormat`.
- Modify: `tests/import.spec.js` — migrate throw→null; delete INI/rules-only/positions-only tests.
- Test: `tests/config-parsers.spec.js` (append gothic + json unit tests).

**Interfaces:**
- Consumes: `validatePlates`, `parseRules`, `serializeGothicFormat` (Task 1 / existing).
- Produces: `json`, `gothic` (objects with `parse`/`serialize`); `PARSERS`; `parseConfig(str)→plates|null`; `parseImportConfig` (alias of `parseConfig`); `looksLikeImportConfig(text)→bool`. `gothic.parse` implements the new contract (positions+rules required, no INI, returns `null` not throw).

- [ ] **Step 1: Write failing tests** — append to `tests/config-parsers.spec.js`:

```js
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
    'positions only':        '040615',
    'rules only':            'A:B-;D:E-',
    'no digit run':          'A:B-,C+',
    'INI start_pos= key':    'start_pos="1,2,3,4,5,6"',
    'empty':                 '   ',
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
    'not bracket/brace':  '040615 A:B-',
    'broken JSON':        '[{"id":1,',
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
```

- [ ] **Step 2: Run to verify RED**

Run: `npx playwright test config-parsers -g "gothic parser|json parser|parseConfig routing"` → FAIL (`gothic`/`json`/`parseConfig` undefined; and `gothic.parse('040615')` currently would parse, not null).

- [ ] **Step 3: Rewrite `parseGothicFormat` to the new contract** (positions+rules required, no INI, returns null). Replace the whole function body (2320–2402) with:

```js
/** Parse the compact "positions + rules" notation, e.g. "040615 A:B-,C+;D:E-".
 *  Requires both parts; knows nothing about chests.ini. Returns null if not this format. */
function parseGothicFormat(raw) {
  const text = String(raw).trim();
  if (!/[A-H]\s*:\s*[A-H]\s*[+\-]/i.test(text)) return null;   // need a rule token
  const dM = text.match(/(?<![,\d])(\d{2,8})(?![,\d])/);        // need a positions digit-run
  if (!dM) return null;
  const rawPos = [...dM[1]].map(Number);
  const depMap = parseRules(text.replace(dM[0], ''));
  const POSITIONS = 7;
  return Array.from({ length: rawPos.length }, (_, i) => ({
    id: i + 1,
    positions: POSITIONS,
    currentPos: Math.max(1, Math.min(POSITIONS, rawPos[i] + 1)),
    deps: depMap[String.fromCharCode(65 + i)] || [],
  }));
}
```

(Out-of-range rule letters — e.g. `04 A:B-,C+` referencing plate C with only 2 positions — now produce a dep with `targetId > length`, which `validatePlates` rejects → `parseConfig` returns null. No throw.)

- [ ] **Step 4: Add the parser objects + registry** where `parseImportConfig`/`looksLikeImportConfig` currently sit (replace 2405–2454):

```js
const json = {
  id: 'json',
  parse(str) {
    const t = str.trim();
    if (t[0] !== '[' && t[0] !== '{') return null;
    try { return JSON.parse(t); } catch { return null; }
  },
  serialize(plates) {
    return JSON.stringify(plates.map(({ id, positions, currentPos, deps }) => ({ id, positions, currentPos, deps })));
  },
};

const gothic = { id: 'gothic', parse: parseGothicFormat, serialize: serializeGothicFormat };

// dotted + bytearray are added in Tasks 3 and 4.
const PARSERS = [json, gothic];

function parseConfig(str) {
  const text = String(str).trim();
  for (const p of PARSERS) {
    const plates = p.parse(text);          // never throws (contract)
    if (plates) { const v = validatePlates(plates); if (v) return v; }
  }
  return null;
}
const parseImportConfig = parseConfig;      // keep existing public name for callers/tests

function looksLikeImportConfig(text) {
  return parseConfig(text) !== null;
}
```

- [ ] **Step 5: Migrate `tests/import.spec.js`**

Delete these tests (capability removed): `rules with explicit start_pos= key` (190), `full INI entry` (202), `no positions defaults to center (4)` (219), `INI with double-quote CSV escaping` (301), `plates with no rules produce empty deps` (385).

Migrate throw→null (the new contract never throws): `fewer positions than rule letters` (395) and `more than 8 positions` (403) — rewrite each to assert `parseImportConfig(<string>) === null` instead of catching a throw. For the >8 case use a compact string, e.g. `parseImportConfig('123456789 A:B-')` → `null`. Move the rules-only assertion (`parseGothicFormat('A:B+;B:C-')`) into a `parseRules` unit test in `config-parsers.spec.js` if not already covered.

- [ ] **Step 6: Run to verify GREEN + no regression**

Run: `npx playwright test config-parsers import solver reference-configs` → PASS. (`solver`/`reference-configs` use `parseImportConfig` on `positions rules` strings — unaffected.)

- [ ] **Step 7: Commit**

```bash
git add index.html tests/config-parsers.spec.js tests/import.spec.js
git commit -m "feat: parser registry (json+gothic), drop app INI parsing, null contract"
```

---

### Task 3: `dotted` parser

**Files:**
- Modify: `index.html` Script #5 — add `dotted`, insert into `PARSERS` after `json`.
- Test: `tests/config-parsers.spec.js` (append).

**Interfaces:**
- Produces: `dotted` object; `PARSERS === [json, dotted, gothic]`.

- [ ] **Step 1: Write failing tests** — append:

```js
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
  test('round-trips (parse->serialize->parse) for 2..8 plates', async ({ page }) => {
    const ok = await page.evaluate(() => {
      for (const s of ['3.531.saaoaa', '7.5313505.ssossaossosasossoaasossasasosassasoasssaso']) {
        const a = dotted.parse(s);
        if (JSON.stringify(dotted.parse(dotted.serialize(a))) !== JSON.stringify(a)) return false;
        if (dotted.serialize(a) !== s) return false;   // canonical string
      }
      return true;
    });
    expect(ok).toBe(true);
  });
  for (const [name, s] of Object.entries({
    'wrong dot count':        '3.531',
    'extra dot':              '3.531.saa.oo',
    'N != positions length':  '3.5313.saaoaa',
    'pairs too short':        '3.531.saaoa',
    'pairs too long':         '3.531.saaoaaa',
    'illegal pair char':      '3.531.saaoax',
    'non-digit N':            'x.531.saaoaa',
    'empty pairs':            '3.531.',
  })) {
    test(`returns null: ${name}`, async ({ page }) => {
      expect(await page.evaluate((x) => dotted.parse(x), s)).toBeNull();
    });
  }
});
```

- [ ] **Step 2: Run to verify RED** — `npx playwright test config-parsers -g dotted` → FAIL (`dotted` undefined).

- [ ] **Step 3: Implement `dotted`** (before the `PARSERS` line):

```js
const dotted = {
  id: 'dotted',
  parse(str) {
    const m = str.trim().match(/^(\d+)\.(\d+)\.([sao]+)$/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const pos = m[2], pairs = m[3].toLowerCase();
    if (pos.length !== n || pairs.length !== n * (n - 1)) return null;
    const POSITIONS = 7;
    const plates = Array.from({ length: n }, (_, i) => ({
      id: i + 1, positions: POSITIONS, currentPos: Number(pos[i]) + 1, deps: [],
    }));
    let k = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const c = pairs[k++];
      if (c === 's' || c === 'o') plates[i].deps.push({ targetId: j + 1, direction: c === 's' ? 'same' : 'opposite', steps: 1 });
    }
    return plates;
  },
  serialize(plates) {
    const n = plates.length;
    const pos = plates.map(p => p.currentPos - 1).join('');
    let pairs = '';
    for (let i = 0; i < n; i++) {
      const by = {}; for (const d of plates[i].deps) by[d.targetId] = d.direction;
      for (let j = 0; j < n; j++) { if (i === j) continue; const dir = by[j + 1]; pairs += dir === 'same' ? 's' : dir === 'opposite' ? 'o' : 'a'; }
    }
    return `${n}.${pos}.${pairs}`;
  },
};
```

Change `const PARSERS = [json, gothic];` → `const PARSERS = [json, dotted, gothic];`.

- [ ] **Step 4: Run to verify GREEN** — `npx playwright test config-parsers` → PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/config-parsers.spec.js
git commit -m "feat: dotted config format parser (N.positions.pairs)"
```

---

### Task 4: `bytearray` parser (unlockmyloot v2, canonical)

**Files:**
- Modify: `index.html` Script #5 — add `bytearray`, append to `PARSERS`.
- Test: `tests/config-parsers.spec.js` (append).

**Interfaces:**
- Produces: `bytearray` object; `PARSERS === [json, dotted, gothic, bytearray]`.

- [ ] **Step 1: Write failing tests** — append:

```js
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
  test('round-trips state (parse->serialize->parse) and emits canonical length', async ({ page }) => {
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
    'invalid length (8)':    'gBDXAECQ',              // len 8 — not in {5,7,10,14,19,24}
    'one char short (18)':   'gBDXAECQhAAQAQAIRA',    // len 18 — not in the set
    'contains ":"':          'gB:DXAECQhAAQAQAIRAA',  // non-base64url char
    'pure digits':           '3055665',               // excluded by the not-^\d+$ guard
  })) {
    test(`returns null: ${name}`, async ({ page }) => {
      expect(await page.evaluate((x) => bytearray.parse(x), s)).toBeNull();
    });
  }
  test('non-zero pad bits are rejected (canonicity)', async ({ page }) => {
    // Take the canonical code, flip a low bit of the last char so pad != 0 while length stays valid.
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
```

The pad-bit test derives its tampered string from the canonical `serialize` output, so it stays length-valid while breaking canonicity — exactly the case the length check alone can't catch.

- [ ] **Step 2: Run to verify RED** — `npx playwright test config-parsers -g bytearray` → FAIL (`bytearray` undefined).

- [ ] **Step 3: Implement `bytearray`** (before the `PARSERS` line):

```js
const bytearray = (() => {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bitsFor = (n) => 4 + 3 * n + 2 * n * (n - 1);
  const lenFor  = (n) => Math.ceil(bitsFor(n) / 6);
  const VALID_LENS = new Set([3, 4, 5, 6, 7, 8].map(lenFor)); // {5,7,10,14,19,24}
  return {
    id: 'bytearray',
    parse(str) {
      const s = str.trim();
      if (!/^[A-Za-z0-9_-]+$/.test(s) || /^\d+$/.test(s)) return null;
      if (!VALID_LENS.has(s.length)) return null;
      const bits = [];
      for (const ch of s) { const v = ABC.indexOf(ch); if (v < 0) return null; for (let b = 5; b >= 0; b--) bits.push((v >> b) & 1); }
      let at = 0;
      const read = (w) => { let v = 0; for (let b = 0; b < w; b++) { if (at >= bits.length) return null; v = (v << 1) | bits[at++]; } return v; };
      const nRaw = read(3); if (nRaw === null) return null;
      const n = nRaw + 3;
      if (lenFor(n) !== s.length) return null;         // declared n must match the code length
      if (read(1) === null) return null;               // flip bit (ignored)
      const POSITIONS = 7;
      const plates = [];
      for (let i = 0; i < n; i++) { const pin = read(3); if (pin === null) return null; plates.push({ id: i + 1, positions: POSITIONS, currentPos: pin + 1, deps: [] }); }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const t = read(2); if (t === null) return null;
        if (t === 1 || t === 2) plates[i].deps.push({ targetId: j + 1, direction: t === 1 ? 'same' : 'opposite', steps: 1 });
      }
      for (; at < bits.length; at++) if (bits[at] !== 0) return null;   // canonical: zero pad
      return plates;
    },
    serialize(plates) {
      const n = plates.length;
      if (n < 3 || n > 8) return null;
      const bits = [];
      const write = (v, w) => { for (let b = w - 1; b >= 0; b--) bits.push((v >> b) & 1); };
      write(n - 3, 3); write(0, 1);
      for (const p of plates) write(p.currentPos - 1, 3);
      for (let i = 0; i < n; i++) {
        const by = {}; for (const d of plates[i].deps) by[d.targetId] = d.direction;
        for (let j = 0; j < n; j++) { if (i === j) continue; const dir = by[j + 1]; write(dir === 'same' ? 1 : dir === 'opposite' ? 2 : 0, 2); }
      }
      while (bits.length % 6 !== 0) bits.push(0);
      let out = '';
      for (let k = 0; k < bits.length; k += 6) { let v = 0; for (let b = 0; b < 6; b++) v = (v << 1) | bits[k + b]; out += ABC[v]; }
      return out;
    },
  };
})();
```

Change `PARSERS` to `[json, dotted, gothic, bytearray]`.

- [ ] **Step 4: Run to verify GREEN** — `npx playwright test config-parsers` → PASS. Fix any test-vector strings flagged in Step 1's note first.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/config-parsers.spec.js
git commit -m "feat: bytearray config parser (unlockmyloot v2, canonical base64url)"
```

---

### Task 5: Cross-format routing matrix + near-miss suite

**Files:**
- Test: `tests/config-parsers.spec.js` (append). No `index.html` change expected.

**Interfaces:** Consumes all four parsers + `parseConfig`/`looksLikeImportConfig`.

- [ ] **Step 1: Write the routing + near-miss tests** — append:

```js
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
        claims: ['json', 'dotted', 'gothic', 'bytearray'].filter(id => ({ json, dotted, gothic, bytearray }[id]).parse(s) !== null),
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
    'bytearray wrong length': 'gBDXAECQhAAQAQAIRA',   // len 18
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
```

- [ ] **Step 2: Run to verify** — `npx playwright test config-parsers` → PASS. If any near-miss unexpectedly routes, that is a real detection bug in the corresponding parser's shape guard — fix the guard (not the test) and re-run.

- [ ] **Step 3: Full-suite regression** — `npx playwright test` → all green.

- [ ] **Step 4: Commit**

```bash
git add tests/config-parsers.spec.js
git commit -m "test: cross-format routing matrix and near-miss non-routing"
```

---

### Task 6: Verify

- [ ] **Step 1:** `npx playwright test` → all suites pass.
- [ ] **Step 2:** Sanity-drive the import UI: paste `3.531.saaoaa` and `gBDXAECQhAAQAQAIRAA` into the import flow (or `page.evaluate(() => openImportDialog('3.531.saaoaa'))` + apply) and confirm the config applies (plate count + positions update). Paste `hello` and confirm it does **not** trigger import.
- [ ] **Step 3:** Confirm the design's out-of-scope boundary held: export/copy still emit gothic + JSON only; no URL/#8 wiring was added.

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

// Pure-node tests for the DB pipeline (tools/ini2json.cjs as a module):
// canonical keys, nameless entries, and the db-decisions ("rerere") layer.

const require = createRequire(import.meta.url);
const pipeline = require('../tools/ini2json.cjs');

const INI = (body) => body.trim() + '\n';

// A minimal valid ini block. Values use the ""..."" wrapping of the real file.
const BASIC = INI(`
"[test_chest_one]
name=""Тестовый сундук""
cells=2
rules=""A:B-""
start_pos=""1,2""
tags=""тест"""
`);

test.describe('canonicalKey', () => {
  test('is stable under rule group and token reordering', () => {
    const a = pipeline.canonicalKey([1, 2, 3], 'B:D-;C:B-,D-');
    const b = pipeline.canonicalKey([1, 2, 3], 'C:D-,B-;B:D-');
    expect(a).toBe(b);
    const c = pipeline.canonicalKey([1, 2, 4], 'B:D-;C:B-,D-');
    expect(c).not.toBe(a); // different positions → different lock
  });
});

test.describe('nameless entries', () => {
  const NAMELESS = INI(`
"[unnamed_1]
name=""""
cells=3
rules=""A:B+""
start_pos=""1,2,3""
tags="""""
`);

  test('are kept with empty name/tags and a content-derived id', () => {
    const { entries } = pipeline.buildEntries(NAMELESS);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toEqual({});
    expect(entries[0].tags).toEqual([]);
    expect(entries[0].id).toBe('lock-123');
  });
});

test.describe('db-decisions layer', () => {
  const DUPES = INI(`
"[dup_a]
name=""Сундук А""
cells=2
rules=""A:B-;B:A+""
start_pos=""1,2""
tags=""один"""
"[dup_b]
name=""Сундук Б""
cells=2
rules=""B:A+;A:B-""
start_pos=""1,2""
tags=""два"""
`);

  test('reports canonically-duplicate groups without an override as REVIEW-NEEDED', () => {
    const { entries, report } = pipeline.buildEntries(DUPES);
    expect(entries).toHaveLength(2); // no silent merging
    expect(report.some(l => l.startsWith('REVIEW-NEEDED'))).toBe(true);
  });

  test('an override replaces the whole canonical group with the recorded entries', () => {
    const key = pipeline.canonicalKey([1, 2], 'A:B-;B:A+');
    const decisions = {
      v: 1,
      overrides: [{ key, entries: [{
        id: 'merged-chest', name: { ru: 'Слитый сундук' }, cells: 2,
        rules: 'A:B-;B:A+', pos: [1, 2], tags: ['один', 'два'], img: [],
      }] }],
      additions: [], translations: {},
    };
    const { entries, report } = pipeline.buildEntries(DUPES, decisions);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('merged-chest');
    expect(entries[0].tags).toEqual(['один', 'два']);
    expect(report.some(l => l.startsWith('REVIEW-NEEDED'))).toBe(false);
    expect(report.some(l => l.startsWith('OVERRIDE'))).toBe(true);
  });

  test('an override that still holds several entries stays flagged for review', () => {
    const key = pipeline.canonicalKey([1, 2], 'A:B-;B:A+');
    const decisions = {
      v: 1, additions: [], translations: {},
      overrides: [{ key, entries: [
        { id: 'dup-a', name: { ru: 'Сундук А' }, cells: 2, rules: 'A:B-;B:A+', pos: [1, 2], tags: [], img: [] },
        { id: 'dup-b', name: { ru: 'Сундук Б' }, cells: 2, rules: 'A:B-;B:A+', pos: [1, 2], tags: [], img: [] },
      ] }],
    };
    const { entries, report } = pipeline.buildEntries(DUPES, decisions);
    expect(entries).toHaveLength(2);
    expect(report.some(l => l.startsWith('REVIEW-NEEDED') && l.includes('overridden'))).toBe(true);
  });

  test('additions are appended as-is (desc field passes through)', () => {
    const decisions = {
      v: 1, overrides: [], translations: {},
      additions: [{
        id: 'uml-new-lock', name: { ru: 'Новый', en: 'New' },
        desc: { ru: 'Описание' }, cells: 2, rules: 'A:B+', pos: [3, 4],
        tags: ['uml'], img: [],
      }],
    };
    const { entries } = pipeline.buildEntries(BASIC, decisions);
    expect(entries).toHaveLength(2);
    const added = entries.find(e => e.id === 'uml-new-lock');
    expect(added.desc).toEqual({ ru: 'Описание' });
  });

  test('translations fill and overwrite name/desc languages by canonical key', () => {
    const key = pipeline.canonicalKey([1, 2], 'A:B-');
    const decisions = {
      v: 1, overrides: [], additions: [],
      translations: { [key]: {
        name: { en: 'Test chest', de: 'Testkiste' },
        desc: { ru: 'Описание из переводов' },
      } },
    };
    const { entries } = pipeline.buildEntries(BASIC, decisions);
    expect(entries[0].name.ru).toBe('Тестовый сундук'); // untouched
    expect(entries[0].name.en).toBe('Test chest');
    expect(entries[0].name.de).toBe('Testkiste');
    expect(entries[0].desc).toEqual({ ru: 'Описание из переводов' });
  });
});

// ── bootstrap: freeze current chests.json into decisions ─────────────────────

const bootstrap = require('../tools/bootstrap-decisions.cjs');

test.describe('bootstrapDecisions', () => {
  const mk = (id, ru, pos, rules, extra = {}) => ({
    id, name: ru ? { ru } : {}, cells: pos.length, rules, pos, tags: [], img: [], ...extra,
  });

  test('identical groups produce no decisions', () => {
    const regen = [mk('a', 'А', [1, 2], 'A:B-')];
    const current = [mk('a', 'А', [1, 2], 'A:B-')];
    const { decisions } = bootstrap.bootstrapDecisions(regen, current);
    expect(decisions.overrides).toEqual([]);
    expect(decisions.additions).toEqual([]);
  });

  test('a group differing in content is frozen with the CURRENT json content', () => {
    const regen = [mk('a', 'А', [1, 2], 'A:B-')];
    const current = [mk('a', 'А', [1, 2], 'A:B-', { name: { ru: 'А', en: 'A (translated)' } })];
    const { decisions } = bootstrap.bootstrapDecisions(regen, current);
    expect(decisions.overrides).toHaveLength(1);
    expect(decisions.overrides[0].entries[0].name.en).toBe('A (translated)');
  });

  test('a previously collapsed group is frozen to its single current entry', () => {
    const regen = [
      mk('a', 'Вариант 1', [1, 2], 'A:B-'),
      mk('a-2', 'Вариант 2', [1, 2], 'B:A-;A:B-'.replace('B:A-;', '')), // same canonical lock
    ];
    regen[1].rules = 'A:B-';
    const current = [mk('a', 'Вариант 1', [1, 2], 'A:B-')];
    const { decisions } = bootstrap.bootstrapDecisions(regen, current);
    expect(decisions.overrides).toHaveLength(1);
    expect(decisions.overrides[0].entries).toHaveLength(1);
    expect(decisions.overrides[0].entries[0].id).toBe('a');
  });

  test('entries existing only in current json become additions', () => {
    const regen = [mk('a', 'А', [1, 2], 'A:B-')];
    const current = [mk('a', 'А', [1, 2], 'A:B-'), mk('manual', 'Ручной', [3, 4], 'B:A+')];
    const { decisions } = bootstrap.bootstrapDecisions(regen, current);
    expect(decisions.additions).toHaveLength(1);
    expect(decisions.additions[0].id).toBe('manual');
  });

  test('entries only in regenerated output (rescued) need no decision', () => {
    const regen = [mk('a', 'А', [1, 2], 'A:B-'), mk('lock-33', null, [3, 3], 'A:B+')];
    const current = [mk('a', 'А', [1, 2], 'A:B-')];
    const { decisions, stats } = bootstrap.bootstrapDecisions(regen, current);
    expect(decisions.overrides).toEqual([]);
    expect(decisions.additions).toEqual([]);
    expect(stats.rescued).toBe(1);
  });

  test('name key order does not cause a false diff', () => {
    const regen = [{ ...mk('a', null, [1, 2], 'A:B-'), name: { ru: 'А', en: 'A' } }];
    const current = [{ ...mk('a', null, [1, 2], 'A:B-'), name: { en: 'A', ru: 'А' } }];
    const { decisions } = bootstrap.bootstrapDecisions(regen, current);
    expect(decisions.overrides).toEqual([]);
  });
});

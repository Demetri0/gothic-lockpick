import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

// Node-level tests for the Google-Translate round-trip tool.

const require = createRequire(import.meta.url);
const gaps = require('../tools/translate-gaps.cjs');
const { canonicalKey } = require('../tools/ini2json.cjs');

const mk = (id, name, pos, rules, extra = {}) => ({
  id, name, cells: pos.length, rules, pos, tags: [], img: [], ...extra,
});

test.describe('exportGaps', () => {
  test('emits one line per missing language with a parallel map', () => {
    const entries = [mk('a', { ru: 'Сундук у ворот' }, [1, 2], 'A:B-')];
    const out = gaps.exportGaps(entries);
    for (const lang of ['en', 'de', 'uk']) {
      expect(out[lang].lines).toEqual(['Сундук у ворот']);
      expect(out[lang].map).toEqual([{
        key: canonicalKey([1, 2], 'A:B-'), id: 'a', field: 'name', src: 'ru',
      }]);
    }
    expect(out.ru.lines).toEqual([]); // ru present — nothing to translate into ru
  });

  test('skips nameless entries and complete entries', () => {
    const entries = [
      mk('nameless', {}, [1, 2], 'A:B-'),
      mk('full', { ru: 'Р', en: 'E', de: 'D', uk: 'U' }, [3, 4], 'B:A+'),
    ];
    const out = gaps.exportGaps(entries);
    for (const lang of ['ru', 'en', 'de', 'uk']) expect(out[lang].lines).toEqual([]);
  });

  test('exports desc gaps only when a desc exists in some language', () => {
    const entries = [
      mk('with-desc', { ru: 'Имя', en: 'Name', de: 'N', uk: 'І' }, [1, 2], 'A:B-',
        { desc: { ru: 'Описание замка' } }),
      mk('no-desc', { ru: 'И2', en: 'N2', de: 'N2', uk: 'І2' }, [3, 4], 'B:A+'),
    ];
    const out = gaps.exportGaps(entries);
    expect(out.en.lines).toEqual(['Описание замка']);
    expect(out.en.map[0].field).toBe('desc');
    expect(out.ru.lines).toEqual([]);
  });
});

test.describe('importGaps / finalize', () => {
  test('zips translated lines into translationsPending via the map (byId)', () => {
    const key = canonicalKey([1, 2], 'A:B-');
    const decisions = { v: 1, overrides: [], additions: [], translations: {} };
    const map = [{ key, id: 'a', field: 'name', src: 'ru' }];
    gaps.importGaps(decisions, 'en', ['Chest by the gate'], map);
    expect(decisions.translationsPending[key].byId.a.name.en).toBe('Chest by the gate');
  });

  test('rejects a translated file whose line count does not match the map', () => {
    const decisions = { v: 1 };
    const map = [{ key: 'k', id: 'a', field: 'name', src: 'ru' }];
    expect(() => gaps.importGaps(decisions, 'en', ['one', 'two'], map)).toThrow(/line count/i);
  });

  test('finalize merges pending into translations and clears pending', () => {
    const decisions = {
      v: 1, overrides: [], additions: [],
      translations: { k1: { byId: { a: { name: { de: 'Alt' } } } } },
      translationsPending: {
        k1: { byId: { a: { name: { en: 'New EN' } } } },
        k2: { byId: { b: { desc: { uk: 'Опис' } } } },
      },
    };
    gaps.finalizeTranslations(decisions);
    expect(decisions.translations.k1.byId.a.name).toEqual({ de: 'Alt', en: 'New EN' });
    expect(decisions.translations.k2.byId.b.desc).toEqual({ uk: 'Опис' });
    expect(decisions.translationsPending).toBeUndefined();
  });
});

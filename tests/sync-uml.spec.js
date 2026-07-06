import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

// Node-level tests for the unlockmyloot sync tool (no network — fixtures only).

const require = createRequire(import.meta.url);
const sync = require('../tools/sync-uml.cjs');
const review = require('../tools/review-server.cjs');
const { canonicalKey } = require('../tools/ini2json.cjs');

const RU_PAGE = `<!DOCTYPE html><html lang="ru"><head>
<meta name="description" content="Хижина Диего юго-восточнее ворот замка. 5 эссенций, 3 отмычки.">
</head><body>
<nav class="crumb" aria-label="breadcrumb"><a href="/">Решатель</a><span>/</span><a href="/locks/">Каталог</a><span>/</span><span>Сундук Диего</span></nav>
<a href="/?lock=Yix4ABIAASCSAE">Открыть в решателе</a>
</body></html>`;

const EN_PAGE = RU_PAGE
  .replace('Сундук Диего', "Diego's chest")
  .replace(/content="[^"]*"/, 'content="Diego’s hut south-east of the castle gate."');

test.describe('decodeLockCode', () => {
  test('decodes the v2 bitstream into 0-based pins and directed edges', () => {
    // Verified earlier against the live site: 7 plates, pins 0020656 (0-based)
    const r = sync.decodeLockCode('gBDXAECQhAAQAQAIRAA');
    expect(r.pos).toEqual([0, 0, 2, 0, 6, 5, 6]);
    expect(r.rules).toBe('A:F-;B:C+,E-,G+;C:D-;D:E-;E:D-;F:D+;G:A-,C-');
  });
});

test.describe('parseLockPage', () => {
  test('extracts the breadcrumb short name, meta description and lock code', () => {
    const p = sync.parseLockPage(RU_PAGE);
    expect(p.name).toBe('Сундук Диего');
    expect(p.desc).toBe('Хижина Диего юго-восточнее ворот замка. 5 эссенций, 3 отмычки.');
    expect(p.code).toBe('Yix4ABIAASCSAE');
  });
});

test.describe('classify', () => {
  const mk = (id, name, pos, rules) => ({ id, name, cells: pos.length, rules, pos, tags: [], img: [] });
  const their = (slug, pos, rules) => ({
    slug, pos, rules, name: { ru: 'Сундук Диего', en: "Diego's chest" },
    desc: { ru: 'Описание ru', en: 'Description en' },
  });

  test('an exact canonical match becomes an enrich item carrying their desc', () => {
    const ours = [mk('our-diego', { ru: 'Хижина Диего' }, [1, 0, 5], 'A:B-')];
    const { items, stats } = sync.classify([their('diego-chest', [1, 0, 5], 'A:B-')], ours);
    expect(stats).toEqual({ exact: 1, conflict: 0, added: 0 });
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('enrich');
    expect(items[0].key).toBe(canonicalKey([1, 0, 5], 'A:B-'));
    expect(items[0].candidates).toHaveLength(2); // our entry + their record
    expect(items[0].proposed.desc).toEqual({ ru: 'Описание ru', en: 'Description en' });
    expect(items[0].proposed.name.ru).toBe('Хижина Диего'); // our names win by default
  });

  test('same rules but different positions become a conflict item with a note', () => {
    const ours = [mk('our-x', { ru: 'Наш' }, [1, 0, 5], 'A:B-')];
    const { items, stats } = sync.classify([their('x', [2, 0, 5], 'A:B-')], ours);
    expect(stats.conflict).toBe(1);
    expect(items[0].type).toBe('conflict');
    expect(items[0].key).toBe(canonicalKey([1, 0, 5], 'A:B-')); // keyed to OUR group
    expect(items[0].note).toMatch(/2,0,5/);
    expect(items[0].proposed.pos).toEqual([1, 0, 5]); // default: keep ours
  });

  test('an unknown lock becomes an add item', () => {
    const { items, stats } = sync.classify([their('newbie', [3, 3], 'A:B+')], []);
    expect(stats.added).toBe(1);
    expect(items[0].type).toBe('add');
    expect(items[0].proposed.id).toBe('newbie');
    expect(items[0].proposed.pos).toEqual([3, 3]);
  });
});

test.describe('review server handles additions', () => {
  test('applyAddDecision appends to decisions.additions (upsert by id)', () => {
    const decisions = { v: 1, overrides: [], additions: [] };
    review.applyAddDecision(decisions, { id: 'newbie', pos: [3, 3] });
    review.applyAddDecision(decisions, { id: 'newbie', pos: [3, 4] });
    expect(decisions.additions).toHaveLength(1);
    expect(decisions.additions[0].pos).toEqual([3, 4]);
  });
});

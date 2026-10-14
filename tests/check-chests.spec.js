import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

// pre-commit consistency check: a committed chests.json must equal a fresh build
// of chests.ini + tools/db-decisions.json (the `updated` stamp aside), whoever
// or whatever edited it. The real-repository comparison is a manual step of the
// hook (it depends on the local-only chests.ini), not part of this suite.

const require = createRequire(import.meta.url);
const { checkChests, TRIGGERS } = require('../.githooks/check-chests.cjs');
const { buildEntries, canonicalKey } = require('../tools/ini2json.cjs');

const INI = `"[test_chest_one]
name=""Тестовый сундук""
cells=2
rules=""A:B-""
start_pos=""1,2""
tags=""тест"""
`;
const built = (ini, dec) => JSON.stringify({ v: 1, updated: 'any', entries: buildEntries(ini, dec).entries });
const check = (o) => checkChests({ buildEntries, stagedDecisions: null, ...o });

test('a chests.json matching a fresh build passes, whatever its timestamp', () => {
  expect(check({ stagedJson: built(INI, null), ini: INI }).ok).toBe(true);
});

test('a hand-edited chests.json is rejected with a pointer to db-decisions', () => {
  const edited = JSON.parse(built(INI, null)); edited.entries[0].pos = [3, 3];
  const r = check({ stagedJson: JSON.stringify(edited), ini: INI });
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('tools/db-decisions.json');
});

test('a decisions change without a rebuild is rejected', () => {
  const dec = { v: 1, drops: [canonicalKey([1, 2], 'A:B-')] };
  expect(check({ stagedJson: built(INI, dec), stagedDecisions: JSON.stringify(dec), ini: INI }).ok).toBe(true);
  expect(check({ stagedJson: built(INI, null), stagedDecisions: JSON.stringify(dec), ini: INI }).ok).toBe(false);
});

test('without chests.ini the check passes with a warning', () => {
  const r = check({ stagedJson: '{}', ini: null });
  expect(r.ok).toBe(true);
  expect(r.warn).toContain('chests.ini');
});

test('the check triggers on the data, the decisions and the builder', () => {
  expect(TRIGGERS).toEqual(['chests.json', 'tools/db-decisions.json', 'tools/ini2json.cjs']);
});

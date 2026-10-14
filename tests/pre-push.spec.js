import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseRefs, blockSrc, fnSrc, corpusNeeded, planPush, hookConfig } = require('../.githooks/pre-push.cjs');

const Z = '0'.repeat(40);
const page = ({ blocks = {}, fns = {} } = {}) => '<html>'
  + Object.entries({ 'solver-src': 's', 'game-logic': 'g', codecs: 'c', ui: 'u', ...blocks }).map(([id, s]) => `<script id="${id}">${s}</script>`).join('')
  + `<script id="config">${Object.entries({ entryToPlates: 'return 1;', validatePlates: 'return 2;', handler: 'x();', ...fns }).map(([n, b]) => `function ${n}(a) {\n  ${b}\n}`).join('\n')}</script>`
  + '</html>';

test('blockSrc tolerates extra attributes and reports a missing block as null', () => {
  expect(blockSrc('<script type="text/javascript" id="codecs">x</script>', 'codecs')).toBe('x');
  expect(blockSrc('<html></html>', 'codecs')).toBeNull();
});

test('fnSrc extracts a top-level function by brace matching', () => {
  expect(fnSrc(page(), 'entryToPlates')).toContain('return 1;');
  expect(fnSrc(page(), 'missing')).toBeNull();
});

test('corpus: needed for solver/move/codec blocks, DB conversion functions or chests.json; not for UI code', () => {
  expect(corpusNeeded(page(), page({ blocks: { ui: 'U' } }), false)).toBe(false);
  expect(corpusNeeded(page(), page({ fns: { handler: 'y();' } }), false)).toBe(false);   // config-block UI code
  for (const id of ['solver-src', 'game-logic', 'codecs'])
    expect(corpusNeeded(page(), page({ blocks: { [id]: 'X' } }), false), id).toBe(true);
  for (const fn of ['entryToPlates', 'validatePlates'])
    expect(corpusNeeded(page(), page({ fns: { [fn]: 'changed();' } }), false), fn).toBe(true);
  expect(corpusNeeded(page(), page(), true)).toBe(true);
  expect(corpusNeeded(null, page(), false)).toBe(true);
});

function fakeGit({ peel = {}, known = [], onRemote = [], mergeBase = null, html = {}, chests = [] } = {}) {
  return {
    peel: s => peel[s] ?? s, exists: s => known.includes(s), onRemote: c => onRemote.includes(c),
    mergeBase: () => mergeBase, show: s => html[s] ?? null, chestsChanged: (b, c) => chests.includes(c),
  };
}

test('deletions are skipped; tags are peeled and deduplicated with branches', () => {
  const refs = parseRefs(`refs/heads/main h1 refs/heads/main r0\nrefs/tags/v1 t1 refs/tags/v1 ${Z}\nrefs/heads/old ${Z} refs/heads/old r9\n`);
  expect(planPush(refs, fakeGit({ peel: { t1: 'h1' }, known: ['r0'], html: { r0: page(), h1: page() } })))
    .toEqual([{ commit: 'h1', corpus: false }]);
});

test('a commit already on a remote-tracking ref is not re-tested', () => {
  const refs = parseRefs(`refs/tags/v2 t2 refs/tags/v2 ${Z}\n`);
  expect(planPush(refs, fakeGit({ peel: { t2: 'h1' }, onRemote: ['h1'] }))).toEqual([]);
});

test('a new branch compares against the merge-base; no base means the corpus runs', () => {
  const refs = parseRefs(`refs/heads/x h1 refs/heads/x ${Z}\n`);
  expect(planPush(refs, fakeGit({ mergeBase: 'm', html: { m: page(), h1: page() } }))[0].corpus).toBe(false);
  expect(planPush(refs, fakeGit({ mergeBase: null }))[0].corpus).toBe(true);
});

test('several distinct ref tips each get their own job; chests.json triggers the corpus', () => {
  const refs = parseRefs('refs/heads/a h1 refs/heads/a r0\nrefs/heads/b h2 refs/heads/b r0\nrefs/heads/c h3 refs/heads/c r0\n');
  const jobs = planPush(refs, fakeGit({ known: ['r0'], chests: ['h3'],
    html: { r0: page(), h1: page(), h2: page({ blocks: { codecs: 'X' } }), h3: page() } }));
  expect(jobs).toEqual([{ commit: 'h1', corpus: false }, { commit: 'h2', corpus: true }, { commit: 'h3', corpus: true }]);
});

test('the hook config pins its own port and never reuses a server', () => {
  const cfg = hookConfig(3107);
  expect(cfg).toContain("from './playwright.config.js'");
  expect(cfg).toContain('3107');
  expect(cfg).toContain('reuseExistingServer: false');
});

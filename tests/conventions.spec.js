import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Conventions cheap to check mechanically (CLAUDE.md → Testing). Scope, stated
// honestly: Playwright locator/selector calls in test files, DOM queries by
// test id in app code, and URL writes. Not checked: DOM queries inside
// page.evaluate() (tests read computed styles and markup there) and code after
// a regex literal containing `//` (stripComments is a small scanner, not a parser).

const TESTS = fileURLToPath(new URL('./', import.meta.url));
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(spec\.)?js$/.test(f) ? [p] : [];
});

/** Blank out // and /* *\/ comments, keeping strings and line numbers intact. */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// One or more compounds joined by whitespace or `>`. Each compound is a
// data-test-id attribute (any operator) followed by optional extra attribute
// filters. No classes, tags, ids, commas or pseudo-classes.
const ATTR = String.raw`\[[a-z][a-z0-9-]*(?:[\^$*|~]?=(?:"[^"]*"|'[^']*'))?\]`;
const COMPOUND = String.raw`\[data-test-id[\^$*|~]?=(?:"[^"]*"|'[^']*')\](?:${ATTR})*`;
const SELECTOR = new RegExp(String.raw`^\s*${COMPOUND}(?:\s*>\s*${COMPOUND}|\s+${COMPOUND})*\s*$`);
// Playwright calls whose first argument is a selector string.
const SELECTOR_CALL = String.raw`(?:\.\s*(?:locator|frameLocator)|\bpage\.\s*(?:\$\$?|\$\$?eval|waitForSelector|click|dblclick|fill|check|uncheck|hover|press|type|selectOption|tap|focus|textContent|innerText|innerHTML|getAttribute|isVisible|isHidden|isEnabled|isDisabled|isChecked))\s*\(`;

function locatorViolations(src) {
  const code = stripComments(src), out = [];
  const lineOf = idx => code.slice(0, idx).split('\n').length;
  for (const m of code.matchAll(/\.\s*(getByText|getByRole|getByLabel|getByPlaceholder|getByTitle|getByAltText)\s*\(/g))
    out.push(`${lineOf(m.index)}: ${m[1]}()`);
  for (const m of code.matchAll(/\bhasText\s*:/g)) out.push(`${lineOf(m.index)}: filter({ hasText })`);
  const re = new RegExp(SELECTOR_CALL + String.raw`\s*(?:(['"\`])((?:\\.|(?!\1)[\s\S])*)\1(\s*\+)?|([^)'"\`\s][^)]*))`, 'g');
  for (const m of code.matchAll(re)) {
    const [, , selector, concat] = m;
    if (selector === undefined || concat) out.push(`${lineOf(m.index)}: non-literal selector`);
    else if (!SELECTOR.test(selector.replace(/\$\{[^}]*\}/g, 'x'))) out.push(`${lineOf(m.index)}: '${selector}'`);
  }
  return out;
}

function appTestIdQueries(src) {
  return src.split('\n').flatMap((l, i) =>
    /(querySelector(All)?|closest|matches)\s*\(\s*['"`][^'"`]*data-test-id/.test(l) || /dataset\.testId(?!\s*=[^=])/.test(l)
      ? [`${i + 1}: ${l.trim()}`] : []);
}

test('the locator lint accepts every test-id form and rejects everything else', () => {
  for (const ok of [
    `page.getByTestId('btn-start')`,
    `page.locator('[data-test-id="pos-input-1"]')`,
    `page.locator('[data-test-id^="search-result-0-hole-"][data-active="true"]')`,
    `page.locator('[data-test-id="toast"][data-test-type="success"]').last()`,
    `page.locator(\`[data-test-id="mini-cell-\${r}-\${c}"]\`)`,
    `page.locator('[data-test-id="a"] [data-test-id="b"]')`,
    `page.locator('[data-test-id="a"] > [data-test-id="b"]')`,
    `page.keyboard.press('Control+k')`,
    `// page.getByText('commented out')`,
  ]) expect(locatorViolations(ok), ok).toEqual([]);
  for (const bad of [
    `page.getByText('Go')`, `page.getByRole ('button')`, `page.locator('#btn-start')`,
    `page.locator('.btn-primary')`, `page.locator('[data-test-id="x"] .btn')`,
    `page.locator('[data-test-id="x"], button')`, `page.locator(selector)`,
    `page.locator(\n  '.multi-line'\n)`, `rows.filter({ hasText: 'x' })`,
    `page.click('#x')`, `page.$('.row')`, `page.waitForSelector('.x')`,
    `page.locator('[data-test-id="a"]' + '.x')`,
  ]) expect(locatorViolations(bad), bad).not.toEqual([]);
});

test('test files locate elements only by data-test-id', () => {
  const found = walk(TESTS).filter(f => !f.endsWith('conventions.spec.js'))
    .flatMap(f => locatorViolations(readFileSync(f, 'utf8')).map(v => `${f.slice(TESTS.length)}:${v}`));
  expect(found, found.join('\n')).toEqual([]);
});

test('app code never queries the DOM by data-test-id (test ids are for tests)', () => {
  const found = appTestIdQueries(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  expect(found, found.join('\n')).toEqual([]);
});

test('the URL is written in one place: urlWrite (callers use urlReplace/urlPush)', () => {
  const html = stripComments(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  // Bracket access to the history *methods* would dodge the count below. (The solver
  // has an unrelated local array named `history`, so match the method names.)
  expect(html, 'no bracket access to history methods').not.toMatch(/history\s*\[[^\]]*State/);
  const start = html.indexOf('function urlWrite(');
  expect(start, 'urlWrite exists').toBeGreaterThan(-1);
  const body = html.slice(start, html.indexOf('\n}', start));
  const all = [...html.matchAll(/history\.(replaceState|pushState)\s*\(/g)].length;
  const inside = [...body.matchAll(/history\.(replaceState|pushState)\s*\(/g)].length;
  expect(inside, 'urlWrite calls both history methods').toBe(2);
  expect(all, 'history.*State( appears only inside urlWrite').toBe(inside);
});

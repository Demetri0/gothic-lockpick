import { test, expect } from '@playwright/test';

// The convention (CLAUDE.md) is that every user-visible string exists in all three
// locales. Nothing enforced it, so a forgotten translation could only be found by eye.
// These guards make the omission fail the suite instead.

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('every locale defines exactly the same set of keys', async ({ page }) => {
  const gaps = await page.evaluate(() => {
    const locales = Object.keys(TRANSLATIONS);
    const keys = Object.fromEntries(locales.map(l => [l, new Set(Object.keys(TRANSLATIONS[l]))]));
    const all = [...new Set(locales.flatMap(l => [...keys[l]]))];
    const out = {};
    for (const l of locales) {
      const missing = all.filter(k => !keys[l].has(k));
      if (missing.length) out[l] = missing;
    }
    return out;
  });
  expect(gaps).toEqual({});
});

test('no translation value is empty', async ({ page }) => {
  const blank = await page.evaluate(() =>
    Object.entries(TRANSLATIONS).flatMap(([l, dict]) =>
      Object.entries(dict).filter(([, v]) => typeof v === 'string' && !v.trim()).map(([k]) => `${l}.${k}`)));
  expect(blank).toEqual([]);
});

test('every data-i18n key used in the markup exists in the dictionaries', async ({ page }) => {
  const unknown = await page.evaluate(() => {
    const all = new Set(Object.values(TRANSLATIONS).flatMap(d => Object.keys(d)));
    const used = [...document.querySelectorAll('[data-i18n],[data-i18n-title]')]
      .flatMap(el => [el.dataset.i18n, el.dataset.i18nTitle]).filter(Boolean);
    return [...new Set(used)].filter(k => !all.has(k));
  });
  expect(unknown).toEqual([]);
});

test('t() returns a real string for every key in every locale', async ({ page }) => {
  const bad = await page.evaluate(() => {
    const out = [];
    const original = state.lang;
    for (const l of Object.keys(TRANSLATIONS)) {
      state.lang = l;
      for (const k of Object.keys(TRANSLATIONS[l])) {
        const v = t(k);
        // t() falls back to the key itself when a lookup misses — that must never happen
        if (typeof v !== 'string' || !v.trim() || v === k) out.push(`${l}.${k}`);
      }
    }
    state.lang = original;
    return out;
  });
  expect(bad).toEqual([]);
});

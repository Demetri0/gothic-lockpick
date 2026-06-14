# Gothic Lockpick — Project Conventions

## Testing

### Selectors
Always use `data-test-id` attributes to locate elements in tests. Never use CSS classes, tag names, text content, or IDs as selectors — they are implementation details that change without notice.

```js
// ✓ correct
page.getByTestId('btn-start')
page.locator('[data-test-id="pos-val-1"]')

// ✗ wrong
page.locator('#btn-start')
page.locator('.btn-primary')
page.getByText('РЕШЕНИЕ')
```

When an element needs to be tested but has no `data-test-id`, add one to `index.html` first.

### Language
Write all test descriptions (`test('...')`) and inline comments in **English**.

```js
// ✓ correct
test('D moves the active plate right', async ({ page }) => {
  // First go right so we can verify A goes back
  ...
});

// ✗ wrong
test('D двигает активную плашку вправо', async ({ page }) => {
  // Сначала вправо, чтобы убедиться что A двигает обратно
  ...
});
```

## Localization

Any user-visible text added to `index.html` must be added to **all three locales** (`ru`, `en`, `uk`) in the `TRANSLATIONS` object. Never hardcode a display string in HTML or JS without a corresponding translation key — use `data-i18n` on the element and `t('key')` in JS.

The only exception is locale-independent symbols (e.g. `·`, `↩`) that carry the same meaning in all languages.

### Style
- `{ force: true }` on clicks inside the 3D scene (CSS 3D transforms affect hit-testing)
- Don't assert transient UI states (overlay appearing then disappearing in <5 ms is not reliably catchable — assert the result instead)
- Keep `beforeEach` to `page.goto('/')` only; per-test setup goes inside the test

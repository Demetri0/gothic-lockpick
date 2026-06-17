import { expect } from '@playwright/test';

// The position lock renders one input per plate (data-test-id="pos-input-<id>"),
// plus edge ghost controls (poslock-ghost-del / poslock-ghost-add).

/** Current value of plate `i` (1-based) as a string digit. */
export async function posDigit(page, i) {
  return page.getByTestId(`pos-input-${i}`).inputValue();
}

/** Assert plate `i` (1-based) shows `val`. */
export async function expectPosDigit(page, i, val) {
  await expect(page.getByTestId(`pos-input-${i}`)).toHaveValue(String(val));
}

/** Assert plate `i` (1-based) is the active (framed) plate. */
export async function expectActivePlate(page, i) {
  await expect(page.getByTestId('poslock')).toHaveAttribute('data-active', String(i));
}

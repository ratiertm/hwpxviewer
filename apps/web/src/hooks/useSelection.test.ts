/**
 * Tests for the pure coordinate helpers inside useSelection. The drag
 * pipeline itself is covered by an E2E (E2E-30) because it requires the real
 * SVG ``getScreenCTM`` which JSDOM doesn't implement.
 */

import { describe, expect, it } from 'vitest';

import { lengthBetween, orderLocations } from './useSelection';

describe('orderLocations', () => {
  it('returns identity when already ordered (same section+para)', () => {
    const a = { sec: 0, para: 0, charOffset: 3 };
    const b = { sec: 0, para: 0, charOffset: 7 };
    expect(orderLocations(a, b)).toEqual([a, b]);
  });

  it('swaps when offsets reversed within one paragraph', () => {
    const a = { sec: 0, para: 0, charOffset: 7 };
    const b = { sec: 0, para: 0, charOffset: 3 };
    expect(orderLocations(a, b)).toEqual([b, a]);
  });

  it('orders by paragraph before offset', () => {
    const a = { sec: 0, para: 5, charOffset: 0 };
    const b = { sec: 0, para: 2, charOffset: 99 };
    expect(orderLocations(a, b)).toEqual([b, a]);
  });

  it('orders by section first', () => {
    const a = { sec: 1, para: 0, charOffset: 0 };
    const b = { sec: 0, para: 99, charOffset: 99 };
    expect(orderLocations(a, b)).toEqual([b, a]);
  });
});

describe('lengthBetween', () => {
  it('returns delta within a single paragraph', () => {
    expect(
      lengthBetween({ sec: 0, para: 0, charOffset: 2 }, { sec: 0, para: 0, charOffset: 9 }),
    ).toBe(7);
  });

  it('returns 0 for identical points', () => {
    const p = { sec: 0, para: 0, charOffset: 5 };
    expect(lengthBetween(p, p)).toBe(0);
  });

  it('returns null for cross-paragraph ranges (v0.3 limitation)', () => {
    expect(
      lengthBetween({ sec: 0, para: 0, charOffset: 0 }, { sec: 0, para: 1, charOffset: 0 }),
    ).toBeNull();
  });

  it('returns null for cross-section ranges', () => {
    expect(
      lengthBetween({ sec: 0, para: 0, charOffset: 0 }, { sec: 1, para: 0, charOffset: 0 }),
    ).toBeNull();
  });
});

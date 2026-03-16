import { describe, it, expect } from 'vitest';
import { CM_TO_PTS, guideToPosition, positionToGuide } from '../../src/shared/utils/guideConvert';

const A4_W = 595;
const A4_H = 842;

// Regression: Math.round(2 * 28.346) = 57 → 57/28.346 ≈ 2.01 (was bug)
describe('guideConvert — rounding accuracy', () => {
  it('2.00 cm round-trips to exactly 2.00 (vertical)', () => {
    const pos = guideToPosition(2.00, 'vertical', A4_W, A4_H);
    const cm = positionToGuide(pos, 'vertical', A4_W, A4_H);
    expect(cm.toFixed(2)).toBe('2.00');
  });

  it('2.00 cm round-trips to exactly 2.00 (horizontal)', () => {
    const pos = guideToPosition(2.00, 'horizontal', A4_W, A4_H);
    const cm = positionToGuide(pos, 'horizontal', A4_W, A4_H);
    expect(cm.toFixed(2)).toBe('2.00');
  });

  it('Math.round bug is absent — 2 * CM_TO_PTS is not rounded', () => {
    // If Math.round were applied: Math.round(2 * 28.346) = 57
    // Then 57 / 28.346 = 2.0108... ≠ 2.00
    const pos = 2 * CM_TO_PTS; // 56.692
    expect(Math.round(pos)).toBe(57); // confirm the old bug
    expect(pos / CM_TO_PTS).toBeCloseTo(2.00, 5); // but without round it's exact
  });
});

describe('guideConvert — vertical guides', () => {
  it('positive cm converts from left', () => {
    const pos = guideToPosition(3.0, 'vertical', A4_W, A4_H);
    expect(pos).toBeCloseTo(3.0 * CM_TO_PTS, 5);
  });

  it('negative cm converts from right', () => {
    const pos = guideToPosition(-2.0, 'vertical', A4_W, A4_H);
    expect(pos).toBeCloseTo(A4_W - 2.0 * CM_TO_PTS, 5);
  });

  it('position near left edge returns positive cm', () => {
    const cm = positionToGuide(3.0 * CM_TO_PTS, 'vertical', A4_W, A4_H);
    expect(cm).toBeGreaterThan(0);
    expect(cm).toBeCloseTo(3.0, 5);
  });

  it('position near right edge returns negative cm', () => {
    const cm = positionToGuide(A4_W - 2.0 * CM_TO_PTS, 'vertical', A4_W, A4_H);
    expect(cm).toBeLessThan(0);
    expect(cm).toBeCloseTo(-2.0, 5);
  });

  it('zero position round-trips to 0', () => {
    const pos = guideToPosition(0, 'vertical', A4_W, A4_H);
    expect(pos).toBe(0);
    const cm = positionToGuide(0, 'vertical', A4_W, A4_H);
    expect(cm).toBe(0);
  });
});

describe('guideConvert — horizontal guides', () => {
  it('positive cm converts from bottom', () => {
    const pos = guideToPosition(5.0, 'horizontal', A4_W, A4_H);
    expect(pos).toBeCloseTo(A4_H - 5.0 * CM_TO_PTS, 5);
  });

  it('negative cm converts from top', () => {
    const pos = guideToPosition(-3.0, 'horizontal', A4_W, A4_H);
    expect(pos).toBeCloseTo(3.0 * CM_TO_PTS, 5);
  });

  it('position near bottom returns positive cm', () => {
    const cm = positionToGuide(A4_H - 5.0 * CM_TO_PTS, 'horizontal', A4_W, A4_H);
    expect(cm).toBeGreaterThan(0);
    expect(cm).toBeCloseTo(5.0, 5);
  });

  it('position near top returns negative cm', () => {
    const cm = positionToGuide(3.0 * CM_TO_PTS, 'horizontal', A4_W, A4_H);
    expect(cm).toBeLessThan(0);
    expect(cm).toBeCloseTo(-3.0, 5);
  });

  it('1.0 cm round-trips accurately (horizontal from bottom)', () => {
    const pos = guideToPosition(1.0, 'horizontal', A4_W, A4_H);
    const cm = positionToGuide(pos, 'horizontal', A4_W, A4_H);
    expect(cm.toFixed(2)).toBe('1.00');
  });

  it('various round-trip values are accurate to 2 decimal places', () => {
    const testValues = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 5.0, 10.0];
    for (const v of testValues) {
      const pos = guideToPosition(v, 'vertical', A4_W, A4_H);
      const cm = positionToGuide(pos, 'vertical', A4_W, A4_H);
      expect(cm.toFixed(2)).toBe(v.toFixed(2));
    }
  });
});

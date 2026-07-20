import { describe, expect, test } from 'bun:test';
import {
  BLUR_PEAK_MIN,
  BLUR_SCORE_FAIR,
  BLUR_SCORE_POOR,
  DARK_MEAN_FAIR,
  DARK_MEAN_POOR,
  evaluateCaptureQuality,
  getCaptureQualityGuidance
} from './quality';

describe('evaluateCaptureQuality', () => {
  test('returns good when bright and sharp', () => {
    const q = evaluateCaptureQuality(BLUR_SCORE_FAIR + 200, 140, 0.1, 0);
    expect(q.level).toBe('good');
    expect(q.reasons).toEqual([]);
  });

  test('flags fair when mean luma is moderately low', () => {
    const mid = (DARK_MEAN_POOR + DARK_MEAN_FAIR) / 2;
    const q = evaluateCaptureQuality(BLUR_SCORE_FAIR + 200, mid, 0.2, 0);
    expect(q.level).toBe('fair');
    expect(q.reasons).toContain('dark');
  });

  test('flags fair when focus is below absolute fair threshold', () => {
    const mid = (BLUR_SCORE_POOR + BLUR_SCORE_FAIR) / 2;
    const q = evaluateCaptureQuality(mid, 140, 0.1, 0);
    expect(q.level).toBe('fair');
    expect(q.reasons).toEqual(['blur']);
  });

  test('flags poor when very dark', () => {
    const q = evaluateCaptureQuality(800, DARK_MEAN_POOR - 10, 0.3, 0);
    expect(q.level).toBe('poor');
    expect(q.reasons).toContain('dark');
  });

  test('uses relative peak to catch blur even if absolute score is mid-high', () => {
    const peak = Math.max(BLUR_PEAK_MIN, 1000);
    // 40% of peak → below BLUR_REL_FAIR (0.55) → blur
    const current = peak * 0.4;
    const q = evaluateCaptureQuality(current, 140, 0.1, peak);
    expect(q.reasons).toContain('blur');
    expect(q.level === 'fair' || q.level === 'poor').toBe(true);
  });

  test('relative very-blur maps to poor', () => {
    const peak = 1000;
    const current = peak * 0.25; // below BLUR_REL_POOR 0.32
    const q = evaluateCaptureQuality(current, 140, 0.1, peak);
    expect(q.level).toBe('poor');
    expect(q.reasons).toContain('blur');
  });

  test('dark ratio alone can flag darkness', () => {
    const q = evaluateCaptureQuality(800, 120, 0.7, 0);
    expect(q.reasons).toContain('dark');
    expect(q.level === 'fair' || q.level === 'poor').toBe(true);
  });
});

describe('getCaptureQualityGuidance', () => {
  test('none and good messages', () => {
    expect(getCaptureQualityGuidance('none', [])).toContain('書類全体');
    expect(getCaptureQualityGuidance('good', [])).toContain('シャッター');
  });

  test('uses the same copy for fair and poor (severity color carries severity)', () => {
    expect(getCaptureQualityGuidance('fair', ['dark'])).toBe('もう少し明るくしてください');
    expect(getCaptureQualityGuidance('poor', ['dark'])).toBe('もう少し明るくしてください');
    expect(getCaptureQualityGuidance('fair', ['blur'])).toBe('手ブレ注意：端末を安定させてください');
    expect(getCaptureQualityGuidance('poor', ['blur'])).toBe('手ブレ注意：端末を安定させてください');
    expect(getCaptureQualityGuidance('fair', ['dark', 'blur'])).toBe(
      '明るさとピントを調整してください'
    );
    expect(getCaptureQualityGuidance('poor', ['dark', 'blur'])).toBe(
      '明るさとピントを調整してください'
    );
  });
});

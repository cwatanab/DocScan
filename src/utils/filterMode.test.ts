import { describe, expect, test } from 'bun:test';
import {
  combineFilterMode,
  getColorMode,
  getEnhancementMode,
  type FilterMode
} from './filterMode';

describe('getColorMode / getEnhancementMode', () => {
  test.each([
    ['color_enhanced', 'color', 'enhanced'],
    ['color_original', 'color', 'original'],
    ['document_enhanced', 'document', 'enhanced'],
    ['document_original', 'document', 'original'],
    ['mono', 'document', 'original']
  ] as const)('%s → color=%s enhancement=%s', (mode, color, enhancement) => {
    expect(getColorMode(mode)).toBe(color);
    expect(getEnhancementMode(mode)).toBe(enhancement);
  });
});

describe('combineFilterMode', () => {
  test('combines color × enhancement into FilterMode', () => {
    expect(combineFilterMode('color', 'enhanced')).toBe('color_enhanced');
    expect(combineFilterMode('color', 'original')).toBe('color_original');
    expect(combineFilterMode('document', 'enhanced')).toBe('document_enhanced');
    expect(combineFilterMode('document', 'original')).toBe('document_original');
  });

  test('round-trips with getColorMode / getEnhancementMode for non-mono modes', () => {
    const modes: FilterMode[] = [
      'color_enhanced',
      'color_original',
      'document_enhanced',
      'document_original'
    ];
    for (const mode of modes) {
      const recombined = combineFilterMode(getColorMode(mode), getEnhancementMode(mode));
      expect(recombined).toBe(mode);
    }
  });
});

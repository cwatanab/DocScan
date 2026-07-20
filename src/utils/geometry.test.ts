import { describe, expect, test } from 'bun:test';
import { distance, sortBoxPoints, sortPoints, type Point } from './geometry';

describe('sortPoints', () => {
  test('orders four shuffled corners as TL, TR, BR, BL', () => {
    const shuffled: Point[] = [
      { x: 200, y: 10 },  // TR
      { x: 10, y: 10 },   // TL
      { x: 10, y: 300 },  // BL
      { x: 200, y: 300 }  // BR
    ];
    const sorted = sortPoints(shuffled);
    expect(sorted).toEqual([
      { x: 10, y: 10 },
      { x: 200, y: 10 },
      { x: 200, y: 300 },
      { x: 10, y: 300 }
    ]);
  });

  test('returns input unchanged when length is not 4', () => {
    const three: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 }
    ];
    expect(sortPoints(three)).toBe(three);
  });

  test('does not mutate the original array', () => {
    const original: Point[] = [
      { x: 5, y: 5 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 0, y: 5 }
    ];
    const snapshot = original.map((p) => ({ ...p }));
    sortPoints(original);
    expect(original).toEqual(snapshot);
  });
});

describe('sortBoxPoints', () => {
  test('orders number[][] boxes as TL, TR, BR, BL', () => {
    const box = [
      [80, 0],
      [0, 0],
      [0, 40],
      [80, 40]
    ];
    expect(sortBoxPoints(box)).toEqual([
      [0, 0],
      [80, 0],
      [80, 40],
      [0, 40]
    ]);
  });
});

describe('distance', () => {
  test('computes Euclidean distance between two points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});

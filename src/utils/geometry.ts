/**
 * 2D 幾何ユーティリティ（ドキュメント四隅など）
 */

export interface Point {
  x: number;
  y: number;
}

/** 頂点を左上・右上・右下・左下の順にソートする */
export function sortPoints(points: Point[]): Point[] {
  if (points.length !== 4) return points;

  const sortedByX = [...points].sort((a, b) => a.x - b.x);
  const leftMost = [sortedByX[0], sortedByX[1]];
  const rightMost = [sortedByX[2], sortedByX[3]];

  const [topLeft, bottomLeft] = leftMost.sort((a, b) => a.y - b.y);
  const [topRight, bottomRight] = rightMost.sort((a, b) => a.y - b.y);

  return [topLeft, topRight, bottomRight, bottomLeft];
}

/** 2点間のユークリッド距離 */
export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/** number[][] 形式の4点を左上・右上・右下・左下にソートする（OCR 用） */
export function sortBoxPoints(points: number[][]): number[][] {
  const sortedX = [...points].sort((a, b) => a[0] - b[0]);
  const left = [sortedX[0], sortedX[1]];
  const right = [sortedX[2], sortedX[3]];

  const [topLeft, bottomLeft] = left.sort((a, b) => a[1] - b[1]);
  const [topRight, bottomRight] = right.sort((a, b) => a[1] - b[1]);

  return [topLeft, topRight, bottomRight, bottomLeft];
}

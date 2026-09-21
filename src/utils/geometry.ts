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

/**
 * 4頂点の形状がドキュメント（凸四角形）として幾何学的に妥当かを判定する
 */
export function checkShapeValidity(
  pts: Point[],
  maxCos: number,
  maxEdgeRatio: number = 1.3
): boolean {
  if (pts.length !== 4) return false;

  // 1. 各内角の角度チェック (cosθ の絶対値が maxCos の範囲外なら弾く)
  for (let i = 0; i < 4; i++) {
    const pPrev = pts[(i + 3) % 4];
    const pCurr = pts[i];
    const pNext = pts[(i + 1) % 4];

    const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);

    const denominator = len1 * len2;
    if (denominator === 0) {
      return false; // ゼロ除算の回避（完全に頂点が重なっている場合）
    }

    const cosTheta = (v1.x * v2.x + v1.y * v2.y) / denominator;
    if (Math.abs(cosTheta) > maxCos) {
      return false; // 鋭角・鈍角制限
    }
  }

  // 2. 対辺の長さ比チェック (極端に歪んだ台形などを弾く)
  // pts は TL, TR, BR, BL の順に並んでいる前提
  const dTop = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const dRight = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y);
  const dBottom = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
  const dLeft = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);

  if (dTop === 0 || dBottom === 0 || dLeft === 0 || dRight === 0) {
    return false;
  }

  const ratioH = Math.max(dTop, dBottom) / Math.min(dTop, dBottom);
  const ratioV = Math.max(dLeft, dRight) / Math.min(dLeft, dRight);

  if (ratioH > maxEdgeRatio || ratioV > maxEdgeRatio) {
    return false;
  }

  return true;
}

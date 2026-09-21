/**
 * ドキュメント四隅座標のエッジ吸着・精緻化（Corner Refinement）
 *
 * AI検出（SimCC）による粗い四隅座標を初期値とし、
 * 各辺の法線方向における輝度勾配（エッジ）を1次元サンプリングして
 * 直線フィッティング（PCA/直交最小二乗）を行い、4直線の交点として
 * ピクセル精度でドキュメント境界に吸着（Snap）させる。
 */

import type { Point } from './geometry';
import { distance, checkShapeValidity } from './geometry';

export interface RefineCornersOptions {
  /** 探索半径（px）。未指定時は画像サイズから動的計算（min(W, H) * 0.045、最大 50px） */
  searchRadius?: number;
  /** 各辺のサンプル点数。デフォルト 24 */
  sampleCount?: number;
  /** エッジ判定の最小勾配しきい値。デフォルト 12 */
  minGradient?: number;
  /** 最大許容移動距離（px）。未指定時は searchRadius * 1.4 */
  maxDisplacement?: number;
}

interface FittedLine {
  origin: Point;
  direction: Point; // 単位方向ベクトル
}

/**
 * バイリニア補間を用いてサブピクセル座標の輝度 (0〜255) を取得する
 */
function getBilinearLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));

  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const fx = cx - x0;
  const fy = cy - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const l00 = 0.299 * data[idx00] + 0.587 * data[idx00 + 1] + 0.114 * data[idx00 + 2];
  const l10 = 0.299 * data[idx10] + 0.587 * data[idx10 + 1] + 0.114 * data[idx10 + 2];
  const l01 = 0.299 * data[idx01] + 0.587 * data[idx01 + 1] + 0.114 * data[idx01 + 2];
  const l11 = 0.299 * data[idx11] + 0.587 * data[idx11 + 1] + 0.114 * data[idx11 + 2];

  const top = l00 * (1 - fx) + l10 * fx;
  const bottom = l01 * (1 - fx) + l11 * fx;

  return top * (1 - fy) + bottom * fy;
}

/**
 * 2直線の交点を計算する
 */
function intersectLines(line1: FittedLine, line2: FittedLine): Point | null {
  const dx = line2.origin.x - line1.origin.x;
  const dy = line2.origin.y - line1.origin.y;

  // 外積（det）
  const det = line1.direction.x * line2.direction.y - line1.direction.y * line2.direction.x;
  if (Math.abs(det) < 0.02) {
    // ほぼ平行で交差しない
    return null;
  }

  const s = (dx * line2.direction.y - dy * line2.direction.x) / det;
  return {
    x: line1.origin.x + s * line1.direction.x,
    y: line1.origin.y + s * line1.direction.y
  };
}

/**
 * 点群に対して主成分分析 (PCA) による直交最小二乗直線フィッティングを行う
 */
function fitLinePCA(points: Point[]): FittedLine | null {
  if (points.length < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (const pt of points) {
    sumX += pt.x;
    sumY += pt.y;
  }
  const meanX = sumX / points.length;
  const meanY = sumY / points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const pt of points) {
    const dx = pt.x - meanX;
    const dy = pt.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    origin: { x: meanX, y: meanY },
    direction: { x: Math.cos(angle), y: Math.sin(angle) }
  };
}

/**
 * AI等で粗検出された四隅座標を、画像のコントラスト境界（エッジ）に吸着させて精緻化する。
 *
 * @param source 画像ソース（HTMLCanvasElement または ImageData）
 * @param corners 初期四隅座標（TL, TR, BR, BL）
 * @param options 設定オプション
 * @returns 精緻化された四隅座標（検出失敗・異常時は元の corners を返す）
 */
export function refineDocumentCorners(
  source: HTMLCanvasElement | ImageData,
  corners: Point[],
  options?: RefineCornersOptions
): Point[] {
  if (!corners || corners.length !== 4) return corners;

  let width: number;
  let height: number;
  let data: Uint8ClampedArray;

  if ('data' in source && typeof source.width === 'number') {
    width = source.width;
    height = source.height;
    data = source.data;
  } else if ('getContext' in source) {
    const canvas = source as HTMLCanvasElement;
    width = canvas.width;
    height = canvas.height;
    if (width <= 0 || height <= 0) return corners;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return corners;
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      data = imgData.data;
    } catch {
      return corners;
    }
  } else {
    return corners;
  }

  const minDim = Math.min(width, height);
  const searchRadius =
    options?.searchRadius ?? Math.min(50, Math.max(16, Math.round(minDim * 0.045)));
  const sampleCount = options?.sampleCount ?? 24;
  const minGradient = options?.minGradient ?? 12;
  const maxDisplacement = options?.maxDisplacement ?? searchRadius * 1.4;

  const fittedLines: (FittedLine | null)[] = [null, null, null, null];

  // 4辺（0: 上, 1: 右, 2: 下, 3: 左）を処理
  for (let edgeIdx = 0; edgeIdx < 4; edgeIdx++) {
    const pStart = corners[edgeIdx];
    const pEnd = corners[(edgeIdx + 1) % 4];

    const edgeDx = pEnd.x - pStart.x;
    const edgeDy = pEnd.y - pStart.y;
    const edgeLen = Math.hypot(edgeDx, edgeDy);

    if (edgeLen < 20) {
      // 辺が短すぎる場合はスキップ
      continue;
    }

    const ux = edgeDx / edgeLen;
    const uy = edgeDy / edgeLen;
    // 単位法線ベクトル（辺の直交方向）
    const nx = -uy;
    const ny = ux;

    const edgePoints: Point[] = [];
    const offsets: number[] = [];

    // 角の丸みや手ブレ・指の映り込みを避けるため、辺の両端 14% を除外した区間でサンプリング
    const margin = 0.14;
    const effectiveSpan = 1.0 - margin * 2;

    for (let s = 0; s < sampleCount; s++) {
      const t = margin + (s / (sampleCount - 1)) * effectiveSpan;
      const sampleX = pStart.x + t * edgeDx;
      const sampleY = pStart.y + t * edgeDy;

      // 法線方向に沿って 1px 刻みで輝度プロファイルを収集
      const profileLen = searchRadius * 2 + 1;
      const profile: number[] = new Array(profileLen);

      for (let r = -searchRadius; r <= searchRadius; r++) {
        const qx = sampleX + r * nx;
        const qy = sampleY + r * ny;
        profile[r + searchRadius] = getBilinearLuma(data, width, height, qx, qy);
      }

      // 3点移動平均で平滑化
      const smoothed: number[] = new Array(profileLen);
      for (let i = 1; i < profileLen - 1; i++) {
        smoothed[i] = (profile[i - 1] + 2 * profile[i] + profile[i + 1]) * 0.25;
      }

      // 勾配（1次差分）を計算し、絶対値の最大ピークを探索
      let maxGrad = 0;
      let peakR = 0;

      for (let r = -searchRadius + 2; r <= searchRadius - 2; r++) {
        const idx = r + searchRadius;
        const grad = Math.abs(smoothed[idx + 1] - smoothed[idx - 1]);
        if (grad > maxGrad) {
          maxGrad = grad;
          peakR = r;
        }
      }

      // コントラストが不十分な平坦領域は破棄
      if (maxGrad < minGradient) continue;

      // 3点放物線フィッティングによるサブピクセルピーク推定
      const pIdx = peakR + searchRadius;
      const gPrev = Math.abs(smoothed[pIdx - 1] - smoothed[pIdx - 3] || 0);
      const gCurr = maxGrad;
      const gNext = Math.abs(smoothed[pIdx + 3] - smoothed[pIdx + 1] || 0);
      const denom = 2 * (2 * gCurr - gPrev - gNext);
      const subOffset = denom > 1e-4 ? (gNext - gPrev) / denom : 0;
      const refinedR = peakR + Math.max(-0.5, Math.min(0.5, subOffset));

      const edgePtX = sampleX + refinedR * nx;
      const edgePtY = sampleY + refinedR * ny;

      edgePoints.push({ x: edgePtX, y: edgePtY });
      offsets.push(refinedR);
    }

    // 外れ値除去（中央値基準）
    if (edgePoints.length >= 4) {
      const sortedOffsets = [...offsets].sort((a, b) => a - b);
      const medOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
      const allowedDeviation = Math.max(8, searchRadius * 0.4);

      const inlierPoints: Point[] = [];
      for (let i = 0; i < edgePoints.length; i++) {
        if (Math.abs(offsets[i] - medOffset) <= allowedDeviation) {
          inlierPoints.push(edgePoints[i]);
        }
      }

      // インライアが十分に存在する場合にPCA直線フィッティング
      if (inlierPoints.length >= Math.max(4, Math.floor(sampleCount * 0.22))) {
        const fitted = fitLinePCA(inlierPoints);
        if (fitted) {
          // 直線ベクトルの向きを元の辺ベクトルと同じ向きに揃える
          const dot = fitted.direction.x * ux + fitted.direction.y * uy;
          if (dot < 0) {
            fitted.direction.x = -fitted.direction.x;
            fitted.direction.y = -fitted.direction.y;
          }
          fittedLines[edgeIdx] = fitted;
        }
      }
    }

    // フィッティングできなかった場合は元の辺の2点を通る直線を使う
    if (!fittedLines[edgeIdx]) {
      fittedLines[edgeIdx] = {
        origin: pStart,
        direction: { x: ux, y: uy }
      };
    }
  }

  // 4直線の交点から新しい四隅を計算
  const refinedCorners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const prevLine = fittedLines[(i + 3) % 4]!;
    const currLine = fittedLines[i]!;

    const intersection = intersectLines(prevLine, currLine);
    const origPoint = corners[i];

    if (intersection && distance(intersection, origPoint) <= maxDisplacement) {
      // 画面内にクランプして採用
      refinedCorners.push({
        x: Math.max(0, Math.min(width, intersection.x)),
        y: Math.max(0, Math.min(height, intersection.y))
      });
    } else {
      // 交点が遠すぎる・求まらない場合は元の点を採用
      refinedCorners.push(origPoint);
    }
  }

  // 形状の幾何学的妥当性チェック
  if (!checkShapeValidity(refinedCorners, 0.20, 1.35)) {
    // 形状が歪んでしまった場合は安全に元の corners を返す
    return corners;
  }

  return refinedCorners;
}

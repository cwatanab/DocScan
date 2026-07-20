/**
 * 撮影画質（明るさ・鮮明さ）の評価
 *
 * プレビューは 300px 前後に縮小したうえで評価する前提。
 * 絶対しきい値に加え、直近のピーク鮮明度との相対比較でブレを拾いやすくする。
 */

import { safeDeleteAll } from '../cvMat';
import type { Point } from '../geometry';
import { calculateFocusScore } from './focus';

export type CaptureQualityLevel = 'good' | 'fair' | 'poor' | 'none';
export type CaptureQualityReason = 'dark' | 'blur';

export interface CaptureQuality {
  level: CaptureQualityLevel;
  reasons: CaptureQualityReason[];
  /** ラプラシアン分散（高いほど鮮明） */
  focusScore: number;
  /** 平均輝度 0–255 */
  meanLuma: number;
  /** 暗部ピクセル比率 0–1 */
  darkRatio: number;
}

/**
 * 明るさ（紙面の平均輝度想定）
 * 白っぽい書類は通常 110–180。100 を切ると明らかに薄暗い。
 */
export const DARK_MEAN_FAIR = 105;
export const DARK_MEAN_POOR = 72;
/** 輝度がこの値未満の画素の比率 */
export const DARK_PIXEL_THRESHOLD = 60;
export const DARK_RATIO_FAIR = 0.42;
export const DARK_RATIO_POOR = 0.62;

/**
 * 鮮明さ（300px 縮小 + 文字入り書類の経験レンジ）
 * シャープ時は数百〜数千、ピンボケ／手ブレで大きく落ちる。
 * 以前の 45–90 は実機でほぼ常に good になっていた。
 */
export const BLUR_SCORE_FAIR = 320;
export const BLUR_SCORE_POOR = 140;

/** ピーク鮮明度に対する相対（セッション内の「この環境での最良」比） */
export const BLUR_REL_FAIR = 0.55;
export const BLUR_REL_POOR = 0.32;
/** 相対判定を有効にする最小ピーク（これ未満は絶対値のみ） */
export const BLUR_PEAK_MIN = 200;

export interface CaptureMetrics {
  focusScore: number;
  meanLuma: number;
  darkRatio: number;
}

/**
 * ドキュメント四隅の外接矩形を、元キャンバス → 縮小キャンバス座標系に写して切り出す。
 * 失敗時は null（全体評価にフォールバック）。
 */
export function cropDocumentRoi(
  sourceCanvas: HTMLCanvasElement,
  corners: Point[],
  maxDim: number = 300
): HTMLCanvasElement | null {
  if (!corners || corners.length !== 4) return null;

  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(sourceCanvas.width, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(sourceCanvas.height, Math.max(...ys));

  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw < 16 || bh < 16) return null;

  // 枠ギリギリだと余白・影で輝度が偏るので少し内側を使う
  const insetX = bw * 0.08;
  const insetY = bh * 0.08;
  const sx = Math.floor(minX + insetX);
  const sy = Math.floor(minY + insetY);
  const sw = Math.max(8, Math.floor(bw - insetX * 2));
  const sh = Math.max(8, Math.floor(bh - insetY * 2));

  let dw = sw;
  let dh = sh;
  if (dw > maxDim || dh > maxDim) {
    if (dw > dh) {
      dh = Math.round((dh * maxDim) / dw);
      dw = maxDim;
    } else {
      dw = Math.round((dw * maxDim) / dh);
      dh = maxDim;
    }
  }

  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, dw, dh);
  return out;
}

/**
 * 平均輝度と暗部比率を一度に計測
 */
export function calculateLumaStats(canvas: HTMLCanvasElement): { meanLuma: number; darkRatio: number } {
  const cv = window.cv;
  if (!cv) return { meanLuma: 128, darkRatio: 0 };

  let src: any = null;
  let gray: any = null;
  let mask: any = null;

  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const meanLuma = cv.mean(gray)[0];

    mask = new cv.Mat();
    cv.threshold(gray, mask, DARK_PIXEL_THRESHOLD, 255, cv.THRESH_BINARY_INV);
    const darkRatio = cv.mean(mask)[0] / 255;

    return { meanLuma, darkRatio };
  } catch (e) {
    console.error('Error in calculating luma stats: ', e);
    return { meanLuma: 128, darkRatio: 0 };
  } finally {
    safeDeleteAll(src, gray, mask);
  }
}

export function calculateMeanLuma(canvas: HTMLCanvasElement): number {
  return calculateLumaStats(canvas).meanLuma;
}

/**
 * Canvas 全体からメトリクスを取得
 */
export function measureCaptureMetrics(canvas: HTMLCanvasElement): CaptureMetrics {
  const focusScore = calculateFocusScore(canvas);
  const { meanLuma, darkRatio } = calculateLumaStats(canvas);
  return { focusScore, meanLuma, darkRatio };
}

/**
 * フォーカス／輝度メトリクスから総合画質を判定する。
 * @param peakFocus 直近セッションのピーク鮮明度（相対ブレ判定用。0 なら絶対値のみ）
 */
export function evaluateCaptureQuality(
  focusScore: number,
  meanLuma: number,
  darkRatio: number = 0,
  peakFocus: number = 0
): Omit<CaptureQuality, 'focusScore' | 'meanLuma' | 'darkRatio'> {
  const reasons: CaptureQualityReason[] = [];

  const isDark =
    meanLuma < DARK_MEAN_FAIR || darkRatio > DARK_RATIO_FAIR;
  const isVeryDark =
    meanLuma < DARK_MEAN_POOR || darkRatio > DARK_RATIO_POOR;

  const absBlurry = focusScore < BLUR_SCORE_FAIR;
  const absVeryBlurry = focusScore < BLUR_SCORE_POOR;

  const useRel = peakFocus >= BLUR_PEAK_MIN;
  const relBlurry = useRel && focusScore < peakFocus * BLUR_REL_FAIR;
  const relVeryBlurry = useRel && focusScore < peakFocus * BLUR_REL_POOR;

  const isBlurry = absBlurry || relBlurry;
  const isVeryBlurry = absVeryBlurry || relVeryBlurry;

  if (isDark) reasons.push('dark');
  if (isBlurry) reasons.push('blur');

  let level: CaptureQualityLevel;
  if (isVeryDark || isVeryBlurry || (isDark && isBlurry)) {
    level = 'poor';
  } else if (isDark || isBlurry) {
    level = 'fair';
  } else {
    level = 'good';
  }

  return { level, reasons };
}

/**
 * 縮小 Canvas から focus + luma をまとめて評価する
 */
export function assessCanvasCaptureQuality(
  canvas: HTMLCanvasElement,
  peakFocus: number = 0
): CaptureQuality {
  const metrics = measureCaptureMetrics(canvas);
  const { level, reasons } = evaluateCaptureQuality(
    metrics.focusScore,
    metrics.meanLuma,
    metrics.darkRatio,
    peakFocus
  );
  return {
    level,
    reasons,
    focusScore: metrics.focusScore,
    meanLuma: metrics.meanLuma,
    darkRatio: metrics.darkRatio
  };
}

/**
 * 元フレーム + 四隅から ROI を切り出して評価（推奨）
 */
export function assessDocumentCaptureQuality(
  sourceCanvas: HTMLCanvasElement,
  corners: Point[],
  peakFocus: number = 0
): CaptureQuality {
  const roi = cropDocumentRoi(sourceCanvas, corners, 320);
  const target = roi ?? (() => {
    // フォールバック: 全体を 320 辺に縮小
    const c = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(sourceCanvas.width, sourceCanvas.height));
    c.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    c.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(sourceCanvas, 0, 0, c.width, c.height);
    return c;
  })();

  return assessCanvasCaptureQuality(target, peakFocus);
}

/** 枠・UI 用の色パレット */
export const QUALITY_FRAME_COLORS: Record<
  Exclude<CaptureQualityLevel, 'none'>,
  { stroke: string; fill: string; corner: string }
> = {
  good: {
    stroke: '#10b981',
    fill: 'rgba(16, 185, 129, 0.15)',
    corner: '#059669'
  },
  fair: {
    stroke: '#f59e0b',
    fill: 'rgba(245, 158, 11, 0.16)',
    corner: '#d97706'
  },
  poor: {
    stroke: '#ef4444',
    fill: 'rgba(239, 68, 68, 0.16)',
    corner: '#dc2626'
  }
};

/**
 * ガイダンス文言（枠色と併用）
 */
export function getCaptureQualityGuidance(
  level: CaptureQualityLevel,
  reasons: CaptureQualityReason[]
): string {
  if (level === 'none') {
    return '書類全体が写るようにしてください';
  }
  if (level === 'good') {
    return 'そのままシャッターを押せます';
  }

  const hasDark = reasons.includes('dark');
  const hasBlur = reasons.includes('blur');

  // fair / poor とも同じ文言（枠色で重大度を示す）
  if (hasDark && hasBlur) return '明るさとピントを調整してください';
  if (hasDark) return 'もう少し明るくしてください';
  return '手ブレ注意：端末を安定させてください';
}

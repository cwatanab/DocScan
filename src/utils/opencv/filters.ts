/**
 * OpenCV フィルター処理
 */

import { safeDelete, safeDeleteAll, safeDeleteMatVector } from '../cvMat';
import type { FilterMode } from '../filterMode';
import { sortPoints, type Point } from '../geometry';

export type { FilterMode } from '../filterMode';

/**
 * cv.Mat に対して直接フィルター処理を適用する
 * @param src 入力 cv.Mat (RGBA)
 * @param dst 出力 cv.Mat (RGBA または GRAY)
 * @param mode フィルターモード
 */
export function applyFilterToMat(src: any, dst: any, mode: FilterMode): void {
  const cv = window.cv;
  if (!cv) return;

  let channels: any = null;
  let lut: any = null;
  let rgb: any = null;

  try {
    if (mode === 'color_enhanced') {
      let hsv: any = null;
      let mask: any = null;
      try {
        hsv = new cv.Mat();
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        channels = new cv.MatVector();
        cv.split(hsv, channels);

        const sChan = channels.get(1);
        const vChan = channels.get(2);

        // 輝度の自動補正: 0-255 の Min-Max ストレッチ
        mask = new cv.Mat();
        cv.normalize(vChan, vChan, 0, 255, cv.NORM_MINMAX, -1, mask);

        // 彩度を 1.25 倍に引き上げて鮮やかさを復元
        sChan.convertTo(sChan, -1, 1.25, 0);

        cv.merge(channels, hsv);
        rgb = new cv.Mat();
        cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
        cv.cvtColor(rgb, dst, cv.COLOR_RGB2RGBA);

        safeDelete(rgb);
        rgb = null;
      } catch (err) {
        console.error('Error in color_enhanced filter:', err);
        src.copyTo(dst);
      } finally {
        safeDeleteAll(hsv, mask);
      }
    } else if (mode === 'color_original') {
      src.copyTo(dst);
    } else if (mode === 'document_enhanced') {
      let small: any = null;
      let smallBg: any = null;
      let bg: any = null;
      let mask: any = null;
      try {
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

        // 1/4 サイズで背景推定（しわ・影の除去）
        small = new cv.Mat();
        smallBg = new cv.Mat();
        bg = new cv.Mat();
        const scale = 0.25;
        const smallW = Math.round(dst.cols * scale);
        const smallH = Math.round(dst.rows * scale);

        cv.resize(dst, small, new cv.Size(smallW, smallH), 0, 0, cv.INTER_LINEAR);

        lut = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 13));
        cv.dilate(small, smallBg, lut);
        cv.medianBlur(smallBg, smallBg, 13);
        cv.resize(smallBg, bg, dst.size(), 0, 0, cv.INTER_LINEAR);

        cv.divide(dst, bg, dst, 255, -1);

        mask = new cv.Mat();
        const minMax = cv.minMaxLoc(dst, mask);
        const minVal = minMax.minVal;
        const maxVal = minMax.maxVal;

        if (maxVal > minVal) {
          const scaleFactor = 255.0 / (maxVal - minVal);
          dst.convertTo(dst, -1, scaleFactor, -minVal * scaleFactor);
        }

        // ハイライトクリップ付きガンマ補正
        lut = new cv.Mat(1, 256, cv.CV_8UC1);
        const lutData = new Uint8Array(256);
        const gamma = 2.2;
        const clipThreshold = 220;
        for (let i = 0; i < 256; i++) {
          if (i >= clipThreshold) {
            lutData[i] = 255;
          } else {
            const norm = i / clipThreshold;
            lutData[i] = Math.min(255, Math.max(0, Math.pow(norm, gamma) * 255.0));
          }
        }
        lut.data.set(lutData);
        cv.LUT(dst, lut, dst);
      } catch (err) {
        console.error('Error in document_enhanced filter (Morphology):', err);
      } finally {
        safeDeleteAll(small, smallBg, bg, mask, lut);
        lut = null;
      }
    } else if (mode === 'document_original') {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
    } else if (mode === 'mono') {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      cv.adaptiveThreshold(
        dst,
        dst,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15,
        10
      );
    }
  } finally {
    safeDeleteMatVector(channels);
    safeDeleteAll(lut, rgb);
  }
}

/**
 * Canvas にフィルターを適用し、新しい Canvas を返す
 */
export function applyFilter(canvas: HTMLCanvasElement, mode: FilterMode): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) return canvas;

  let src: any = null;
  let dst: any = null;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = canvas.width;
  resultCanvas.height = canvas.height;

  try {
    src = cv.imread(canvas);
    dst = new cv.Mat();
    applyFilterToMat(src, dst, mode);
    cv.imshow(resultCanvas, dst);
  } finally {
    safeDeleteAll(src, dst);
  }

  return resultCanvas;
}

/**
 * 画像の色彩を解析し、最適なフィルターモードを自動判定する
 */
export async function detectOptimalFilter(
  imageSrc: string,
  corners: Point[]
): Promise<{ mode: 'color_enhanced' | 'document_enhanced'; colorRatio: number }> {
  const cv = window.cv;
  let colorRatio = 0.0;
  if (!cv || !cv.Mat || corners.length !== 4) {
    return { mode: 'document_enhanced', colorRatio: 0.0 };
  }

  let src: any = null;
  let small: any = null;
  let hsv: any = null;
  let channels: any = null;
  let threshSat: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;

  try {
    // iOS の canvas 同期エラー回避のため、新たに画像をデコードする
    const tempImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = imageSrc;
    });

    src = cv.imread(tempImg);
    small = new cv.Mat();
    const sorted = sortPoints(corners);
    const [tl, tr, br, bl] = sorted;

    srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      150, 0,
      150, 150,
      0, 150
    ]);

    M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(src, small, M, new cv.Size(150, 150), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    hsv = new cv.Mat();
    cv.cvtColor(small, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

    channels = new cv.MatVector();
    cv.split(hsv, channels);

    const sChan = channels.get(1);
    threshSat = new cv.Mat();
    cv.threshold(sChan, threshSat, 12, 255, cv.THRESH_BINARY);

    const meanVal = cv.mean(threshSat)[0];
    colorRatio = meanVal / 255.0;

    if (colorRatio > 0.005) {
      return { mode: 'color_enhanced', colorRatio };
    }
  } catch (e) {
    console.error('Error in detecting optimal filter: ', e);
  } finally {
    safeDelete(threshSat);
    safeDeleteMatVector(channels);
    safeDeleteAll(hsv, small, src, srcCoords, dstCoords, M);
  }

  return { mode: 'document_enhanced', colorRatio };
}

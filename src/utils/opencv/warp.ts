/**
 * 台形補正・回転・ワープ＋フィルター合成
 */

import { safeDeleteAll } from '../cvMat';
import type { FilterMode } from '../filterMode';
import { distance, sortPoints, type Point } from '../geometry';
import { applyFilterToMat } from './filters';

function emptyCanvasFrom(srcImgOrCanvas: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  if (srcImgOrCanvas instanceof HTMLCanvasElement) {
    return srcImgOrCanvas;
  }
  const c = document.createElement('canvas');
  c.width = srcImgOrCanvas.width;
  c.height = srcImgOrCanvas.height;
  return c;
}

/**
 * 4隅の座標を元にドキュメントの台形補正を行う
 */
export function warpImage(
  srcImgOrCanvas: HTMLCanvasElement | HTMLImageElement,
  corners: Point[]
): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) {
    console.error('OpenCV.js is not loaded.');
    return emptyCanvasFrom(srcImgOrCanvas);
  }

  const sortedCorners = sortPoints(corners);
  const [tl, tr, br, bl] = sortedCorners;

  const maxWidth = Math.max(1, Math.round(Math.max(distance(br, bl), distance(tr, tl))));
  const maxHeight = Math.max(1, Math.round(Math.max(distance(tr, br), distance(tl, bl))));

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = maxWidth;
  dstCanvas.height = maxHeight;

  let src: any = null;
  let dst: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;

  try {
    src = cv.imread(srcImgOrCanvas);
    dst = new cv.Mat();

    srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth, 0,
      maxWidth, maxHeight,
      0, maxHeight
    ]);

    M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    cv.imshow(dstCanvas, dst);
  } finally {
    safeDeleteAll(src, dst, srcCoords, dstCoords, M);
  }

  return dstCanvas;
}

/**
 * 画像を 90 度回転させる
 */
export function rotateImage90(
  srcImgOrCanvas: HTMLCanvasElement | HTMLImageElement,
  clockwise: boolean = true
): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) {
    return emptyCanvasFrom(srcImgOrCanvas);
  }

  let src: any = null;
  let dst: any = null;
  const resultCanvas = document.createElement('canvas');

  try {
    src = cv.imread(srcImgOrCanvas);
    dst = new cv.Mat();

    cv.rotate(src, dst, clockwise ? cv.ROTATE_90_CLOCKWISE : cv.ROTATE_90_COUNTERCLOCKWISE);

    const w =
      srcImgOrCanvas instanceof HTMLImageElement
        ? srcImgOrCanvas.naturalWidth || srcImgOrCanvas.width
        : srcImgOrCanvas.width;
    const h =
      srcImgOrCanvas instanceof HTMLImageElement
        ? srcImgOrCanvas.naturalHeight || srcImgOrCanvas.height
        : srcImgOrCanvas.height;

    resultCanvas.width = h;
    resultCanvas.height = w;
    cv.imshow(resultCanvas, dst);
  } finally {
    safeDeleteAll(src, dst);
  }

  return resultCanvas;
}

/**
 * HTMLImageElement から確実にピクセルを読むための Canvas 化。
 * display:none や iOS のデコード未完了時の cv.imread 失敗を避ける。
 */
function imageToCanvas(imageEl: HTMLImageElement): HTMLCanvasElement | null {
  const w = imageEl.naturalWidth || imageEl.width;
  const h = imageEl.naturalHeight || imageEl.height;
  if (w <= 0 || h <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(imageEl, 0, 0, w, h);
  } catch (err) {
    console.error('Failed to draw image to canvas for warp:', err);
    return null;
  }
  return canvas;
}

/**
 * 台形補正とフィルター処理を行い、結果の DataURL を生成する
 */
export function processWarpAndFilter(
  imageEl: HTMLImageElement,
  corners: Point[],
  filterMode: FilterMode,
  rotation: number = 0
): string | null {
  const cv = window.cv;
  if (!cv) return null;
  if (!corners || corners.length !== 4) return null;

  const sortedCorners = sortPoints(corners);
  const [tl, tr, br, bl] = sortedCorners;

  const maxWidth = Math.max(1, Math.round(Math.max(distance(br, bl), distance(tr, tl))));
  const maxHeight = Math.max(1, Math.round(Math.max(distance(tr, br), distance(tl, bl))));

  // 非表示や iOS デコード問題を避けるため、いったん Canvas に描画してから imread する
  const sourceCanvas = imageToCanvas(imageEl);
  if (!sourceCanvas) {
    console.error('processWarpAndFilter: source image has no drawable pixels');
    return null;
  }

  let src: any = null;
  let warped: any = null;
  let dst: any = null;
  let rotated: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;

  try {
    src = cv.imread(sourceCanvas);
    warped = new cv.Mat();

    srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth, 0,
      maxWidth, maxHeight,
      0, maxHeight
    ]);

    M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(
      src,
      warped,
      M,
      new cv.Size(maxWidth, maxHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );

    dst = new cv.Mat();
    applyFilterToMat(warped, dst, filterMode);

    // 90/270 度はサイズが入れ替わるため、in-place rotate ではなく別 Mat へ出力する
    let output = dst;
    if (rotation === 90 || rotation === 180 || rotation === 270) {
      rotated = new cv.Mat();
      if (rotation === 90) {
        cv.rotate(dst, rotated, cv.ROTATE_90_CLOCKWISE);
      } else if (rotation === 180) {
        cv.rotate(dst, rotated, cv.ROTATE_180);
      } else {
        cv.rotate(dst, rotated, cv.ROTATE_90_COUNTERCLOCKWISE);
      }
      output = rotated;
    }

    const resultCanvas = document.createElement('canvas');
    if (rotation === 90 || rotation === 270) {
      resultCanvas.width = maxHeight;
      resultCanvas.height = maxWidth;
    } else {
      resultCanvas.width = maxWidth;
      resultCanvas.height = maxHeight;
    }

    cv.imshow(resultCanvas, output);
    return resultCanvas.toDataURL('image/jpeg', 0.95);
  } catch (err) {
    console.error('processWarpAndFilter failed:', err);
    return null;
  } finally {
    safeDeleteAll(src, warped, dst, rotated, srcCoords, dstCoords, M);
  }
}

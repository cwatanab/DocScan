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

  const maxWidth = Math.max(distance(br, bl), distance(tr, tl));
  const maxHeight = Math.max(distance(tr, br), distance(tl, bl));

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

  const sortedCorners = sortPoints(corners);
  const [tl, tr, br, bl] = sortedCorners;

  const maxWidth = Math.max(distance(br, bl), distance(tr, tl));
  const maxHeight = Math.max(distance(tr, br), distance(tl, bl));

  let src: any = null;
  let warped: any = null;
  let dst: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;

  try {
    src = cv.imread(imageEl);
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
    cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    dst = new cv.Mat();
    applyFilterToMat(warped, dst, filterMode);

    if (rotation === 90) {
      cv.rotate(dst, dst, cv.ROTATE_90_CLOCKWISE);
    } else if (rotation === 180) {
      cv.rotate(dst, dst, cv.ROTATE_180);
    } else if (rotation === 270) {
      cv.rotate(dst, dst, cv.ROTATE_90_COUNTERCLOCKWISE);
    }

    const resultCanvas = document.createElement('canvas');
    if (rotation === 90 || rotation === 270) {
      resultCanvas.width = maxHeight;
      resultCanvas.height = maxWidth;
    } else {
      resultCanvas.width = maxWidth;
      resultCanvas.height = maxHeight;
    }

    cv.imshow(resultCanvas, dst);
    return resultCanvas.toDataURL('image/jpeg', 0.95);
  } finally {
    safeDeleteAll(src, warped, dst, srcCoords, dstCoords, M);
  }
}

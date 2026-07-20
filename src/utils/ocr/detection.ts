/**
 * OCR テキスト検出（DB PostProcess）
 */

import { safeDelete, safeDeleteAll, safeDeleteMatVector } from '../cvMat';
import { sortBoxPoints } from '../geometry';

/**
 * cv.minAreaRect が返す RotatedRect から 4 つの頂点座標を算出する
 * (cv.boxPoints が一部の OpenCV.js で省略されている問題の回避策)
 */
function getRotatedRectPoints(rect: {
  center: { x: number; y: number };
  size: { width: number; height: number };
  angle: number;
}): number[][] {
  const cx = rect.center.x;
  const cy = rect.center.y;
  const w = rect.size.width;
  const h = rect.size.height;
  const angle = rect.angle;

  const theta = (angle * Math.PI) / 180.0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2]
  ];

  return pts.map(([x, y]) => [x * cos - y * sin + cx, x * sin + y * cos + cy]);
}

/**
 * 検出された輪郭内部における確率マップの平均スコアを算出する
 */
function calculateBoxScore(predMat: any, contour: any): number {
  const cv = window.cv;
  if (!cv) return 0.5;

  const rect = cv.boundingRect(contour);
  const roiPred = predMat.roi(rect);
  const mask = cv.Mat.zeros(rect.height, rect.width, cv.CV_8UC1);
  const contours = new cv.MatVector();
  const shiftedContour = new cv.Mat(contour.rows, 1, cv.CV_32SC2);

  const data = contour.data32S;
  const shiftedData = new Int32Array(contour.rows * 2);
  for (let i = 0; i < contour.rows; i++) {
    shiftedData[i * 2] = data[i * 2] - rect.x;
    shiftedData[i * 2 + 1] = data[i * 2 + 1] - rect.y;
  }
  shiftedContour.data32S.set(shiftedData);
  contours.push_back(shiftedContour);

  cv.drawContours(mask, contours, 0, new cv.Scalar(255), -1);

  const meanScalar = cv.mean(roiPred, mask);
  const score = meanScalar[0];

  safeDeleteAll(roiPred, mask, shiftedContour);
  safeDelete(contours);

  return score;
}

/**
 * 検出モデルの後処理 (DBPostProcess)
 */
export function dbPostProcess(
  predData: Float32Array,
  predHeight: number,
  predWidth: number,
  origWidth: number,
  origHeight: number,
  unclipRatio: number
): number[][][] {
  const cv = window.cv;
  if (!cv) return [];

  let predMat: any = null;
  let binaryMat: any = null;
  let contours: any = null;
  let hierarchy: any = null;

  try {
    predMat = new cv.Mat(predHeight, predWidth, cv.CV_32FC1);
    predMat.data32F.set(predData);

    binaryMat = new cv.Mat();
    cv.threshold(predMat, binaryMat, 0.3, 255, cv.THRESH_BINARY);
    binaryMat.convertTo(binaryMat, cv.CV_8UC1);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(binaryMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const boxes: number[][][] = [];
    const ratioX = origWidth / predWidth;
    const ratioY = origHeight / predHeight;

    for (let i = 0; i < contours.size(); ++i) {
      const contour = contours.get(i);
      const peri = cv.arcLength(contour, true);
      if (peri < 12) {
        safeDelete(contour);
        continue;
      }

      const rect = cv.minAreaRect(contour);

      const score = calculateBoxScore(predMat, contour);
      if (score < 0.5) {
        safeDelete(contour);
        continue;
      }

      const wRect = rect.size.width;
      const hRect = rect.size.height;
      const area = wRect * hRect;
      const perimeter = 2 * (wRect + hRect);
      const distance = perimeter > 0 ? (area * unclipRatio) / perimeter : 0;

      rect.size.width += 2 * distance;
      rect.size.height += 2 * distance;

      const pts = getRotatedRectPoints(rect);
      const sortedPts = sortBoxPoints(pts);

      const finalPts = sortedPts.map((p) => [
        Math.min(Math.max(0, p[0] * ratioX), origWidth),
        Math.min(Math.max(0, p[1] * ratioY), origHeight)
      ]);

      const w = Math.hypot(finalPts[1][0] - finalPts[0][0], finalPts[1][1] - finalPts[0][1]);
      const h = Math.hypot(finalPts[3][0] - finalPts[0][0], finalPts[3][1] - finalPts[0][1]);
      if (w < 4 || h < 4) {
        safeDelete(contour);
        continue;
      }

      boxes.push(finalPts);
      safeDelete(contour);
    }

    boxes.sort((a, b) => {
      const ay = (a[0][1] + a[1][1] + a[2][1] + a[3][1]) / 4;
      const by = (b[0][1] + b[1][1] + b[2][1] + b[3][1]) / 4;
      return ay - by;
    });

    return boxes;
  } finally {
    safeDeleteAll(predMat, binaryMat, hierarchy);
    safeDeleteMatVector(contours);
  }
}

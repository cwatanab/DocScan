/**
 * フォーカス（ピント）スコア計算
 */

import { safeDeleteAll } from '../cvMat';

/**
 * 画像のフォーカススコア（ラプラシアン分散）を計算する。
 * 高いほどピントが合っておりエッジが立っている。
 */
export function calculateFocusScore(canvas: HTMLCanvasElement): number {
  const cv = window.cv;
  if (!cv) return 0;

  let src: any = null;
  let gray: any = null;
  let laplacian: any = null;
  let mean: any = null;
  let stddev: any = null;

  let score = 0;
  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    laplacian = new cv.Mat();
    mean = new cv.Mat();
    stddev = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, laplacian, cv.CV_64F, 1, 1, 0, cv.BORDER_DEFAULT);
    cv.meanStdDev(laplacian, mean, stddev);

    const sd = stddev.doubleAt(0, 0);
    score = sd * sd;
  } catch (e) {
    console.error('Error in calculating focus score: ', e);
  } finally {
    safeDeleteAll(src, gray, laplacian, mean, stddev);
  }

  return score;
}

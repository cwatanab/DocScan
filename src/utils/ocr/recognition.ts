/**
 * OCR テキスト認識（切り出し・前処理・CTC デコード）
 */

import * as ort from 'onnxruntime-web';
import { safeDeleteAll } from '../cvMat';
import { resizeCanvas } from '../imageExportHelper';

/**
 * OCR エンジン専用の画像前処理
 * （過剰処理によるエッジ潰れを防ぐため、グレースケール＋マイルドなアンシャープのみ）
 */
export function preprocessImageForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) return canvas;

  const inputCanvas = resizeCanvas(canvas, 2240);

  let src: any = null;
  let dst: any = null;
  let blurred: any = null;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = inputCanvas.width;
  resultCanvas.height = inputCanvas.height;

  try {
    src = cv.imread(inputCanvas);
    dst = new cv.Mat();

    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

    blurred = new cv.Mat();
    cv.GaussianBlur(dst, blurred, new cv.Size(3, 3), 1.0, 1.0);
    cv.addWeighted(dst, 1.3, blurred, -0.3, 0, dst);

    cv.imshow(resultCanvas, dst);
  } finally {
    safeDeleteAll(src, dst, blurred);
  }

  return resultCanvas;
}

/**
 * 画像から多角形領域を切り出して水平にする (Perspective Warp)
 */
export function getCropImage(canvas: HTMLCanvasElement, box: number[][]): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) return canvas;

  let src: any = null;
  let srcTri: any = null;
  let dstTri: any = null;
  let M: any = null;
  let dst: any = null;

  const x0 = box[0][0],
    y0 = box[0][1];
  const x1 = box[1][0],
    y1 = box[1][1];
  const x2 = box[2][0],
    y2 = box[2][1];
  const x3 = box[3][0],
    y3 = box[3][1];

  const width = Math.max(
    Math.hypot(x1 - x0, y1 - y0),
    Math.hypot(x2 - x3, y2 - y3)
  );
  const height = Math.max(
    Math.hypot(x3 - x0, y3 - y0),
    Math.hypot(x2 - x1, y2 - y1)
  );

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = width;
  cropCanvas.height = height;

  try {
    src = cv.imread(canvas);

    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [x0, y0, x1, y1, x2, y2, x3, y3]);
    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);

    M = cv.getPerspectiveTransform(srcTri, dstTri);
    dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(width, height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);

    cv.imshow(cropCanvas, dst);
  } finally {
    safeDeleteAll(src, srcTri, dstTri, M, dst);
  }

  return cropCanvas;
}

/**
 * 縦長の Canvas を時計回りに 90 度回転させる（縦書き用）
 */
export function rotateCanvas90(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const rotated = document.createElement('canvas');
  rotated.width = canvas.height;
  rotated.height = canvas.width;
  const ctx = rotated.getContext('2d')!;

  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate((90 * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

  return rotated;
}

/**
 * テキスト認識用テンソルの前処理
 */
export function preprocessRecImage(canvas: HTMLCanvasElement): ort.Tensor {
  const targetHeight = 48;
  const aspect = canvas.width / canvas.height;
  const targetWidth = Math.min(1024, Math.max(16, Math.round(targetHeight * aspect)));

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const ctx = tempCanvas.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, targetWidth, targetHeight);

  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imgData.data;
  const numPixels = targetWidth * targetHeight;
  const inputBuffer = new Float32Array(numPixels * 3);

  const scale = 2.0 / 255.0;
  let srcIdx = 0;
  for (let i = 0; i < numPixels; i++) {
    inputBuffer[i] = data[srcIdx++] * scale - 1.0;
    inputBuffer[numPixels + i] = data[srcIdx++] * scale - 1.0;
    inputBuffer[numPixels * 2 + i] = data[srcIdx++] * scale - 1.0;
    srcIdx++;
  }

  return new ort.Tensor('float32', inputBuffer, [1, 3, targetHeight, targetWidth]);
}

/**
 * CTC デコードによるテキスト変換
 */
export function decodeCtc(
  outputData: Float32Array,
  seqLen: number,
  vocabSize: number,
  dict: string[]
): { text: string; confidence: number } {
  let prevIdx = -1;
  const chars: string[] = [];
  let totalScore = 0;
  let count = 0;
  const blankIdx = 0;

  for (let t = 0; t < seqLen; t++) {
    let maxVal = -Infinity;
    let maxIdx = -1;
    const offset = t * vocabSize;

    for (let v = 0; v < vocabSize; v++) {
      const val = outputData[offset + v];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = v;
      }
    }

    if (maxIdx !== blankIdx && maxIdx !== prevIdx) {
      const charIdx = maxIdx - 1;
      if (charIdx >= 0 && charIdx < dict.length) {
        chars.push(dict[charIdx]);
        totalScore += maxVal;
        count++;
      }
    }
    prevIdx = maxIdx;
  }

  const text = chars.join('');
  let confidence = count > 0 ? totalScore / count : 0.0;

  if (confidence > 1.0) {
    confidence = 1.0 / (1.0 + Math.exp(-confidence));
  } else if (confidence < 0.0) {
    confidence = 0.0;
  }

  return { text, confidence: confidence * 100 };
}

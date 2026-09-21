import * as ort from 'onnxruntime-web';
import { setupOrtEnvironment } from './ortConfig';
import { safeDeleteAll } from './cvMat';
import type { FilterMode } from './filterMode';
import { applyFilterToMat } from './opencv/filters';
import { warpImage } from './opencv/warp';
import type { Point } from './geometry';

let unwarpSession: ort.InferenceSession | null = null;
let initPromise: Promise<ort.InferenceSession | null> | null = null;

/**
 * Paddle-OCR / PaddleX Document Unwarping (UVDoc) エンジンの初期化
 */
export function initUnwarpEngine(): Promise<ort.InferenceSession | null> {
  if (unwarpSession) return Promise.resolve(unwarpSession);
  if (initPromise) return initPromise;

  setupOrtEnvironment();

  initPromise = (async () => {
    try {
      const modelPath = `${import.meta.env.BASE_URL}models/uvdoc.ort`;
      unwarpSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
      });
      console.log('[AI Unwarp] Document Unwarping engine loaded successfully.');
      return unwarpSession;
    } catch (err: any) {
      console.warn(
        '[AI Unwarp] Document unwarping model not found or failed to load. Falling back to perspective warp. Detail:',
        err?.message || err
      );
      unwarpSession = null;
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

/**
 * AIモデルのロード状態をチェック
 */
export function isUnwarpEngineLoaded(): boolean {
  return unwarpSession !== null;
}

/**
 * OpenCV.js の cv.remap を用いて AI 出力の UV Map (Remap Grid) から高解像度アンラップ画像を生成
 * @param srcCanvas 元画像 Canvas
 * @param uvData UVマップデータ (Float32Array [2, H, W] または [H, W, 2])
 * @param gridW グリッド幅
 * @param gridH グリッド高さ
 * @param isLayoutHW2 レイアウトが [H, W, 2] かどうか (true の場合 x,y ペア、false の場合 [2, H, W])
 */
export function remapCanvasWithGrid(
  srcCanvas: HTMLCanvasElement,
  uvData: Float32Array,
  gridW: number,
  gridH: number,
  isLayoutHW2: boolean = false
): HTMLCanvasElement | null {
  const cv = window.cv;
  if (!cv) return null;

  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;

  let srcMat: any = null;
  let dstMat: any = null;
  let mapXMat: any = null;
  let mapYMat: any = null;
  let resizedMapX: any = null;
  let resizedMapY: any = null;

  try {
    srcMat = cv.imread(srcCanvas);
    dstMat = new cv.Mat();

    // 1. 低解像度の MapX / MapY Float32 マトリクスを作成
    mapXMat = new cv.Mat(gridH, gridW, cv.CV_32FC1);
    mapYMat = new cv.Mat(gridH, gridW, cv.CV_32FC1);

    const mapXData = mapXMat.data32F;
    const mapYData = mapYMat.data32F;
    const numPoints = gridW * gridH;

    if (isLayoutHW2) {
      // [H, W, 2] (x, y normalized 0..1 or absolute pixels)
      for (let i = 0; i < numPoints; i++) {
        let u = uvData[i * 2];
        let v = uvData[i * 2 + 1];
        // 0..1 正規化値の場合はピクセル座標へスケール
        if (u <= 1.01 && v <= 1.01) {
          u *= srcW;
          v *= srcH;
        }
        mapXData[i] = u;
        mapYData[i] = v;
      }
    } else {
      // [2, H, W] (0: U/X, 1: V/Y)
      const uOffset = 0;
      const vOffset = numPoints;
      for (let i = 0; i < numPoints; i++) {
        let u = uvData[uOffset + i];
        let v = uvData[vOffset + i];
        if (u <= 1.01 && v <= 1.01) {
          u *= srcW;
          v *= srcH;
        }
        mapXData[i] = u;
        mapYData[i] = v;
      }
    }

    // 2. 元画像解像度へ MapX, MapY をバイリニア拡大補間
    resizedMapX = new cv.Mat();
    resizedMapY = new cv.Mat();
    cv.resize(mapXMat, resizedMapX, new cv.Size(srcW, srcH), 0, 0, cv.INTER_LINEAR);
    cv.resize(mapYMat, resizedMapY, new cv.Size(srcW, srcH), 0, 0, cv.INTER_LINEAR);

    // 3. remap によるドキュメントの平坦化展開
    cv.remap(
      srcMat,
      dstMat,
      resizedMapX,
      resizedMapY,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255)
    );

    const outCanvas = document.createElement('canvas');
    outCanvas.width = srcW;
    outCanvas.height = srcH;
    cv.imshow(outCanvas, dstMat);

    return outCanvas;
  } catch (err) {
    console.error('[AI Unwarp] remapCanvasWithGrid failed:', err);
    return null;
  } finally {
    safeDeleteAll(srcMat, dstMat, mapXMat, mapYMat, resizedMapX, resizedMapY);
  }
}

/**
 * AI (Paddle-OCR UVDoc) を用いたドキュメントの Unwrap 処理
 */
export async function unwarpDocumentAI(srcCanvas: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  try {
    const session = await initUnwarpEngine();
    if (!session) return null;

    const inputW = 480;
    const inputH = 480;

    // 1. 画像のプリプロセス (モデルサイズに描画)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = inputW;
    tempCanvas.height = inputH;
    const ctx = tempCanvas.getContext('2d')!;
    ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, inputW, inputH);

    const imgData = ctx.getImageData(0, 0, inputW, inputH);
    const data = imgData.data;
    const numPixels = inputW * inputH;

    // NCHW 形式: [1, 3, 480, 480]
    const inputBuffer = new Float32Array(numPixels * 3);
    const rOffset = 0;
    const gOffset = numPixels;
    const bOffset = numPixels * 2;

    for (let i = 0; i < numPixels; i++) {
      const srcIdx = i * 4;
      inputBuffer[rOffset + i] = data[srcIdx] / 255.0;
      inputBuffer[gOffset + i] = data[srcIdx + 1] / 255.0;
      inputBuffer[bOffset + i] = data[srcIdx + 2] / 255.0;
    }

    const inputTensor = new ort.Tensor('float32', inputBuffer, [1, 3, inputH, inputW]);
    const feeds = { [session.inputNames[0]]: inputTensor };

    // 2. 推論実行
    const results = await session.run(feeds);
    const outputTensor = results[session.outputNames[0]];

    if (!outputTensor || !outputTensor.data) {
      return null;
    }

    const uvData = outputTensor.data as Float32Array;
    const shape = outputTensor.dims; // e.g. [1, 2, gridH, gridW] or [1, gridH, gridW, 2]

    let gridH = inputH;
    let gridW = inputW;
    let isHW2 = false;

    if (shape.length === 4) {
      if (shape[1] === 2) {
        gridH = shape[2];
        gridW = shape[3];
        isHW2 = false;
      } else if (shape[3] === 2) {
        gridH = shape[1];
        gridW = shape[2];
        isHW2 = true;
      }
    }

    // 3. Remap によるアンラップ画像の生成
    return remapCanvasWithGrid(srcCanvas, uvData, gridW, gridH, isHW2);
  } catch (err) {
    console.error('[AI Unwarp] unwarpDocumentAI failed:', err);
    return null;
  }
}

/**
 * 平面台形補正を Unwrap Document (湾曲補正) で置き換えるメイン関数
 * AIモデルがあれば AI Unwrap を実行し、モデルが未導入または失敗した場合は台形補正へ安全にフォールバック
 */
export async function processUnwarpAndFilter(
  imageEl: HTMLImageElement,
  corners: Point[],
  filterMode: FilterMode,
  rotation: number = 0
): Promise<string | null> {
  const cv = window.cv;
  if (!cv) return null;

  // 1. ソース画像の Canvas 化
  const w = imageEl.naturalWidth || imageEl.width;
  const h = imageEl.naturalHeight || imageEl.height;
  if (w <= 0 || h <= 0) return null;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const ctx = srcCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(imageEl, 0, 0, w, h);

  // 2. AI Unwrap を試行
  let unwarpedCanvas: HTMLCanvasElement | null = await unwarpDocumentAI(srcCanvas);

  // 3. AI Unwrap が無効・失敗した場合は、四隅座標による透視変換（平面台形補正）へフォールバック
  if (!unwarpedCanvas) {
    if (corners && corners.length === 4) {
      unwarpedCanvas = warpImage(srcCanvas, corners);
    } else {
      unwarpedCanvas = srcCanvas;
    }
  }

  // 4. フィルター適用と回転
  let srcMat: any = null;
  let filteredMat: any = null;
  let rotatedMat: any = null;

  try {
    srcMat = cv.imread(unwarpedCanvas);
    filteredMat = new cv.Mat();
    applyFilterToMat(srcMat, filteredMat, filterMode);

    let outputMat = filteredMat;
    if (rotation === 90 || rotation === 180 || rotation === 270) {
      rotatedMat = new cv.Mat();
      if (rotation === 90) {
        cv.rotate(filteredMat, rotatedMat, cv.ROTATE_90_CLOCKWISE);
      } else if (rotation === 180) {
        cv.rotate(filteredMat, rotatedMat, cv.ROTATE_180);
      } else {
        cv.rotate(filteredMat, rotatedMat, cv.ROTATE_90_COUNTERCLOCKWISE);
      }
      outputMat = rotatedMat;
    }

    const outWidth = outputMat.cols;
    const outHeight = outputMat.rows;
    const resCanvas = document.createElement('canvas');
    resCanvas.width = outWidth;
    resCanvas.height = outHeight;

    cv.imshow(resCanvas, outputMat);
    return resCanvas.toDataURL('image/jpeg', 0.95);
  } catch (err) {
    console.error('processUnwarpAndFilter failed at filter/rotation stage:', err);
    return null;
  } finally {
    safeDeleteAll(srcMat, filteredMat, rotatedMat);
  }
}

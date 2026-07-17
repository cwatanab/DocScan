import * as ort from 'onnxruntime-web';
import { resizeCanvas } from './imageExportHelper';

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
  width: number;
  height: number;
}

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let ocrDict: string[] = [];

// OCRエンジン専用の画像前処理
// (過剰な画像処理による文字のエッジ潰れや誤読を防ぐため、単純なグレースケール化のみを行います)
function preprocessImageForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  // メモリ負荷を考慮し、前処理時も最大辺2240px程度に抑えてOpenCVに入力
  const inputCanvas = resizeCanvas(canvas, 2240);

  const src = cv.imread(inputCanvas);
  const dst = new cv.Mat();
  
  // 1. グレースケール化のみを適用
  cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

  // 結果の書き出し
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = inputCanvas.width;
  resultCanvas.height = inputCanvas.height;
  cv.imshow(resultCanvas, dst);

  // リソースの削除
  src.delete();
  dst.delete();

  return resultCanvas;
}

/**
 * ONNX Runtime Web OCR セッションを初期化する
 */
async function initOcrEngine(onProgress?: (progress: number) => void): Promise<{ detSession: ort.InferenceSession, recSession: ort.InferenceSession, dict: string[] }> {
  if (detSession && recSession && ocrDict.length > 0) {
    return { detSession, recSession, dict: ocrDict };
  }

  const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 35));

  try {
    if (onProgress) onProgress(0.1); 
    await yieldToUi();

    // WASM のパスとオプションを設定
    ort.env.wasm.wasmPaths = window.location.origin + '/';
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 4);

    if (onProgress) onProgress(0.2);
    await yieldToUi();

    // サーバーからモデルデータと辞書をダウンロード
    const [detRes, recRes, dictRes] = await Promise.all([
      fetch('/models/det.onnx'),
      fetch('/models/rec.onnx'),
      fetch('/models/ppocrv6_dict.txt')
    ]);

    if (!detRes.ok || !recRes.ok || !dictRes.ok) {
      throw new Error('Failed to download OCR models from public/models/');
    }
    if (onProgress) onProgress(0.5);
    await yieldToUi();

    const [detBytes, recBytes, dictText] = await Promise.all([
      detRes.arrayBuffer(),
      recRes.arrayBuffer(),
      dictRes.text()
    ]);
    ocrDict = dictText.split(/\r?\n/);

    if (onProgress) onProgress(0.7);
    await yieldToUi();

    // ONNX Runtime セッションの構築
    if (!detSession) {
      detSession = await ort.InferenceSession.create(new Uint8Array(detBytes), {
        executionProviders: ['wasm'],
      });
    }
    if (onProgress) onProgress(0.85);
    await yieldToUi();

    if (!recSession) {
      recSession = await ort.InferenceSession.create(new Uint8Array(recBytes), {
        executionProviders: ['wasm'],
      });
    }

    if (onProgress) onProgress(1.0);
    await yieldToUi();

    return { detSession, recSession, dict: ocrDict };
  } catch (err) {
    console.error('Failed to initialize ONNX Runtime Web OCR engine:', err);
    throw err;
  }
}

/**
 * cv.minAreaRect が返す RotatedRect から 4 つの頂点座標を算出する
 * (cv.boxPoints が一部の OpenCV.js で省略されている問題の回避策)
 */
function getRotatedRectPoints(rect: any): number[][] {
  const cx = rect.center.x;
  const cy = rect.center.y;
  const w = rect.size.width;
  const h = rect.size.height;
  const angle = rect.angle;

  const theta = (angle * Math.PI) / 180.0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // 回転前のローカル座標
  const pts = [
    [-w / 2, -h / 2], // 左上
    [w / 2, -h / 2],  // 右上
    [w / 2, h / 2],   // 右下
    [-w / 2, h / 2]   // 左下
  ];

  // 回転と平行移動
  return pts.map(([x, y]) => {
    return [
      x * cos - y * sin + cx,
      x * sin + y * cos + cy
    ];
  });
}

/**
 * 検出された輪郭（多角形）の内部における確率マップの平均スコアを算出する
 * (背景の0ピクセルを排除し、正確な確信度を計算するためにマスクを使用)
 */
function calculateBoxScore(predMat: any, contour: any): number {
  const cv = (window as any).cv;
  if (!cv) return 0.5;

  const rect = cv.boundingRect(contour);
  
  // 外接矩形領域の確率マップ (ROI) を切り出し
  const roiPred = predMat.roi(rect);
  
  // マスク画像 (単一チャンネル, 0初期化) を作成
  const mask = cv.Mat.zeros(rect.height, rect.width, cv.CV_8UC1);
  
  // 輪郭の座標を ROI 座標系にシフトさせて格納するための Mat
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
  
  // マスク内の輪郭領域を 255 (白) で塗りつぶす
  cv.drawContours(mask, contours, 0, new cv.Scalar(255), -1);
  
  // マスクされた領域の平均確率を算出
  const meanScalar = cv.mean(roiPred, mask);
  const score = meanScalar[0]; // 1チャンネル目の平均値
  
  // メモリ解放
  roiPred.delete();
  mask.delete();
  shiftedContour.delete();
  contours.delete();
  
  return score;
}

/**
 * 検出モデルの後処理 (DBPostProcess)
 */
function dbPostProcess(
  predData: Float32Array,
  predHeight: number,
  predWidth: number,
  origWidth: number,
  origHeight: number,
  unclipRatio: number
): number[][][] {
  const cv = (window as any).cv;
  if (!cv) return [];

  const predMat = new cv.Mat(predHeight, predWidth, cv.CV_32FC1);
  predMat.data32F.set(predData);

  const binaryMat = new cv.Mat();
  cv.threshold(predMat, binaryMat, 0.3, 255, cv.THRESH_BINARY);
  binaryMat.convertTo(binaryMat, cv.CV_8UC1);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binaryMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const boxes: number[][][] = [];
  const ratioX = origWidth / predWidth;
  const ratioY = origHeight / predHeight;

  for (let i = 0; i < contours.size(); ++i) {
    const contour = contours.get(i);
    const peri = cv.arcLength(contour, true);
    if (peri < 12) {
      contour.delete();
      continue;
    }

    const rect = cv.minAreaRect(contour);
    
    // 検出領域の確信度平均（スコア）を算出し、ノイズを除去する (基準値 0.6)
    const score = calculateBoxScore(predMat, contour);
    if (score < 0.6) {
      contour.delete();
      continue;
    }

    // 精密な unclip 処理 (RotatedRectの幅・高さを直接平行拡張することで、アスペクト比を維持し歪みを防止する)
    const w_rect = rect.size.width;
    const h_rect = rect.size.height;
    const area = w_rect * h_rect;
    const perimeter = 2 * (w_rect + h_rect);
    const distance = perimeter > 0 ? (area * unclipRatio) / perimeter : 0;

    rect.size.width += 2 * distance;
    rect.size.height += 2 * distance;

    const pts = getRotatedRectPoints(rect);
    const sortedPts = sortPoints(pts);

    const finalPts = sortedPts.map(p => [
      Math.min(Math.max(0, p[0] * ratioX), origWidth),
      Math.min(Math.max(0, p[1] * ratioY), origHeight)
    ]);

    const w = Math.sqrt((finalPts[1][0] - finalPts[0][0]) ** 2 + (finalPts[1][1] - finalPts[0][1]) ** 2);
    const h = Math.sqrt((finalPts[3][0] - finalPts[0][0]) ** 2 + (finalPts[3][1] - finalPts[0][1]) ** 2);
    if (w < 4 || h < 4) {
      contour.delete();
      continue;
    }

    boxes.push(finalPts);
    contour.delete();
  }

  predMat.delete();
  binaryMat.delete();
  contours.delete();
  hierarchy.delete();

  // 上から順にソート
  boxes.sort((a, b) => {
    const ay = (a[0][1] + a[1][1] + a[2][1] + a[3][1]) / 4;
    const by = (b[0][1] + b[1][1] + b[2][1] + b[3][1]) / 4;
    return ay - by;
  });

  return boxes;
}

/**
 * 頂点の時計回りソート
 */
function sortPoints(points: number[][]): number[][] {
  const sortedX = [...points].sort((a, b) => a[0] - b[0]);
  const left = [sortedX[0], sortedX[1]];
  const right = [sortedX[2], sortedX[3]];

  const [topLeft, bottomLeft] = left.sort((a, b) => a[1] - b[1]);
  const [topRight, bottomRight] = right.sort((a, b) => a[1] - b[1]);

  return [topLeft, topRight, bottomRight, bottomLeft];
}

/**
 * 画像から多角形領域を切り出して水平にする (Perspective Warp)
 */
function getCropImage(canvas: HTMLCanvasElement, box: number[][]): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  const src = cv.imread(canvas);

  const x0 = box[0][0], y0 = box[0][1];
  const x1 = box[1][0], y1 = box[1][1];
  const x2 = box[2][0], y2 = box[2][1];
  const x3 = box[3][0], y3 = box[3][1];

  const width = Math.max(
    Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2),
    Math.sqrt((x2 - x3) ** 2 + (y2 - y3) ** 2)
  );
  const height = Math.max(
    Math.sqrt((x3 - x0) ** 2 + (y3 - y0) ** 2),
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  );

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    x0, y0,
    x1, y1,
    x2, y2,
    x3, y3
  ]);

  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    width, 0,
    width, height,
    0, height
  ]);

  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  cv.warpPerspective(src, dst, M, new cv.Size(width, height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = width;
  cropCanvas.height = height;
  cv.imshow(cropCanvas, dst);

  src.delete();
  srcTri.delete();
  dstTri.delete();
  M.delete();
  dst.delete();

  return cropCanvas;
}

/**
 * 縦長の Canvas を時計回りに 90 度回転させる (縦書き用)
 */
function rotateCanvas90(canvas: HTMLCanvasElement): HTMLCanvasElement {
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
function preprocessRecImage(canvas: HTMLCanvasElement): ort.Tensor {
  const targetHeight = 48;
  const aspect = canvas.width / canvas.height;
  // 最小幅を 16px に制限して、極端に押しつぶされるのを防ぐ
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

  // HWC to NCHW, mean=0.5, std=0.5
  for (let i = 0; i < numPixels; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;

    inputBuffer[i] = (r - 0.5) / 0.5;
    inputBuffer[numPixels + i] = (g - 0.5) / 0.5;
    inputBuffer[numPixels * 2 + i] = (b - 0.5) / 0.5;
  }

  return new ort.Tensor('float32', inputBuffer, [1, 3, targetHeight, targetWidth]);
}

/**
 * CTC デコードによるテキスト変換
 */
function decodeCtc(outputData: Float32Array, seqLen: number, vocabSize: number, dict: string[]): { text: string, confidence: number } {
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
  let confidence = count > 0 ? (totalScore / count) : 0.0;
  
  if (confidence > 1.0) {
    confidence = 1.0 / (1.0 + Math.exp(-confidence));
  } else if (confidence < 0.0) {
    confidence = 0.0;
  }

  return { text, confidence: confidence * 100 };
}

/**
 * 画像データ(DataURLまたはCanvas)からOCR解析を実行する (ONNX Runtime Web 版)
 * @param imageSource 解析対象画像 (DataURL または HTMLCanvasElement)
 * @param onProgress 進捗更新コールバック (0〜1の数値)
 */
export async function performOcr(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<OcrResult> {
  try {
    // 1. エンジンの初期化
    const { detSession, recSession, dict } = await initOcrEngine(onProgress);

    // 2. 画像の取得と前処理（OpenCV による前処理）
    let width = 0;
    let height = 0;
    let processedCanvas: HTMLCanvasElement;

    if (typeof imageSource === 'string') {
      const img = new Image();
      img.src = imageSource;
      await new Promise((resolve) => {
        img.onload = () => {
          width = img.width;
          height = img.height;
          resolve(null);
        };
      });

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tCtx = tempCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(img, 0, 0);
        processedCanvas = preprocessImageForOcr(tempCanvas);
      } else {
        processedCanvas = tempCanvas;
      }
    } else {
      width = imageSource.width;
      height = imageSource.height;
      processedCanvas = preprocessImageForOcr(imageSource);
    }

    const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 45));
    if (onProgress) onProgress(0.9);
    await yieldToUi();

    // 3. テキスト検出 (Detection)
    const detLimitSideLen = 2240;
    let detScale = 1.0;
    if (processedCanvas.width > processedCanvas.height) {
      detScale = detLimitSideLen / processedCanvas.width;
    } else {
      detScale = detLimitSideLen / processedCanvas.height;
    }
    const detWidth = Math.round((processedCanvas.width * detScale) / 32) * 32;
    const detHeight = Math.round((processedCanvas.height * detScale) / 32) * 32;

    const detResizeCanvas = document.createElement('canvas');
    detResizeCanvas.width = detWidth;
    detResizeCanvas.height = detHeight;
    const detCtx = detResizeCanvas.getContext('2d')!;
    detCtx.drawImage(processedCanvas, 0, 0, processedCanvas.width, processedCanvas.height, 0, 0, detWidth, detHeight);

    const detImgData = detCtx.getImageData(0, 0, detWidth, detHeight);
    const detData = detImgData.data;
    const detNumPixels = detWidth * detHeight;
    const detInputBuffer = new Float32Array(detNumPixels * 3);

    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    // NCHW (RGB)
    for (let i = 0; i < detNumPixels; i++) {
      const r = detData[i * 4] / 255.0;
      const g = detData[i * 4 + 1] / 255.0;
      const b = detData[i * 4 + 2] / 255.0;

      detInputBuffer[i] = (r - mean[0]) / std[0];
      detInputBuffer[detNumPixels + i] = (g - mean[1]) / std[1];
      detInputBuffer[detNumPixels * 2 + i] = (b - mean[2]) / std[2];
    }

    const detTensor = new ort.Tensor('float32', detInputBuffer, [1, 3, detHeight, detWidth]);
    const detFeeds = { [detSession.inputNames[0]]: detTensor };
    const detResults = await detSession.run(detFeeds);
    const detOutputTensor = detResults[detSession.outputNames[0]];
    const detOutputData = detOutputTensor.data as Float32Array;

    const unclipRatio = 1.8;
    const boxes = dbPostProcess(
      detOutputData,
      detHeight,
      detWidth,
      processedCanvas.width,
      processedCanvas.height,
      unclipRatio
    );

    // 4. テキスト認識 (Recognition)
    const words: OcrWord[] = [];
    const textLines: string[] = [];

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      let cropCanvas = getCropImage(processedCanvas, box);

      // 縦書き（高さ > 幅）の場合は横倒し（時計回り90度回転）にして認識器に入力する
      if (cropCanvas.height > cropCanvas.width) {
        cropCanvas = rotateCanvas90(cropCanvas);
      }

      const recTensor = preprocessRecImage(cropCanvas);
      const recFeeds = { [recSession.inputNames[0]]: recTensor };

      const recResults = await recSession.run(recFeeds);
      const recOutputTensor = recResults[recSession.outputNames[0]];
      const recOutputData = recOutputTensor.data as Float32Array;

      const dims = recOutputTensor.dims;
      const seqLen = dims[1];
      const vocabSize = dims[2];

      const decoded = decodeCtc(recOutputData, seqLen, vocabSize, dict);

      if (decoded.text.trim().length > 0) {
        textLines.push(decoded.text);

        // 座標を入力画像元のスケールに戻す
        const scaleX = width / processedCanvas.width;
        const scaleY = height / processedCanvas.height;
        const finalBox = box.map(p => [p[0] * scaleX, p[1] * scaleY]);

        words.push({
          text: decoded.text,
          confidence: decoded.confidence,
          bbox: {
            x0: finalBox[0][0],
            y0: finalBox[0][1],
            x1: finalBox[2][0],
            y1: finalBox[2][1]
          }
        });
      }
    }

    if (onProgress) onProgress(1.0);
    await yieldToUi();

    return {
      text: textLines.join('\n'),
      words,
      width,
      height
    };
  } catch (error) {
    console.error('OCR analysis failed via ONNX Runtime Web:', error);
    throw error;
  }
}

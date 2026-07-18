import * as ort from 'onnxruntime-web';
import { setupOrtEnvironment } from './ortConfig';
import type { Point } from './opencvHelper';
import { sortPoints } from './opencvHelper';

let docSegSession: ort.InferenceSession | null = null;
let initPromise: Promise<ort.InferenceSession | null> | null = null;

/**
 * AIドキュメント境界検出エンジンの初期化
 */
export function initDocSegEngine(): Promise<ort.InferenceSession | null> {
  if (docSegSession) return Promise.resolve(docSegSession);
  if (initPromise) return initPromise;

  setupOrtEnvironment();

  initPromise = (async () => {
    try {
      const modelPath = `${import.meta.env.BASE_URL}models/doc_seg.ort`;
      docSegSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
      });
      return docSegSession;
    } catch (err: any) {
      console.warn('[AI Seg] Document corner detection model not found or failed to load. Falling back to OpenCV. Error detail:', err?.message || err, err?.stack || '');
      docSegSession = null;
      initPromise = null; // 再試行可能にする
      return null;
    }
  })();

  return initPromise;
}

/**
 * AIモデルのロード状態をチェック
 */
export function isAISegEngineLoaded(): boolean {
  return docSegSession !== null;
}

/**
 * 4隅が凸四角形を構成し、かつ内角が極端な角度になっていないかを判定する
 * @param pts 4つの点 (TL, TR, BR, BL)
 * @param maxCos 許容する最大 cosθ値 (絶対値)
 */
export function checkShapeValidity(pts: Point[], maxCos: number): boolean {
  if (pts.length !== 4) return false;

  // 各内角の角度チェック (cosθ の絶対値が maxCos の範囲外なら弾く)
  for (let i = 0; i < 4; i++) {
    const pPrev = pts[(i + 3) % 4];
    const pCurr = pts[i];
    const pNext = pts[(i + 1) % 4];

    const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);

    const denominator = len1 * len2;
    if (denominator === 0) {
      return false; // ゼロ除算の回避（完全に頂点が重なっている場合）
    }

    const cosTheta = (v1.x * v2.x + v1.y * v2.y) / denominator;
    if (Math.abs(cosTheta) > maxCos) {
      return false; // 鋭角・鈍角制限
    }
  }

  return true;
}

/**
 * AI (DocCornerNet LEAN) を用いたドキュメントの4隅検出
 * @param srcCanvas 元画像が描画されたCanvas
 * @returns 検出された4点。検出できなかった場合はnull
 */
export async function detectDocumentAI(srcCanvas: HTMLCanvasElement): Promise<Point[] | null> {
  try {
    // エンジンの初期化・取得
    const session = await initDocSegEngine();
    if (!session) {
      return null; // モデルがない場合は自動でOpenCV検出にフォールバック
    }

    const width = srcCanvas.width;
    const height = srcCanvas.height;
    const inputSize = 224; // DocCornerNet の入力解像度

    // 1. 画像のプリプロセス: 224x224にリサイズ
    // (iOS Safariのバグ回避のため、シングルトンではなく毎回新規アロケート。300ms間隔のため負荷は軽微)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = inputSize;
    tempCanvas.height = inputSize;
    const ctx = tempCanvas.getContext('2d')!;
    
    // アスペクト比を維持せず 224x224 に伸縮描画
    ctx.drawImage(srcCanvas, 0, 0, width, height, 0, 0, inputSize, inputSize);

    const imgData = ctx.getImageData(0, 0, inputSize, inputSize);
    const data = imgData.data;
    const numPixels = inputSize * inputSize;
    
    // NHWC 形式: [1, 224, 224, 3] (ピクセル順にR, G, Bを詰める)
    const inputBuffer = new Float32Array(numPixels * 3);

    // ImageNet 標準の正規化 (最適化: 除算を事前乗算スケールとオフセットにまとめ演算負荷を低減)
    const rScale = 1.0 / (255.0 * 0.229);
    const rOffset = 0.485 / 0.229;
    const gScale = 1.0 / (255.0 * 0.224);
    const gOffset = 0.456 / 0.224;
    const bScale = 1.0 / (255.0 * 0.225);
    const bOffset = 0.406 / 0.225;

    let srcIdx = 0;
    let dstIdx = 0;
    for (let i = 0; i < numPixels; i++) {
      inputBuffer[dstIdx++] = data[srcIdx++] * rScale - rOffset;
      inputBuffer[dstIdx++] = data[srcIdx++] * gScale - gOffset;
      inputBuffer[dstIdx++] = data[srcIdx++] * bScale - bOffset;
      srcIdx++; // アルファ値をスキップ
    }

    const inputTensor = new ort.Tensor('float32', inputBuffer, [1, inputSize, inputSize, 3]);

    // 2. 推論の実行
    const feeds = { [session.inputNames[0]]: inputTensor };
    const results = await session.run(feeds);
    
    // モデルの出力レイヤーを取得 (順序不整合対策のため名前で動的に探索)
    let coordsTensor: ort.Tensor | null = null;
    let scoreTensor: ort.Tensor | null = null;

    for (const name of session.outputNames) {
      if (name.includes('coord')) {
        coordsTensor = results[name];
      } else if (name.includes('score') || name.includes('logit')) {
        scoreTensor = results[name];
      }
    }

    // 見つからなかった場合の順序指定フォールバック
    if (!coordsTensor || !scoreTensor) {
      coordsTensor = results[session.outputNames[0]];
      scoreTensor = results[session.outputNames[1]];
    }

    if (!coordsTensor || !scoreTensor) {
      console.error("[AI Seg] Output tensors not found in model results.");
      return null;
    }

    const coordsData = coordsTensor.data as Float32Array;
    const scoreLogit = scoreTensor.data[0] as number;

    // 3. ドキュメントの存在確率（信頼度）の判定
    const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-x));
    const confidence = sigmoid(scoreLogit);



    // ドキュメントが見つからない（写っていない）と判断された場合は null
    // 信頼度閾値を 0.5 に設定して曖昧な誤検出を防止
    if (confidence < 0.5) {
      return null;
    }

    // 4. 誤検出フィルター: 画面全体を囲んでしまう巨大な枠線を排除
    const x0 = coordsData[0]; const y0 = coordsData[1]; // TL
    const x1 = coordsData[2]; const y1 = coordsData[3]; // TR
    const x2 = coordsData[4]; const y2 = coordsData[5]; // BR
    const x3 = coordsData[6]; const y3 = coordsData[7]; // BL

    // (A) 面積による条件チェック (Shoelace公式による正規化面積計算)
    const area = 0.5 * Math.abs(
      (x0 * y1 - y0 * x1) +
      (x1 * y2 - y1 * x2) +
      (x2 * y3 - y2 * x3) +
      (x3 * y0 - y3 * x0)
    );

    // 面積が画面全体の 5% 未満、または 90% を超える場合は誤検出として除外
    if (area < 0.05 || area > 0.90) {
      return null;
    }

    // (B) 形状の歪みフィルター (三角形化・自己交差の排除)
    // 生の検出時点では、カメラ移動中の追従が途切れるのを防ぐために 0.500 と少し緩めにチェック
    const rawPts = [
      { x: x0, y: y0 }, // TL
      { x: x1, y: y1 }, // TR
      { x: x2, y: y2 }, // BR
      { x: x3, y: y3 }  // BL
    ];
    if (!checkShapeValidity(rawPts, 0.500)) {
      return null;
    }

    // 5. 座標を元の画像サイズにスケールバック
    // coordsDataの順序: TL(左上), TR(右上), BR(右下), BL(左下) の x, y ペア
    const pts: Point[] = [
      {
        x: Math.max(0, Math.min(width, coordsData[0] * width)),
        y: Math.max(0, Math.min(height, coordsData[1] * height))
      }, // TL
      {
        x: Math.max(0, Math.min(width, coordsData[2] * width)),
        y: Math.max(0, Math.min(height, coordsData[3] * height))
      }, // TR
      {
        x: Math.max(0, Math.min(width, coordsData[4] * width)),
        y: Math.max(0, Math.min(height, coordsData[5] * height))
      }, // BR
      {
        x: Math.max(0, Math.min(width, coordsData[6] * width)),
        y: Math.max(0, Math.min(height, coordsData[7] * height))
      }  // BL
    ];


    
    // 頂点を整列(左上、右上、右下、左下)して返す
    return sortPoints(pts);
  } catch (err) {
    console.error("[AI Seg] Inference or post-processing failed:", err);
    return null;
  }
}

/**
 * 画像サイズに基づいたA4アスペクト比のデフォルト座標を返す
 */
export function getDefaultCorners(w: number, h: number): Point[] {
  const a4Ratio = 1.4142;
  let rectW = 0;
  let rectH = 0;

  if (h > w) {
    // 縦画面の場合
    rectW = w * 0.75;
    rectH = rectW * a4Ratio;
    if (rectH > h * 0.8) {
      rectH = h * 0.8;
      rectW = rectH / a4Ratio;
    }
  } else {
    // 横画面の場合
    rectH = h * 0.75;
    rectW = rectH * a4Ratio;
    if (rectW > w * 0.8) {
      rectW = w * 0.8;
      rectH = rectW / a4Ratio;
    }
  }

  const startX = (w - rectW) / 2;
  const startY = (h - rectH) / 2;
  const endX = startX + rectW;
  const endY = startY + rectH;

  return [
    { x: startX, y: startY },
    { x: endX, y: startY },
    { x: endX, y: endY },
    { x: startX, y: endY }
  ];
}

/**
 * AIによる境界検出を試み、検出できなかった場合はデフォルトの境界を返す
 */
export async function detectDocumentWithFallback(
  srcCanvas: HTMLCanvasElement,
  aiModelLoaded: boolean
): Promise<Point[]> {
  let corners: Point[] | null = null;
  if (aiModelLoaded) {
    corners = await detectDocumentAI(srcCanvas);
  }
  if (!corners) {
    corners = getDefaultCorners(srcCanvas.width, srcCanvas.height);
  }
  return corners;
}


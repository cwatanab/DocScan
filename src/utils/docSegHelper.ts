import * as ort from 'onnxruntime-web';
import { setupOrtEnvironment } from './ortConfig';
import { sortPoints, checkShapeValidity, type Point } from './geometry';

export { checkShapeValidity };

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
      console.log('[AI Seg] Document corner detection model loaded successfully.');
      return docSegSession;
    } catch (err: any) {
      console.warn(
        '[AI Seg] Document corner detection model not found or failed to load. Falling back to default corners (getDefaultCorners). Error detail:',
        err?.message || err
      );
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
 * AI (Paddle-OCR / PaddleX Document Processing 仕様) を用いたドキュメントの4隅検出
 * @param srcCanvas 元画像が描画されたCanvas
 * @returns 検出された4点 (TL, TR, BR, BL)。検出できなかった場合は null (getDefaultCornersへフォールバック用)
 */
export async function detectDocumentAI(srcCanvas: HTMLCanvasElement): Promise<Point[] | null> {
  try {
    // エンジンの初期化・取得
    const session = await initDocSegEngine();
    if (!session) {
      return null; // モデルがない場合は getDefaultCorners にフォールバック
    }

    const width = srcCanvas.width;
    const height = srcCanvas.height;
    const inputSize = 224; // Paddle Document Processing の入力解像度 (224x224)

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

    // NHWC 形式: [1, 224, 224, 3] (doc_seg.ort モデルの期待する入力仕様)
    const inputBuffer = new Float32Array(numPixels * 3);

    // 正規化: (pixel / 255.0 - mean) / std
    const rScale = 1.0 / (255.0 * 0.229);
    const rSub = 0.485 / 0.229;
    const gScale = 1.0 / (255.0 * 0.224);
    const gSub = 0.456 / 0.224;
    const bScale = 1.0 / (255.0 * 0.225);
    const bSub = 0.406 / 0.225;

    let srcIdx = 0;
    let dstIdx = 0;
    for (let i = 0; i < numPixels; i++) {
      inputBuffer[dstIdx++] = data[srcIdx++] * rScale - rSub;
      inputBuffer[dstIdx++] = data[srcIdx++] * gScale - gSub;
      inputBuffer[dstIdx++] = data[srcIdx++] * bScale - bSub;
      srcIdx++; // Alphaチャンネルをスキップ
    }

    const inputTensor = new ort.Tensor('float32', inputBuffer, [1, inputSize, inputSize, 3]);

    // 2. 推論の実行
    const feeds = { [session.inputNames[0]]: inputTensor };
    const results = await session.run(feeds);

    // モデルの出力レイヤーを取得 (順序不整合対策のため名前で動的に探索)
    let coordsTensor: ort.Tensor | null = null;
    let scoreTensor: ort.Tensor | null = null;

    for (const name of session.outputNames) {
      if (name.includes('coord') || name.includes('point') || name.includes('loc') || name.includes('box')) {
        coordsTensor = results[name];
      } else if (name.includes('score') || name.includes('logit') || name.includes('conf') || name.includes('cls')) {
        scoreTensor = results[name];
      }
    }

    // 見つからなかった場合の順序指定フォールバック
    if (!coordsTensor && session.outputNames.length >= 1) {
      coordsTensor = results[session.outputNames[0]];
    }
    if (!scoreTensor && session.outputNames.length >= 2) {
      scoreTensor = results[session.outputNames[1]];
    }

    if (!coordsTensor) {
      console.error('[AI Seg] Corner coordinate output tensor not found in model results.');
      return null;
    }

    const coordsData = coordsTensor.data as Float32Array;

    // 3. ドキュメントの存在確率（信頼度）の判定
    if (scoreTensor) {
      const scoreLogit = scoreTensor.data[0] as number;
      const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-x));
      const confidence = sigmoid(scoreLogit);

      // ドキュメントが見つからない（写っていない）と判断された場合は null にして getDefaultCorners へフォールバック
      // 閾値 0.40 で暗所や低コントラスト環境でも確実に検出
      if (confidence < 0.40) {
        return null;
      }
    }

    // 4. 誤検出フィルター: 画面全体を囲んでしまう巨大な枠線や極端な小領域を排除
    // DocCornerNet の出力 coordsData は 0〜1 の正規化座標
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
    // 斜めからの撮影パースペクティブ歪みも許容しつつ異常値を弾く (cos 0.55 ≈ 56°〜124°, 辺比率 1.7)
    const rawPts = [
      { x: x0, y: y0 }, // TL
      { x: x1, y: y1 }, // TR
      { x: x2, y: y2 }, // BR
      { x: x3, y: y3 }  // BL
    ];
    if (!checkShapeValidity(rawPts, 0.550, 1.7)) {
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
    console.error('[AI Seg] Inference or post-processing failed:', err);
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

export async function detectDocumentWithFallback(
  srcCanvas: HTMLCanvasElement,
  aiModelLoaded: boolean
): Promise<Point[]> {
  let corners: Point[] | null = null;
  if (aiModelLoaded) {
    corners = await detectDocumentAI(srcCanvas);

    // AIの検出座標の形状妥当性チェック
    if (corners && !checkShapeValidity(corners, 0.45, 1.6)) {
      corners = null;
    }
  }
  if (!corners) {
    corners = getDefaultCorners(srcCanvas.width, srcCanvas.height);
  }
  return corners;
}

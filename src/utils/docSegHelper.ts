import * as ort from 'onnxruntime-web';
import type { Point } from './opencvHelper';
import { sortPoints } from './opencvHelper';

let docSegSession: ort.InferenceSession | null = null;
let isInitializing = false;

/**
 * AIドキュメント境界検出エンジンの初期化
 */
export async function initDocSegEngine(): Promise<ort.InferenceSession | null> {
  if (docSegSession) return docSegSession;
  if (isInitializing) {
    // 初期化中の場合は完了するまで待つ
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return docSegSession;
  }

  isInitializing = true;
  ort.env.wasm.wasmPaths = window.location.origin + '/';

  try {
    console.log("[AI Seg] Loading document corner detection model (1.9MB)...");
    docSegSession = await ort.InferenceSession.create('/models/doc_seg.ort', {
      executionProviders: ['wasm'],
    });
    console.log("[AI Seg] Model loaded successfully.");
    return docSegSession;
  } catch (err) {
    console.warn('[AI Seg] Document corner detection model not found or failed to load. Falling back to OpenCV.');
    docSegSession = null;
    return null;
  } finally {
    isInitializing = false;
  }
}

/**
 * AIモデルのロード状態をチェック
 */
export function isAISegEngineLoaded(): boolean {
  return docSegSession !== null;
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

    // ImageNet 標準の正規化 (mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    for (let i = 0; i < numPixels; i++) {
      const r = data[i * 4] / 255.0;
      const g = data[i * 4 + 1] / 255.0;
      const b = data[i * 4 + 2] / 255.0;

      inputBuffer[i * 3] = (r - 0.485) / 0.229;
      inputBuffer[i * 3 + 1] = (g - 0.456) / 0.224;
      inputBuffer[i * 3 + 2] = (b - 0.406) / 0.225;
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

    console.log(`[AI Seg] Inference Results - score_logit: ${scoreLogit.toFixed(4)}, confidence: ${confidence.toFixed(4)}, coords_len: ${coordsData.length}`);
    if (coordsData.length >= 8) {
      console.log(`[AI Seg] Raw coordinates:`, Array.from(coordsData).map(v => v.toFixed(3)));
    }

    // ドキュメントが見つからない（写っていない）と判断された場合は null
    // 境界閾値を 0.35 に設定し、緩めながらも誤検出を防ぐ
    if (confidence < 0.35) {
      return null;
    }

    // 4. 座標を元の画像サイズにスケールバック
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

    console.log(`[AI Seg] Document detected! (confidence: ${confidence.toFixed(3)})`);
    
    // 頂点を整列(左上、右上、右下、左下)して返す
    return sortPoints(pts);
  } catch (err) {
    console.error("[AI Seg] Inference or post-processing failed:", err);
    return null;
  }
}

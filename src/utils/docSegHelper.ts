import * as ort from 'onnxruntime-web';
import type { Point } from './opencvHelper';
import { sortPoints } from './opencvHelper';

let docSegSession: ort.InferenceSession | null = null;
let isInitializing = false;

/**
 * AIドキュメントセグメンテーションエンジンの初期化
 */
export async function initDocSegEngine(): Promise<ort.InferenceSession> {
  if (docSegSession) return docSegSession;
  if (isInitializing) {
    // 初期化中の場合は完了するまで待つ
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (docSegSession) return docSegSession;
  }

  isInitializing = true;
  const ortVersion = __ORT_VERSION__;
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;

  try {
    console.log("[AI Seg] Loading document segmentation model...");
    docSegSession = await ort.InferenceSession.create('https://huggingface.co/Jwalit/kyc-document-corner-detector-v2/resolve/main/model.onnx', {
      executionProviders: ['wasm'],
    });
    console.log("[AI Seg] Model loaded successfully.");
    return docSegSession;
  } catch (err) {
    console.error('[AI Seg] Failed to load Document Segmentation Model:', err);
    throw err;
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
 * AI (Segmentation Model + OpenCV.js) を用いたドキュメントの4隅検出
 * @param srcCanvas 元画像が描画されたCanvas
 * @returns 検出された4点。検出できなかった場合はnull
 */
export async function detectDocumentAI(srcCanvas: HTMLCanvasElement): Promise<Point[] | null> {
  const cv = (window as any).cv;
  if (!cv) {
    console.error("[AI Seg] OpenCV.js is not loaded.");
    return null;
  }

  try {
    // エンジンの初期化・取得
    const session = await initDocSegEngine();

    const width = srcCanvas.width;
    const height = srcCanvas.height;
    const inputSize = 256; // セグメンテーション用の標準解像度

    // 1. 画像のプリプロセス: 256x256にリサイズ
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = inputSize;
    tempCanvas.height = inputSize;
    const ctx = tempCanvas.getContext('2d')!;
    
    // アスペクト比を維持せず、モデルの学習構成に合わせて256x256に伸縮描画
    ctx.drawImage(srcCanvas, 0, 0, width, height, 0, 0, inputSize, inputSize);

    const imgData = ctx.getImageData(0, 0, inputSize, inputSize);
    const data = imgData.data;
    const numPixels = inputSize * inputSize;
    const inputBuffer = new Float32Array(numPixels * 3);

    // HWC to NCHW 変換 & 正規化
    // ImageNet 標準の正規化 (mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    for (let i = 0; i < numPixels; i++) {
      const r = data[i * 4] / 255.0;
      const g = data[i * 4 + 1] / 255.0;
      const b = data[i * 4 + 2] / 255.0;

      inputBuffer[i] = (r - 0.485) / 0.229;
      inputBuffer[numPixels + i] = (g - 0.456) / 0.224;
      inputBuffer[numPixels * 2 + i] = (b - 0.406) / 0.225;
    }

    const inputTensor = new ort.Tensor('float32', inputBuffer, [1, 3, inputSize, inputSize]);

    // 2. 推論の実行
    const feeds = { [session.inputNames[0]]: inputTensor };
    const results = await session.run(feeds);
    const outputTensor = results[session.outputNames[0]];
    const outputData = outputTensor.data as Float32Array;

    // 3. ポストプロセス: マスク画像の生成 (OpenCV.js Matオブジェクトにマップ)
    const maskMat = new cv.Mat(inputSize, inputSize, cv.CV_8UC1);
    const threshold = 0.5;
    const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-x));

    for (let y = 0; y < inputSize; y++) {
      for (let x = 0; x < inputSize; x++) {
        const idx = y * inputSize + x;
        const val = outputData[idx];
        // 出力がロジット（値域が0-1外）である場合はシグモイドを適用
        const prob = val > 1.0 || val < 0.0 ? sigmoid(val) : val;
        maskMat.ucharPtr(y, x)[0] = prob > threshold ? 255 : 0;
      }
    }

    // 4. OpenCV.jsで輪郭検出と四隅への近似
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let bestPts: Point[] | null = null;

    try {
      // 外部輪郭のみを検出
      cv.findContours(maskMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;
      // 入力画像の 5% 以上の面積を持つものだけを対象とする
      const minArea = (inputSize * inputSize) * 0.05;

      for (let i = 0; i < contours.size(); ++i) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        if (area > minArea && area > maxArea) {
          const peri = cv.arcLength(contour, true);

          // 頑健に4点を探索するため、輪郭近似しきい値を動的に探索
          for (let epsScale = 0.01; epsScale <= 0.05; epsScale += 0.005) {
            const approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, epsScale * peri, true);

            // 近似された頂点数が4つの場合
            if (approx.rows === 4) {
              const pts: Point[] = [];
              for (let j = 0; j < 4; j++) {
                const px = approx.data32S[j * 2];
                const py = approx.data32S[j * 2 + 1];
                
                // 256x256 から元のキャンバスサイズへと座標をスケールバック
                pts.push({
                  x: Math.max(0, Math.min(width, (px / inputSize) * width)),
                  y: Math.max(0, Math.min(height, (py / inputSize) * height))
                });
              }

              // 対角線の比率を検証し、潰れた平行四辺形を排除
              const d1 = Math.hypot(pts[0].x - pts[2].x, pts[0].y - pts[2].y);
              const d2 = Math.hypot(pts[1].x - pts[3].x, pts[1].y - pts[3].y);
              const diagRatio = Math.min(d1, d2) / Math.max(d1, d2);

              if (diagRatio > 0.22) {
                maxArea = area;
                bestPts = pts;
                approx.delete();
                break;
              }
            }
            approx.delete();
          }
        }
      }
    } catch (err) {
      console.error("[AI Seg] Contour processing error:", err);
    } finally {
      contours.delete();
      hierarchy.delete();
      maskMat.delete();
    }

    // 検出できた場合は頂点を整列(左上、右上、右下、左下)して返す
    return bestPts ? sortPoints(bestPts) : null;
  } catch (err) {
    console.error("[AI Seg] Inference failed:", err);
    return null;
  }
}

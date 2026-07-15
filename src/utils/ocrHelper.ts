// @ts-ignore
import init, { WasmOcrEngineBuilder } from './pure_onnx_ocr';
// @ts-ignore
import wasmUrl from './pure_onnx_ocr_bg.wasm?url';

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

let ocrEngine: any = null;

// DataURL を ArrayBuffer に変換するユーティリティ
function dataURLToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Canvas を ArrayBuffer に変換するユーティリティ
async function canvasToArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas to blob conversion failed'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target!.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('Reading blob failed'));
      reader.readAsArrayBuffer(blob);
    }, 'image/jpeg', 0.95);
  });
}

// Canvas を指定の最大長辺にリサイズするヘルパー
function resizeCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const width = canvas.width;
  const height = canvas.height;
  if (Math.max(width, height) <= maxSide) return canvas;

  const ratio = maxSide / Math.max(width, height);
  const newWidth = Math.round(width * ratio);
  const newHeight = Math.round(height * ratio);

  const resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = newWidth;
  resizedCanvas.height = newHeight;
  const ctx = resizedCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, newWidth, newHeight);
  }
  return resizedCanvas;
}

// OCRエンジン専用の画像前処理（影の除去と輪郭シャープネス強調）
function preprocessImageForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  // メモリ負荷を考慮し、前処理時も最大辺2240px程度に抑えてOpenCVに入力
  const inputCanvas = resizeCanvas(canvas, 2240);

  const src = cv.imread(inputCanvas);
  const dst = new cv.Mat();
  
  // 1. グレースケール化
  cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
  
  // 2. 背景の推定 (膨張・平滑化) と除算 (Division) による影の除去
  const dilated = new cv.Mat();
  const bg = new cv.Mat();
  const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(19, 19));
  cv.dilate(dst, dilated, M);
  cv.medianBlur(dilated, bg, 19);
  cv.divide(dst, bg, dst, 255.0);
  
  // 3. OCR専用の超コントラスト調整 (文字は漆黒、背景は純白に極端化するLUT)
  const lut = new cv.Mat(1, 256, cv.CV_8UC1);
  const data = new Uint8Array(256);
  const gamma = 2.0;  // 中間色を強烈に引き締める
  const minVal = 70;  // 70以下のグレーを完全な黒(0)にする
  const maxVal = 180; // 180以上の明るい領域を完全な白(255)にする
  for (let i = 0; i < 256; i++) {
    let val = i;
    if (val <= minVal) {
      val = 0;
    } else if (val >= maxVal) {
      val = 255;
    } else {
      val = ((val - minVal) / (maxVal - minVal)) * 255;
    }
    const corrected = Math.pow(val / 255.0, gamma) * 255.0;
    data[i] = Math.min(255, Math.max(0, corrected));
  }
  lut.data.set(data);
  cv.LUT(dst, lut, dst);

  // 4. アンシャープマスクによる輪郭のシャープネス強調
  const blurred = new cv.Mat();
  cv.GaussianBlur(dst, blurred, new cv.Size(3, 3), 1.0, 1.0);
  cv.addWeighted(dst, 1.6, blurred, -0.6, 0, dst);

  // 結果の書き出し
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = inputCanvas.width;
  resultCanvas.height = inputCanvas.height;
  cv.imshow(resultCanvas, dst);

  // リソースの削除
  src.delete();
  dst.delete();
  dilated.delete();
  bg.delete();
  M.delete();
  lut.delete();
  blurred.delete();

  return resultCanvas;
}

/**
 * pure-onnx-ocr WASM エンジンを初期化し、シングルトンとして保持する
 */
async function initOcrEngine(onProgress?: (progress: number) => void): Promise<any> {
  if (ocrEngine) return ocrEngine;

  // ブラウザのUIレンダリングにスレッドを一時的に明け渡すためのヘルパー
  const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 35));

  try {
    if (onProgress) onProgress(0.1); 
    await yieldToUi(); // 初期化開始

    // 1. WASM の初期化 (ViteのアセットURLを渡してロード)
    await init(wasmUrl);
    if (onProgress) onProgress(0.4);
    await yieldToUi();

    // 2. サーバーからモデルデータをダウンロード
    const [detRes, recRes, dictRes] = await Promise.all([
      fetch('/models/det.onnx'),
      fetch('/models/rec.onnx'),
      fetch('/models/ppocrv5_dict.txt')
    ]);

    if (!detRes.ok || !recRes.ok || !dictRes.ok) {
      throw new Error('Failed to download OCR models from public/models/');
    }
    if (onProgress) onProgress(0.65);
    await yieldToUi();

    const [detBytes, recBytes, dictBytes] = await Promise.all([
      detRes.arrayBuffer(),
      recRes.arrayBuffer(),
      dictRes.arrayBuffer()
    ]);
    if (onProgress) onProgress(0.85);
    await yieldToUi();

    // 3. エンジンのビルド (OCR精度最大化のパラメータ調整)
    const builder = new WasmOcrEngineBuilder();
    ocrEngine = builder
      .det_model_bytes(new Uint8Array(detBytes))
      .rec_model_bytes(new Uint8Array(recBytes))
      .dictionary_bytes(new Uint8Array(dictBytes))
      .det_limit_side_len(2240) // 1920 -> 2240 に引き上げてA4極小文字の潰れを防止
      .det_unclip_ratio(1.8) // 1.5 -> 1.8 に拡張して文字の端切れによる誤認識を防止
      .rec_batch_size(8)
      .build();

    if (onProgress) { onProgress(1.0); await yieldToUi(); }
    return ocrEngine;
  } catch (err) {
    console.error('Failed to initialize pure-onnx-ocr engine:', err);
    throw err;
  }
}

/**
 * 画像データ(DataURLまたはCanvas)からOCR解析を実行する (pure-onnx-ocr WASM に移行)
 * @param imageSource 解析対象画像 (DataURL または HTMLCanvasElement)
 * @param onProgress 進捗更新コールバック (0〜1の数値)
 */
export async function performOcr(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<OcrResult> {
  try {
    // 1. エンジンの初期化・ロード
    const engine = await initOcrEngine(onProgress);

    // 2. 画像サイズ (width/height) の取得と ArrayBuffer への変換 (OCR専用の裏前処理適用)
    let width = 0;
    let height = 0;
    let arrayBuffer: ArrayBuffer;

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

      // OCR専用の裏側コントラスト＆シャープネス前処理を適用する
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tCtx = tempCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(img, 0, 0);
        const processedCanvas = preprocessImageForOcr(tempCanvas);
        arrayBuffer = await canvasToArrayBuffer(processedCanvas);
      } else {
        arrayBuffer = dataURLToArrayBuffer(imageSource);
      }
    } else {
      width = imageSource.width;
      height = imageSource.height;
      
      // Canvasの場合も前処理を適用
      const processedCanvas = preprocessImageForOcr(imageSource);
      arrayBuffer = await canvasToArrayBuffer(processedCanvas);
    }

    const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 45));

    if (onProgress) onProgress(0.9);
    await yieldToUi(); // 推論前に画面（スピナー）を確実に描画更新させる

    // 3. OCR 推論の実行 (WASM)
    const imageArray = new Uint8Array(arrayBuffer);
    const resultJson = engine.run_from_bytes(imageArray);

    if (onProgress) onProgress(1.0);
    await yieldToUi(); // 推論完了

    const results = JSON.parse(resultJson);

    // 4. 結果を OcrResult にマッピング
    const allText = results.map((r: any) => r.text).join('\n');

    const words: OcrWord[] = results.map((r: any) => {
      // 境界ボックス (boundingBox) から、外接する長方形(bbox)の対角線座標を算出
      const box = r.bounding_box && r.bounding_box[0];
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      
      if (box && box.length > 0) {
        // [x, y] 形式と {x, y} 形式の両方を許容して座標展開
        const xs = box.map((p: any) => Array.isArray(p) ? p[0] : p.x);
        const ys = box.map((p: any) => Array.isArray(p) ? p[1] : p.y);
        x0 = Math.min(...xs);
        y0 = Math.min(...ys);
        x1 = Math.max(...xs);
        y1 = Math.max(...ys);
      }

      return {
        text: r.text,
        confidence: (r.confidence || 0) * 100, // Tesseractとの互換性のため 0〜100% 表記にスケーリング
        bbox: { x0, y0, x1, y1 }
      };
    });

    return {
      text: allText,
      words,
      width,
      height
    };
  } catch (error) {
    console.error('OCR analysis failed via pure-onnx-ocr:', error);
    throw error;
  }
}

/**
 * ONNX Runtime Web OCR セッションの初期化
 */

import * as ort from 'onnxruntime-web';
import { setupOrtEnvironment } from '../ortConfig';

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let ocrDict: string[] = [];
let initPromise: Promise<{
  detSession: ort.InferenceSession;
  recSession: ort.InferenceSession;
  dict: string[];
}> | null = null;

const progressListeners = new Set<(progress: number) => void>();

const notifyProgress = (progress: number) => {
  progressListeners.forEach((listener) => {
    try {
      listener(progress);
    } catch (e) {
      console.warn('[OCR Init] Progress listener error:', e);
    }
  });
};

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 35));

/**
 * ONNX Runtime Web OCR セッションを初期化する
 */
export function initOcrEngine(
  onProgress?: (progress: number) => void
): Promise<{
  detSession: ort.InferenceSession;
  recSession: ort.InferenceSession;
  dict: string[];
}> {
  if (detSession && recSession && ocrDict.length > 0) {
    if (onProgress) {
      try {
        onProgress(1.0);
      } catch {
        // 進捗コールバックの例外は無視
      }
    }
    return Promise.resolve({ detSession, recSession, dict: ocrDict });
  }

  if (onProgress) {
    progressListeners.add(onProgress);
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      notifyProgress(0.1);
      await yieldToUi();

      setupOrtEnvironment();
      const base = import.meta.env.BASE_URL;

      const [detRes, recRes, dictRes] = await Promise.all([
        fetch(`${base}models/PP-OCRv6_small_det_onnx/inference.onnx`),
        fetch(`${base}models/PP-OCRv6_small_rec_onnx/inference.onnx`),
        fetch(`${base}models/ppocrv6_dict.txt`)
      ]);

      if (!detRes.ok || !recRes.ok || !dictRes.ok) {
        throw new Error('Failed to download OCR models from public/models/');
      }
      notifyProgress(0.5);
      await yieldToUi();

      const [detBytes, recBytes, dictText] = await Promise.all([
        detRes.arrayBuffer(),
        recRes.arrayBuffer(),
        dictRes.text()
      ]);
      ocrDict = dictText.split(/\r?\n/);

      notifyProgress(0.7);
      await yieldToUi();

      if (!detSession) {
        detSession = await ort.InferenceSession.create(new Uint8Array(detBytes), {
          executionProviders: ['wasm']
        });
      }
      notifyProgress(0.85);
      await yieldToUi();

      if (!recSession) {
        recSession = await ort.InferenceSession.create(new Uint8Array(recBytes), {
          executionProviders: ['wasm']
        });
      }

      notifyProgress(1.0);
      await yieldToUi();

      return { detSession, recSession, dict: ocrDict };
    } catch (err) {
      console.error('Failed to initialize ONNX Runtime Web OCR engine:', err);
      initPromise = null;
      throw err;
    } finally {
      progressListeners.clear();
    }
  })();

  return initPromise;
}

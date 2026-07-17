import * as ort from 'onnxruntime-web';

let ortInitialized = false;

/**
 * ONNX Runtime Web のグローバル環境設定を初期化する
 */
export function setupOrtEnvironment(): void {
  if (ortInitialized) return;

  // WASMの配信パスを指定 (CORS・COEPエラー回避のためローカルの BASE_URL)
  ort.env.wasm.wasmPaths = import.meta.env.BASE_URL;

  // Web Worker起動のハング回避およびセキュアコンテキスト制限回避のため、スレッド数を 1 に固定
  ort.env.wasm.numThreads = 1;

  ortInitialized = true;
  console.log("[ortConfig] ONNX Runtime environment initialized (numThreads: 1, wasmPaths: local)");
}

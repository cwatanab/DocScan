/**
 * OpenCV.js のロード監視 (シングルトン Promise)
 */

let opencvLoadPromise: Promise<void> | null = null;

/**
 * OpenCV.js のロードを監視する
 * @param timeoutMs タイムアウト時間 (ミリ秒)
 */
export function loadOpenCV(timeoutMs: number = 90000): Promise<void> {
  if (opencvLoadPromise) {
    return opencvLoadPromise;
  }

  opencvLoadPromise = new Promise<void>((resolve, reject) => {
    // 既に準備完了している場合 (Wasm初期化完了を保証するため cv.Mat の存在までチェック)
    if (window.cvState === 'ready' || (window.cv && typeof window.cv.Mat === 'function')) {
      window.cvState = 'ready';
      resolve();
      return;
    }

    // window.Module のコールバックを保証
    if (!window.Module) {
      window.Module = {
        onRuntimeInitialized: () => {
          window.cvState = 'ready';
          window.dispatchEvent(new Event('opencv-ready'));
          resolve();
        }
      };
    } else {
      const oldInit = window.Module.onRuntimeInitialized;
      window.Module.onRuntimeInitialized = () => {
        if (oldInit) {
          try {
            oldInit();
          } catch (e) {
            console.error(e);
          }
        }
        window.cvState = 'ready';
        window.dispatchEvent(new Event('opencv-ready'));
        resolve();
      };
    }

    const handleReady = () => {
      window.removeEventListener('opencv-ready', handleReady);
      resolve();
    };
    window.addEventListener('opencv-ready', handleReady);

    const timer = setTimeout(() => {
      window.removeEventListener('opencv-ready', handleReady);
      opencvLoadPromise = null;
      reject(new Error('初期化がタイムアウトしました。ネットワーク接続を確認し、再読み込みしてください。'));
    }, timeoutMs);

    const script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    if (script) {
      const oldOnError = script.onerror;
      script.onerror = (e) => {
        if (oldOnError) {
          try {
            oldOnError(e);
          } catch (err) {
            console.error(err);
          }
        }
        clearTimeout(timer);
        window.removeEventListener('opencv-ready', handleReady);
        opencvLoadPromise = null;
        reject(new Error('初期化スクリプトのダウンロードに失敗しました。'));
      };
    } else {
      console.warn("[OpenCV] Static script tag '#opencv-script' not found in HTML.");
    }
  });

  return opencvLoadPromise;
}

/** OpenCV が利用可能かどうかを同期的に判定する */
export function isOpenCvReady(): boolean {
  return window.cvState === 'ready' || !!(window.cv && typeof window.cv.Mat === 'function');
}

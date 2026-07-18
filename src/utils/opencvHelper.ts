/**
 * OpenCV.js を用いた画像処理ユーティリティ
 */

export interface Point {
  x: number;
  y: number;
}

let opencvLoadPromise: Promise<void> | null = null;

/**
 * OpenCV.js のロードを監視する (シングルトン Promise)
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

    // window.Moduleのコールバックを保証
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
          try { oldInit(); } catch (e) { console.error(e); }
        }
        window.cvState = 'ready';
        window.dispatchEvent(new Event('opencv-ready'));
        resolve();
      };
    }

    // opencv-ready イベントの監視
    const handleReady = () => {
      window.removeEventListener('opencv-ready', handleReady);
      resolve();
    };
    window.addEventListener('opencv-ready', handleReady);

    // タイムアウト監視
    const timer = setTimeout(() => {
      window.removeEventListener('opencv-ready', handleReady);
      opencvLoadPromise = null; // エラー時はリセットして再試行可能にする
      reject(new Error("初期化がタイムアウトしました。ネットワーク接続を確認し、再読み込みしてください。"));
    }, timeoutMs);

    // HTMLに存在するスクリプトタグのエラーイベントをフック
    const script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    if (script) {
      const oldOnError = script.onerror;
      script.onerror = (e) => {
        if (oldOnError) {
          try { oldOnError(e); } catch (err) { console.error(err); }
        }
        clearTimeout(timer);
        window.removeEventListener('opencv-ready', handleReady);
        opencvLoadPromise = null; // エラー時はリセットして再試行可能にする
        reject(new Error("初期化スクリプトのダウンロードに失敗しました。"));
      };
    } else {
      console.warn("[OpenCV] Static script tag '#opencv-script' not found in HTML.");
    }
  });

  return opencvLoadPromise;
}

// 頂点のソート (左上, 右上, 右下, 左下)
export function sortPoints(points: Point[]): Point[] {
  if (points.length !== 4) return points;

  // x座標でソートして、左側の2点と右側の2点に分ける
  const sortedByX = [...points].sort((a, b) => a.x - b.x);
  const leftMost = [sortedByX[0], sortedByX[1]];
  const rightMost = [sortedByX[2], sortedByX[3]];

  // 左側の2点のうち、y座標が小さい方が左上、大きい方が左下
  const [topLeft, bottomLeft] = leftMost.sort((a, b) => a.y - b.y);
  // 右側の2点のうち、y座標が小さい方が右上、大きい方が右下
  const [topRight, bottomRight] = rightMost.sort((a, b) => a.y - b.y);

  return [topLeft, topRight, bottomRight, bottomLeft];
}

// 2点間の距離
function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * 4隅の座標を元に、ドキュメントの台形補正を行う
 * @param srcCanvas 元画像が描画されているCanvas
 * @param corners 補正する4頂点 (左上, 右上, 右下, 左下)
 * @returns 補正後のCanvas
 */
export function warpImage(srcImgOrCanvas: HTMLCanvasElement | HTMLImageElement, corners: Point[]): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) {
    console.error("OpenCV.js is not loaded.");
    if (srcImgOrCanvas instanceof HTMLCanvasElement) {
      return srcImgOrCanvas;
    }
    const c = document.createElement('canvas');
    c.width = srcImgOrCanvas.width;
    c.height = srcImgOrCanvas.height;
    return c;
  }

  // 頂点のソート
  const sortedCorners = sortPoints(corners);
  const [tl, tr, br, bl] = sortedCorners;

  // 補正後の縦横サイズを算出
  const widthA = distance(br, bl);
  const widthB = distance(tr, tl);
  const maxWidth = Math.max(widthA, widthB);

  const heightA = distance(tr, br);
  const heightB = distance(tl, bl);
  const maxHeight = Math.max(heightA, heightB);

  // 出力Canvasの設定
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = maxWidth;
  dstCanvas.height = maxHeight;

  let src: any = null;
  let dst: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;

  try {
    src = cv.imread(srcImgOrCanvas);
    dst = new cv.Mat();

    // 変換元の4頂点
    srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    // 変換後の4頂点
    dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth, 0,
      maxWidth, maxHeight,
      0, maxHeight
    ]);

    // 変換マトリクスを取得して適用
    M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 結果をCanvasに書き出す
    cv.imshow(dstCanvas, dst);
  } finally {
    // メモリ解放 (例外時にも確実に実行)
    if (src) src.delete();
    if (dst) dst.delete();
    if (srcCoords) srcCoords.delete();
    if (dstCoords) dstCoords.delete();
    if (M) M.delete();
  }

  return dstCanvas;
}

/**
 * cv.Mat に対して直接フィルター処理を適用する
 * @param src 入力 cv.Mat (RGBA)
 * @param dst 出力 cv.Mat (RGBA または GRAY)
 * @param mode フィルターモード
 */
export function applyFilterToMat(src: any, dst: any, mode: 'color' | 'mono' | 'document'): void {
  const cv = window.cv;
  if (!cv) return;

  let grayForStats: any = null;
  let meanMat: any = null;
  let stddevMat: any = null;
  let ycrcb: any = null;
  let channels: any = null;
  let yChan: any = null;
  let crChan: any = null;
  let cbChan: any = null;
  let lut: any = null;
  let M: any = null;
  let dilated: any = null;
  let bg: any = null;
  let rgb: any = null;

  try {
    // --- 自動補正のための画像解析 (平均輝度の算出) ---
    let meanVal = 128;
    try {
      grayForStats = new cv.Mat();
      cv.cvtColor(src, grayForStats, cv.COLOR_RGBA2GRAY);
      meanMat = new cv.Mat();
      stddevMat = new cv.Mat();
      cv.meanStdDev(grayForStats, meanMat, stddevMat);
      meanVal = meanMat.doubleAt(0, 0);
    } catch (e) {
      console.warn("Failed to calculate image stats for auto filter:", e);
    } finally {
      if (grayForStats) { grayForStats.delete(); grayForStats = null; }
      if (meanMat) { meanMat.delete(); meanMat = null; }
      if (stddevMat) { stddevMat.delete(); stddevMat = null; }
    }

    if (mode === 'color') {
      ycrcb = new cv.Mat();
      cv.cvtColor(src, ycrcb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(ycrcb, ycrcb, cv.COLOR_RGB2YCrCb);

      channels = new cv.MatVector();
      cv.split(ycrcb, channels);
      
      yChan = channels.get(0);  // Y (輝度)
      crChan = channels.get(1); // Cr (色度)
      cbChan = channels.get(2); // Cb (色度)
      
      lut = new cv.Mat(1, 256, cv.CV_8UC1);
      const data = new Uint8Array(256);
      
      let gamma = 1.2;
      let minVal = 15;
      let maxVal = 240;

      if (meanVal < 130) {
        gamma = Math.max(1.0, 1.2 - ((130 - meanVal) / 130) * 0.2);
        minVal = Math.max(10, 15 - Math.round((130 - meanVal) / 10));
        maxVal = Math.max(190, 240 - Math.round((130 - meanVal) / 3));
      } else {
        gamma = Math.min(1.4, 1.2 + ((meanVal - 130) / 125) * 0.2);
        minVal = Math.min(25, 15 + Math.round((meanVal - 130) / 12));
      }
      
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

      const kernelSize = 33;
      M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));

      dilated = new cv.Mat();
      bg = new cv.Mat();
      cv.dilate(yChan, dilated, M);
      cv.medianBlur(dilated, bg, kernelSize);
      
      cv.divide(yChan, bg, yChan, 255.0);
      cv.LUT(yChan, lut, yChan);
      
      dilated.delete(); dilated = null;
      bg.delete(); bg = null;
      M.delete(); M = null;
      lut.delete(); lut = null;

      cv.merge(channels, ycrcb);
      rgb = new cv.Mat();
      cv.cvtColor(ycrcb, rgb, cv.COLOR_YCrCb2RGB);
      cv.cvtColor(rgb, dst, cv.COLOR_RGB2RGBA);
      rgb.delete(); rgb = null;

      yChan.delete(); yChan = null;
      crChan.delete(); crChan = null;
      cbChan.delete(); cbChan = null;
      channels.delete(); channels = null;
      ycrcb.delete(); ycrcb = null;
    } else if (mode === 'mono') {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      cv.adaptiveThreshold(
        dst,
        dst,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15,
        10
      );
    } else if (mode === 'document') {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      
      dilated = new cv.Mat();
      bg = new cv.Mat();
      M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(33, 33));
      cv.dilate(dst, dilated, M);
      cv.medianBlur(dilated, bg, 33);
      
      cv.divide(dst, bg, dst, 255.0);
      
      lut = new cv.Mat(1, 256, cv.CV_8UC1);
      const data = new Uint8Array(256);
      
      let gamma = 1.35;
      let minVal = 20;
      let maxVal = 230;

      if (meanVal < 110) {
        gamma = 1.1;
        minVal = 10;
        maxVal = 220;
      } else if (meanVal > 200) {
        gamma = 1.5;
        minVal = 30;
        maxVal = 240;
      }
      
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

      dilated.delete(); dilated = null;
      bg.delete(); bg = null;
      M.delete(); M = null;
      lut.delete(); lut = null;
    }
  } finally {
    if (grayForStats) { try { grayForStats.delete(); } catch(e){} }
    if (meanMat) { try { meanMat.delete(); } catch(e){} }
    if (stddevMat) { try { stddevMat.delete(); } catch(e){} }
    if (ycrcb) { try { ycrcb.delete(); } catch(e){} }
    if (yChan) { try { yChan.delete(); } catch(e){} }
    if (crChan) { try { crChan.delete(); } catch(e){} }
    if (cbChan) { try { cbChan.delete(); } catch(e){} }
    if (channels) {
      try {
        for (let i = 0; i < channels.size(); i++) {
          try {
            const m = channels.get(i);
            if (m) m.delete();
          } catch(e){}
        }
        channels.delete();
      } catch(e){}
    }
    if (lut) { try { lut.delete(); } catch(e){} }
    if (M) { try { M.delete(); } catch(e){} }
    if (dilated) { try { dilated.delete(); } catch(e){} }
    if (bg) { try { bg.delete(); } catch(e){} }
    if (rgb) { try { rgb.delete(); } catch(e){} }
  }
}

/**
 * カラーモードフィルタ（白黒、コントラスト強調など）を適用する
 * @param canvas 適用対象のCanvas
 * @param mode 'color' | 'mono' | 'document'
 * @returns フィルタ適用後の新しいCanvas
 */
export function applyFilter(canvas: HTMLCanvasElement, mode: 'color' | 'mono' | 'document'): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) return canvas;

  let src: any = null;
  let dst: any = null;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = canvas.width;
  resultCanvas.height = canvas.height;

  try {
    src = cv.imread(canvas);
    dst = new cv.Mat();
    applyFilterToMat(src, dst, mode);
    cv.imshow(resultCanvas, dst);
  } finally {
    if (src) { try { src.delete(); } catch(e){} }
    if (dst) { try { dst.delete(); } catch(e){} }
  }

  return resultCanvas;
}

/**
 * 画像エレメントを90度反時計回りに回転させる（左回転）
 * @param canvas 回転対象 of Canvas
 * @returns 回転後の新しいCanvas
 */
export function rotateImage90(srcImgOrCanvas: HTMLCanvasElement | HTMLImageElement, clockwise: boolean = true): HTMLCanvasElement {
  const cv = window.cv;
  if (!cv) {
    if (srcImgOrCanvas instanceof HTMLCanvasElement) {
      return srcImgOrCanvas;
    }
    const c = document.createElement('canvas');
    c.width = srcImgOrCanvas.width;
    c.height = srcImgOrCanvas.height;
    return c;
  }

  let src: any = null;
  let dst: any = null;
  const resultCanvas = document.createElement('canvas');

  try {
    src = cv.imread(srcImgOrCanvas);
    dst = new cv.Mat();

    // 時計回り(右) or 反時計回り(左) に回転
    cv.rotate(src, dst, clockwise ? cv.ROTATE_90_CLOCKWISE : cv.ROTATE_90_COUNTERCLOCKWISE);
    
    // imshowするためにCanvasのsizeを入れ替える
    const w = srcImgOrCanvas instanceof HTMLImageElement ? (srcImgOrCanvas.naturalWidth || srcImgOrCanvas.width) : srcImgOrCanvas.width;
    const h = srcImgOrCanvas instanceof HTMLImageElement ? (srcImgOrCanvas.naturalHeight || srcImgOrCanvas.height) : srcImgOrCanvas.height;

    resultCanvas.width = h;
    resultCanvas.height = w;

    cv.imshow(resultCanvas, dst);
  } finally {
    // 例外時にも確実に解放
    if (src) { try { src.delete(); } catch(e){} }
    if (dst) { try { dst.delete(); } catch(e){} }
  }

  return resultCanvas;
}

/**
 * 画像のフォーカススコア（ラプラシアン分散）を計算する。高いほどピントが合っておりエッジが立っている。
 * @param canvas 対象 of Canvas
 * @returns フォーカススコア
 */
export function calculateFocusScore(canvas: HTMLCanvasElement): number {
  const cv = window.cv;
  if (!cv) return 0;

  let src: any = null;
  let gray: any = null;
  let laplacian: any = null;
  let mean: any = null;
  let stddev: any = null;

  let score = 0;
  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    laplacian = new cv.Mat();
    mean = new cv.Mat();
    stddev = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // ラプラシアンフィルタを適用 (2階微分エッジ抽出)
    cv.Laplacian(gray, laplacian, cv.CV_64F, 1, 1, 0, cv.BORDER_DEFAULT);
    // 平均と標準偏差を算出
    cv.meanStdDev(laplacian, mean, stddev);
    // 標準偏差の二乗 ＝ 分散
    const sd = stddev.doubleAt(0, 0);
    score = sd * sd;
  } catch (e) {
    console.error("Error in calculating focus score: ", e);
  } finally {
    if (src) { try { src.delete(); } catch(e){} }
    if (gray) { try { gray.delete(); } catch(e){} }
    if (laplacian) { try { laplacian.delete(); } catch(e){} }
    if (mean) { try { mean.delete(); } catch(e){} }
    if (stddev) { try { stddev.delete(); } catch(e){} }
  }

  return score;
}

/**
 * 画像の色彩や特徴量を解析し、最適なフィルターモードを自動判定する
 * @param canvas 解析対象の補正後画像Canvas
 * @returns 'color' | 'document'
 */
export function detectOptimalFilter(canvas: HTMLCanvasElement): 'color' | 'document' {
  const cv = window.cv;
  if (!cv || !cv.Mat) {
    return 'document'; // フォールバック
  }

  let src: any = null;
  let hsv: any = null;
  let channels: any = null;
  
  try {
    src = cv.imread(canvas);
    hsv = new cv.Mat();

    // 1. カラーかどうかの判定 (HSVに変換し、Sチャンネルの平均値を見る)
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    
    // HSVの各チャンネルを分離
    channels = new cv.MatVector();
    cv.split(hsv, channels);
    
    let sChan = channels.get(1); // S（彩度）チャンネルを取得
    let meanSat = cv.mean(sChan)[0]; // 彩度の平均値 (0-255)
    
    // 彩度の平均値が 15 以上なら「カラー画像」とみなす
    if (meanSat > 15) {
      return 'color';
    }
  } catch (e) {
    console.error("Error in detecting optimal filter: ", e);
  } finally {
    if (channels) {
      try {
        for (let i = 0; i < channels.size(); i++) {
          try { channels.get(i).delete(); } catch(err){}
        }
        channels.delete();
      } catch(err){}
    }
    if (hsv) { try { hsv.delete(); } catch(e){} }
    if (src) { try { src.delete(); } catch(e){} }
  }

  return 'document';
}

/**
 * 画像エレメントと4角の頂点、フィルタモードを指定し、台形補正とフィルタ処理を行った結果のDataURLを生成する
 */
export function processWarpAndFilter(
  imageEl: HTMLImageElement,
  corners: Point[],
  filterMode: 'color' | 'document'
): string | null {
  const cv = window.cv;
  if (!cv) return null;

  // 頂点のソート
  const sortedCorners = sortPoints(corners);
  const [tl, tr, br, bl] = sortedCorners;

  // 補正後の縦横サイズを算出
  const widthA = distance(br, bl);
  const widthB = distance(tr, tl);
  const maxWidth = Math.max(widthA, widthB);

  const heightA = distance(tr, br);
  const heightB = distance(tl, bl);
  const maxHeight = Math.max(heightA, heightB);

  let src: any = null;
  let warped: any = null;
  let dst: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = maxWidth;
  resultCanvas.height = maxHeight;

  try {
    src = cv.imread(imageEl);
    warped = new cv.Mat();

    // 変換元の4頂点
    srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    // 変換後の4頂点
    dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth, 0,
      maxWidth, maxHeight,
      0, maxHeight
    ]);

    // 変換マトリクスを取得して適用
    M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    dst = new cv.Mat();
    // フィルターを適用
    applyFilterToMat(warped, dst, filterMode);

    // 結果を描画
    cv.imshow(resultCanvas, dst);
  } finally {
    if (src) { try { src.delete(); } catch(e){} }
    if (warped) { try { warped.delete(); } catch(e){} }
    if (dst) { try { dst.delete(); } catch(e){} }
    if (srcCoords) { try { srcCoords.delete(); } catch(e){} }
    if (dstCoords) { try { dstCoords.delete(); } catch(e){} }
    if (M) { try { M.delete(); } catch(e){} }
  }

  return resultCanvas.toDataURL('image/jpeg', 0.95);
}


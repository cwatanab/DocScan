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
export function loadOpenCV(timeoutMs: number = 30000): Promise<void> {
  if (opencvLoadPromise) {
    return opencvLoadPromise;
  }

  opencvLoadPromise = new Promise<void>((resolve, reject) => {
    // 既に準備完了している場合
    if ((window as any).cvState === 'ready' || (window as any).cv) {
      resolve();
      return;
    }

    // window.Moduleのコールバックを保証
    if (!(window as any).Module) {
      (window as any).Module = {
        onRuntimeInitialized: () => {
          console.log("[OpenCV] onRuntimeInitialized callback triggered!");
          (window as any).cvState = 'ready';
          window.dispatchEvent(new Event('opencv-ready'));
          resolve();
        }
      };
    } else {
      const oldInit = (window as any).Module.onRuntimeInitialized;
      (window as any).Module.onRuntimeInitialized = () => {
        if (oldInit) {
          try { oldInit(); } catch (e) { console.error(e); }
        }
        console.log("[OpenCV] Hooked onRuntimeInitialized callback triggered!");
        (window as any).cvState = 'ready';
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
      reject(new Error("OpenCV.js 初期化がタイムアウトしました。ネットワーク接続を確認し、再読み込みしてください。"));
    }, timeoutMs);

    // HTMLに存在するスクリプトタグのエラーイベントをフック
    const script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    if (script) {
      console.log("[OpenCV] Monitoring existing static script tag...");
      const oldOnError = script.onerror;
      script.onerror = (e) => {
        if (oldOnError) {
          try { oldOnError(e); } catch (err) { console.error(err); }
        }
        clearTimeout(timer);
        window.removeEventListener('opencv-ready', handleReady);
        reject(new Error("OpenCV.js スクリプトのダウンロードに失敗しました。"));
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

  // x + y が最小 -> 左上, 最大 -> 右下
  // y - x が最小 -> 右上, 最大 -> 左下
  const sorted = [...points];
  
  // 和と差を計算
  const sum = sorted.map(p => p.x + p.y);
  const diff = sorted.map(p => p.y - p.x);

  const topLeft = sorted[sum.indexOf(Math.min(...sum))];
  const bottomRight = sorted[sum.indexOf(Math.max(...sum))];
  const topRight = sorted[diff.indexOf(Math.min(...diff))];
  const bottomLeft = sorted[diff.indexOf(Math.max(...diff))];

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
export function warpImage(srcCanvas: HTMLCanvasElement, corners: Point[]): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) {
    console.error("OpenCV.js is not loaded.");
    return srcCanvas;
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

  const src = cv.imread(srcCanvas);
  const dst = new cv.Mat();

  // 変換元の4頂点
  const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y,
    tr.x, tr.y,
    br.x, br.y,
    bl.x, bl.y
  ]);

  // 変換後の4頂点
  const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    maxWidth, 0,
    maxWidth, maxHeight,
    0, maxHeight
  ]);

  // 変換マトリクスを取得して適用
  const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
  cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  // 結果をCanvasに書き出す
  cv.imshow(dstCanvas, dst);

  // メモリ解放
  src.delete();
  dst.delete();
  srcCoords.delete();
  dstCoords.delete();
  M.delete();

  return dstCanvas;
}





/**
 * カラーモードフィルタ（白黒、コントラスト強調など）を適用する
 * @param canvas 適用対象のCanvas
 * @param mode 'color' | 'mono' | 'document'
 * @returns フィルタ適用後の新しいCanvas
 */
export function applyFilter(canvas: HTMLCanvasElement, mode: 'color' | 'mono' | 'document'): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  const src = cv.imread(canvas);
  const dst = new cv.Mat();
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = canvas.width;
  resultCanvas.height = canvas.height;

  // --- 自動補正のための画像解析 (平均輝度の算出) ---
  let meanVal = 128;
  try {
    const grayForStats = new cv.Mat();
    cv.cvtColor(src, grayForStats, cv.COLOR_RGBA2GRAY);
    const meanMat = new cv.Mat();
    const stddevMat = new cv.Mat();
    cv.meanStdDev(grayForStats, meanMat, stddevMat);
    meanVal = meanMat.doubleAt(0, 0);
    grayForStats.delete();
    meanMat.delete();
    stddevMat.delete();
  } catch (e) {
    console.warn("Failed to calculate image stats for auto filter:", e);
  }

  if (mode === 'color') {
    // カラーモード: YCrCb 空間に変換し、輝度チャンネル Y のみに対して背景除算とコントラスト補正を行うことで色ズレを完全に防ぎます。
    const ycrcb = new cv.Mat();
    cv.cvtColor(src, ycrcb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(ycrcb, ycrcb, cv.COLOR_RGB2YCrCb);

    const channels = new cv.MatVector();
    cv.split(ycrcb, channels);
    
    const yChan = channels.get(0);  // Y (輝度)
    const crChan = channels.get(1); // Cr (色度)
    const cbChan = channels.get(2); // Cb (色度)
    
    // ガンマ補正用LUTの作成
    const lut = new cv.Mat(1, 256, cv.CV_8UC1);
    const data = new Uint8Array(256);
    
    // 画像全体の明るさ (meanVal) に応じて、ガンマとしきい値を動的に自動調整する (コントラストと文字を引き締める調整)
    let gamma = 1.2;
    let minVal = 15;
    let maxVal = 240;

    if (meanVal < 130) {
      // 暗い画像 (露出不足など) ➔ ガンマを下げて明るくし、黒つぶれを防ぐ
      gamma = Math.max(1.0, 1.2 - ((130 - meanVal) / 130) * 0.2);
      minVal = Math.max(10, 15 - Math.round((130 - meanVal) / 10));
      maxVal = Math.max(190, 240 - Math.round((130 - meanVal) / 3));
    } else {
      // 明るい画像 ➔ ガンマを上げてコントラストを引き締める
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

    // Yチャンネルに対して背景除算（影消し）とLUT補正を適用
    const kernelSize = 33;
    const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));

    const dilated = new cv.Mat();
    const bg = new cv.Mat();
    cv.dilate(yChan, dilated, M);
    cv.medianBlur(dilated, bg, kernelSize);
    
    // 影ムラを除去（除算）し背景を白く飛ばす
    cv.divide(yChan, bg, yChan, 255.0);
    
    // ガンマ・レベル補正を適用
    cv.LUT(yChan, lut, yChan);
    
    dilated.delete();
    bg.delete();
    M.delete();
    lut.delete();

    // 再合成して RGB に変換してから RGBA に戻す (COLOR_YCrCb2RGBA は OpenCV.js で未定義のため)
    cv.merge(channels, ycrcb);
    const rgb = new cv.Mat();
    cv.cvtColor(ycrcb, rgb, cv.COLOR_YCrCb2RGB);
    cv.cvtColor(rgb, dst, cv.COLOR_RGB2RGBA);
    rgb.delete();

    // リソースの解放
    yChan.delete();
    crChan.delete();
    cbChan.delete();
    channels.delete();
    ycrcb.delete();
  } else if (mode === 'mono') {
    // モノクロ化（白黒2値化）
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
    // ドキュメントモード: 背景の影のムラを除算(Division)で完璧にフラットにした後、ガンマ補正でくっきり白黒化する
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
    
    // 背景の推定 (膨張・平滑化)
    const dilated = new cv.Mat();
    const bg = new cv.Mat();
    const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(33, 33));
    cv.dilate(dst, dilated, M);
    cv.medianBlur(dilated, bg, 33);
    
    // 影消し (背景を確実に白く飛ばすため 100% 適用に戻す)
    cv.divide(dst, bg, dst, 255.0);
    
    // ガンマ補正 & しきい値ストレッチ (紙の白さを保証しつつ、文字の極端なギラつき・掠れを防ぐマイルドな設定)
    const lut = new cv.Mat(1, 256, cv.CV_8UC1);
    const data = new Uint8Array(256);
    
    // コントラストパラメータ (背景を白く、文字をくっきり引き締めるガンマ補正)
    let gamma = 1.35;
    let minVal = 20;
    let maxVal = 230;

    if (meanVal < 110) {
      gamma = 1.1; // 暗い画像は少し明るく調整しつつコントラストも残す
      minVal = 10;
      maxVal = 220;
    } else if (meanVal > 200) {
      gamma = 1.5; // 明るい画像はさらに強めにコントラストを効かせる
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

    dilated.delete();
    bg.delete();
    M.delete();
    lut.delete();
  }

  cv.imshow(resultCanvas, dst);
  src.delete();
  dst.delete();

  return resultCanvas;
}

/**
 * 画像を90度反時計回りに回転させる（左回転）
 * @param canvas 回転対象 of Canvas
 * @returns 回転後の新しいCanvas
 */
export function rotateImage90(canvas: HTMLCanvasElement, clockwise: boolean = true): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  const src = cv.imread(canvas);
  const dst = new cv.Mat();
  const resultCanvas = document.createElement('canvas');

  // 時計回り(右) or 反時計回り(左) に回転
  cv.rotate(src, dst, clockwise ? cv.ROTATE_90_CLOCKWISE : cv.ROTATE_90_COUNTERCLOCKWISE);
  
  // imshowするためにCanvasのサイズを入れ替える
  resultCanvas.width = canvas.height;
  resultCanvas.height = canvas.width;

  cv.imshow(resultCanvas, dst);
  
  src.delete();
  dst.delete();

  return resultCanvas;
}

/**
 * 画像のフォーカススコア（ラプラシアン分散）を計算する。高いほどピントが合っておりエッジが立っている。
 * @param canvas 対象のCanvas
 * @returns フォーカススコア
 */
export function calculateFocusScore(canvas: HTMLCanvasElement): number {
  const cv = (window as any).cv;
  if (!cv) return 0;

  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const laplacian = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();

  let score = 0;
  try {
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
    src.delete();
    gray.delete();
    laplacian.delete();
    mean.delete();
    stddev.delete();
  }

  return score;
}

/**
 * 画像の色彩や特徴量を解析し、最適なフィルターモードを自動判定する
 * @param canvas 解析対象の補正後画像Canvas
 * @returns 'color' | 'document'
 */
export function detectOptimalFilter(canvas: HTMLCanvasElement): 'color' | 'document' {
  const cv = (window as any).cv;
  if (!cv || !cv.Mat) {
    return 'document'; // フォールバック
  }

  let src = cv.imread(canvas);
  let hsv = new cv.Mat();
  
  try {
    // 1. カラーかどうかの判定 (HSVに変換し、Sチャンネルの平均値を見る)
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    
    // HSVの各チャンネルを分離
    let channels = new cv.MatVector();
    cv.split(hsv, channels);
    
    let sChan = channels.get(1); // S（彩度）チャンネルを取得
    let meanSat = cv.mean(sChan)[0]; // 彩度の平均値 (0-255)
    
    sChan.delete();
    channels.delete();

    // 彩度の平均値が 15 以上なら「カラー画像」とみなす
    if (meanSat > 15) {
      return 'color';
    }
  } catch (e) {
    console.error("Error in detecting optimal filter: ", e);
  } finally {
    hsv.delete();
    src.delete();
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
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imageEl.naturalWidth || imageEl.width;
  tempCanvas.height = imageEl.naturalHeight || imageEl.height;
  const ctx = tempCanvas.getContext('2d');
  
  if (ctx) {
    ctx.drawImage(imageEl, 0, 0);
    const warpedCanvas = warpImage(tempCanvas, corners);
    const filteredCanvas = applyFilter(warpedCanvas, filterMode);
    return filteredCanvas.toDataURL('image/jpeg', 0.95);
  }
  return null;
}


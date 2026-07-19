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
export type FilterMode = 'color_enhanced' | 'color_original' | 'document_enhanced' | 'document_original' | 'mono';

export function applyFilterToMat(src: any, dst: any, mode: FilterMode): void {
  const cv = window.cv;
  if (!cv) return;

  let channels: any = null;
  let lut: any = null;
  let rgb: any = null;

  try {

    if (mode === 'color_enhanced') {
      let hsv: any = null;
      let mask: any = null;
      try {
        hsv = new cv.Mat();
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        channels = new cv.MatVector();
        cv.split(hsv, channels);

        const sChan = channels.get(1); // 彩度チャネル
        const vChan = channels.get(2); // 明度・輝度チャネル

        // 1. 輝度の自動補正: 0-255 の Min-Max ストレッチ
        // 自動的に最も明るい部分を白、最も暗い部分を黒に引き伸ばします
        mask = new cv.Mat();
        cv.normalize(vChan, vChan, 0, 255, cv.NORM_MINMAX, -1, mask);

        // 2. 彩度の自動補正: 彩度を 1.25倍 に引き上げて鮮やかさを復元 (赤ペン・蛍光ペン・捺印などを強調)
        sChan.convertTo(sChan, -1, 1.25, 0);

        cv.merge(channels, hsv);
        rgb = new cv.Mat();
        cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
        cv.cvtColor(rgb, dst, cv.COLOR_RGB2RGBA);
        
        rgb.delete(); rgb = null;
      } catch (err) {
        console.error("Error in color_enhanced filter:", err);
        src.copyTo(dst);
      } finally {
        if (hsv) { try { hsv.delete(); } catch(e){} }
        if (mask) { try { mask.delete(); } catch(e){} }
      }

    } else if (mode === 'color_original') {
      src.copyTo(dst);
    } else if (mode === 'document_enhanced') {
      let small: any = null;
      let smallBg: any = null;
      let bg: any = null;
      let mask: any = null;
      try {
        // 1. グレースケールに変換
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

        // 2. 適応的背景推定 (モルフォロジー演算による文字の消去と影・しわの抽出)
        // メモリと速度向上のため、1/4 サイズに縮小して処理します
        // ※ new cv.Size(0, 0) による OpenCV.js のリサイズクラッシュを防ぐため、サイズを明示的に指定します
        small = new cv.Mat();
        smallBg = new cv.Mat();
        bg = new cv.Mat();
        const scale = 0.25;
        const smallW = Math.round(dst.cols * scale);
        const smallH = Math.round(dst.rows * scale);

        cv.resize(dst, small, new cv.Size(smallW, smallH), 0, 0, cv.INTER_LINEAR);

        // 膨張処理 (Dilation) のカーネルサイズを 13x13 に戻し、折じわや影を背景画像に残して除算で消去できるようにします
        lut = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 13));
        cv.dilate(small, smallBg, lut);
        // メディアンフィルタで背景陰影を滑らかにします (サイズ 13)
        cv.medianBlur(smallBg, smallBg, 13);

        // 元のサイズに拡大します
        cv.resize(smallBg, bg, dst.size(), 0, 0, cv.INTER_LINEAR);

        // 3. 元のグレースケール画像を背景画像で除算して、影やうねり（しわ）を完璧に相殺します
        cv.divide(dst, bg, dst, 255, -1);

        // 4. 背景除去後の画像を 0-255 の範囲に Min-Max ストレッチ（正規化）
        // ※ OpenCV.jsの引数例外を防ぐため、明示的に空のマスクを渡します
        mask = new cv.Mat();
        const minMax = cv.minMaxLoc(dst, mask);
        const minVal = minMax.minVal;
        const maxVal = minMax.maxVal;

        if (maxVal > minVal) {
          const scaleFactor = 255.0 / (maxVal - minVal);
          dst.convertTo(dst, -1, scaleFactor, -minVal * scaleFactor);
        }

        // 5. ハイライトクリップ付きガンマ補正 (gamma = 2.2, clip = 220)
        // 除算で消しきれなかったわずかなしわの影（明るいグレー）がガンマ補正で引き締められて浮き出るのを防ぐため、
        // 輝度 220 以上を完全な白 (255) に強制クリップし、それ未満の文字領域だけをガンマ補正で太く濃く引き締めます
        lut = new cv.Mat(1, 256, cv.CV_8UC1);
        const lutData = new Uint8Array(256);
        const gamma = 2.2;
        const clipThreshold = 220;
        for (let i = 0; i < 256; i++) {
          if (i >= clipThreshold) {
            lutData[i] = 255;
          } else {
            const norm = i / clipThreshold;
            lutData[i] = Math.min(255, Math.max(0, Math.pow(norm, gamma) * 255.0));
          }
        }
        lut.data.set(lutData);
        cv.LUT(dst, lut, dst);
      } catch (err) {
        console.error("Error in document_enhanced filter (Morphology):", err);
      } finally {
        if (small) { try { small.delete(); } catch(e){} }
        if (smallBg) { try { smallBg.delete(); } catch(e){} }
        if (bg) { try { bg.delete(); } catch(e){} }
        if (mask) { try { mask.delete(); } catch(e){} }
        if (lut) { try { lut.delete(); } catch(e){} lut = null; }
      }
    } else if (mode === 'document_original') {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
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
    }
  } finally {
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
    if (rgb) { try { rgb.delete(); } catch(e){} }
  }
}

/**
 * カラーモードフィルタ（白黒、コントラスト強調など）を適用する
 * @param canvas 適用対象のCanvas
 * @param mode 'color' | 'mono' | 'document'
 * @returns フィルタ適用後の新しいCanvas
 */
export function applyFilter(canvas: HTMLCanvasElement, mode: FilterMode): HTMLCanvasElement {
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
 * @returns 'original' | 'document'
 */
export async function detectOptimalFilter(
  imageSrc: string,
  corners: { x: number; y: number }[]
): Promise<{ mode: 'color_enhanced' | 'document_enhanced'; colorRatio: number }> {
  const cv = window.cv;
  let colorRatio = 0.0;
  if (!cv || !cv.Mat || corners.length !== 4) {
    return { mode: 'document_enhanced', colorRatio: 0.0 };
  }

  let src: any = null;
  let small: any = null;
  let hsv: any = null;
  let channels: any = null;
  let threshSat: any = null;
  let srcCoords: any = null;
  let dstCoords: any = null;
  let M: any = null;
  let tempImg: HTMLImageElement | null = null;
  
  try {
    // Use a newly loaded image to guarantee complete decoding and avoid iOS canvas sync errors
    tempImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = imageSrc;
    });

    src = cv.imread(tempImg);
    small = new cv.Mat();
    const sorted = sortPoints(corners);
    const [tl, tr, br, bl] = sorted;

    srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      150, 0,
      150, 150,
      0, 150
    ]);

    M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(src, small, M, new cv.Size(150, 150), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    hsv = new cv.Mat();

    // 1. カラーかどうかの判定 (HSVに変換し、Sチャンネルの閾値比率を見る)
    cv.cvtColor(small, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    
    // HSVの各チャンネルを分離
    channels = new cv.MatVector();
    cv.split(hsv, channels);
    
    let sChan = channels.get(1); // S（彩度）チャンネルを取得
    
    // 有彩色と判定する彩度閾値を 35 から 20 に下げ、暗い撮影環境のカラー情報も確実に拾います (薄い紙の黄ばみは 0 に足切り)
    threshSat = new cv.Mat();
    cv.threshold(sChan, threshSat, 12, 255, cv.THRESH_BINARY);
    
    // 有彩色ピクセルの平均値（全体の何割が有彩色ピクセルかを示す値, 0-255）
    const meanVal = cv.mean(threshSat)[0];
    colorRatio = meanVal / 255.0; // 0.0 ~ 1.0 の割合

    // 有彩色領域が全体の 0.3% 以上存在すれば「カラー画像」と判定 (より小さな印鑑や数行の赤字に対応)
    if (colorRatio > 0.005) {
      return { mode: 'color_enhanced', colorRatio };
    }
  } catch (e) {
    console.error("Error in detecting optimal filter: ", e);
  } finally {
    if (threshSat) { try { threshSat.delete(); } catch(e){} }
    if (channels) {
      try {
        for (let i = 0; i < channels.size(); i++) {
          try { channels.get(i).delete(); } catch(err){}
        }
        channels.delete();
      } catch(err){}
    }
    if (hsv) { try { hsv.delete(); } catch(e){} }
    if (small) { try { small.delete(); } catch(e){} }
    if (src) { try { src.delete(); } catch(e){} }
    if (srcCoords) { try { srcCoords.delete(); } catch(e){} }
    if (dstCoords) { try { dstCoords.delete(); } catch(e){} }
    if (M) { try { M.delete(); } catch(e){} }
  }

  return { mode: 'document_enhanced', colorRatio };
}

/**
 * 画像エレメントと4角の頂点、フィルタモードを指定し、台形補正とフィルタ処理を行った結果のDataURLを生成する
 */
export function processWarpAndFilter(
  imageEl: HTMLImageElement,
  corners: Point[],
  filterMode: FilterMode,
  rotation: number = 0
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

    // 回転を適用
    if (rotation === 90) {
      cv.rotate(dst, dst, cv.ROTATE_90_CLOCKWISE);
    } else if (rotation === 180) {
      cv.rotate(dst, dst, cv.ROTATE_180);
    } else if (rotation === 270) {
      cv.rotate(dst, dst, cv.ROTATE_90_COUNTERCLOCKWISE);
    }

    const resultCanvas = document.createElement('canvas');
    if (rotation === 90 || rotation === 270) {
      resultCanvas.width = maxHeight;
      resultCanvas.height = maxWidth;
    } else {
      resultCanvas.width = maxWidth;
      resultCanvas.height = maxHeight;
    }

    // 結果を描画
    cv.imshow(resultCanvas, dst);
    return resultCanvas.toDataURL('image/jpeg', 0.95);
  } finally {
    if (src) { try { src.delete(); } catch(e){} }
    if (warped) { try { warped.delete(); } catch(e){} }
    if (dst) { try { dst.delete(); } catch(e){} }
    if (srcCoords) { try { srcCoords.delete(); } catch(e){} }
    if (dstCoords) { try { dstCoords.delete(); } catch(e){} }
    if (M) { try { M.delete(); } catch(e){} }
  }
}


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
 * 画像からドキュメントの輪郭（4隅）を輪郭検出（findContours）ベースで自動検出する
 * @param srcCanvas 解析元のCanvas
 * @returns 検出された4点。検出できなかった場合はnull
 */
export function detectDocument(srcCanvas: HTMLCanvasElement): Point[] | null {
  const cv = (window as any).cv;
  const width = srcCanvas.width;
  const height = srcCanvas.height;

  if (!cv) return null;

  // 1. 高速化とノイズ抑制のため、画像を縮小して処理する
  const maxDim = 300; // 長辺 300px に超軽量リサイズ
  const scale = maxDim / Math.max(width, height);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);

  const src = cv.imread(srcCanvas);
  const resized = new cv.Mat();
  cv.resize(src, resized, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_AREA);

  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edged = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    // グレースケール化 & ガウシアンブラーで平滑化
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    // Canny法でエッジ抽出
    cv.Canny(blurred, edged, 75, 200);

    // 輪郭同士の接続を強化するため、カーネルサイズ3x3で膨張（Dilate）処理を行う
    const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edged, edged, M);
    M.delete();

    // 輪郭検出
    cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxContourIndex = -1;
    let approx = new cv.Mat();

    // 検出するドキュメントの最小面積しきい値（画像全体の15%以上）
    const minAreaThreshold = (scaledWidth * scaledHeight) * 0.15;

    // 面積が最大で、多角形近似した際に4頂点の凸四角形となるものを探す
    for (let i = 0; i < contours.size(); ++i) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      if (area > minAreaThreshold && area > maxArea) {
        const peri = cv.arcLength(contour, true);
        const tempApprox = new cv.Mat();
        
        // 輪郭の近似化 (アルゴリズムの許容誤差を設定)
        cv.approxPolyDP(contour, tempApprox, 0.02 * peri, true);

        // 4頂点かつ凸多角形であることを確認
        if (tempApprox.rows === 4 && cv.isContourConvex(tempApprox)) {
          maxArea = area;
          maxContourIndex = i;
          approx.delete();
          approx = tempApprox;
        } else {
          tempApprox.delete();
        }
      }
    }

    // 4角形が正しく検出された場合
    if (maxContourIndex !== -1 && approx.rows === 4) {
      const pts: Point[] = [];
      for (let i = 0; i < 4; i++) {
        const x = approx.data32S[i * 2];
        const y = approx.data32S[i * 2 + 1];
        pts.push({
          x: Math.max(0, Math.min(Math.round(x / scale), width)),
          y: Math.max(0, Math.min(Math.round(y / scale), height))
        });
      }
      approx.delete();
      return sortPoints(pts);
    }

    approx.delete();

    // -- フォールバック処理 --
    // きれいな凸四角形が検出できなかった場合、面積が最大である輪郭の
    // 最小境界回転四角形 (minAreaRect) を計算して 4隅を推定する
    maxArea = 0;
    let fallbackContourIndex = -1;
    for (let i = 0; i < contours.size(); ++i) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area > minAreaThreshold && area > maxArea) {
        maxArea = area;
        fallbackContourIndex = i;
      }
    }

    if (fallbackContourIndex !== -1) {
      const contour = contours.get(fallbackContourIndex);
      const rotatedRect = cv.minAreaRect(contour);
      const vertices = cv.RotatedRect.points(rotatedRect);
      const pts: Point[] = [];
      for (let i = 0; i < 4; i++) {
        pts.push({
          x: Math.max(0, Math.min(Math.round(vertices[i].x / scale), width)),
          y: Math.max(0, Math.min(Math.round(vertices[i].y / scale), height))
        });
      }
      return sortPoints(pts);
    }

  } catch (e) {
    console.error("Error in contour document detection: ", e);
  } finally {
    src.delete();
    resized.delete();
    gray.delete();
    blurred.delete();
    edged.delete();
    contours.delete();
    hierarchy.delete();
  }

  return null;
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

  if (mode === 'color') {
    // カラーモード: 紙の陰影ムラを除去（除算）しつつ、インクの鮮やかさを残してガンマ補正をかける
    const channels = new cv.MatVector();
    cv.split(src, channels);
    
    // ガンマ補正用LUTの作成
    const lut = new cv.Mat(1, 256, cv.CV_8UC1);
    const data = new Uint8Array(256);
    
    const gamma = 1.25; // カラーの階調を破綻させず背景を明るくする適正なガンマ値
    const minVal = 20;  // カラーインクの色味を残すために黒引き締めは浅めにする
    const maxVal = 235; // ハイライト（背景の紙）を白へ伸ばすしきい値
    
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

    // RGBの各チャンネルごとに背景除算＋ガンマ補正を適用
    const kernelSize = 33;
    const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));

    for (let c = 0; c < 3; c++) {
      const ch = channels.get(c);
      
      // 背景推定 (膨張 + メディアンフィルタ)
      const dilated = new cv.Mat();
      const bg = new cv.Mat();
      cv.dilate(ch, dilated, M);
      cv.medianBlur(dilated, bg, kernelSize);
      
      // 影ムラを除去（除算）し背景を白く飛ばす
      cv.divide(ch, bg, ch, 255.0);
      
      // ガンマ・レベル補正を適用
      cv.LUT(ch, lut, ch);
      
      dilated.delete();
      bg.delete();
    }

    cv.merge(channels, dst);

    M.delete();
    lut.delete();
    
    // 各チャンネルのメモリ解放
    for (let c = 0; c < channels.size(); c++) {
      const ch = channels.get(c);
      ch.delete();
    }
    channels.delete();
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
    // カーネルサイズを 19 から 33 に拡大し、細い罫線や文字が背景とみなされて消去されるのを防ぐ
    const dilated = new cv.Mat();
    const bg = new cv.Mat();
    const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(33, 33));
    cv.dilate(dst, dilated, M);
    cv.medianBlur(dilated, bg, 33);
    
    // 元画像 / 背景推定画像 の除算 (Division) を行い、陰影ムラを完全に白(255)へ平滑化する
    cv.divide(dst, bg, dst, 255.0);

    // ガンマ補正 & しきい値ストレッチで、背景を完全な白に、文字を完全な黒にする
    const lut = new cv.Mat(1, 256, cv.CV_8UC1);
    const data = new Uint8Array(256);
    
    const gamma = 1.5;  // ガンマ補正を適度に抑え、罫線などの中間トーンの細い線が消えるのを防ぐ
    const minVal = 30;  // 黒の引き締め開始しきい値。少し下げることで、薄い文字もしっかり黒くする
    const maxVal = 225; // 白飛びのしきい値。195から225に引き上げることで、薄いグレー（罫線など）を残す
    
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
export function rotateImage90(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  const src = cv.imread(canvas);
  const dst = new cv.Mat();
  const resultCanvas = document.createElement('canvas');

  // 90度反時計回りに回転
  cv.rotate(src, dst, cv.ROTATE_90_COUNTERCLOCKWISE);
  
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
 * @returns 'color' | 'mono' | 'document'
 */
export function detectOptimalFilter(canvas: HTMLCanvasElement): 'color' | 'mono' | 'document' {
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
    // (紙面の白い部分のノイズ程度なら平均彩度は 3〜8 に収まります。文字や写真に色が入ると15を軽々と超えます)
    if (meanSat > 15) {
      return 'color';
    }

    // 2. モノクロの場合、ドキュメント(白黒はっきり)か、モノクロ写真/イラストかの判定
    // 文字ドキュメントの特徴である「双峰性の輝度分布 (白と黒がはっきり分かれる)」を簡易的に判別するため、
    // グレースケール画像の標準偏差（コントラストの強さ）をチェックする
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    
    let mean = new cv.Mat();
    let stddev = new cv.Mat();
    cv.meanStdDev(gray, mean, stddev);
    
    // stddev.doubleAt(0, 0) で標準偏差を取得
    const stddevVal = stddev.doubleAt(0, 0);
    
    mean.delete();
    stddev.delete();
    gray.delete();

    // 標準偏差が低い（コントラストが弱い、グレーの中間調が多いモノクロ写真など）場合は 'mono'
    // 標準偏差が高い（白と黒のメリハリが強い書類）場合は 'document' を選択
    if (stddevVal < 45) {
      return 'mono';
    }
  } catch (e) {
    console.error("Error in detecting optimal filter: ", e);
  } finally {
    hsv.delete();
    src.delete();
  }

  return 'document';
}


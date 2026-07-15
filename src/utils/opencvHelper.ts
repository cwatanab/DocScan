/**
 * OpenCV.js を用いた画像処理ユーティリティ
 */

export interface Point {
  x: number;
  y: number;
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
 * 画像からドキュメントの輪郭（4隅）をハフ変換（直線検出）ベースで自動検出する
 * @param srcCanvas 解析元のCanvas
 * @returns 検出された4点。検出できなかった場合はnull
 */
export function detectDocument(srcCanvas: HTMLCanvasElement): Point[] | null {
  const cv = (window as any).cv;
  const width = srcCanvas.width;
  const height = srcCanvas.height;

  if (!cv) return null;

  // 1. 高速化のため、一時的に画像を縮小して処理する
  const scale = 500 / Math.max(width, height);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);

  const src = cv.imread(srcCanvas);
  const resized = new cv.Mat();
  cv.resize(src, resized, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_AREA);

  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edged = new cv.Mat();
  const lines = new cv.Mat();

  try {
    // グレースケール化 & ノイズ平滑化
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    // Cannyでエッジを抽出
    cv.Canny(blurred, edged, 50, 150, 3, false);

    // 2. 確率的ハフ変換 (Probabilistic Hough Transform) で直線セグメントを検出
    // 投票数80以上(よりはっきりした線のみ)、最小の長さ60px(文字や短い線を無視)、直線の隙間許容10pxに厳格化
    cv.HoughLinesP(edged, lines, 1, Math.PI / 180, 80, 60, 10);

    const horizontalLines: {x1: number, y1: number, x2: number, y2: number, angle: number}[] = [];
    const verticalLines: {x1: number, y1: number, x2: number, y2: number, angle: number}[] = [];

    // 直線を「水平に近いグループ」と「垂直に近いグループ」に振り分ける
    for (let i = 0; i < lines.rows; ++i) {
      const x1 = lines.data32S[i * 4];
      const y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2];
      const y2 = lines.data32S[i * 4 + 3];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;

      let normAngle = angle;
      if (normAngle > 90) normAngle -= 180;
      if (normAngle < -90) normAngle += 180;

      // ほぼ水平 (傾き -25〜25 度) - 角度条件を少し絞る
      if (Math.abs(normAngle) < 25) {
        horizontalLines.push({ x1, y1, x2, y2, angle: normAngle });
      }
      // ほぼ垂直 (傾き 65〜90 度 または -90〜-65 度) - 角度条件を少し絞る
      else if (Math.abs(normAngle) > 65) {
        verticalLines.push({ x1, y1, x2, y2, angle: normAngle });
      }
    }

    // 3. すべての水平線と垂直線の組み合わせについて、交点 (Intersection) を計算
    const intersections: Point[] = [];
    for (const h of horizontalLines) {
      for (const v of verticalLines) {
        const pt = getLineIntersection(h, v);
        if (pt) {
          // 画面の少し内側（マージン考慮）に収まる交点のみ採用
          if (pt.x >= -20 && pt.x <= scaledWidth + 20 && pt.y >= -20 && pt.y <= scaledHeight + 20) {
            intersections.push(pt);
          }
        }
      }
    }

    // 4. 交点群を画面の「左上・右上・右下・左下」の4象限にクラスタリングする
    if (intersections.length >= 4) {
      const midX = scaledWidth / 2;
      const midY = scaledHeight / 2;

      const qTl: Point[] = [];
      const qTr: Point[] = [];
      const qBr: Point[] = [];
      const qBl: Point[] = [];

      for (const pt of intersections) {
        if (pt.x < midX && pt.y < midY) qTl.push(pt);
        else if (pt.x >= midX && pt.y < midY) qTr.push(pt);
        else if (pt.x >= midX && pt.y >= midY) qBr.push(pt);
        else if (pt.x < midX && pt.y >= midY) qBl.push(pt);
      }

      // 各象限で、最も「画面の四隅」に近い外側の代表的な交点を1点ずつ抽出
      if (qTl.length > 0 && qTr.length > 0 && qBr.length > 0 && qBl.length > 0) {
        const getRepresentativePoint = (pts: Point[], quadrant: 'tl' | 'tr' | 'br' | 'bl'): Point => {
          return pts.reduce((best, curr) => {
            switch (quadrant) {
              case 'tl': return (curr.x + curr.y < best.x + best.y) ? curr : best;
              case 'tr': return (curr.x - curr.y > best.x - best.y) ? curr : best;
              case 'br': return (curr.x + curr.y > best.x + best.y) ? curr : best;
              case 'bl': return (curr.y - curr.x > best.y - best.x) ? curr : best;
            }
          });
        };

        const tl = getRepresentativePoint(qTl, 'tl');
        const tr = getRepresentativePoint(qTr, 'tr');
        const br = getRepresentativePoint(qBr, 'br');
        const bl = getRepresentativePoint(qBl, 'bl');

        const pts = [tl, tr, br, bl].map(pt => ({
          x: Math.round(pt.x / scale),
          y: Math.round(pt.y / scale)
        }));

        const clampedPts = pts.map(pt => ({
          x: Math.max(0, Math.min(pt.x, width)),
          y: Math.max(0, Math.min(pt.y, height))
        }));

        return sortPoints(clampedPts);
      }
    }
  } catch (e) {
    console.error("Error in HoughLines document detection: ", e);
  } finally {
    src.delete();
    resized.delete();
    gray.delete();
    blurred.delete();
    edged.delete();
    lines.delete();
  }

  return null;
}

// 2本の直線の交点を算出する数学的ヘルパー
function getLineIntersection(
  l1: {x1: number, y1: number, x2: number, y2: number},
  l2: {x1: number, y1: number, x2: number, y2: number}
): Point | null {
  const d = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2);
  if (Math.abs(d) < 1e-5) return null; // 平行

  const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / d;
  
  return {
    x: l1.x1 + t * (l1.x2 - l1.x1),
    y: l1.y1 + t * (l1.y2 - l1.y1)
  };
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
    // カラーモード: 紙の影を除去し、インクの色鮮やかさを保ちつつコントラストを最適化する
    const lut = new cv.Mat(1, 256, cv.CV_8UC1);
    const data = new Uint8Array(256);
    
    const gamma = 0.70; // やや明るくし背景を白く飛ばすガンマ値
    const minVal = 35;  // 35以下の暗い部分を黒へ引き締める
    const maxVal = 215; // 215以上の明るい背景を白へ飛ばす
    
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

    // RGB チャンネルを分割し、個別にレベル&ガンマ補正テーブルを適用 (Aチャンネルは除外)
    const channels = new cv.MatVector();
    cv.split(src, channels);
    for (let c = 0; c < 3; c++) {
      const ch = channels.get(c);
      cv.LUT(ch, lut, ch);
    }
    cv.merge(channels, dst);

    lut.delete();
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
    const dilated = new cv.Mat();
    const bg = new cv.Mat();
    const M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(19, 19));
    cv.dilate(dst, dilated, M);
    cv.medianBlur(dilated, bg, 19);
    
    // 元画像 / 背景推定画像 の除算 (Division) を行い、陰影ムラを完全に白(255)へ平滑化する
    // これにより黒枠やゴミ等の外れ値の影響を受けずに、文字のコントラストが最大化される
    cv.divide(dst, bg, dst, 255.0);

    // ガンマ補正 & しきい値ストレッチで、背景を完全な白に、文字を完全な黒にする
    const lut = new cv.Mat(1, 256, cv.CV_8UC1);
    const data = new Uint8Array(256);
    
    const gamma = 2.4;  // ガンマ値のみを大幅に引き上げ、階調を潰さずに中間トーン(文字)を漆黒へ引き締める
    const minVal = 45;  // 黒にするしきい値は上げず、元の穏やかな範囲に維持
    const maxVal = 195; // 白にするしきい値は上げず、元の穏やかな範囲に維持
    
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
 * 画像を90度時計回りに回転させる
 * @param canvas 回転対象のCanvas
 * @returns 回転後の新しいCanvas
 */
export function rotateImage90(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cv = (window as any).cv;
  if (!cv) return canvas;

  const src = cv.imread(canvas);
  const dst = new cv.Mat();
  const resultCanvas = document.createElement('canvas');

  // 90度時計回りに回転
  cv.rotate(src, dst, cv.ROTATE_90_CLOCKWISE);
  
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

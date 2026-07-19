import type { OcrResult } from './ocrHelper';

/**
 * OCRテキスト情報と座標データを元に、画像を非表示にしてテキストのみを元のレイアウト通りに配置したHTMLドキュメントを生成する
 * (レスポンシブなコンテナクエリを使用し、画面幅に合わせて完璧にスケーリングされます)
 */
export function createReproducedHtml(
  pages: { ocrResult?: OcrResult }[]
): string {
  let html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>再現ドキュメント - DocScan</title>
  <style>
    :root {
      --bg-color: #f8fafc;
      --page-bg: #ffffff;
      --text-color: #0f172a;
      --border-color: #e2e8f0;
      --shadow-color: rgba(15, 23, 42, 0.08);
    }

    body {
      margin: 0;
      padding: 40px 20px;
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    /* 印刷時の設定 */
    @media print {
      body {
        background-color: transparent;
        padding: 0;
      }
      .page-container {
        box-shadow: none !important;
        border: none !important;
        margin: 0 auto !important;
        page-break-after: always;
      }
    }

    /* ページコンテナ */
    .page-container {
      position: relative;
      background-color: var(--page-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-shadow: 0 10px 25px -5px var(--shadow-color), 0 8px 10px -6px var(--shadow-color);
      margin: 0 auto 40px auto;
      width: 100%;
      max-width: 850px; /* 標準的な閲覧サイズ */
      box-sizing: border-box;
      container-type: inline-size; /* コンテナクエリを有効化 */
      overflow: hidden;
    }

    /* 文字列要素 (絶対配置) */
    .ocr-element {
      position: absolute;
      box-sizing: border-box;
      white-space: nowrap;
      line-height: 1.1;
      transform-origin: left top;
      color: var(--text-color);
      display: flex;
      align-items: center;
    }

    /* デバッグ用：枠線を薄く見せたい場合のスタイル */
    /* .ocr-element:hover { background-color: rgba(16, 185, 129, 0.08); } */
  </style>
</head>
<body>
`;

  pages.forEach((pageData, index) => {
    const { ocrResult } = pageData;
    
    // OCR結果がない、またはサイズが取得できない場合はデフォルトのアスペクト比(A4)を設定
    const imgW = ocrResult?.width || 1200;
    const imgH = ocrResult?.height || 1697;

    html += `  <!-- ページ ${index + 1} -->\n`;
    html += `  <div class="page-container" style="aspect-ratio: ${imgW} / ${imgH};">\n`;

    if (ocrResult && ocrResult.words.length > 0) {
      ocrResult.words.forEach((word) => {
        if (!word.text.trim()) return;

        const x0 = word.bbox.x0;
        const y0 = word.bbox.y0;
        const x1 = word.bbox.x1;
        const y1 = word.bbox.y1;

        const wPixel = x1 - x0;
        const hPixel = y1 - y0;

        // 全体の幅・高さに対するパーセンテージ位置を算出 (レスポンシブ対応)
        const leftPercent = (x0 / imgW) * 100;
        const topPercent = (y0 / imgH) * 100;
        const widthPercent = (wPixel / imgW) * 100;
        const heightPercent = (hPixel / imgH) * 100;

        // フォントサイズはコンテナ幅に対する割合 (cqw 単位) で指定することで、拡大縮小に追従
        // 文字の高さ (hPixel) を元画像の幅 (imgW) に対する割合で示し、フォントのはみ出しを防ぐため 0.70 倍に調整
        const fontSizeCqw = (hPixel / imgW) * 100 * 0.70;

        // 特殊文字のエスケープ
        const escapedText = escapeHtml(word.text);

        html += `    <div class="ocr-element" style="left: ${leftPercent.toFixed(3)}%; top: ${topPercent.toFixed(3)}%; width: ${widthPercent.toFixed(3)}%; height: ${heightPercent.toFixed(3)}%; font-size: ${fontSizeCqw.toFixed(3)}cqw;">${escapedText}</div>\n`;
      });
    } else {
      html += `    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #94a3b8; font-style: italic; font-size: 2cqw;">このページのOCRテキストデータはありません</div>\n`;
    }

    html += `  </div>\n`;
  });

  html += `</body>
</html>`;

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

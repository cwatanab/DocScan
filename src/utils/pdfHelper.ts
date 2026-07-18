import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { OcrResult } from './ocrHelper';

// 日本語フォントをロードするヘルパー（ローカル優先、失敗時はCDNにフォールバック）
async function loadJapaneseFont(): Promise<{ bytes: ArrayBuffer; isOtf: boolean }> {
  const localPath = '/fonts/NotoSansJP-Regular.ttf';
  const cdnUrl = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf';

  try {
    const res = await fetch(localPath);
    const contentType = res.headers.get('content-type');
    // SPAのルーティングフォールバック等により、存在しないファイルに対してHTMLが返されるのを防ぐため、text/htmlは除外します
    if (res.ok && contentType && !contentType.includes('text/html')) {
      const bytes = await res.arrayBuffer();
      return { bytes, isOtf: false };
    }
  } catch (e) {
    console.warn('Failed to load local Japanese font, falling back to CDN:', e);
  }

  const res = await fetch(cdnUrl);
  const contentType = res.headers.get('content-type');
  if (!res.ok || (contentType && contentType.includes('text/html'))) {
    throw new Error('Failed to fetch Japanese font from both local and CDN (invalid response)');
  }
  const bytes = await res.arrayBuffer();
  return { bytes, isOtf: true };
}

// PDF用に画像を長辺1600pxにリサイズし、画質90%のJPEGとして再圧縮する
async function compressImageForPdf(imageSrc: string, maxDimension: number = 1600): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (Math.max(img.width, img.height) <= maxDimension) {
        resolve(imageSrc);
        return;
      }

      const scale = maxDimension / Math.max(img.width, img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        // JPEG品質 95% で出力
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } else {
        resolve(imageSrc);
      }
    };
    img.onerror = () => resolve(imageSrc);
    img.src = imageSrc;
  });
}

/**
 * スキャンされた複数の補正画像とOCR結果を結合して、サーチャブルPDFを生成する
 * @param pages 補正済み画像(DataURL形式)とそれぞれのOCR結果の配列
 * @returns PDFのBlob
 */
export async function createSearchablePdf(
  pages: { imageSrc: string; ocrResult?: OcrResult }[]
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  // fontkitを登録
  pdfDoc.registerFontkit(fontkit);

  // 日本語フォントをロードして埋め込む（サブセット化を有効にし、ファイルサイズ肥大化を防ぎます）
  // ※ OTF形式の場合はfontkitのバグで破損するため、サブセット化を無効化します
  let jpFont: any;
  try {
    const { bytes, isOtf } = await loadJapaneseFont();
    jpFont = await pdfDoc.embedFont(bytes, { subset: !isOtf });
  } catch (e) {
    console.error('Failed to embed Japanese font, falling back to Helvetica:', e);
    jpFont = await pdfDoc.embedFont('Helvetica');
  }

  for (const pageData of pages) {
    const { imageSrc, ocrResult } = pageData;

    // PDF埋め込み用に画質を設定し、高画質な1600px JPEGに変換する
    const compressedSrc = await compressImageForPdf(imageSrc, 1600);

    // 画像データの埋め込み (PNG / JPEG の自動判定)
    let image: any;
    if (compressedSrc.startsWith('data:image/png')) {
      image = await pdfDoc.embedPng(compressedSrc);
    } else {
      image = await pdfDoc.embedJpg(compressedSrc);
    }

    const { width: imgWidth, height: imgHeight } = image.scale(1.0);

    // 新しいページを追加 (画像のサイズに合わせる)
    const page = pdfDoc.addPage([imgWidth, imgHeight]);

    // 1. 画像を背景として描画
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: imgWidth,
      height: imgHeight,
    });

    // 2. OCR結果が存在する場合、透明テキストを重ねる
    if (ocrResult && ocrResult.words.length > 0) {
      const { words, width: ocrWidth, height: ocrHeight } = ocrResult;
      
      // OCR解像度とPDF解像度の比率を計算
      const scaleX = imgWidth / ocrWidth;
      const scaleY = imgHeight / ocrHeight;

      for (const word of words) {
        if (!word.text.trim()) continue;

        // OCRのバウンディングボックス位置
        const x = word.bbox.x0 * scaleX;
        const y = imgHeight - (word.bbox.y1 * scaleY); // PDFは左下が原点なので反転
        const wordHeight = (word.bbox.y1 - word.bbox.y0) * scaleY;

        // フォントサイズの設定 (ボックスの高さに合わせる)
        const fontSize = Math.max(wordHeight * 0.8, 4);

        try {
          // テキストを描画 (不透明度 0 で透明にし、かつ座標とサイズを合わせる)
          // 日本語対応フォントで描画することにより、PDF上で日本語の選択・コピー・検索が可能になります
          page.drawText(word.text, {
            x: x,
            y: y,
            size: fontSize,
            font: jpFont,
            color: rgb(0, 0, 0),
            opacity: 0.0, // 見えないが、PDF上で選択・コピー・検索が可能
          });
        } catch (e) {
          console.warn(`Could not draw word text "${word.text}":`, e);
        }
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes] as any, { type: 'application/pdf' });
}

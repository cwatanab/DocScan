/**
 * 画像エクスポート用の共通ユーティリティヘルパー
 */

export type ExportFormat = 'png' | 'jpeg';

/**
 * 撮影日時のタイムスタンプ文字列 (YYYYMMDD_HHMMSS) を生成する
 */
export const getFormattedTimestamp = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
};

/**
 * Blobデータをブラウザでダウンロード実行する共通処理
 */
export const triggerBlobDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * メモリー節約とクラッシュ防止のため、Canvasを指定の最大辺 maxDim に縮小するヘルパー
 */
export const resizeCanvas = (srcCanvas: HTMLCanvasElement, maxDim: number): HTMLCanvasElement => {
  const dstCanvas = document.createElement('canvas');
  let w = srcCanvas.width;
  let h = srcCanvas.height;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  dstCanvas.width = w;
  dstCanvas.height = h;
  const ctx = dstCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(srcCanvas, 0, 0, w, h);
  }
  return dstCanvas;
};

/**
 * 既存の Canvas にリサイズ描画するヘルパー。新規Canvasの作成を抑え、GC負荷を軽減します。
 */
export const resizeCanvasTo = (
  srcCanvas: HTMLCanvasElement,
  dstCanvas: HTMLCanvasElement,
  maxDim: number
): void => {
  let w = srcCanvas.width;
  let h = srcCanvas.height;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  // iOS Safari 対策: 同じサイズの場合は width/height の再設定をスキップして、描画バッファのリセットや真っ黒化を防ぐ
  if (dstCanvas.width !== w || dstCanvas.height !== h) {
    dstCanvas.width = w;
    dstCanvas.height = h;
  }
  const ctx = dstCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(srcCanvas, 0, 0, w, h);
  }
};

/**
 * DataURL画像を256色（インデックスカラー相当）に量子化減色した PNG Blobに変換する
 */
export const convertToPngBlob = async (imageSrc: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const maxDim = 1920;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        // 【必須仕様】8bit/256色への均等量子化減色 (R:3bit, G:3bit, B:2bit)
        // 激しい等高線状 of ブロックノイズ（バンディング）を抑制するため、確率的ディザリングを適用
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const rNoise = (Math.random() - 0.5) * 36;
          const gNoise = (Math.random() - 0.5) * 36;
          const bNoise = (Math.random() - 0.5) * 85;

          data[i] = Math.max(0, Math.min(255, Math.round((data[i] + rNoise) / 36) * 36));
          data[i+1] = Math.max(0, Math.min(255, Math.round((data[i+1] + gNoise) / 36) * 36));
          data[i+2] = Math.max(0, Math.min(255, Math.round((data[i+2] + bNoise) / 85) * 85));
        }
        ctx.putImageData(imgData, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("PNG blob generation failed"));
          }
        }, 'image/png');
      } else {
        reject(new Error("Canvas context failed"));
      }
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = imageSrc;
  });
};

/**
 * DataURL画像を画質95%のJPEG Blobに変換する
 */
export const convertToJpegBlob = async (imageSrc: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const maxDim = 1920;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("JPEG blob generation failed"));
          }
        }, 'image/jpeg', 0.95);
      } else {
        reject(new Error("Canvas context failed"));
      }
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = imageSrc;
  });
};

/**
 * DataURL画像(PNG等)をJPEGのFileオブジェクトに変換する
 */
export const convertToJpegFile = async (imageSrc: string, filename: string): Promise<File> => {
  const blob = await convertToJpegBlob(imageSrc);
  return new File([blob], filename, { type: 'image/jpeg' });
};

/**
 * 指定したフォーマットで画像をBlobに変換する
 */
export const convertToBlob = async (imageSrc: string, format: ExportFormat): Promise<Blob> => {
  if (format === 'png') {
    return convertToPngBlob(imageSrc);
  } else {
    return convertToJpegBlob(imageSrc);
  }
};

/**
 * 単一ページを指定のフォーマットでダウンロード保存する
 */
export const downloadSinglePage = async (
  imageSrc: string,
  index: number,
  format: ExportFormat,
  timestamp?: string
): Promise<void> => {
  const ts = timestamp || getFormattedTimestamp();
  const ext = format === 'png' ? 'png' : 'jpg';
  const blob = await convertToBlob(imageSrc, format);
  triggerBlobDownload(blob, `SCAN_${ts}_${String(index + 1).padStart(3, '0')}.${ext}`);
};

/**
 * 全ページを指定のフォーマットで順次ダウンロード保存する (ブラウザフリーズ防止用の間隔あり)
 */
export const downloadAllPages = async (
  pages: string[],
  format: ExportFormat
): Promise<void> => {
  const timestamp = getFormattedTimestamp();
  for (let i = 0; i < pages.length; i++) {
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          await downloadSinglePage(pages[i], i, format, timestamp);
        } catch (err) {
          console.error(`Failed to download page ${i + 1} as ${format}:`, err);
        }
        resolve();
      }, i * 300);
    });
  }
};

/**
 * 単一ページを共有する (共有API非対応時はダウンロードにフォールバック)
 */
export const shareSinglePage = async (
  imageSrc: string,
  index: number,
  format: ExportFormat
): Promise<void> => {
  const ts = getFormattedTimestamp();
  const ext = format === 'png' ? 'png' : 'jpg';
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const fileName = `SCAN_${ts}_${String(index + 1).padStart(3, '0')}.${ext}`;
  
  try {
    const blob = await convertToBlob(imageSrc, format);
    const file = new File([blob], fileName, { type: mime });
    
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
      });
    } else {
      await downloadSinglePage(imageSrc, index, format, ts);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return;
    }
    console.error("Failed to share page:", err);
    await downloadSinglePage(imageSrc, index, format, ts);
  }
};

/**
 * 全ページを一括で共有する (共有API非対応時はダウンロードにフォールバック)
 */
export const shareAllPages = async (
  pages: string[],
  format: ExportFormat
): Promise<void> => {
  const timestamp = getFormattedTimestamp();
  const ext = format === 'png' ? 'png' : 'jpg';
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const filesList: File[] = [];

  try {
    for (let i = 0; i < pages.length; i++) {
      const fileName = `SCAN_${timestamp}_${String(i + 1).padStart(3, '0')}.${ext}`;
      const blob = await convertToBlob(pages[i], format);
      const file = new File([blob], fileName, { type: mime });
      filesList.push(file);
    }

    if (navigator.canShare && navigator.canShare({ files: filesList })) {
      await navigator.share({
        files: filesList,
      });
    } else {
      await downloadAllPages(pages, format);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return;
    }
    console.error("Failed to share pages:", err);
    await downloadAllPages(pages, format);
  }
};

/**
 * PWA キャッシュと登録済み Service Worker を完全に削除し、アプリを強制再読み込みする
 */
export const clearAppCacheAndReload = async (): Promise<void> => {
  try {
    // 1. キャッシュストレージの全消去
    if (window.caches) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
    // 2. Service Worker の全解除
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }
  } catch (e) {
    console.error("Error clearing app cache:", e);
  } finally {
    // 強制的にサーバーから最新ソースを取得してリロード
    window.location.reload();
  }
};

/**
 * 現在のホスト名がローカル実行（localhost, 127.0.0.1, またはプライベートIPアドレス等）であるかを判定する
 */
export const isLocalExecution = (): boolean => {
  const hn = window.location.hostname;
  return (
    hn === 'localhost' ||
    hn === '127.0.0.1' ||
    hn.startsWith('192.168.') ||
    hn.startsWith('172.') ||
    hn.startsWith('10.') ||
    hn.endsWith('.local')
  );
};

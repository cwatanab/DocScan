/**
 * 画像エクスポート用の共通ユーティリティヘルパー
 */

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
 * DataURL画像を256色（インデックスカラー相当）に量子化減色したPNG Blobに変換する
 */
export const convertToPngBlob = async (imageSrc: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        
        // 256色への均等量子化減色 (R:3bit, G:3bit, B:2bit)
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.round(data[i] / 36) * 36;
          data[i+1] = Math.round(data[i+1] / 36) * 36;
          data[i+2] = Math.round(data[i+2] / 85) * 85;
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
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
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

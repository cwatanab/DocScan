/**
 * OCR 結果の型定義
 */

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
  width: number;
  height: number;
}

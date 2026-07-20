/**
 * OCR ユーティリティ（公開 API の集約）
 *
 * 実装は utils/ocr/ 以下に分割。既存の import パス互換のためこのファイルから再エクスポートする。
 */

export type { OcrWord, OcrResult } from './ocr/types';
export { performOcr } from './ocr/perform';

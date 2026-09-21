/**
 * OpenCV.js を用いた画像処理ユーティリティ（公開 API の集約）
 *
 * 実装は utils/opencv/ 以下に分割。既存の import パス互換のためこのファイルから再エクスポートする。
 */

export type { Point } from './geometry';
export { sortPoints, distance, checkShapeValidity } from './geometry';
export { refineDocumentCorners, type RefineCornersOptions } from './cornerRefinement';

export type { FilterMode } from './filterMode';

export { loadOpenCV, isOpenCvReady } from './opencv/load';
export { applyFilterToMat, applyFilter, detectOptimalFilter } from './opencv/filters';
export { warpImage, rotateImage90, processWarpAndFilter } from './opencv/warp';
export { processUnwarpAndFilter, unwarpDocumentAI } from './unwarpHelper';
export { calculateFocusScore } from './opencv/focus';
export {
  calculateMeanLuma,
  calculateLumaStats,
  evaluateCaptureQuality,
  assessCanvasCaptureQuality,
  assessDocumentCaptureQuality,
  cropDocumentRoi,
  getCaptureQualityGuidance,
  QUALITY_FRAME_COLORS
} from './opencv/quality';
export type {
  CaptureQuality,
  CaptureQualityLevel,
  CaptureQualityReason
} from './opencv/quality';

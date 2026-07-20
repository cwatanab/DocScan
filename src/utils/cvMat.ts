/**
 * OpenCV.js の Mat / MatVector を安全に解放するヘルパー
 */

/** delete() 可能な OpenCV オブジェクトの最小インターフェース */
export type CvDeletable = { delete: () => void } | null | undefined;

/**
 * 単一の Mat などを安全に delete する。
 * 既に解放済み・null の場合は何もしない。
 */
export function safeDelete(mat: CvDeletable): void {
  if (!mat) return;
  try {
    mat.delete();
  } catch {
    // 二重解放や無効オブジェクトは無視
  }
}

/**
 * 複数の Mat をまとめて解放する。
 */
export function safeDeleteAll(...mats: CvDeletable[]): void {
  for (const mat of mats) {
    safeDelete(mat);
  }
}

/**
 * MatVector とその中身を解放する。
 */
export function safeDeleteMatVector(vector: { size: () => number; get: (i: number) => CvDeletable; delete: () => void } | null | undefined): void {
  if (!vector) return;
  try {
    for (let i = 0; i < vector.size(); i++) {
      safeDelete(vector.get(i));
    }
  } catch {
    // size()/get() 失敗時は vector 本体のみ解放を試みる
  }
  safeDelete(vector);
}

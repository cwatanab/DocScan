/**
 * localStorage の JSON 読み書きヘルパー
 */

/**
 * localStorage から JSON を読み取る。失敗時や未設定時は defaultValue を返す。
 */
export function loadJson<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * localStorage に JSON を書き込む。失敗時は警告のみ。
 */
export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to persist localStorage key "${key}":`, e);
  }
}

/** OCR 有効化の永続化キー */
export const STORAGE_KEY_ENABLE_OCR = 'docscan_enable_ocr';

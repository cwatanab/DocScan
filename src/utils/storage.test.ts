import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loadJson, saveJson, STORAGE_KEY_ENABLE_OCR } from './storage';

/** Minimal localStorage polyfill for Bun test runtime */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    }
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: mock
  });
  return store;
}

describe('loadJson / saveJson', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorageMock();
  });

  afterEach(() => {
    store.clear();
  });

  test('returns default when key is missing', () => {
    expect(loadJson('missing_key', false)).toBe(false);
    expect(loadJson('missing_key', { a: 1 })).toEqual({ a: 1 });
  });

  test('round-trips boolean OCR preference under the real storage key', () => {
    saveJson(STORAGE_KEY_ENABLE_OCR, true);
    expect(store.get(STORAGE_KEY_ENABLE_OCR)).toBe('true');
    expect(loadJson(STORAGE_KEY_ENABLE_OCR, false)).toBe(true);

    saveJson(STORAGE_KEY_ENABLE_OCR, false);
    expect(loadJson(STORAGE_KEY_ENABLE_OCR, true)).toBe(false);
  });

  test('round-trips objects via JSON', () => {
    saveJson('docscan_test_obj', { pages: 2, mode: 'pdf' });
    expect(loadJson('docscan_test_obj', null)).toEqual({ pages: 2, mode: 'pdf' });
  });

  test('returns default when stored value is invalid JSON', () => {
    store.set('broken', '{not-json');
    expect(loadJson('broken', 'fallback')).toBe('fallback');
  });
});

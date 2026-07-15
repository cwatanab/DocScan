export interface ScannedDoc {
  id: string;
  title: string;
  createdAt: number;
  pages: string[]; // 補正画像 (DataURL) の配列
}

const DB_NAME = 'DocumentScanDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

// ドキュメントを全取得
export async function getAllDocuments(): Promise<ScannedDoc[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      // 日付の降順（新しい順）にソートして返す
      const docs = request.result as ScannedDoc[];
      docs.sort((a, b) => b.createdAt - a.createdAt);
      resolve(docs);
    };
  });
}

// ドキュメントを保存・更新
export async function saveDocument(doc: ScannedDoc): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(doc);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// ドキュメントを削除
export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

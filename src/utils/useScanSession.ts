import { useState } from 'react';
import type { Point, FilterMode } from './opencvHelper';
import { performOcr } from './ocrHelper';
import type { OcrResult } from './ocrHelper';

export type Step = 'scan' | 'edit' | 'export';

export interface FlyingImage {
  src: string;
  rect: DOMRect;
}

export function useScanSession() {
  const [step, setStep] = useState<Step>('scan');
  const [currentRawImage, setCurrentRawImage] = useState<string | null>(null);
  const [currentCorners, setCurrentCorners] = useState<Point[]>([]);
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [scannedPageFilterModes, setScannedPageFilterModes] = useState<FilterMode[]>([]);
  const [currentFilterMode, setCurrentFilterMode] = useState<FilterMode>(() => {
    try {
      const saved = localStorage.getItem('docscan_current_filter_mode');
      return (saved as FilterMode) || 'document_enhanced';
    } catch {
      return 'document_enhanced';
    }
  });
  const [ocrResults, setOcrResults] = useState<{ [key: number]: OcrResult }>({});
  const [exportMode, setExportMode] = useState<'pdf' | 'jpeg'>('pdf');
  const [initialIsWarped, setInitialIsWarped] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [flyingImage, setFlyingImage] = useState<FlyingImage | null>(null);

  // セッションを初期化し、最初のスキャン画面に戻る
  const startNewScan = () => {
    setScannedPages([]);
    setOcrResults({});
    setScannedPageFilterModes([]);
    setCurrentRawImage(null);
    setStep('scan');
  };

  // カメラスキャン画面での撮影完了時の処理
  const capture = (imageSrc: string, corners: Point[]) => {
    setCurrentRawImage(imageSrc);
    setCurrentCorners(corners);
    setInitialIsWarped(false); // トリミング調整から開始する
    
    // 保存されているデフォルトフィルターモードをロードする
    try {
      const saved = localStorage.getItem('docscan_current_filter_mode');
      setCurrentFilterMode((saved as FilterMode) || 'document_enhanced');
    } catch {
      setCurrentFilterMode('document_enhanced');
    }
    
    setStep('edit');
  };

  // 編集画面での決定時の処理
  const savePage = async (
    warpedImageSrc: string,
    filterMode: FilterMode,
    enableOcr: boolean,
    corners: Point[],
    rect?: DOMRect | null
  ) => {
    setCurrentCorners(corners); // ユーザーが調整した座標を履歴保存用に上書き
    setExportMode(enableOcr ? 'pdf' : 'jpeg');
    setCurrentFilterMode(filterMode);
    
    try {
      localStorage.setItem('docscan_current_filter_mode', filterMode);
    } catch (e) {
      console.warn("Failed to persist filter mode state:", e);
    }

    setScannedPageFilterModes(prev => [...prev, filterMode]);

    if (rect) {
      setFlyingImage({
        src: warpedImageSrc,
        rect
      });
      // 0.65秒後に飛行画像をフェードアウトさせてクリアする
      setTimeout(() => {
        setFlyingImage(null);
      }, 650);
    }

    if (enableOcr) {
      setIsOcrLoading(true);
      try {
        const index = scannedPages.length;
        const ocrResult = await performOcr(warpedImageSrc);
        setOcrResults(prev => ({ ...prev, [index]: ocrResult }));
      } catch (err) {
        console.error("OCR failed during savePage:", err);
      } finally {
        setIsOcrLoading(false);
      }
    }
    
    setScannedPages(prev => [...prev, warpedImageSrc]);
    setStep('export'); // 確定後は即座にプレビュー画面に進む
  };

  // 編集画面でのキャンセル時の処理
  const cancelEdit = () => {
    setCurrentRawImage(null); // 一時生画像のキャッシュをクリアする
    if (scannedPages.length > 0) {
      setStep('export'); // スキャン済ページがある場合はエクスポート画面に戻る
    } else {
      setStep('scan'); // ない場合はカメラ画面に戻る
    }
  };

  // エクスポート完了時の処理
  const exportComplete = () => {
    startNewScan();
  };

  // プレビュー画面からカメラ画面に戻る処理
  const backToScanner = () => {
    setCurrentRawImage(null); // 再撮影用に一時キャッシュをクリアする
    setStep('scan');
  };

  // プレビュー画面から再編集に戻る処理
  const backToEdit = () => {
    // 直前に確定したページとOCR結果を取り除く
    setOcrResults(prev => {
      const next = { ...prev };
      delete next[scannedPages.length - 1];
      return next;
    });
    setScannedPages(prev => prev.slice(0, -1));

    // 最後のページのフィルターモードを復元して配列から削る
    setScannedPageFilterModes(prev => {
      const lastMode = prev[prev.length - 1] || 'document_enhanced';
      setCurrentFilterMode(lastMode);
      return prev.slice(0, -1);
    });

    setInitialIsWarped(true); // フィルター適用画面に戻す
    setStep('edit');
  };

  return {
    step,
    currentRawImage,
    currentCorners,
    scannedPages,
    scannedPageFilterModes,
    ocrResults,
    exportMode,
    initialIsWarped,
    isOcrLoading,
    flyingImage,
    currentFilterMode,
    startNewScan,
    capture,
    savePage,
    cancelEdit,
    exportComplete,
    backToScanner,
    backToEdit
  };
}

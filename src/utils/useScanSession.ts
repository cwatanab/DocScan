import { useState, useCallback, useRef, useEffect } from 'react';
import type { Point } from './geometry';
import type { FilterMode } from './filterMode';
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
  const [currentFilterMode, setCurrentFilterMode] = useState<FilterMode>('document_enhanced');
  const [ocrResults, setOcrResults] = useState<{ [key: number]: OcrResult }>({});
  const [exportMode, setExportMode] = useState<'pdf' | 'jpeg'>('pdf');
  const [initialIsWarped, setInitialIsWarped] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [flyingImage, setFlyingImage] = useState<FlyingImage | null>(null);

  const scannedPagesRef = useRef(scannedPages);
  scannedPagesRef.current = scannedPages;

  const flyingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // アンマウント時に飛行アニメのタイマーを確実に解除する
  useEffect(() => {
    return () => {
      if (flyingTimerRef.current !== null) {
        clearTimeout(flyingTimerRef.current);
        flyingTimerRef.current = null;
      }
    };
  }, []);

  const clearFlyingTimer = useCallback(() => {
    if (flyingTimerRef.current !== null) {
      clearTimeout(flyingTimerRef.current);
      flyingTimerRef.current = null;
    }
  }, []);

  const dismissOcrError = useCallback(() => {
    setOcrError(null);
  }, []);

  const startNewScan = useCallback(() => {
    clearFlyingTimer();
    setScannedPages([]);
    setOcrResults({});
    setScannedPageFilterModes([]);
    setCurrentRawImage(null);
    setOcrError(null);
    setFlyingImage(null);
    setStep('scan');
  }, [clearFlyingTimer]);

  const capture = useCallback((imageSrc: string, corners: Point[]) => {
    setCurrentRawImage(imageSrc);
    setCurrentCorners(corners);
    setInitialIsWarped(false);
    setCurrentFilterMode('document_enhanced');
    setOcrError(null);
    setStep('edit');
  }, []);

  const savePage = useCallback(
    async (
      warpedImageSrc: string,
      filterMode: FilterMode,
      enableOcr: boolean,
      corners: Point[],
      rect?: DOMRect | null
    ) => {
      setCurrentCorners(corners);
      setExportMode(enableOcr ? 'pdf' : 'jpeg');
      setCurrentFilterMode(filterMode);
      setOcrError(null);

      // 確定前の長さを基準にインデックスを決める（連打時のズレを防ぐ）
      const pageIndex = scannedPagesRef.current.length;
      setScannedPageFilterModes((prev) => [...prev, filterMode]);

      if (rect) {
        clearFlyingTimer();
        setFlyingImage({ src: warpedImageSrc, rect });
        flyingTimerRef.current = setTimeout(() => {
          setFlyingImage(null);
          flyingTimerRef.current = null;
        }, 650);
      }

      if (enableOcr) {
        setIsOcrLoading(true);
        try {
          const ocrResult = await performOcr(warpedImageSrc);
          setOcrResults((prev) => ({ ...prev, [pageIndex]: ocrResult }));
        } catch (err) {
          console.error('OCR failed during savePage:', err);
          setOcrError(
            'OCR解析に失敗しました。画像の保存は完了していますが、検索可能な文字情報は埋め込まれていません。'
          );
        } finally {
          setIsOcrLoading(false);
        }
      }

      setScannedPages((prev) => [...prev, warpedImageSrc]);
      setStep('export');
    },
    [clearFlyingTimer]
  );

  const cancelEdit = useCallback(() => {
    setCurrentRawImage(null);
    setStep(scannedPagesRef.current.length > 0 ? 'export' : 'scan');
  }, []);

  const exportComplete = useCallback(() => {
    startNewScan();
  }, [startNewScan]);

  const backToScanner = useCallback(() => {
    setCurrentRawImage(null);
    setOcrError(null);
    setStep('scan');
  }, []);

  const backToEdit = useCallback(() => {
    const lastIndex = scannedPagesRef.current.length - 1;
    setOcrResults((prev) => {
      const next = { ...prev };
      delete next[lastIndex];
      return next;
    });
    setScannedPages((prev) => prev.slice(0, -1));

    setScannedPageFilterModes((prev) => {
      const lastMode = prev[prev.length - 1] || 'document_enhanced';
      setCurrentFilterMode(lastMode);
      return prev.slice(0, -1);
    });

    setOcrError(null);
    setInitialIsWarped(true);
    setStep('edit');
  }, []);

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
    ocrError,
    dismissOcrError,
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

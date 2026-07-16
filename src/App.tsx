import { useState } from 'react';
import { CameraScanner } from './components/CameraScanner';
import { DocumentEditor } from './components/DocumentEditor';
import { ExportPreview } from './components/ExportPreview';
import type { Point } from './utils/opencvHelper';

type Step = 'scan' | 'edit' | 'export';

export default function App() {
  // アプリ起動時の画面を「カメラスキャン画面（scan）」に設定
  const [step, setStep] = useState<Step>('scan');
  
  // スキャン中のセッション状態
  const [currentRawImage, setCurrentRawImage] = useState<string | null>(null);
  const [currentCorners, setCurrentCorners] = useState<Point[]>([]);
  const [scannedPages, setScannedPages] = useState<string[]>([]); // 補正済画像のリスト
  const [exportMode, setExportMode] = useState<'pdf' | 'jpeg'>('pdf'); // エクスポートモードの保存（トグルの状態を反映）
  const [initialIsWarped, setInitialIsWarped] = useState(false);

  // トランジション飛行画像（確定時のアニメーション）用の状態
  const [flyingImage, setFlyingImage] = useState<{
    src: string;
    rect: DOMRect;
  } | null>(null);

  // 新規スキャン開始 (セッションリセット)
  const handleStartNewScan = () => {
    setScannedPages([]);
    setCurrentRawImage(null);
    setStep('scan');
  };

  // 画像キャプチャ完了
  const handleCapture = (imageSrc: string, corners: Point[]) => {
    setCurrentRawImage(imageSrc);
    setCurrentCorners(corners);
    setInitialIsWarped(false); // 新規撮影時は必ずピン調整から始める
    setStep('edit');
  };

  // 編集完了（台形補正・フィルタ適用済み）
  const handleSavePage = (
    warpedImageSrc: string,
    _filterMode: 'color' | 'document',
    enableOcr: boolean,
    rect?: DOMRect | null
  ) => {
    setScannedPages(prev => [...prev, warpedImageSrc]);
    setExportMode(enableOcr ? 'pdf' : 'jpeg');

    if (rect) {
      setFlyingImage({
        src: warpedImageSrc,
        rect
      });
      // 0.65秒後に飛行画像をフェードアウトさせてクリア
      setTimeout(() => {
        setFlyingImage(null);
      }, 650);
    }
    
    setStep('export'); // 確定後はダイアログを挟まず、即座にエクスポート画面に進む
  };

  // エクスポート完了 (一時メモリをクリアし、即座に最初のカメラスキャン画面に戻る)
  const handleExportComplete = () => {
    handleStartNewScan();
  };

  return (
    <div className="app-layout">
      {step === 'scan' && (
        <CameraScanner
          onCapture={handleCapture}
        />
      )}

      {step === 'edit' && currentRawImage && (
        <DocumentEditor
          imageSrc={currentRawImage}
          initialCorners={currentCorners}
          onSave={handleSavePage}
          onCancel={() => {
            setCurrentRawImage(null); // 一時生画像のキャッシュのみクリア
            if (scannedPages.length > 0) {
              setStep('export'); // スキャン済ページがある場合はエクスポートプレビューに戻る
            } else {
              setStep('scan'); // スキャン済ページがない場合はカメラに戻る
            }
          }}
          initialIsWarped={initialIsWarped}
        />
      )}

      {step === 'export' && (
        <ExportPreview
          pages={scannedPages}
          exportMode={exportMode}
          onComplete={handleExportComplete}
          onBackToScanner={() => {
            setCurrentRawImage(null); // 再撮影用に一時生画像キャッシュをクリア
            setStep('scan');
          }}
          onBackToEdit={() => {
            // 直前に確定したページをやり直すため、配列の末尾から取り除く
            setScannedPages(prev => prev.slice(0, -1));
            setInitialIsWarped(true); // フィルター適用画面に戻す
            setStep('edit');
          }}
        />
      )}

      {/* 確定時の画像飛行（フワッと吸い込まれる）オーバーレイ */}
      {flyingImage && (
        <div className="flying-image-overlay" style={{ pointerEvents: 'none' }}>
          <img
            src={flyingImage.src}
            alt="Flying page"
            className="flying-image-item"
            style={{
              position: 'fixed',
              left: flyingImage.rect.left,
              top: flyingImage.rect.top,
              width: flyingImage.rect.width,
              height: flyingImage.rect.height,
              zIndex: 9999,
            }}
          />
        </div>
      )}
    </div>
  );
}

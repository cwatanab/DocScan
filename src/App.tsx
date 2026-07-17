import { CameraScanner } from './components/CameraScanner';
import { DocumentEditor } from './components/DocumentEditor';
import { ExportPreview } from './components/ExportPreview';
import { useScanSession } from './utils/useScanSession';
import { Loader2 } from 'lucide-react';

export default function App() {
  const {
    step,
    currentRawImage,
    currentCorners,
    scannedPages,
    ocrResults,
    exportMode,
    initialIsWarped,
    isOcrLoading,
    flyingImage,
    currentFilterMode,
    capture,
    savePage,
    cancelEdit,
    exportComplete,
    backToScanner,
    backToEdit
  } = useScanSession();

  return (
    <div className="app-layout">
      {isOcrLoading && (
        <div className="loading-screen">
          <Loader2 className="spinner spinner-large" color="var(--primary)" />
          <h3>OCR テキスト解析中</h3>
          <p>
            文字情報を解析しています。これには数秒かかる場合があります。
          </p>
        </div>
      )}

      {step === 'scan' && (
        <CameraScanner
          onCapture={capture}
        />
      )}

      {step === 'edit' && currentRawImage && (
        <DocumentEditor
          imageSrc={currentRawImage}
          initialCorners={currentCorners}
          onSave={savePage}
          onCancel={cancelEdit}
          initialIsWarped={initialIsWarped}
          initialFilterMode={currentFilterMode}
        />
      )}

      {step === 'export' && (
        <ExportPreview
          pages={scannedPages}
          exportMode={exportMode}
          ocrResults={ocrResults}
          onComplete={exportComplete}
          onBackToScanner={backToScanner}
          onBackToEdit={backToEdit}
        />
      )}

      {/* 確定時の画像飛行（フワッと吸い込まれる）オーバーレイ */}
      {flyingImage && (
        <div className="flying-image-overlay">
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


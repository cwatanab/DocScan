import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Download, Share2, Copy } from 'lucide-react';
import type { OcrResult } from '../utils/ocrHelper';
import { createSearchablePdf } from '../utils/pdfHelper';
import { createReproducedHtml } from '../utils/htmlHelper';
import { ZoomableImage } from './ZoomableImage';
import { ThumbnailGrid } from './ThumbnailGrid';
import {
  getFormattedTimestamp,
  triggerBlobDownload,
  downloadSinglePage,
  downloadAllPages,
  shareSinglePage,
  shareAllPages,
  type ExportFormat
} from '../utils/imageExportHelper';

interface ExportPreviewProps {
  pages: string[];
  exportMode: 'pdf' | 'jpeg';
  ocrResults: { [key: number]: OcrResult };
  onComplete: () => void;
  onBackToScanner: () => void;
  onBackToEdit?: () => void;
  ocrError?: string | null;
  onDismissOcrError?: () => void;
}

/** 画像フォーマット共通のダウンロード／共有ハンドラを生成する */
function useImageFormatHandlers(pages: string[]) {
  const makeHandlers = useCallback(
    (format: ExportFormat) => ({
      download: async (imageSrc: string, index: number, timestamp?: string) => {
        try {
          await downloadSinglePage(imageSrc, index, format, timestamp);
        } catch (err) {
          console.error(`Failed to download as ${format}:`, err);
        }
      },
      downloadAll: async () => {
        try {
          await downloadAllPages(pages, format);
        } catch (err) {
          console.error(`Failed to download all ${format}s:`, err);
        }
      },
      shareSingle: async (imageSrc: string, index: number) => {
        try {
          await shareSinglePage(imageSrc, index, format);
        } catch (err) {
          console.error(`Failed to share single ${format}:`, err);
        }
      },
      shareAll: async () => {
        try {
          await shareAllPages(pages, format);
        } catch (err) {
          console.error(`Failed to share ${format}s:`, err);
        }
      }
    }),
    [pages]
  );

  const png = useMemo(() => makeHandlers('png'), [makeHandlers]);
  const jpeg = useMemo(() => makeHandlers('jpeg'), [makeHandlers]);

  return { png, jpeg };
}

export const ExportPreview: React.FC<ExportPreviewProps> = ({
  pages,
  exportMode,
  ocrResults,
  onComplete,
  onBackToScanner,
  onBackToEdit,
  ocrError = null,
  onDismissOcrError
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 生成中の PDF が古い pages/ocr に対応していない場合の破棄用世代カウンタ
  const pdfGenerationIdRef = useRef(0);
  const pagesKey = useMemo(
    () => `${pages.length}:${pages.map((p) => p.length).join(',')}:${Object.keys(ocrResults).join(',')}`,
    [pages, ocrResults]
  );

  const { png, jpeg } = useImageFormatHandlers(pages);

  const htmlContent = useMemo(() => {
    const htmlData = pages.map((_, index) => ({
      ocrResult: ocrResults[index]
    }));
    return createReproducedHtml(htmlData);
  }, [pages, ocrResults]);

  // PDF モード時はバックグラウンドで生成する。
  // pagesKey 変化でキャッシュを無効化し、世代 ID で古い結果を破棄する。
  useEffect(() => {
    if (exportMode !== 'pdf') {
      setPdfBlob(null);
      return;
    }

    setPdfBlob(null);
    const generationId = ++pdfGenerationIdRef.current;
    let cancelled = false;

    const pdfData = pages.map((imageSrc, index) => ({
      imageSrc,
      ocrResult: ocrResults[index]
    }));

    createSearchablePdf(pdfData)
      .then((blob) => {
        if (cancelled || generationId !== pdfGenerationIdRef.current) return;
        setPdfBlob(blob);
      })
      .catch((err) => {
        if (cancelled || generationId !== pdfGenerationIdRef.current) return;
        console.error('PDF generation failed on mount:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [exportMode, pages, ocrResults, pagesKey]);

  const ensurePdfGenerated = useCallback(async (): Promise<Blob | null> => {
    if (pdfBlob) return pdfBlob;

    const generationId = ++pdfGenerationIdRef.current;
    setIsProcessing(true);
    setError(null);
    try {
      const pdfData = pages.map((imageSrc, index) => ({
        imageSrc,
        ocrResult: ocrResults[index]
      }));
      const generatedBlob = await createSearchablePdf(pdfData);
      if (generationId !== pdfGenerationIdRef.current) {
        return null;
      }
      setPdfBlob(generatedBlob);
      return generatedBlob;
    } catch (err) {
      if (generationId !== pdfGenerationIdRef.current) {
        return null;
      }
      console.error('PDF generation error:', err);
      setError('PDFの生成中にエラーが発生しました。もう一度お試しください。');
      return null;
    } finally {
      if (generationId === pdfGenerationIdRef.current) {
        setIsProcessing(false);
      }
    }
  }, [pdfBlob, pages, ocrResults]);

  const handleDownloadPdf = useCallback(async () => {
    const blob = await ensurePdfGenerated();
    if (!blob) return;
    triggerBlobDownload(blob, `DocScan_${getFormattedTimestamp()}.pdf`);
  }, [ensurePdfGenerated]);

  const handleDownloadHtml = useCallback(() => {
    try {
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
      triggerBlobDownload(blob, `DocScan_${getFormattedTimestamp()}.html`);
    } catch (err) {
      console.error('HTML generation failed:', err);
      alert('HTMLファイルの生成に失敗しました。');
    }
  }, [htmlContent]);

  const handleShareHtml = useCallback(() => {
    try {
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
      const fileName = `DocScan_${getFormattedTimestamp()}.html`;
      const file = new File([blob], fileName, { type: 'text/html' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('HTML share failed:', err);
          }
        });
      } else {
        triggerBlobDownload(blob, fileName);
      }
    } catch (err) {
      console.error('HTML share failed:', err);
      alert('HTMLファイルの共有に失敗しました。');
    }
  }, [htmlContent]);

  const handleShare = useCallback(async () => {
    const blob = await ensurePdfGenerated();
    if (!blob) return;

    const fileName = `DocScan_${getFormattedTimestamp()}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    } else {
      triggerBlobDownload(blob, fileName);
    }
  }, [ensurePdfGenerated]);

  const handleTabChange = useCallback((tab: 'pdf' | 'text') => {
    setActiveTab(tab);
  }, []);

  const handleCopyText = useCallback(() => {
    const allText = Object.values(ocrResults)
      .map((res) => res.text)
      .join('\n\n--- ページ区切り ---\n\n');

    navigator.clipboard
      .writeText(allText)
      .then(() => alert('テキストをクリップボードにコピーしました'))
      .catch((err) => console.error('Copy failed:', err));
  }, [ocrResults]);

  if (isProcessing) {
    const title = exportMode === 'pdf' ? 'PDFの生成中' : '画像の書き出し中';
    const desc =
      exportMode === 'pdf'
        ? '文字情報を埋め込み、検索可能なPDFを作成しています...'
        : '画像ファイルを用意しています。しばらくお待ちください...';

    return (
      <div className="loading-screen-blurred">
        <div className="loading-content-wrapper">
          <div className="spinner spinner-large" />
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>{title}</h3>
          <p
            style={{
              fontSize: '13px',
              color: '#94a3b8',
              maxWidth: '90%',
              lineHeight: '1.5',
              textAlign: 'center'
            }}
          >
            {desc}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen" style={{ color: 'var(--error)' }}>
        <div className="error-icon-large">⚠️</div>
        <h3 className="error-text-title">エラー</h3>
        <p className="error-text-desc">{error}</p>
        <button onClick={onBackToScanner} className="btn-primary-small btn-padding-large">
          スキャンに戻る
        </button>
      </div>
    );
  }

  return (
    <div className="export-container">
      <div className="header-bar">
        <button onClick={onBackToEdit || onBackToScanner} className="btn-text-nav">
          {'< 戻る'}
        </button>
        <h3 style={{ fontSize: '16px', fontWeight: '600' }}>エクスポート</h3>
        <button onClick={onComplete} className="btn-text-nav btn-text-accent">
          {'完了 >'}
        </button>
      </div>

      {ocrError && (
        <div className="toast-banner toast-banner-warning" role="alert">
          <p className="toast-banner-text">{ocrError}</p>
          {onDismissOcrError && (
            <button type="button" className="toast-banner-dismiss" onClick={onDismissOcrError}>
              閉じる
            </button>
          )}
        </div>
      )}

      {exportMode === 'pdf' && (
        <div className="export-tab-bar">
          <button
            onClick={() => handleTabChange('pdf')}
            className={`export-tab-btn ${activeTab === 'pdf' ? 'export-tab-btn-active' : ''}`}
          >
            PDFプレビュー
          </button>
          <button
            onClick={() => handleTabChange('text')}
            className={`export-tab-btn ${activeTab === 'text' ? 'export-tab-btn-active' : ''}`}
          >
            OCRテキスト
          </button>
        </div>
      )}

      <div className="export-content-area">
        {activeTab === 'pdf' ? (
          <div className="export-preview-column">
            <ThumbnailGrid
              pages={pages}
              onPageClick={setPreviewImage}
              onBackToScanner={onBackToScanner}
              onShareSingleJpeg={jpeg.shareSingle}
              onDownloadJpeg={jpeg.download}
              onShareSinglePng={png.shareSingle}
              onDownloadPng={png.download}
            />
          </div>
        ) : (
          <div className="ocr-text-box" style={{ flex: 1, minHeight: '350px', maxWidth: 'none' }}>
            <div className="ocr-box-header" style={{ justifyContent: 'flex-end' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleCopyText}
                  className="ocr-box-copy-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Copy style={{ width: '13px', height: '13px' }} />
                  テキストコピー
                </button>
              </div>
            </div>

            <div
              className="ocr-box-content"
              style={{
                flex: 1,
                padding: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                maxHeight: 'none'
              }}
            >
              {Object.values(ocrResults).length > 0 ? (
                <iframe
                  srcDoc={htmlContent}
                  title="HTML Preview"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    backgroundColor: '#ffffff',
                    flex: 1
                  }}
                />
              ) : (
                <div style={{ padding: '16px', color: '#64748b', fontStyle: 'italic' }}>
                  文字は検出されませんでした
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="export-footer">
        {exportMode === 'jpeg' ? (
          <div className="export-button-row" style={{ flexDirection: 'column' }}>
            <div className="export-button-row">
              <button onClick={jpeg.shareAll} className="btn-primary-large btn-flex-1 btn-indigo">
                <Share2 style={{ width: '18px', height: '18px' }} />
                JPEG共有
              </button>
              <button
                onClick={png.shareAll}
                className="btn-primary-large btn-flex-1 btn-indigo-dark"
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                PNG共有
              </button>
            </div>

            <div className="export-button-row">
              <button
                onClick={jpeg.downloadAll}
                className="btn-secondary-large btn-flex-1 btn-slate"
              >
                <Download style={{ width: '16px', height: '16px' }} />
                JPEG保存
              </button>
              <button
                onClick={png.downloadAll}
                className="btn-secondary-large btn-flex-1 btn-slate-dark"
              >
                <Download style={{ width: '16px', height: '16px' }} />
                PNG保存
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="export-button-row">
              <button onClick={handleShare} className="btn-primary-large btn-flex-1">
                <Share2 style={{ width: '18px', height: '18px' }} />
                PDFを共有
              </button>
              <button onClick={handleShareHtml} className="btn-primary-large btn-flex-1 btn-indigo">
                <Share2 style={{ width: '18px', height: '18px' }} />
                HTMLを共有
              </button>
            </div>

            <div className="export-button-row">
              <button
                onClick={handleDownloadPdf}
                className="btn-secondary-large btn-flex-1 btn-slate"
              >
                <Download style={{ width: '16px', height: '16px' }} />
                PDF保存
              </button>
              <button
                onClick={handleDownloadHtml}
                className="btn-secondary-large btn-flex-1 btn-slate-dark"
              >
                <Download style={{ width: '16px', height: '16px' }} />
                HTML保存
              </button>
            </div>
          </>
        )}
      </div>

      {previewImage && (
        <ZoomableImage
          src={previewImage}
          alt="Expanded preview"
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { Download, Share2 } from 'lucide-react';
import type { OcrResult } from '../utils/ocrHelper';
import { createSearchablePdf } from '../utils/pdfHelper';
import { ZoomableImage } from './ZoomableImage';
import { ThumbnailGrid } from './ThumbnailGrid';
import {
  getFormattedTimestamp,
  triggerBlobDownload,
  downloadSinglePage,
  downloadAllPages,
  shareSinglePage,
  shareAllPages
} from '../utils/imageExportHelper';

interface ExportPreviewProps {
  pages: string[]; // 補正済み画像のDataURL配列
  exportMode: 'pdf' | 'jpeg';
  ocrResults: { [key: number]: OcrResult }; // Propsとして受け取る
  onComplete: () => void;
  onBackToScanner: () => void;
  onBackToEdit?: () => void;
}

export const ExportPreview: React.FC<ExportPreviewProps> = ({
  pages,
  exportMode,
  ocrResults,
  onComplete,
  onBackToScanner,
  onBackToEdit
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [error, setError] = useState<string | null>(null);
  
  // 拡大プレビュー用のステート
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // マウント時にPDFモードであれば、バックグラウンドで自動的にPDF生成を開始する (OCRはすでに完了済み)
  useEffect(() => {
    if (exportMode === 'pdf' && !pdfBlob) {
      const pdfData = pages.map((imageSrc, index) => ({
        imageSrc,
        ocrResult: ocrResults[index]
      }));
      createSearchablePdf(pdfData)
        .then(blob => setPdfBlob(blob))
        .catch(err => {
          console.error("PDF generation failed on mount:", err);
        });
    }
  }, [exportMode, ocrResults, pages, pdfBlob]);

  // PNGとして保存
  const handleDownloadPng = useCallback(async (imageSrc: string, index: number, timestamp?: string) => {
    try {
      await downloadSinglePage(imageSrc, index, 'png', timestamp);
    } catch (err) {
      console.error('Failed to download as PNG:', err);
    }
  }, []);

  // 全ページをPNGとして順次ダウンロード保存
  const handleDownloadAllPngs = useCallback(async () => {
    try {
      await downloadAllPages(pages, 'png');
    } catch (err) {
      console.error('Failed to download all PNGs:', err);
    }
  }, [pages]);

  // 個別PNGの共有
  const handleShareSinglePng = useCallback(async (imageSrc: string, index: number) => {
    try {
      await shareSinglePage(imageSrc, index, 'png');
    } catch (err) {
      console.error("Failed to share single PNG:", err);
    }
  }, []);

  // 全ページの一括PNG共有
  const handleSharePngs = useCallback(async () => {
    try {
      await shareAllPages(pages, 'png');
    } catch (err) {
      console.error("Failed to share PNGs:", err);
    }
  }, [pages]);

  // 必要に応じてPDFを生成する関数 (すでにOCRは完了しているため、結合のみを実行)
  const ensurePdfGenerated = useCallback(async (): Promise<Blob | null> => {
    if (pdfBlob) return pdfBlob;

    setIsProcessing(true);
    setError(null);
    try {
      const pdfData = pages.map((imageSrc, index) => ({
        imageSrc,
        ocrResult: ocrResults[index]
      }));
      const generatedBlob = await createSearchablePdf(pdfData);
      setPdfBlob(generatedBlob);
      return generatedBlob;
    } catch (err: any) {
      console.error('PDF generation error:', err);
      setError('PDFの生成中にエラーが発生しました。もう一度お試しください。');
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [pdfBlob, pages, ocrResults]);

  // PDFダウンロード
  const handleDownloadPdf = useCallback(async () => {
    const blob = await ensurePdfGenerated();
    if (!blob) return;
    triggerBlobDownload(blob, `DocScan_${getFormattedTimestamp()}.pdf`);
  }, [ensurePdfGenerated]);

  // JPEG(画像)として保存
  const handleDownloadJpeg = useCallback(async (imageSrc: string, index: number, timestamp?: string) => {
    try {
      await downloadSinglePage(imageSrc, index, 'jpeg', timestamp);
    } catch (err) {
      console.error('Failed to download as JPEG:', err);
    }
  }, []);

  // 全ページをJPEGとして順次ダウンロード保存
  const handleDownloadAllJpegs = useCallback(async () => {
    try {
      await downloadAllPages(pages, 'jpeg');
    } catch (err) {
      console.error('Failed to download all JPEGs:', err);
    }
  }, [pages]);

  // 個別JPEGの共有
  const handleShareSingleJpeg = useCallback(async (imageSrc: string, index: number) => {
    try {
      await shareSinglePage(imageSrc, index, 'jpeg');
    } catch (err) {
      console.error("Failed to share single JPEG:", err);
    }
  }, []);

  // 全ページの一括JPEG共有
  const handleShareJpegs = useCallback(async () => {
    try {
      await shareAllPages(pages, 'jpeg');
    } catch (err) {
      console.error("Failed to share JPEGs:", err);
    }
  }, [pages]);

  // 共有（Web Share API）
  const handleShare = useCallback(async () => {
    const blob = await ensurePdfGenerated();
    if (!blob) return;
    
    const fileName = `DocScan_${getFormattedTimestamp()}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });
    
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
        });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    } else {
      triggerBlobDownload(blob, fileName);
    }
  }, [ensurePdfGenerated]);

  // タブ切り替えハンドラ
  const handleTabChange = useCallback((tab: 'pdf' | 'text') => {
    setActiveTab(tab);
  }, []);

  // 全文テキストのコピー
  const handleCopyText = useCallback(() => {
    const allText = Object.values(ocrResults)
      .map(res => res.text)
      .join('\n\n--- ページ区切り ---\n\n');
    
    navigator.clipboard.writeText(allText)
      .then(() => alert('テキストをクリップボードにコピーしました'))
      .catch(err => console.error('Copy failed:', err));
  }, [ocrResults]);

  if (isProcessing) {
    const lastPageImage = pages[pages.length - 1]; // スキャンされた最新の画像
    const title = exportMode === 'pdf' ? 'PDFの生成中' : '画像の書き出し中';
    const desc = exportMode === 'pdf' 
      ? '文字情報を埋め込み、検索可能なPDFを作成しています...'
      : '画像ファイルを用意しています。しばらくお待ちください...';

    return (
      <div className="loading-screen-blurred">
        <div className="loading-content-wrapper">
          <div className="spinner spinner-large" />
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>{title}</h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '90%', lineHeight: '1.5', textAlign: 'center' }}>
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
        <button
          onClick={onBackToScanner}
          className="btn-primary-small btn-padding-large"
        >
          スキャンに戻る
        </button>
      </div>
    );
  }

  return (
    <div className="export-container">
      {/* ヘッダーバー */}
      <div className="header-bar">
        <button
          onClick={onBackToEdit || onBackToScanner}
          className="btn-text-nav"
        >
          {"< 戻る"}
        </button>
        <h3 style={{ fontSize: '16px', fontWeight: '600' }}>エクスポート</h3>
        <button
          onClick={onComplete}
          className="btn-text-nav btn-text-accent"
        >
          {"完了 >"}
        </button>
      </div>

      {/* タブ切り替え */}
      {/* タブ切り替え */}
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

      {/* プレビュー表示エリア */}
      <div className="export-content-area">
        {activeTab === 'pdf' ? (
          /* PDF/画像プレビュー */
          <div className="export-preview-column">

            {/* 各ページのサムネイル */}
            <ThumbnailGrid
              pages={pages}
              onPageClick={setPreviewImage}
              onBackToScanner={onBackToScanner}
              onShareSingleJpeg={handleShareSingleJpeg}
              onDownloadJpeg={handleDownloadJpeg}
              onShareSinglePng={handleShareSinglePng}
              onDownloadPng={handleDownloadPng}
            />
          </div>
        ) : (
          /* OCR テキスト表示 */
          <div className="ocr-text-box">
            <div className="ocr-box-header">
              <span className="ocr-box-label">
                認識された文字情報
              </span>
              <button
                onClick={handleCopyText}
                className="ocr-box-copy-btn"
              >
                コピーする
              </button>
            </div>
            
            <div className="ocr-box-content">
              {Object.values(ocrResults).map(res => res.text).join('\n\n--- ページ区切り ---\n\n') || (
                <span style={{ color: '#64748b', fontStyle: 'italic' }}>文字は検出されませんでした</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 下部アクションバー */}
      <div className="export-footer">
        {exportMode === 'jpeg' ? (
          /* JPEG/PNG用アクション (OCRなし・高速画像出力) */
          <div className="export-button-row" style={{ flexDirection: 'column' }}>
            {/* 共有段 */}
            <div className="export-button-row">
              <button
                onClick={handleShareJpegs}
                className="btn-primary-large btn-flex-1 btn-indigo"
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                JPEG共有
              </button>
              <button
                onClick={handleSharePngs}
                className="btn-primary-large btn-flex-1 btn-indigo-dark"
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                PNG共有
              </button>
            </div>
            
            {/* 保存段 */}
            <div className="export-button-row">
              <button
                onClick={handleDownloadAllJpegs}
                className="btn-secondary-large btn-flex-1 btn-slate"
              >
                <Download style={{ width: '16px', height: '16px' }} />
                JPEG保存
              </button>
              <button
                onClick={handleDownloadAllPngs}
                className="btn-secondary-large btn-flex-1 btn-slate-dark"
              >
                <Download style={{ width: '16px', height: '16px' }} />
                PNG保存
              </button>
            </div>
          </div>
        ) : (
          /* PDF用アクション (OCR付きサーチャブルPDF) */
          <>
            <div className="export-button-row">
              <button
                onClick={handleShare}
                className="btn-primary-large btn-flex-1"
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                PDFを共有
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
            </div>
          </>
        )}
      </div>

      {/* サムネイルクリック時の拡大プレビュー (Zoomable Lightbox) */}
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

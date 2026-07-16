import React, { useState } from 'react';
import { Download, Share2, FileText, Loader2, CheckCircle2, Plus } from 'lucide-react';
import { performOcr } from '../utils/ocrHelper';
import type { OcrResult } from '../utils/ocrHelper';
import { createSearchablePdf } from '../utils/pdfHelper';
import { ZoomableImage } from './ZoomableImage';
import {
  getFormattedTimestamp,
  triggerBlobDownload,
  convertToPngBlob,
  convertToJpegBlob,
  convertToJpegFile
} from '../utils/imageExportHelper';

interface ExportPreviewProps {
  pages: string[]; // 補正済み画像のDataURL配列
  exportMode: 'pdf' | 'jpeg';
  onComplete: () => void;
  onBackToScanner: () => void;
  onBackToEdit?: () => void;
}

export const ExportPreview: React.FC<ExportPreviewProps> = ({
  pages,
  exportMode,
  onComplete,
  onBackToScanner,
  onBackToEdit
}) => {
  const [ocrResults, setOcrResults] = useState<{ [key: number]: OcrResult }>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrDone, setOcrDone] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [error, setError] = useState<string | null>(null);
  
  // 拡大プレビュー用のステート
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // PNGとして保存
  const handleDownloadPng = async (imageSrc: string, index: number, timestamp?: string) => {
    try {
      setIsProcessing(true);
      const blob = await convertToPngBlob(imageSrc);
      const ts = timestamp || getFormattedTimestamp();
      triggerBlobDownload(blob, `SCAN_${ts}_${String(index + 1).padStart(3, '0')}.png`);
    } catch (err) {
      console.error('Failed to convert and download as PNG:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 全ページをPNGとして順次ダウンロード保存
  const handleDownloadAllPngs = async () => {
    const timestamp = getFormattedTimestamp(); // バッチ全体でタイムスタンプを統一
    for (let i = 0; i < pages.length; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(async () => {
          await handleDownloadPng(pages[i], i, timestamp);
          resolve();
        }, i * 300); // ブラウザブロック防止のため300msの間隔をあける
      });
    }
  };

  // 個別PNGの共有
  const handleShareSinglePng = async (imageSrc: string, index: number) => {
    try {
      setIsProcessing(true);
      const blob = await convertToPngBlob(imageSrc);
      const fileName = `SCAN_${getFormattedTimestamp()}_${String(index + 1).padStart(3, '0')}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
        });
      } else {
        await handleDownloadPng(imageSrc, index);
      }
    } catch (err) {
      console.error("Failed to share single PNG:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 全ページの一括PNG共有
  const handleSharePngs = async () => {
    try {
      setIsProcessing(true);
      const filesList: File[] = [];
      const timestamp = getFormattedTimestamp();
      
      for (let i = 0; i < pages.length; i++) {
        const fileName = `SCAN_${timestamp}_${String(i + 1).padStart(3, '0')}.png`;
        const blob = await convertToPngBlob(pages[i]);
        const file = new File([blob], fileName, { type: 'image/png' });
        filesList.push(file);
      }
      
      setIsProcessing(false);

      if (navigator.canShare && navigator.canShare({ files: filesList })) {
        await navigator.share({
          files: filesList,
        });
      } else {
        await handleDownloadAllPngs();
      }
    } catch (err: any) {
      setIsProcessing(false);
      if (err.name === 'AbortError') {
        console.log("PNG sharing was canceled by user.");
        return;
      }
      console.error("Failed to share PNGs:", err);
      await handleDownloadAllPngs();
    }
  };

  // 必要に応じてOCRおよびPDFを遅延評価（生成）する関数
  const ensurePdfGenerated = async (): Promise<Blob | null> => {
    if (pdfBlob) return pdfBlob;

    try {
      setIsProcessing(true);
      setError(null);
      const results: { [key: number]: OcrResult } = { ...ocrResults };

      // まだOCRが行われていないページがあれば実行
      for (let i = 0; i < pages.length; i++) {
        if (!results[i]) {
          const ocrResult = await performOcr(pages[i]);
          results[i] = ocrResult;
          setOcrResults(prev => ({ ...prev, [i]: ocrResult }));
        }
      }
      setOcrDone(true);

      // サーチャブルPDFの生成
      const pdfData = pages.map((imageSrc, index) => ({
        imageSrc,
        ocrResult: results[index]
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
  };

  // PDFダウンロード
  const handleDownloadPdf = async () => {
    const blob = await ensurePdfGenerated();
    if (!blob) return;
    triggerBlobDownload(blob, `SCAN_${getFormattedTimestamp()}.pdf`);
  };

  // JPEG(画像)として保存
  const handleDownloadJpeg = async (imageSrc: string, index: number, timestamp?: string) => {
    const ts = timestamp || getFormattedTimestamp();
    try {
      setIsProcessing(true);
      const blob = await convertToJpegBlob(imageSrc);
      triggerBlobDownload(blob, `SCAN_${ts}_${String(index + 1).padStart(3, '0')}.jpg`);
    } catch (err) {
      console.error('Failed to convert and download as JPEG:', err);
      // 失敗時のフォールバック (そのままダウンロード)
      const a = document.createElement('a');
      a.href = imageSrc;
      a.download = `SCAN_${ts}_${String(index + 1).padStart(3, '0')}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setIsProcessing(false);
    }
  };

  // 全ページをJPEGとして順次ダウンロード保存
  const handleDownloadAllJpegs = async () => {
    const timestamp = getFormattedTimestamp(); // バッチ全体でタイムスタンプを統一
    for (let i = 0; i < pages.length; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(async () => {
          await handleDownloadJpeg(pages[i], i, timestamp);
          resolve();
        }, i * 300); // ブラウザブロック防止のため300msの間隔をあける
      });
    }
  };

  // 個別JPEGの共有
  const handleShareSingleJpeg = async (imageSrc: string, index: number) => {
    try {
      setIsProcessing(true);
      const fileName = `SCAN_${getFormattedTimestamp()}_${String(index + 1).padStart(3, '0')}.jpg`;
      const file = await convertToJpegFile(imageSrc, fileName);
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
        });
      } else {
        await handleDownloadJpeg(imageSrc, index);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("Single JPEG sharing was canceled by user.");
        return;
      }
      console.error("Failed to share single JPEG:", err);
      await handleDownloadJpeg(imageSrc, index);
    } finally {
      setIsProcessing(false);
    }
  };

  // 全ページの一括JPEG共有
  const handleShareJpegs = async () => {
    try {
      setIsProcessing(true);
      const filesList: File[] = [];
      const timestamp = getFormattedTimestamp();
      
      for (let i = 0; i < pages.length; i++) {
        const fileName = `SCAN_${timestamp}_${String(i + 1).padStart(3, '0')}.jpg`;
        const file = await convertToJpegFile(pages[i], fileName);
        filesList.push(file);
      }
      
      setIsProcessing(false);

      if (navigator.canShare && navigator.canShare({ files: filesList })) {
        await navigator.share({
          files: filesList,
        });
      } else {
        await handleDownloadAllJpegs();
      }
    } catch (err: any) {
      setIsProcessing(false);
      if (err.name === 'AbortError') {
        console.log("JPEG sharing was canceled by user.");
        return;
      }
      console.error("Failed to share JPEGs:", err);
      await handleDownloadAllJpegs();
    }
  };

  // 共有（Web Share API）
  const handleShare = async () => {
    const blob = await ensurePdfGenerated();
    if (!blob) return;
    
    const fileName = `SCAN_${getFormattedTimestamp()}.pdf`;
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
  };

  // タブ切り替えハンドラ（テキストタブ選択時に自動的にOCRを走らせる）
  const handleTabChange = async (tab: 'pdf' | 'text') => {
    setActiveTab(tab);
    if (tab === 'text' && !ocrDone) {
      try {
        setIsProcessing(true);
        const results: { [key: number]: OcrResult } = { ...ocrResults };
        for (let i = 0; i < pages.length; i++) {
          if (!results[i]) {
            const res = await performOcr(pages[i]);
            results[i] = res;
            setOcrResults(prev => ({ ...prev, [i]: res }));
          }
        }
        setOcrDone(true);
      } catch (err) {
        console.error('OCR tab loading failed:', err);
        setError('OCR処理中にエラーが発生しました。もう一度お試しください。');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // 全文テキストのコピー
  const handleCopyText = () => {
    const allText = Object.values(ocrResults)
      .map(res => res.text)
      .join('\n\n--- ページ区切り ---\n\n');
    
    navigator.clipboard.writeText(allText)
      .then(() => alert('テキストをクリップボードにコピーしました'))
      .catch(err => console.error('Copy failed:', err));
  };

  if (isProcessing) {
    const lastPageImage = pages[pages.length - 1]; // スキャンされた最新の画像
    return (
      <div className="loading-screen-blurred">
        {/* 背景にスキャンした画像をうっすらオーバーレイ配置 */}
        {lastPageImage && (
          <img
            src={lastPageImage}
            alt="Background scanned page"
            className="loading-bg-image"
          />
        )}
        <div className="loading-content-wrapper">
          <Loader2 className="spinner spinner-large" style={{ color: '#6366f1' }} />
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>OCR処理とPDF生成</h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '240px', lineHeight: '1.5' }}>
            画像の文字を解析し、検索可能なPDFを作成しています...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen" style={{ color: '#ef4444' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
        <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px', color: '#f8fafc' }}>エラー</h3>
        <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '240px', marginBottom: '24px' }}>{error}</p>
        <button
          onClick={onBackToScanner}
          className="btn-primary-small"
          style={{ padding: '12px 24px' }}
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
          <div style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {exportMode === 'pdf' && (
              <div className="preview-pdf-info-card">
                <div className="pdf-icon-wrapper">
                  <FileText style={{ width: '24px', height: '24px' }} />
                </div>
                <div className="pdf-info-text">
                  <h4 className="pdf-info-filename">
                    スキャンドキュメント.pdf
                  </h4>
                  <p className="pdf-info-meta">
                    {pages.length} ページ • {pdfBlob ? `${(pdfBlob.size / 1024 / 1024).toFixed(2)} MB` : '未生成 (保存時に作成)'}
                  </p>
                </div>
                <CheckCircle2 style={{ width: '20px', height: '20px', color: '#10b981' }} />
              </div>
            )}

            {/* 各ページのサムネイル */}
            <div className="thumbnail-grid">
              {pages.map((page, idx) => (
                <div 
                  key={idx} 
                  className="thumbnail-card"
                  onClick={() => setPreviewImage(page)}
                  style={{ cursor: 'pointer' }}
                >
                  <img
                    src={page}
                    alt={`Page ${idx + 1}`}
                    className="thumbnail-card-img"
                  />
                  <div className="thumbnail-card-bar">
                    <span className="thumbnail-card-title">
                      P {idx + 1}
                    </span>
                    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                      {/* JPEG 共有/保存 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShareSingleJpeg(page, idx); }}
                        className="thumbnail-card-download"
                        style={{ backgroundColor: '#4f46e5', width: '22px', height: '22px', padding: '0' }}
                        title="JPEGを共有"
                      >
                        <Share2 style={{ width: '10px', height: '10px' }} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadJpeg(page, idx); }}
                        className="thumbnail-card-download"
                        style={{ backgroundColor: '#334155', width: '22px', height: '22px', padding: '0' }}
                        title="JPEG保存"
                      >
                        <Download style={{ width: '10px', height: '10px' }} />
                      </button>
                      {/* PNG 共有/保存 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShareSinglePng(page, idx); }}
                        className="thumbnail-card-download"
                        style={{ backgroundColor: '#10b981', width: '22px', height: '22px', padding: '0' }}
                        title="PNGを共有"
                      >
                        <Share2 style={{ width: '10px', height: '10px', color: '#fff' }} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadPng(page, idx); }}
                        className="thumbnail-card-download"
                        style={{ backgroundColor: '#0f172a', width: '22px', height: '22px', padding: '0', border: '1px solid #334155' }}
                        title="PNG保存"
                      >
                        <Download style={{ width: '10px', height: '10px', color: '#fff' }} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {/* ページ追加用の点線アクションカード */}
              <div 
                onClick={onBackToScanner} 
                className="thumbnail-card add-page-card"
              >
                <Plus style={{ width: '22px', height: '22px', color: '#6366f1', marginBottom: '8px' }} />
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#cbd5e1' }}>ページ追加</span>
              </div>
            </div>
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
      <div className="export-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px 20px' }}>
        {exportMode === 'jpeg' ? (
          /* JPEG/PNG用アクション (OCRなし・高速画像出力) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            {/* 共有段 */}
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button
                onClick={handleShareJpegs}
                className="btn-primary-large"
                style={{ flex: 1, margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', backgroundColor: '#6366f1', padding: '16px', borderRadius: '16px', fontSize: '14px', fontWeight: '700' }}
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                JPEG共有
              </button>
              <button
                onClick={handleSharePngs}
                className="btn-primary-large"
                style={{ flex: 1, margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', backgroundColor: '#4f46e5', padding: '16px', borderRadius: '16px', fontSize: '14px', fontWeight: '700' }}
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                PNG共有
              </button>
            </div>
            
            {/* 保存段 */}
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button
                onClick={handleDownloadAllJpegs}
                className="btn-secondary-large"
                style={{ flex: 1, margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '16px', borderRadius: '16px', fontSize: '14px', fontWeight: '700', backgroundColor: '#334155', border: '1px solid #475569', color: '#fff' }}
              >
                <Download style={{ width: '16px', height: '16px' }} />
                JPEG保存
              </button>
              <button
                onClick={handleDownloadAllPngs}
                className="btn-secondary-large"
                style={{ flex: 1, margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '16px', borderRadius: '16px', fontSize: '14px', fontWeight: '700', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }}
              >
                <Download style={{ width: '16px', height: '16px' }} />
                PNG保存
              </button>
            </div>
          </div>
        ) : (
          /* PDF用アクション (OCR付きサーチャブルPDF) */
          <>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button
                onClick={handleShare}
                className="btn-primary-large"
                style={{ flex: 1, margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                PDFを共有
              </button>
              
              <button
                onClick={handleShareJpegs}
                className="btn-primary-large"
                style={{ flex: 1, margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', backgroundColor: '#4f46e5' }}
              >
                <Share2 style={{ width: '18px', height: '18px' }} />
                JPEGを共有
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button
                onClick={handleDownloadPdf}
                className="btn-secondary-large"
                style={{ flex: 1, width: 'auto', margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '13px' }}
              >
                <Download style={{ width: '16px', height: '16px' }} />
                PDF保存
              </button>
              
              <button
                onClick={handleDownloadAllJpegs}
                className="btn-secondary-large"
                style={{ flex: 1, width: 'auto', margin: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '13px', backgroundColor: '#334155', border: '1px solid #475569' }}
              >
                <Download style={{ width: '16px', height: '16px' }} />
                JPEG保存 ({pages.length}枚)
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

import React, { useEffect, useState, useRef } from 'react';
import { Download, Share2, FileText, Loader2, CheckCircle2, Plus } from 'lucide-react';
import { performOcr } from '../utils/ocrHelper';
import type { OcrResult } from '../utils/ocrHelper';
import { createSearchablePdf } from '../utils/pdfHelper';

interface ExportPreviewProps {
  pages: string[]; // 補正済み画像のDataURL配列
  onComplete: () => void;
  onBackToScanner: () => void;
}

// ピンチイン・アウト、ドラッグ(パン)、ダブルタップズームに対応した画像拡大プレビューコンポーネント (画像への直接transform適用 & リスナー範囲限定版)
const ZoomableImage: React.FC<{ src: string; alt: string; onClose: () => void }> = ({ src, alt, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  // タッチイベントを受け取るための画像コンテナへのRef
  const contentRef = useRef<HTMLDivElement>(null);
  
  // イベントリスナー内で常に最新のState値を参照するためのRef
  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // タッチ開始時の状態を保持するRef
  const touchStartRef = useRef<{
    distance: number;
    scale: number;
    x: number;
    y: number;
    posX: number;
    posY: number;
    isPinching: boolean;
  }>({ distance: 0, scale: 1, x: 0, y: 0, posX: 0, posY: 0, isPinching: false });

  const lastTapRef = useRef<number>(0);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    // タッチ開始時の処理
    const handleTouchStartRaw = (e: TouchEvent) => {
      const currentScale = scaleRef.current;
      const currentPos = positionRef.current;

      // ダブルタップ判定 (ダブルタップで拡大/等倍リセット)
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        e.preventDefault();
        if (currentScale > 1) {
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          setScale(2.5);
          setPosition({ x: 0, y: 0 });
        }
        lastTapRef.current = now;
        return;
      }
      lastTapRef.current = now;

      if (e.touches.length === 2) {
        // 2本指の場合: ピンチズームの初期化
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        
        touchStartRef.current = {
          distance: dist > 0 ? dist : 1, // 0除算を防止
          scale: currentScale,
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
          posX: currentPos.x,
          posY: currentPos.y,
          isPinching: true
        };
      } else if (e.touches.length === 1) {
        // 1本指の場合: ドラッグ（パン）の初期化
        const t = e.touches[0];
        touchStartRef.current = {
          distance: 0,
          scale: currentScale,
          x: t.clientX,
          y: t.clientY,
          posX: currentPos.x,
          posY: currentPos.y,
          isPinching: false
        };
      }
    };

    // タッチ中のドラッグ・ズーム処理
    const handleTouchMoveRaw = (e: TouchEvent) => {
      const currentScale = scaleRef.current;

      if (e.touches.length === 2 && touchStartRef.current.isPinching) {
        // ピンチズームの計算 (ブラウザ全体のズームを防止)
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        
        const startDist = touchStartRef.current.distance || 1;
        const factor = dist / startDist;
        const newScale = Math.max(1, Math.min(5, touchStartRef.current.scale * factor));
        setScale(newScale);
      } else if (e.touches.length === 1 && !touchStartRef.current.isPinching && currentScale > 1) {
        // ドラッグ（パン）の計算 (画像がズームしている時のみパン移動を許可し、背後のスクロールを抑止)
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - touchStartRef.current.x;
        const dy = t.clientY - touchStartRef.current.y;
        
        setPosition({
          x: touchStartRef.current.posX + dx,
          y: touchStartRef.current.posY + dy
        });
      }
    };

    // タッチ終了時の処理
    const handleTouchEndRaw = () => {
      const currentScale = scaleRef.current;
      // ズーム倍率が1以下になったら位置を中央リセットする
      if (currentScale <= 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    };

    // 画像コンテナに対してのみリスナー登録 (画像外タッチ時の誤入力をカット)
    element.addEventListener('touchstart', handleTouchStartRaw, { passive: false });
    element.addEventListener('touchmove', handleTouchMoveRaw, { passive: false });
    element.addEventListener('touchend', handleTouchEndRaw);

    return () => {
      element.removeEventListener('touchstart', handleTouchStartRaw);
      element.removeEventListener('touchmove', handleTouchMoveRaw);
      element.removeEventListener('touchend', handleTouchEndRaw);
    };
  }, []); // 依存配列を空にしてイベントが途切れないように固定

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      {/* 閉じるボタンをズーム対象の外側に配置し、スケールの影響を完全にシャットアウト */}
      <button 
        className="lightbox-close-btn"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        ✕
      </button>

      <div 
        ref={contentRef}
        className="lightbox-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible', // 画像がはみ出しても表示されるようにする
          touchAction: 'none'
        }}
      >
        {/* CSSの影響を受けないよう、画像(imgタグ)自体に対して直接transform(ズーム)を適用する */}
        <img 
          src={src} 
          alt={alt} 
          className="lightbox-image" 
          draggable={false}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: scale === 1 && position.x === 0 ? 'transform 0.2s ease-out' : 'none',
            maxWidth: '100%',
            maxHeight: '85vh',
            objectFit: 'contain'
          }}
        />
      </div>
    </div>
  );
};

export const ExportPreview: React.FC<ExportPreviewProps> = ({
  pages,
  onComplete,
  onBackToScanner
}) => {
  const [ocrResults, setOcrResults] = useState<{ [key: number]: OcrResult }>({});
  const [isProcessing, setIsProcessing] = useState(true);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [error, setError] = useState<string | null>(null);
  
  // 拡大プレビュー用のステート
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 全ページのOCRとPDF生成のフロー
  useEffect(() => {
    const runOcrAndGeneratePdf = async () => {
      try {
        setIsProcessing(true);
        setError(null);
        const results: { [key: number]: OcrResult } = {};

        // 各ページをシーケンシャルにOCRにかける
        for (let i = 0; i < pages.length; i++) {
          const ocrResult = await performOcr(pages[i]);
          results[i] = ocrResult;
          setOcrResults(prev => ({ ...prev, [i]: ocrResult }));
        }

        // サーチャブルPDFの生成
        const pdfData = pages.map((imageSrc, index) => ({
          imageSrc,
          ocrResult: results[index]
        }));

        const generatedBlob = await createSearchablePdf(pdfData);
        setPdfBlob(generatedBlob);
      } catch (err: any) {
        console.error('Export error:', err);
        setError('PDFの生成中にエラーが発生しました。もう一度お試しください。');
      } finally {
        setIsProcessing(false);
      }
    };

    runOcrAndGeneratePdf();
  }, [pages]);

  // PDFダウンロード
  const handleDownloadPdf = () => {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `スキャン_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // WebP(画像)として保存 (iOS SafariなどのWebPエンコード非対応環境を考慮した軽量化対応)
  const handleDownloadWebp = async (imageSrc: string, index: number) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          
          // まずブラウザが WebP のエンコードに対応しているかテストする
          const testUrl = canvas.toDataURL('image/webp');
          const isWebpSupported = testUrl.startsWith('data:image/webp');
          
          let outputUrl: string;
          let ext: string;

          if (isWebpSupported) {
            // WebP 対応ブラウザ (Chrome等): 画質80%で高圧縮
            outputUrl = canvas.toDataURL('image/webp', 0.80);
            ext = 'webp';
          } else {
            // iOS Safari等 (WebPデコードはできるが、エンコード非対応のブラウザ):
            // デフォルトのPNGフォールバックを防ぐため、明示的に JPEG品質80% で再圧縮してサイズを劇的に軽量化する
            outputUrl = canvas.toDataURL('image/jpeg', 0.80);
            ext = 'jpg';
          }

          const a = document.createElement('a');
          a.href = outputUrl;
          a.download = `スキャン_ページ_${index + 1}.${ext}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      };
      img.src = imageSrc;
    } catch (err) {
      console.error('Failed to convert and download as WebP:', err);
      // 失敗時のフォールバック (そのままダウンロード)
      const a = document.createElement('a');
      a.href = imageSrc;
      a.download = `スキャン_ページ_${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // 共有（Web Share API）
  const handleShare = async () => {
    if (!pdfBlob) return;
    
    const fileName = `スキャン_${new Date().toISOString().slice(0, 10)}.pdf`;
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
    
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'スキャン書類',
          text: 'Document Scannerから作成されたPDFです。',
        });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    } else {
      handleDownloadPdf();
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
          onClick={onBackToScanner}
          className="btn-text-nav"
        >
          再編集
        </button>
        <h3 style={{ fontSize: '16px', fontWeight: '600' }}>エクスポート</h3>
        <button
          onClick={onComplete}
          className="btn-text-nav btn-text-accent"
        >
          完了
        </button>
      </div>

      {/* タブ切り替え */}
      <div className="export-tab-bar">
        <button
          onClick={() => setActiveTab('pdf')}
          className={`export-tab-btn ${activeTab === 'pdf' ? 'export-tab-btn-active' : ''}`}
        >
          PDFプレビュー
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`export-tab-btn ${activeTab === 'text' ? 'export-tab-btn-active' : ''}`}
        >
          OCRテキスト
        </button>
      </div>

      {/* プレビュー表示エリア */}
      <div className="export-content-area">
        {activeTab === 'pdf' ? (
          /* PDF/画像プレビュー */
          <div style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="preview-pdf-info-card">
              <div className="pdf-icon-wrapper">
                <FileText style={{ width: '24px', height: '24px' }} />
              </div>
              <div className="pdf-info-text">
                <h4 className="pdf-info-filename">
                  スキャンドキュメント.pdf
                </h4>
                <p className="pdf-info-meta">
                  {pages.length} ページ • {pdfBlob ? (pdfBlob.size / 1024 / 1024).toFixed(2) : 0} MB
                </p>
              </div>
              <CheckCircle2 style={{ width: '20px', height: '20px', color: '#10b981' }} />
            </div>

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
                      ページ {idx + 1}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownloadWebp(page, idx); }}
                      className="thumbnail-card-download"
                      title="WebPとして保存"
                    >
                      <Download style={{ width: '12px', height: '12px' }} />
                    </button>
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
      <div className="export-footer">
        <button
          onClick={handleShare}
          className="btn-primary-large"
        >
          <Share2 style={{ width: '20px', height: '20px' }} />
          PDFを共有・送信する
        </button>

        <button
          onClick={handleDownloadPdf}
          className="btn-secondary-large"
        >
          <Download style={{ width: '18px', height: '18px' }} />
          PDFをダウンロード保存
        </button>
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

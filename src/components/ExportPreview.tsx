import React, { useEffect, useState, useRef } from 'react';
import { Download, Share2, FileText, Loader2, CheckCircle2, Plus } from 'lucide-react';
import { performOcr } from '../utils/ocrHelper';
import type { OcrResult } from '../utils/ocrHelper';
import { createSearchablePdf } from '../utils/pdfHelper';

interface ExportPreviewProps {
  pages: string[]; // 補正済み画像のDataURL配列
  exportMode: 'pdf' | 'jpeg';
  onComplete: () => void;
  onBackToScanner: () => void;
  onBackToEdit?: () => void;
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
  exportMode,
  onComplete,
  onBackToScanner,
  onBackToEdit
}) => {
  const [ocrResults, setOcrResults] = useState<{ [key: number]: OcrResult }>({});
  const [isProcessing, setIsProcessing] = useState(false); // 初期表示はOCRを実行しないため非ローディング
  const [ocrDone, setOcrDone] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>('pdf');
  const [error, setError] = useState<string | null>(null);
  
  // 拡大プレビュー用のステート
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 撮影日時のタイムスタンプ文字列 (YYYYMMDD_HHMMSS) を生成するヘルパー
  const getFormattedTimestamp = (): string => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
  };



  // 画像を256色（インデックスカラー相当）に減色したPNGのBlobに変換する
  const convertToPngBlob = async (imageSrc: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          
          // 256色への均等量子化減色 (R:3bit, G:3bit, B:2bit)
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.round(data[i] / 36) * 36;
            data[i+1] = Math.round(data[i+1] / 36) * 36;
            data[i+2] = Math.round(data[i+2] / 85) * 85;
          }
          ctx.putImageData(imgData, 0, 0);
          
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("PNG blob generation failed"));
            }
          }, 'image/png');
        } else {
          reject(new Error("Canvas context failed"));
        }
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = imageSrc;
    });
  };





  // PNGとして保存
  const handleDownloadPng = async (imageSrc: string, index: number) => {
    try {
      setIsProcessing(true);
      const blob = await convertToPngBlob(imageSrc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SCAN_${getFormattedTimestamp()}_${String(index + 1).padStart(3, '0')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to convert and download as PNG:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 全ページをPNGとして順次ダウンロード保存
  const handleDownloadAllPngs = async () => {
    for (let i = 0; i < pages.length; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          handleDownloadPng(pages[i], i);
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
        handleDownloadPng(imageSrc, index);
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
      
      for (let i = 0; i < pages.length; i++) {
        const fileName = `SCAN_${getFormattedTimestamp()}_${String(i + 1).padStart(3, '0')}.png`;
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
        handleDownloadAllPngs();
      }
    } catch (err: any) {
      setIsProcessing(false);
      if (err.name === 'AbortError') {
        console.log("PNG sharing was canceled by user.");
        return;
      }
      console.error("Failed to share PNGs:", err);
      handleDownloadAllPngs();
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SCAN_${getFormattedTimestamp()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // DataURL画像(PNG等)を JPEG の File オブジェクトに変換するヘルパー
  const convertToJpegFile = async (imageSrc: string, filename: string): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const file = new File([blob], filename, { type: 'image/jpeg' });
              resolve(file);
            } else {
              reject(new Error("Blob generation failed"));
            }
          }, 'image/jpeg', 0.95);
        } else {
          reject(new Error("Canvas context failed"));
        }
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = imageSrc;
    });
  };

  // JPEG(画像)として保存
  const handleDownloadJpeg = async (imageSrc: string, index: number) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          
          // 画質 95% の JPEG としてエンコード
          const outputUrl = canvas.toDataURL('image/jpeg', 0.95);
          
          const a = document.createElement('a');
          a.href = outputUrl;
          a.download = `SCAN_${getFormattedTimestamp()}_${String(index + 1).padStart(3, '0')}.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      };
      img.src = imageSrc;
    } catch (err) {
      console.error('Failed to convert and download as JPEG:', err);
      // 失敗時のフォールバック (そのままダウンロード)
      const a = document.createElement('a');
      a.href = imageSrc;
      a.download = `SCAN_${getFormattedTimestamp()}_${String(index + 1).padStart(3, '0')}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // 全ページをJPEGとして順次ダウンロード保存
  const handleDownloadAllJpegs = async () => {
    for (let i = 0; i < pages.length; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          handleDownloadJpeg(pages[i], i);
          resolve();
        }, i * 300); // ブラウザブロック防止のため300msの間隔をあける
      });
    }
  };

  // 個別JPEGの共有
  const handleShareSingleJpeg = async (imageSrc: string, index: number) => {
    try {
      const fileName = `SCAN_${getFormattedTimestamp()}_${String(index + 1).padStart(3, '0')}.jpg`;
      const file = await convertToJpegFile(imageSrc, fileName);
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
        });
      } else {
        handleDownloadJpeg(imageSrc, index);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("Single JPEG sharing was canceled by user.");
        return;
      }
      console.error("Failed to share single JPEG:", err);
      handleDownloadJpeg(imageSrc, index);
    }
  };

  // 全ページの一括JPEG共有
  const handleShareJpegs = async () => {
    try {
      setIsProcessing(true);
      const filesList: File[] = [];
      
      for (let i = 0; i < pages.length; i++) {
        const fileName = `SCAN_${getFormattedTimestamp()}_${String(i + 1).padStart(3, '0')}.jpg`;
        const file = await convertToJpegFile(pages[i], fileName);
        filesList.push(file);
      }
      
      setIsProcessing(false);

      if (navigator.canShare && navigator.canShare({ files: filesList })) {
        await navigator.share({
          files: filesList,
        });
      } else {
        handleDownloadAllJpegs();
      }
    } catch (err: any) {
      setIsProcessing(false);
      if (err.name === 'AbortError') {
        console.log("JPEG sharing was canceled by user.");
        return;
      }
      console.error("Failed to share JPEGs:", err);
      handleDownloadAllJpegs();
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
          戻る
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

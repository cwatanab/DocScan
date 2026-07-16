import React, { useState, useRef, useEffect } from 'react';
import { Check, RotateCcw, RotateCw } from 'lucide-react';
import { sortPoints, warpImage, applyFilter, rotateImage90, detectOptimalFilter } from '../utils/opencvHelper';
import type { Point } from '../utils/opencvHelper';

interface DocumentEditorProps {
  imageSrc: string;
  initialCorners: Point[];
  onSave: (warpedImageSrc: string, filterMode: 'color' | 'mono' | 'document', enableOcr: boolean, rect?: DOMRect | null) => void;
  onCancel: () => void;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  imageSrc,
  initialCorners,
  onSave,
  onCancel
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  
  const [corners, setCorners] = useState<Point[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [filterMode, setFilterMode] = useState<'color' | 'mono' | 'document'>('document');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [isWarped, setIsWarped] = useState(false);
  const [warpedImage, setWarpedImage] = useState<string | null>(null);
  // ルーペ（拡大鏡）の状態
  const [loupe, setLoupe] = useState<{ x: number; y: number; display: boolean } | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [enableOcr, setEnableOcr] = useState(false); // OCR実行のトグルステート (デフォルトOFF)

  // 90度時計回り回転処理 (補正後の画像を回転)
  const handleRotate = () => {
    if (!warpedImage) return;
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const rotatedCanvas = rotateImage90(tempCanvas);
        const url = rotatedCanvas.toDataURL('image/jpeg', 0.95);
        setWarpedImage(url);
      }
    };
    img.src = warpedImage;
  };

  // 初期の4隅の設定（画像の大きさが確定した段階で、安全に範囲内にクランプしてセットする）
  useEffect(() => {
    if (initialCorners && initialCorners.length === 4 && imageSize.width > 0 && imageSize.height > 0) {
      const clamped = initialCorners.map(pt => ({
        x: Math.max(0, Math.min(pt.x, imageSize.width)),
        y: Math.max(0, Math.min(pt.y, imageSize.height))
      }));
      setCorners(sortPoints(clamped));
    }
  }, [initialCorners, imageSize]);

  // 画像読み込み完了時のサイズ取得
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    updateDisplaySize();
  };

  // 表示サイズの更新
  const updateDisplaySize = () => {
    if (imageRef.current) {
      setDisplaySize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight
      });
    }
  };

  // ウィンドウリサイズ時・方向変更時の処理
  useEffect(() => {
    window.addEventListener('resize', updateDisplaySize);
    return () => window.removeEventListener('resize', updateDisplaySize);
  }, []);

  // 座標変換: 原寸大画像座標 -> 画面表示座標
  const toDisplayPoint = (pt: Point): Point => {
    if (imageSize.width === 0 || displaySize.width === 0) return { x: 0, y: 0 };
    return {
      x: (pt.x / imageSize.width) * displaySize.width,
      y: (pt.y / imageSize.height) * displaySize.height
    };
  };

  // 座標変換: 画面表示座標 -> 原寸大画像座標
  const toImagePoint = (x: number, y: number): Point => {
    if (displaySize.width === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min((x / displaySize.width) * imageSize.width, imageSize.width)),
      y: Math.max(0, Math.min((y / displaySize.height) * imageSize.height, imageSize.height))
    };
  };

  // ドラッグ開始
  const handleStart = (index: number) => {
    setDraggedIndex(index);
  };

  // ドラッグ中・移動
  const handleMove = (clientX: number, clientY: number) => {
    if (draggedIndex === null || !imageRef.current || !canvasRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const boundedX = Math.max(0, Math.min(x, displaySize.width));
    const boundedY = Math.max(0, Math.min(y, displaySize.height));

    const newImagePoint = toImagePoint(boundedX, boundedY);

    setCorners(prev => {
      const next = [...prev];
      next[draggedIndex] = newImagePoint;
      return next;
    });

    setLoupe({
      x: boundedX,
      y: boundedY,
      display: true
    });

    drawLoupe(newImagePoint);
  };

  // ルーペ（拡大鏡）のキャンバス描画
  const drawLoupe = (imgPt: Point) => {
    const loupeCanvas = loupeCanvasRef.current;
    if (!loupeCanvas || !imageRef.current) return;
    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) return;

    // Retina/高解像度対応のため、実ピクセルサイズは300px（CSSで150pxに縮小）
    const size = 300;
    loupeCanvas.width = size;
    loupeCanvas.height = size;

    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();

    // 切り取り元のサイズ (180pxを300pxに拡大＝約1.66倍拡大。拡大率を抑えて周囲の状況を把握しやすくする)
    const sourceSize = 180;
    ctx.drawImage(
      imageRef.current,
      imgPt.x - sourceSize / 2,
      imgPt.y - sourceSize / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size
    );

    // 十字線の描画
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4; // 太くして見やすく
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    // 白い外枠の描画
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8; // 太くして見やすく
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  };

  // ドラッグ終了
  const handleEnd = () => {
    setDraggedIndex(null);
    setLoupe(null);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (draggedIndex === null) return;
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggedIndex === null) return;
    handleMove(e.clientX, e.clientY);
  };

  // 台形補正のプレビュー実行
  const handleWarpPreview = (autoDetectFilter: boolean = false) => {
    if (corners.length !== 4) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageSize.width;
    tempCanvas.height = imageSize.height;
    const ctx = tempCanvas.getContext('2d');
    
    if (ctx && imageRef.current) {
      ctx.drawImage(imageRef.current, 0, 0);
      const warpedCanvas = warpImage(tempCanvas, corners);
      
      let targetFilterMode = filterMode;
      
      if (autoDetectFilter) {
        // 画像の色彩や標準偏差から、最適なフィルターモードを自動判定
        targetFilterMode = detectOptimalFilter(warpedCanvas);
        setFilterMode(targetFilterMode); // UIの選択状態を更新
      }
      
      const filteredCanvas = applyFilter(warpedCanvas, targetFilterMode);
      const url = filteredCanvas.toDataURL('image/jpeg', 0.95);
      setWarpedImage(url);
      setIsWarped(true);
    }
  };

  // フィルタ切り替え時のプレビュー再実行
  useEffect(() => {
    if (isWarped) {
      handleWarpPreview(false); // 手動での切り替え時は自動判定をスキップ
    }
  }, [filterMode]);

  // 確定して保存
  const handleConfirm = () => {
    let rect: DOMRect | null = null;
    if (previewImageRef.current) {
      rect = previewImageRef.current.getBoundingClientRect();
    }

    if (warpedImage) {
      onSave(warpedImage, filterMode, enableOcr, rect);
    } else {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageSize.width;
      tempCanvas.height = imageSize.height;
      const ctx = tempCanvas.getContext('2d');
      if (ctx && imageRef.current) {
        ctx.drawImage(imageRef.current, 0, 0);
        const warpedCanvas = warpImage(tempCanvas, corners);
        const filteredCanvas = applyFilter(warpedCanvas, filterMode);
        const url = filteredCanvas.toDataURL('image/jpeg', 0.95);
        onSave(url, filterMode, enableOcr, rect);
      }
    }
  };

  // リセット
  const handleReset = () => {
    if (imageSize.width > 0) {
      const defaultCorners = [
        { x: imageSize.width * 0.1, y: imageSize.height * 0.1 },
        { x: imageSize.width * 0.9, y: imageSize.height * 0.1 },
        { x: imageSize.width * 0.9, y: imageSize.height * 0.9 },
        { x: imageSize.width * 0.1, y: imageSize.height * 0.9 }
      ];
      setCorners(defaultCorners);
    }
    setIsWarped(false);
    setWarpedImage(null);
  };

  return (
    <div className="editor-container"
         onTouchMove={handleTouchMove}
         onTouchEnd={handleEnd}
         onMouseMove={handleMouseMove}
         onMouseUp={handleEnd}
    >
      {/* ヘッダーバー */}
      <div className="header-bar">
        <button
          onClick={onCancel}
          className="btn-text-nav"
        >
          キャンセル
        </button>
        <h3 style={{ fontSize: '16px', fontWeight: '600' }}>
          {isWarped ? 'フィルタ適用' : 'トリミング調整'}
        </h3>
        <button
          onClick={isWarped ? handleConfirm : () => handleWarpPreview(true)}
          className="btn-text-nav btn-text-accent"
        >
          {isWarped ? <Check style={{ width: '16px', height: '16px', marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }} /> : null}
          {isWarped ? '確定' : '補正実行'}
        </button>
      </div>

      {/* 編集領域 */}
      <div className="editor-workspace">
        {isWarped && warpedImage && (
          /* 補正完了プレビュー */
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '100%', maxHeight: '100%' }}>
            <img
              ref={previewImageRef}
              src={warpedImage}
              alt="Warped preview"
              className="editor-image-preview"
            />
          </div>
        )}

        {/* トリミングハンドル微調整 */}
        {/* filterModeの切り替え時にimageRef.currentがnullになるのを防ぐため、アンマウントせずdisplay: noneで制御 */}
        {/* inline-blockにすることで、コンテナのサイズが画像(img)の表示アスペクト比サイズと自動で100%完全一致します */}
        <div
          ref={containerRef}
          className="editor-interactive-canvas"
          style={{ 
            display: isWarped ? 'none' : 'inline-block',
            position: 'relative'
          }}
        >
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Raw document"
              onLoad={handleImageLoad}
              className="editor-image-preview"
              style={{ 
                pointerEvents: 'none',
                display: 'block' // 画像の下部に生じるインライン隙間(隙間)を防止
              }}
            />

            {/* ガイドライン (SVG) */}
            {displaySize.width > 0 && corners.length === 4 && (
              <svg
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: displaySize.width,
                  height: displaySize.height,
                  pointerEvents: 'none'
                }}
              >
                <polygon
                  points={corners.map(pt => `${toDisplayPoint(pt).x},${toDisplayPoint(pt).y}`).join(' ')}
                  fill="rgba(99, 102, 241, 0.15)"
                  stroke="#6366f1"
                  strokeWidth="3"
                />
              </svg>
            )}

            {/* ドラッグ可能な丸ピン */}
            {displaySize.width > 0 && corners.map((pt, idx) => {
              const displayPt = toDisplayPoint(pt);
              return (
                <div
                  key={idx}
                  className="crop-handle"
                  style={{
                    left: displayPt.x,
                    top: displayPt.y,
                    zIndex: draggedIndex === idx ? 30 : 20,
                  }}
                  onTouchStart={(e) => { e.stopPropagation(); handleStart(idx); }}
                  onMouseDown={(e) => { e.stopPropagation(); handleStart(idx); }}
                >
                  <div className="crop-handle-pin">
                    <div className="crop-handle-inner" />
                  </div>
                </div>
              );
            })}

            {/* ルーペ (拡大鏡) ポップアップ */}
            {loupe && loupe.display && (
              <div
                className="loupe-popup"
                style={{
                  // 画面左右端からはみ出さないようにクランプ (ルーペ径150pxなので中心から75pxマージン)
                  left: Math.max(75, Math.min(loupe.x, displaySize.width - 75)),
                  // 指から180px離す。上端(10px未満)に近すぎる場合は指の下側(60px)に反転して表示
                  top: loupe.y - 180 < 10 ? loupe.y + 60 : loupe.y - 180,
                }}
              >
                <canvas
                  ref={loupeCanvasRef}
                  className="loupe-canvas"
                  style={{ width: 150, height: 150 }}
                />
              </div>
            )}
          </div>
          
          {/* 一時キャンバス */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {/* 下部コントロールエリア */}
      <div className="editor-footer">
        {isWarped ? (
          /* フィルタ切り替えモード */
          <div className="filter-tabs-container">
            <span className="filter-tabs-label">
              フィルター選択
            </span>
            <div className="filter-tabs">
              <button
                onClick={() => setFilterMode('document')}
                className={`filter-tab-btn ${filterMode === 'document' ? 'filter-tab-btn-active' : ''}`}
              >
                ドキュメント
              </button>
              <button
                onClick={() => setFilterMode('mono')}
                className={`filter-tab-btn ${filterMode === 'mono' ? 'filter-tab-btn-active' : ''}`}
              >
                白黒
              </button>
              <button
                onClick={() => setFilterMode('color')}
                className={`filter-tab-btn ${filterMode === 'color' ? 'filter-tab-btn-active' : ''}`}
              >
                カラー
              </button>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                onClick={handleRotate}
                className="btn-secondary-full"
                style={{ flex: 1, marginTop: 0 }}
              >
                <RotateCw style={{ width: '16px', height: '16px' }} />
                右90°回転
              </button>
              <button
                onClick={() => setIsWarped(false)}
                className="btn-secondary-full"
                style={{ flex: 1, marginTop: 0 }}
              >
                <RotateCcw style={{ width: '16px', height: '16px' }} />
                範囲調整に戻る
              </button>
            </div>

            {/* OCRオンオフトグルスイッチ (インライン型: 左側にスイッチ、右側にラベル) */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '10px', width: '100%', padding: '6px 4px', margin: '8px 0 4px 0' }}>
              <label className="switch-toggle-mini">
                <input 
                  type="checkbox" 
                  checked={enableOcr} 
                  onChange={(e) => setEnableOcr(e.target.checked)} 
                />
                <span className="switch-slider-mini"></span>
              </label>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>OCRを行う</span>
            </div>
          </div>
        ) : (
          /* 範囲調整モード */
          <div className="editor-footer-row">
            <button
              onClick={handleReset}
              className="btn-secondary-text"
            >
              <RotateCcw style={{ width: '16px', height: '16px' }} />
              リセット
            </button>
            
            <span className="footer-text-hint">
              4つの角をドラッグして書類に合わせてください
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

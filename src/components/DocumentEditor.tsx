import React, { useState, useRef, useEffect } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { warpImage, rotateImage90, detectOptimalFilter, processWarpAndFilter } from '../utils/opencvHelper';
import type { Point } from '../utils/opencvHelper';
import { useCropHandles } from './useCropHandles';

interface DocumentEditorProps {
  imageSrc: string;
  initialCorners: Point[];
  onSave: (warpedImageSrc: string, filterMode: 'color' | 'document', enableOcr: boolean, corners: Point[], rect?: DOMRect | null) => void;
  onCancel: () => void;
  initialIsWarped?: boolean;
  initialFilterMode?: 'color' | 'document';
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  imageSrc,
  initialCorners,
  onSave,
  onCancel,
  initialIsWarped = false,
  initialFilterMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  
  const [filterMode, setFilterMode] = useState<'color' | 'document'>(initialFilterMode || 'document');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [isWarped, setIsWarped] = useState(initialIsWarped);
  const [warpedImage, setWarpedImage] = useState<string | null>(null);
  // 保存形式の記憶 (localStorage から復元)
  const [enableOcr, setEnableOcr] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('docscan_enable_ocr');
      return saved ? JSON.parse(saved) : false;
    } catch (e) {
      return false;
    }
  });

  const handleToggleOcr = (val: boolean) => {
    setEnableOcr(val);
    try {
      localStorage.setItem('docscan_enable_ocr', JSON.stringify(val));
    } catch (e) {
      console.warn("Failed to persist ocr state:", e);
    }
  };

  // カスタムフックを呼び出して、ピンのドラッグと拡大ルーペのロジックを一括委譲
  const {
    corners,
    draggedIndex,
    loupe,
    loupeCanvasRef,
    toDisplayPoint,
    handleStart,
    handleMove,
    handleEnd
  } = useCropHandles({
    initialCorners,
    imageSize,
    displaySize,
    imageRef
  });

  // 90度回転処理 (補正後の画像を回転。左右指定可能)
  const handleRotate = (clockwise: boolean = true) => {
    if (!warpedImage) return;
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const rotatedCanvas = rotateImage90(tempCanvas, clockwise);
        const url = rotatedCanvas.toDataURL('image/jpeg', 0.95);
        setWarpedImage(url);
      }
    };
    img.src = warpedImage;
  };

  // initialIsWarpedがtrueの場合、画像サイズと4隅確定後に自動で台形補正を実行する
  useEffect(() => {
    if (initialIsWarped && imageSize.width > 0 && corners.length === 4 && !warpedImage) {
      handleWarpPreview(false); // 初回自動補正を実行
    }
  }, [initialIsWarped, imageSize, corners, warpedImage]);

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

  // 非表示(display: none)から表示に切り替わった瞬間に表示サイズを再計測・更新する
  useEffect(() => {
    if (!isWarped) {
      const timer = setTimeout(() => {
        updateDisplaySize();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isWarped]);

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
    if (corners.length !== 4 || !imageRef.current) return;

    let targetFilterMode = filterMode;

    if (autoDetectFilter) {
      // 一時的な台形補正を行い、最適なフィルターモードを自動判定する
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageSize.width;
      tempCanvas.height = imageSize.height;
      const ctx = tempCanvas.getContext('2d');
      
      if (ctx) {
        ctx.drawImage(imageRef.current, 0, 0);
        const warpedCanvas = warpImage(tempCanvas, corners);
        targetFilterMode = detectOptimalFilter(warpedCanvas);
        setFilterMode(targetFilterMode); // UIの選択状態を更新
      }
    }
    
    const url = processWarpAndFilter(imageRef.current, corners, targetFilterMode);
    if (url) {
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
      onSave(warpedImage, filterMode, enableOcr, corners, rect);
    } else if (imageRef.current) {
      const url = processWarpAndFilter(imageRef.current, corners, filterMode);
      if (url) {
        onSave(url, filterMode, enableOcr, corners, rect);
      }
    }
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
          onClick={isWarped ? () => setIsWarped(false) : onCancel}
          className="btn-text-nav"
        >
          {"< 戻る"}
        </button>
        <h3 style={{ fontSize: '16px', fontWeight: '600' }}>
          {isWarped ? 'フィルタ適用' : 'トリミング調整'}
        </h3>
        <button
          onClick={isWarped ? handleConfirm : () => handleWarpPreview(true)}
          className="btn-text-nav btn-text-accent"
        >
          {isWarped ? '確定 >' : '次へ >'}
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
            {loupe && (
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
      </div>

      {/* 下部コントロールエリア (フィルタ適用モードの時のみフッターパネルを表示) */}
      {isWarped && (
        <div className="editor-footer" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 行1: フィルター選択 */}
          <div className="filter-tabs-container">
            <span className="filter-tabs-label">
              モード
            </span>
            <div className="filter-tabs">
              <button
                type="button"
                onClick={() => setFilterMode('document')}
                className={`filter-tab-btn ${filterMode === 'document' ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
              >
                ドキュメント
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('color')}
                className={`filter-tab-btn ${filterMode === 'color' ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
              >
                カラー
              </button>
            </div>
          </div>
          
          {/* 行2: 画像の回転 */}
          <div className="filter-tabs-container">
            <span className="filter-tabs-label">
              画像の回転
            </span>
            <div className="filter-tabs">
              <button
                type="button"
                onClick={() => handleRotate(false)} // 左90° (CCW)
                className="filter-tab-btn"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <RotateCcw style={{ width: '12px', height: '12px' }} />
                左90°
              </button>
              <button
                type="button"
                onClick={() => handleRotate(true)} // 右90° (CW)
                className="filter-tab-btn"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <RotateCw style={{ width: '12px', height: '12px' }} />
                右90°
              </button>
            </div>
          </div>

          {/* 行3: 保存形式 */}
          <div className="filter-tabs-container">
            <span className="filter-tabs-label">
              保存形式
            </span>
            <div className="filter-tabs">
              <button
                type="button"
                onClick={() => handleToggleOcr(true)}
                className={`filter-tab-btn ${enableOcr ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
              >
                PDF(OCR)
              </button>
              <button
                type="button"
                onClick={() => handleToggleOcr(false)}
                className={`filter-tab-btn ${!enableOcr ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
              >
                PNG/JPEG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

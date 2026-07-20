import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { loadOpenCV, detectOptimalFilter, processWarpAndFilter, isOpenCvReady } from '../utils/opencvHelper';
import type { Point, FilterMode } from '../utils/opencvHelper';
import {
  combineFilterMode,
  getColorMode,
  getEnhancementMode,
  type ColorMode,
  type EnhancementMode
} from '../utils/filterMode';
import { loadJson, saveJson, STORAGE_KEY_ENABLE_OCR } from '../utils/storage';
import { useCropHandles } from './useCropHandles';
import { OpenCvInitializer } from './OpenCvInitializer';

interface DocumentEditorProps {
  imageSrc: string;
  initialCorners: Point[];
  onSave: (
    warpedImageSrc: string,
    filterMode: FilterMode,
    enableOcr: boolean,
    corners: Point[],
    rect?: DOMRect | null
  ) => void;
  onCancel: () => void;
  initialIsWarped?: boolean;
  initialFilterMode?: FilterMode;
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
  const warpInFlightRef = useRef(false);
  const [cvReady, setCvReady] = useState(() => isOpenCvReady());
  const [cvError, setCvError] = useState<string | null>(null);
  const [warpError, setWarpError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<FilterMode>(
    initialFilterMode || 'document_enhanced'
  );

  const colorMode = getColorMode(filterMode);
  const enhancementMode = getEnhancementMode(filterMode);

  const handleSetColorMode = (newColorMode: ColorMode) => {
    setFilterMode(combineFilterMode(newColorMode, enhancementMode));
  };

  const handleSetEnhancementMode = (newEnhancementMode: EnhancementMode) => {
    setFilterMode(combineFilterMode(colorMode, newEnhancementMode));
  };

  const [rotation, setRotation] = useState(0);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  // 再編集復帰時もプレビュー生成完了まではトリミング側を維持し、空のフィルター画面を出さない
  const [isWarped, setIsWarped] = useState(false);
  const [warpedImage, setWarpedImage] = useState<string | null>(null);
  const [isWarping, setIsWarping] = useState(false);
  const [enableOcr, setEnableOcr] = useState<boolean>(() =>
    loadJson(STORAGE_KEY_ENABLE_OCR, false)
  );
  const autoWarpOnMountRef = useRef(initialIsWarped);

  const handleToggleOcr = (val: boolean) => {
    setEnableOcr(val);
    saveJson(STORAGE_KEY_ENABLE_OCR, val);
  };

  useEffect(() => {
    if (cvReady) return;

    let cancelled = false;

    loadOpenCV(90000)
      .then(() => {
        if (!cancelled) setCvReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[DocumentEditor] OpenCV load failed:', err);
        setCvError(err.message || 'OpenCV.js の読み込みに失敗しました。');
      });

    return () => {
      cancelled = true;
    };
  }, [cvReady]);

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

  const updateDisplaySize = useCallback(() => {
    if (imageRef.current) {
      setDisplaySize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight
      });
    }
  }, []);

  const handleRotate = useCallback((clockwise: boolean = true) => {
    setRotation((prev) => (clockwise ? (prev + 90) % 360 : (prev - 90 + 360) % 360));
  }, []);

  const handleWarpPreview = useCallback(
    async (autoDetectFilter: boolean = false, targetRotation: number = rotation) => {
      if (!cvReady) return;
      if (corners.length !== 4) return;
      if (warpInFlightRef.current) return;

      warpInFlightRef.current = true;
      setIsWarping(true);
      setWarpError(null);

      try {
        let targetFilterMode = filterMode;

        if (autoDetectFilter) {
          const { mode } = await detectOptimalFilter(imageSrc, corners);
          targetFilterMode = mode;
          setFilterMode(targetFilterMode);
        }

        // await 後もソース画像が使えることを確認する
        const sourceEl = imageRef.current;
        if (!sourceEl || !(sourceEl.naturalWidth || sourceEl.width)) {
          throw new Error('ソース画像の読み込みが完了していません');
        }

        const url = processWarpAndFilter(
          sourceEl,
          corners,
          targetFilterMode,
          targetRotation
        );
        if (!url) {
          throw new Error('画像の補正に失敗しました');
        }

        setWarpedImage(url);
        setIsWarped(true);
      } catch (err) {
        console.error('[DocumentEditor] warp preview failed:', err);
        setWarpError(
          err instanceof Error ? err.message : '画像の補正に失敗しました。もう一度お試しください。'
        );
      } finally {
        warpInFlightRef.current = false;
        setIsWarping(false);
      }
    },
    [corners, filterMode, rotation, cvReady, imageSrc]
  );

  // 再編集復帰時: 画像サイズと 4 隅が揃ったら自動でフィルター画面へ
  useEffect(() => {
    if (!cvReady) return;
    if (!autoWarpOnMountRef.current) return;
    if (imageSize.width <= 0 || corners.length !== 4) return;
    if (warpedImage) return;

    autoWarpOnMountRef.current = false;
    void handleWarpPreview(false);
  }, [cvReady, imageSize, corners, warpedImage, handleWarpPreview]);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      updateDisplaySize();
    },
    [updateDisplaySize]
  );

  useEffect(() => {
    window.addEventListener('resize', updateDisplaySize);
    return () => window.removeEventListener('resize', updateDisplaySize);
  }, [updateDisplaySize]);

  useEffect(() => {
    if (!isWarped) {
      const timer = setTimeout(() => {
        updateDisplaySize();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isWarped, updateDisplaySize]);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (draggedIndex === null) return;
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [draggedIndex, handleMove]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (draggedIndex === null) return;
      handleMove(e.clientX, e.clientY);
    },
    [draggedIndex, handleMove]
  );

  // フィルター／回転変更時にプレビューを再生成する
  // isWarped 入場時の二重実行は skipInitial で避ける（入場時は handleWarpPreview が既に生成済み）
  const prevFilterRotationRef = useRef<{ filterMode: FilterMode; rotation: number } | null>(null);
  useEffect(() => {
    if (!cvReady || !isWarped) {
      if (!isWarped) {
        prevFilterRotationRef.current = null;
      }
      return;
    }

    const prev = prevFilterRotationRef.current;
    prevFilterRotationRef.current = { filterMode, rotation };

    if (!prev) return;
    if (prev.filterMode === filterMode && prev.rotation === rotation) return;

    void handleWarpPreview(false, rotation);
  }, [filterMode, rotation, isWarped, handleWarpPreview, cvReady]);

  const handleConfirm = useCallback(() => {
    if (!cvReady) return;
    const rect = previewImageRef.current?.getBoundingClientRect() ?? null;

    if (warpedImage) {
      onSave(warpedImage, filterMode, enableOcr, corners, rect);
    } else if (imageRef.current) {
      const url = processWarpAndFilter(imageRef.current, corners, filterMode, rotation);
      if (url) {
        onSave(url, filterMode, enableOcr, corners, rect);
      }
    }
  }, [warpedImage, onSave, filterMode, enableOcr, corners, rotation, cvReady]);

  if (!cvReady) {
    return <OpenCvInitializer cvError={cvError} />;
  }

  return (
    <div
      className="editor-container"
      onTouchMove={handleTouchMove}
      onTouchEnd={handleEnd}
      onMouseMove={handleMouseMove}
      onMouseUp={handleEnd}
    >
      <div className="header-bar">
        <button
          onClick={isWarped ? () => setIsWarped(false) : onCancel}
          className="btn-text-nav"
          disabled={isWarping}
        >
          {'< 戻る'}
        </button>
        <h3 style={{ fontSize: '16px', fontWeight: '600' }}>
          {isWarped ? 'フィルター適用' : 'トリミング調整'}
        </h3>
        <button
          onClick={isWarped ? handleConfirm : () => void handleWarpPreview(true)}
          className="btn-text-nav btn-text-accent"
          disabled={isWarping}
        >
          {isWarping ? '処理中…' : '次へ >'}
        </button>
      </div>

      {warpError && (
        <div className="toast-banner toast-banner-warning" role="alert">
          <p className="toast-banner-text">{warpError}</p>
          <button type="button" className="toast-banner-dismiss" onClick={() => setWarpError(null)}>
            閉じる
          </button>
        </div>
      )}

      <div className="editor-workspace">
        {isWarping && !warpedImage && (
          <div className="editor-warp-loading">
            <div className="spinner spinner-large" />
            <p>画像を補正しています…</p>
          </div>
        )}

        {isWarped && warpedImage && (
          <div className={`editor-preview-wrap${isWarping ? ' editor-preview-wrap-busy' : ''}`}>
            <img
              ref={previewImageRef}
              src={warpedImage}
              alt="Warped preview"
              className="editor-image-preview"
            />
          </div>
        )}

        {/*
          display:none だと一部環境でピクセル読み出しに失敗するため、
          フィルター画面中は視覚的に隠すだけにして DOM 上は維持する。
        */}
        <div
          ref={containerRef}
          className="editor-interactive-canvas"
          style={{
            position: isWarped || isWarping ? 'absolute' : 'relative',
            visibility: isWarped || isWarping ? 'hidden' : 'visible',
            pointerEvents: isWarped || isWarping ? 'none' : 'auto',
            left: isWarped || isWarping ? 0 : undefined,
            top: isWarped || isWarping ? 0 : undefined
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
              display: 'block'
            }}
          />

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
                points={corners
                  .map((pt) => `${toDisplayPoint(pt).x},${toDisplayPoint(pt).y}`)
                  .join(' ')}
                fill="rgba(99, 102, 241, 0.15)"
                stroke="#6366f1"
                strokeWidth="3"
              />
            </svg>
          )}

          {displaySize.width > 0 &&
            corners.map((pt, idx) => {
              const displayPt = toDisplayPoint(pt);
              return (
                <div
                  key={idx}
                  className="crop-handle"
                  style={{
                    left: displayPt.x,
                    top: displayPt.y,
                    zIndex: draggedIndex === idx ? 30 : 20
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    handleStart(idx);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleStart(idx);
                  }}
                >
                  <div className="crop-handle-pin">
                    <div className="crop-handle-inner" />
                  </div>
                </div>
              );
            })}

          {loupe && (
            <div
              className="loupe-popup"
              style={{
                left: Math.max(75, Math.min(loupe.x, displaySize.width - 75)),
                top: loupe.y - 180 < 10 ? loupe.y + 60 : loupe.y - 180
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

      {isWarped && (
        <div className="editor-footer" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="filter-tabs-container">
            <span className="filter-tabs-label">ドキュメント</span>
            <div className="filter-tabs">
              <button
                type="button"
                onClick={() => handleSetColorMode('color')}
                className={`filter-tab-btn ${colorMode === 'color' ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
                disabled={isWarping}
              >
                カラー
              </button>
              <button
                type="button"
                onClick={() => handleSetColorMode('document')}
                className={`filter-tab-btn ${colorMode === 'document' ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
                disabled={isWarping}
              >
                白黒
              </button>
            </div>
          </div>

          <div className="filter-tabs-container">
            <span className="filter-tabs-label">画像補正</span>
            <div className="filter-tabs">
              <button
                type="button"
                onClick={() => handleSetEnhancementMode('enhanced')}
                className={`filter-tab-btn ${enhancementMode === 'enhanced' ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
                disabled={isWarping}
              >
                あり
              </button>
              <button
                type="button"
                onClick={() => handleSetEnhancementMode('original')}
                className={`filter-tab-btn ${enhancementMode === 'original' ? 'filter-tab-btn-active' : ''}`}
                style={{ flex: 1 }}
                disabled={isWarping}
              >
                なし
              </button>
            </div>
          </div>

          <div className="filter-tabs-container">
            <span className="filter-tabs-label">保存形式</span>
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

          <div className="filter-tabs-container">
            <span className="filter-tabs-label">画像の回転</span>
            <div className="filter-action-btns">
              <button
                type="button"
                onClick={() => handleRotate(false)}
                className="filter-action-btn"
                disabled={isWarping}
              >
                <RotateCcw className="filter-action-btn-icon" />
                左90°
              </button>
              <button
                type="button"
                onClick={() => handleRotate(true)}
                className="filter-action-btn"
                disabled={isWarping}
              >
                <RotateCw className="filter-action-btn-icon" />
                右90°
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

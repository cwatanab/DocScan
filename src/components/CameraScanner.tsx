import React, { useEffect, useRef } from 'react';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import type { Point } from '../utils/geometry';
import { detectDocumentWithFallback, getDefaultCorners } from '../utils/docSegHelper';
import { useCameraStream } from './useCameraStream';
import { resizeCanvas, clearAppCacheAndReload, isLocalExecution } from '../utils/imageExportHelper';
import { useScannerDetection } from './useScannerDetection';
import {
  getCaptureQualityGuidance,
  QUALITY_FRAME_COLORS
} from '../utils/opencvHelper';

interface CameraScannerProps {
  onCapture: (imageSrc: string, initialCorners: Point[]) => void;
  onCancel?: () => void;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isSleeping, setIsSleeping] = React.useState(false);
  const lastActiveTimeRef = useRef<number>(Date.now());
  const SLEEP_TIMEOUT = 30000; // 30秒枠線未検出で省電力スリープモードへ
  
  // カメラストリーム制御のカスタムフック呼び出し
  const {
    cameraActive,
    errorMsg,
    stopCamera: stopCameraStream,
    animationFrameRef
  } = useCameraStream({ videoRef, enabled: !isSleeping });

  // AI 境界検出・画質評価・キャッシュバッファ
  const {
    aiModelLoaded,
    frameQuality,
    processDetectionFrame,
    getBestCachedFrame,
    resetDetection
  } = useScannerDetection({ cameraActive });

  const qualityLevelForFrame =
    frameQuality.level === 'none' ? 'good' : frameQuality.level;
  const frameColors = QUALITY_FRAME_COLORS[qualityLevelForFrame];
  const guidanceText = getCaptureQualityGuidance(frameQuality.level, frameQuality.reasons);
  const guidanceToneClass =
    frameQuality.level === 'poor'
      ? 'scanner-guidance-poor'
      : frameQuality.level === 'fair'
        ? 'scanner-guidance-fair'
        : frameQuality.level === 'good'
          ? 'scanner-guidance-good'
          : 'scanner-guidance-none';

  // カメラ停止とキャッシュバッファのクリア
  const stopCamera = () => {
    stopCameraStream();
    resetDetection();
  };

  // スリープからの復帰
  const handleWakeUp = () => {
    lastActiveTimeRef.current = Date.now();
    setIsSleeping(false);
  };

  // スマートフォンの画面ON/OFF（画面ロック・アプリ切替など）を検知して省電力スリープへ移行
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsSleeping(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 枠色は React state 経由で最新値を ref に載せ、rAF ループから参照する
  const frameColorsRef = useRef(frameColors);
  frameColorsRef.current = frameColors;

  // リアルタイム輪郭検出ループ
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCanvas = overlayCanvasRef.current;
    const oCtx = overlayCanvas?.getContext('2d');

    let smoothCorners: Point[] | null = null;

    const processFrame = async () => {
      if (video.paused || video.ended) return;

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        if (
          overlayCanvas &&
          (overlayCanvas.width !== video.videoWidth || overlayCanvas.height !== video.videoHeight)
        ) {
          overlayCanvas.width = video.videoWidth;
          overlayCanvas.height = video.videoHeight;
        }

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          smoothCorners = await processDetectionFrame(canvas);

          if (smoothCorners) {
            lastActiveTimeRef.current = Date.now();
          } else {
            const inactiveDuration = Date.now() - lastActiveTimeRef.current;
            if (inactiveDuration > SLEEP_TIMEOUT) {
              setIsSleeping(true);
            }
          }
        }

        // 画質に応じた色の枠線（透過オーバーレイ）
        if (oCtx && overlayCanvas) {
          oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

          if (smoothCorners) {
            const colors = frameColorsRef.current;
            oCtx.strokeStyle = colors.stroke;
            oCtx.lineWidth = 6;
            oCtx.fillStyle = colors.fill;

            oCtx.beginPath();
            oCtx.moveTo(smoothCorners[0].x, smoothCorners[0].y);
            oCtx.lineTo(smoothCorners[1].x, smoothCorners[1].y);
            oCtx.lineTo(smoothCorners[2].x, smoothCorners[2].y);
            oCtx.lineTo(smoothCorners[3].x, smoothCorners[3].y);
            oCtx.closePath();
            oCtx.stroke();
            oCtx.fill();

            oCtx.fillStyle = '#ffffff';
            smoothCorners.forEach((pt) => {
              oCtx.beginPath();
              oCtx.arc(pt.x, pt.y, 12, 0, 2 * Math.PI);
              oCtx.fill();
              oCtx.strokeStyle = colors.corner;
              oCtx.lineWidth = 3;
              oCtx.stroke();
            });
          }
        }
      }

      if (cameraActive) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
      }
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [cameraActive, aiModelLoaded, processDetectionFrame, animationFrameRef]);

  // シャッターを切る (キャッシュバッファから最もピントが合った＝エッジの立った写真を自動選択)
  const handleShutter = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    try {
      const bestFrame = getBestCachedFrame();
      if (bestFrame) {
        // 1回だけ toDataURL を実行
        const dataUrl = bestFrame.canvas.toDataURL('image/jpeg', 0.95);
        
        // キャッシュデータを読み込み終わった後にカメラ停止＆キャッシュクリアを行う
        stopCamera();
        onCapture(dataUrl, bestFrame.corners);
      } else {
        // キャッシュが空の場合のフォールバック (現在のフレームを静的キャプチャし、安全な解像度1600pxに縮小)
        const video = videoRef.current;
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;
        const ctx = captureCanvas.getContext('2d');
        
        if (ctx) {
          ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
          // 縮小処理を適用 (メモリ・処理フリーズ対策)
          const resized = resizeCanvas(captureCanvas, 1600);
          const dataUrl = resized.toDataURL('image/jpeg', 0.92);
          
          const rawCorners = await detectDocumentWithFallback(resized, aiModelLoaded);
          
          stopCamera();
          onCapture(dataUrl, rawCorners);
        }
      }
    } catch (err) {
      console.error("Shutter release failed: ", err);
      // 万が一の例外発生時も、最低限のフォールバックで画面遷移をブロックしない
      onCapture(canvasRef.current.toDataURL('image/jpeg', 0.9), getDefaultCorners(canvasRef.current.width, canvasRef.current.height));
    }
  };

  // ファイルインポート
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = async () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          
          const corners = await detectDocumentWithFallback(tempCanvas, aiModelLoaded);
          
          stopCamera();
          onCapture(dataUrl, corners);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };


  return (
    <div ref={containerRef} className="scanner-container">
      {/* ビデオプレビュー (全画面表示) */}
      <div className="scanner-preview">

        {errorMsg ? (
          <div className="scanner-error-container">
            <p>{errorMsg}</p>
            <input
              type="file"
              accept="image/*"
              id="file-fallback"
              className="hidden"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <label
              htmlFor="file-fallback"
              className="btn-primary-small"
            >
              <ImageIcon style={{ width: '18px', height: '18px', marginRight: '8px' }} />
              ライブラリから画像を選択
            </label>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="scanner-video-feed"
              playsInline
              muted
              style={{ opacity: 0, position: 'absolute', pointerEvents: 'none' }}
            />
            {/* 生映像のみを描画するCanvas */}
            <canvas
              ref={canvasRef}
              className="scanner-video-feed"
            />
            {/* 透過ガイド線のみを描画するCanvas */}
            <canvas
              ref={overlayCanvasRef}
              className="scanner-canvas-overlay"
            />
            {/* アプリロゴ・タイトル・ガイダンス統合オーバーレイ */}
            <div className="scanner-header-overlay">
              <div className="scanner-logo-wrapper">
                <img src="/favicon.ico" alt="" className="scanner-logo-icon" />
              </div>
              <div className="scanner-header-content">
                <h1 className="scanner-title">DocScan <span style={{ fontSize: '0.55em', opacity: 0.6, marginLeft: '6px', fontWeight: 'normal', verticalAlign: 'middle', WebkitTextFillColor: '#ffffff', WebkitBackgroundClip: 'unset', background: 'none' }}>v0.1</span></h1>
                <p className={`scanner-guidance-text ${guidanceToneClass}`}>{guidanceText}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* コントロールバー */}
      <div className="scanner-controls">
        {/* 左側エリア (閉じるボタン + キャッシュクリアボタン) - 幅固定で対称性を維持 */}
        <div style={{ width: '120px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-start' }}>
          {onCancel && (
            <button
              onClick={onCancel}
              className="scanner-close-btn"
              style={{ padding: '8px 0', minWidth: '48px', margin: 0 }}
            >
              閉じる
            </button>
          )}
          {isLocalExecution() && (
            <button
              onClick={() => {
                if (window.confirm("アプリのキャッシュをクリアして再起動しますか？")) {
                  clearAppCacheAndReload();
                }
              }}
              className="scanner-btn-secondary"
              style={{ width: '44px', height: '44px', padding: 0 }}
              title="キャッシュをクリアして再起動"
            >
              <RefreshCw style={{ width: '18px', height: '18px' }} />
            </button>
          )}
        </div>

        <button
          onClick={handleShutter}
          disabled={!cameraActive}
          className={`scanner-shutter-btn scanner-shutter-${qualityLevelForFrame}`}
          style={
            frameQuality.level !== 'none'
              ? { borderColor: frameColors.stroke }
              : undefined
          }
          title={guidanceText}
        >
          <div className="scanner-shutter-inner" />
        </button>

        {/* 右側エリア (ローカルファイル選択ボタン) - 幅固定で対称性を維持 */}
        <div style={{ width: '120px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <input
            type="file"
            accept="image/*"
            id="file-input"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <label
            htmlFor="file-input"
            className="scanner-btn-secondary"
            style={{ width: '44px', height: '44px', margin: 0 }}
          >
            <ImageIcon style={{ width: '18px', height: '18px' }} />
          </label>
        </div>
      </div>

      {isSleeping && (
        <div onClick={handleWakeUp} className="scanner-sleep-overlay">
          <div className="scanner-sleep-icon-ring">
            <RefreshCw className="scanner-sleep-icon" />
          </div>
          <h2 className="scanner-sleep-title">省電力スリープモード</h2>
          <p className="scanner-sleep-desc">
            一定時間枠線が検出されなかったため、カメラを一時停止しました。
          </p>
          <button type="button" className="scanner-sleep-resume-btn">
            画面をタップして再開
          </button>
        </div>
      )}
    </div>
  );
};

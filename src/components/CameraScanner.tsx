import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Sparkles } from 'lucide-react';
import { detectDocument, calculateFocusScore } from '../utils/opencvHelper';
import type { Point } from '../utils/opencvHelper';

interface CameraScannerProps {
  onCapture: (imageSrc: string, initialCorners: Point[]) => void;
  onCancel?: () => void;
}

const getDefaultCorners = (w: number, h: number): Point[] => [
  { x: w * 0.1, y: h * 0.1 },
  { x: w * 0.9, y: h * 0.1 },
  { x: w * 0.9, y: h * 0.9 },
  { x: w * 0.1, y: h * 0.9 }
];

// メモリ節約とクラッシュ防止のため、Canvasを最大辺maxDimに縮小するヘルパー
const resizeCanvas = (srcCanvas: HTMLCanvasElement, maxDim: number): HTMLCanvasElement => {
  const dstCanvas = document.createElement('canvas');
  let w = srcCanvas.width;
  let h = srcCanvas.height;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  dstCanvas.width = w;
  dstCanvas.height = h;
  const ctx = dstCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(srcCanvas, 0, 0, w, h);
  }
  return dstCanvas;
};

interface FrameCache {
  canvas: HTMLCanvasElement;
  corners: Point[];
  score: number;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentFramesRef = useRef<FrameCache[]>([]);
  
  const [cvReady, setCvReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // OpenCVのロード状態をチェック
  useEffect(() => {
    const checkCv = () => {
      if ((window as any).cvState === 'ready' || (window as any).cv) {
        setCvReady(true);
      } else {
        window.addEventListener('opencv-ready', () => setCvReady(true), { once: true });
      }
    };
    checkCv();
    return () => {
      window.removeEventListener('opencv-ready', () => setCvReady(true));
    };
  }, []);

  // カメラの起動
  useEffect(() => {
    if (!cvReady) return;

    const startCamera = async () => {
      try {
        setErrorMsg(null);
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('muted', 'true');
          videoRef.current.play();
          setCameraActive(true);
        }
      } catch (err: any) {
        console.error('Camera access error:', err);
        setErrorMsg('カメラの起動に失敗しました。Safariの設定でカメラ許可を確認してください。');
      }
    };

    startCamera();

    return () => {
      stopCamera();
    };
  }, [cvReady]);

  // カメラ停止
  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    recentFramesRef.current = []; // キャッシュクリア
  };

  // リアルタイム輪郭検出ループ
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCanvas = overlayCanvasRef.current;
    const oCtx = overlayCanvas?.getContext('2d');

    let lastDetectionTime = 0;
    let lastFocusScoreTime = 0;
    let cachedCorners: Point[] | null = null;
    const DETECTION_INTERVAL = 150; // 150ms ごとに輪郭検出を行い、表示のチカチカを抑止
    const FOCUS_BUFFER_INTERVAL = 50; // 50ms ごとにピントスコアを計測し、超高密度にバッファリングする

    const processFrame = () => {
      if (video.paused || video.ended) return;

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        if (overlayCanvas && (overlayCanvas.width !== video.videoWidth || overlayCanvas.height !== video.videoHeight)) {
          overlayCanvas.width = video.videoWidth;
          overlayCanvas.height = video.videoHeight;
        }

        if (ctx) {
          // 生のカメラ映像を描画
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const now = performance.now();
          
          // 1. ドキュメントの輪郭検出 (計算負荷を考慮し 150ms 間隔で間引き)
          if (now - lastDetectionTime > DETECTION_INTERVAL) {
            cachedCorners = detectDocument(canvas);
            lastDetectionTime = now;
          }

          // 2. ピントの計測と高解像度フレームのキャッシュ蓄積 (50ms 間隔で高密度追尾)
          if (cachedCorners && (now - lastFocusScoreTime > FOCUS_BUFFER_INTERVAL)) {
            try {
              // OpenCVの計算負荷を最小化するため、ピント計測用には 300px の超軽量キャンバスを使用する (ピクセル数を97.5%削減)
              const smallCanvas = resizeCanvas(canvas, 300);
              const score = calculateFocusScore(smallCanvas);
              
              // 保存・OCR用には 1920px の最高解像度でキャンバスを生成する
              const tempCanvas = resizeCanvas(canvas, 1920);
              
              // 縮小サイズに合わせて頂点座標もスケールする
              const scaleX = tempCanvas.width / canvas.width;
              const scaleY = tempCanvas.height / canvas.height;
              const scaledCorners = cachedCorners.map(pt => ({
                x: pt.x * scaleX,
                y: pt.y * scaleY
              }));

              recentFramesRef.current.push({
                canvas: tempCanvas,
                corners: scaledCorners,
                score
              });

              // 直近 8フレーム (約0.4秒分) にキャッシュを拡張し、ブレる前の最良画像が選ばれる確率を向上
              if (recentFramesRef.current.length > 8) {
                recentFramesRef.current.shift();
              }
              
              lastFocusScoreTime = now;
            } catch (e) {
              console.error("Error buffering frame: ", e);
            }
          }
        }

        // 緑の枠線は透過オーバーレイCanvasにのみ描画する
        if (oCtx && overlayCanvas) {
          oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

          if (cachedCorners) {
            oCtx.strokeStyle = '#10b981';
            oCtx.lineWidth = 6;
            oCtx.fillStyle = 'rgba(16, 185, 129, 0.15)';
            
            oCtx.beginPath();
            oCtx.moveTo(cachedCorners[0].x, cachedCorners[0].y);
            oCtx.lineTo(cachedCorners[1].x, cachedCorners[1].y);
            oCtx.lineTo(cachedCorners[2].x, cachedCorners[2].y);
            oCtx.lineTo(cachedCorners[3].x, cachedCorners[3].y);
            oCtx.closePath();
            oCtx.stroke();
            oCtx.fill();

            oCtx.fillStyle = '#ffffff';
            cachedCorners.forEach(pt => {
              oCtx.beginPath();
              oCtx.arc(pt.x, pt.y, 12, 0, 2 * Math.PI);
              oCtx.fill();
              oCtx.strokeStyle = '#059669';
              oCtx.lineWidth = 3;
              oCtx.stroke();
            });
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [cameraActive]);

  // シャッターを切る (キャッシュバッファから最もピントが合った＝エッジの立った写真を自動選択)
  const handleShutter = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    try {
      const cachedFrames = recentFramesRef.current;
      if (cachedFrames.length > 0) {
        // ラプラシアン分散スコアが最も高いベストフレームを選択
        let bestFrame = cachedFrames[0];
        for (let i = 1; i < cachedFrames.length; i++) {
          if (cachedFrames[i].score > bestFrame.score) {
            bestFrame = cachedFrames[i];
          }
        }
        
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
          const rawCorners = detectDocument(resized) || getDefaultCorners(resized.width, resized.height);
          
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
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const corners = detectDocument(tempCanvas) || getDefaultCorners(tempCanvas.width, tempCanvas.height);
          stopCamera();
          onCapture(dataUrl, corners);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  if (!cvReady) {
    return (
      <div className="loading-screen">
        <Loader2 className="spinner spinner-large" style={{ color: '#6366f1' }} />
        <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>OpenCV.js 初期化中</h3>
        <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '240px', lineHeight: '1.5' }}>
          画像処理エンジン（約10MB）をロードしています。初回起動には数秒かかる場合があります。
        </p>
      </div>
    );
  }

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
                <Sparkles className="scanner-logo-icon" />
              </div>
              <div className="scanner-header-content">
                <h1 className="scanner-title">DocScan</h1>
                <p className="scanner-guidance-text">書類を枠線に合わせてください</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* コントロールバー */}
      <div className="scanner-controls">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="scanner-close-btn"
          >
            閉じる
          </button>
        ) : (
          /* レイアウトの対称性を維持し、シャッターを完全に中央に固定するためのダミースペース */
          <div style={{ width: '60px', visibility: 'hidden' }} />
        )}

        <button
          onClick={handleShutter}
          disabled={!cameraActive}
          className="scanner-shutter-btn"
        >
          <div className="scanner-shutter-inner" />
        </button>

        <div>
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
          >
            <ImageIcon style={{ width: '20px', height: '20px' }} />
          </label>
        </div>
      </div>
    </div>
  );
};

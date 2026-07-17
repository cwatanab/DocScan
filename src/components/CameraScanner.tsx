import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { detectDocument, calculateFocusScore, loadOpenCV } from '../utils/opencvHelper';
import type { Point } from '../utils/opencvHelper';
import { detectDocumentAI, initDocSegEngine, isAISegEngineLoaded } from '../utils/docSegHelper';
import { useCameraStream } from './useCameraStream';
import { resizeCanvas } from '../utils/imageExportHelper';
import { OpenCvInitializer } from './OpenCvInitializer';

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
  const [cvError, setCvError] = useState<string | null>(null);

  // AI 検出用 state
  const aiEnabled = true;
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModelLoaded, setAiModelLoaded] = useState(isAISegEngineLoaded());

  // AIモデルのプリロード
  useEffect(() => {
    if (aiEnabled && !aiModelLoaded && !aiLoading) {
      setAiLoading(true);
      initDocSegEngine()
        .then((session) => {
          if (session) {
            setAiModelLoaded(true);
            console.log("[CameraScanner] AI segmentation model preloaded.");
          } else {
            setAiModelLoaded(false);
            console.warn("[CameraScanner] AI model load failed. Fallback to OpenCV enabled.");
          }
        })
        .catch(err => {
          console.error("[CameraScanner] Failed to preload AI model:", err);
        })
        .finally(() => {
          setAiLoading(false);
        });
    }
  }, [aiEnabled, aiModelLoaded, aiLoading]);

  // OpenCVのロード状態をチェック＆動的ロード
  useEffect(() => {
    let isMounted = true;

    loadOpenCV(30000)
      .then(() => {
        if (isMounted) {
          setCvReady(true);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("[CameraScanner] OpenCV load failed:", err);
          setCvError(err.message || 'OpenCV.js の読み込みに失敗しました。');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // カメラストリーム制御のカスタムフック呼び出し
  const {
    cameraActive,
    errorMsg,
    stopCamera: stopCameraStream,
    animationFrameRef
  } = useCameraStream({ videoRef, cvReady });

  // カメラ停止とキャッシュバッファのクリア
  const stopCamera = () => {
    stopCameraStream();
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
    let lastValidCorners: Point[] | null = null;
    let smoothCorners: Point[] | null = null;
    let lastSeenDetectionTime = 0;

    const DETECTION_INTERVAL = 150; // 150ms ごとに輪郭検出を行う
    const FOCUS_BUFFER_INTERVAL = 50; // 50ms ごとにピントスコアを計測する
    const CORNER_KEEP_DURATION = 350; // 検出が途切れても 350ms は枠線を維持する
    const SMOOTHING_FACTOR = 0.22; // 指数移動平均の平滑化係数

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
          // 生のカメラ映像を描画する
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const now = performance.now();
          
          // 1. ドキュメントの輪郭検出 (計算負荷を考慮し間引き。AIの場合は 300ms 間隔)
          const currentInterval = (aiEnabled && aiModelLoaded) ? 300 : DETECTION_INTERVAL;
          
          if (now - lastDetectionTime > currentInterval) {
            if (aiEnabled && aiModelLoaded) {
              // プレビュー表示の更新をブロックしないよう非同期（Promise）でAI推論を走らせる
              detectDocumentAI(canvas).then(detected => {
                if (detected) {
                  cachedCorners = detected;
                  lastValidCorners = detected;
                  lastSeenDetectionTime = performance.now();
                } else {
                  cachedCorners = null;
                }
              }).catch(err => {
                console.error("AI detection error during preview: ", err);
              });
            } else {
              const detected = detectDocument(canvas);
              if (detected) {
                cachedCorners = detected;
                lastValidCorners = detected;
                lastSeenDetectionTime = now;
              } else {
                cachedCorners = null;
              }
            }
            lastDetectionTime = now;
          }

          // 2. 枠線の状態維持とジッター平滑化の計算
          let targetCorners: Point[] | null = null;
          if (cachedCorners) {
            targetCorners = cachedCorners;
          } else if (lastValidCorners && (now - lastSeenDetectionTime < CORNER_KEEP_DURATION)) {
            // 検出が一時的に途切れた場合は前回の検出枠線を使用する
            targetCorners = lastValidCorners;
          } else {
            smoothCorners = null;
          }

          if (targetCorners) {
            if (!smoothCorners) {
              smoothCorners = targetCorners;
            } else {
              // 座標の急激な変化（カメラ移動など）を検知する
              let totalDist = 0;
              for (let i = 0; i < 4; i++) {
                totalDist += Math.hypot(targetCorners[i].x - smoothCorners[i].x, targetCorners[i].y - smoothCorners[i].y);
              }
              const avgDist = totalDist / 4;
              
              // 平均移動距離が画像の長辺の12%を超えていたら即時追従させる
              const resetThreshold = Math.max(canvas.width, canvas.height) * 0.12;
              if (avgDist > resetThreshold) {
                smoothCorners = targetCorners;
              } else {
                // 指数移動平均による平滑化を適用する
                smoothCorners = smoothCorners.map((pt, idx) => ({
                  x: pt.x + (targetCorners![idx].x - pt.x) * SMOOTHING_FACTOR,
                  y: pt.y + (targetCorners![idx].y - pt.y) * SMOOTHING_FACTOR
                }));
              }
            }
          }

          // 3. ピントの計測と高解像度フレームのキャッシュ蓄積
          if (smoothCorners && (now - lastFocusScoreTime > FOCUS_BUFFER_INTERVAL)) {
            try {
              // ピント計測用には 300px の超軽量キャンバスを使用する
              const smallCanvas = resizeCanvas(canvas, 300);
              const score = calculateFocusScore(smallCanvas);
              
              // 保存・OCR用には 1920px の最高解像度でキャンバスを生成する
              const tempCanvas = resizeCanvas(canvas, 1920);
              
              // 縮小サイズに合わせて頂点座標もスケールする
              const scaleX = tempCanvas.width / canvas.width;
              const scaleY = tempCanvas.height / canvas.height;
              const scaledCorners = smoothCorners.map(pt => ({
                x: pt.x * scaleX,
                y: pt.y * scaleY
              }));

              recentFramesRef.current.push({
                canvas: tempCanvas,
                corners: scaledCorners,
                score
              });

              // 直近 8フレーム (約0.4秒分) にキャッシュを制限する
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

          if (smoothCorners) {
            oCtx.strokeStyle = '#10b981';
            oCtx.lineWidth = 6;
            oCtx.fillStyle = 'rgba(16, 185, 129, 0.15)';
            
            oCtx.beginPath();
            oCtx.moveTo(smoothCorners[0].x, smoothCorners[0].y);
            oCtx.lineTo(smoothCorners[1].x, smoothCorners[1].y);
            oCtx.lineTo(smoothCorners[2].x, smoothCorners[2].y);
            oCtx.lineTo(smoothCorners[3].x, smoothCorners[3].y);
            oCtx.closePath();
            oCtx.stroke();
            oCtx.fill();

            oCtx.fillStyle = '#ffffff';
            smoothCorners.forEach(pt => {
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
  const handleShutter = async () => {
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
          
          let rawCorners: Point[] | null = null;
          if (aiEnabled && aiModelLoaded) {
            rawCorners = await detectDocumentAI(resized);
          }
          if (!rawCorners) {
            rawCorners = detectDocument(resized) || getDefaultCorners(resized.width, resized.height);
          }
          
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
          
          let corners: Point[] | null = null;
          if (aiEnabled && aiModelLoaded) {
            corners = await detectDocumentAI(tempCanvas);
          }
          if (!corners) {
            corners = detectDocument(tempCanvas) || getDefaultCorners(tempCanvas.width, tempCanvas.height);
          }
          
          stopCamera();
          onCapture(dataUrl, corners);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  if (!cvReady) {
    return <OpenCvInitializer cvError={cvError} />;
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
                <h1 className="scanner-title">DocScan <span style={{ fontSize: '0.55em', opacity: 0.6, marginLeft: '6px', fontWeight: 'normal', verticalAlign: 'middle' }}>v0.1</span></h1>
                <p className="scanner-guidance-text">書類全体が写るようにしてください</p>
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

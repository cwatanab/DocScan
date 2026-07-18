import { useEffect, useRef, useState, useCallback } from 'react';
import type { Point } from '../utils/opencvHelper';
import { calculateFocusScore } from '../utils/opencvHelper';
import { detectDocumentAI, initDocSegEngine, isAISegEngineLoaded, checkShapeValidity } from '../utils/docSegHelper';
import { resizeCanvasTo } from '../utils/imageExportHelper';

export interface FrameCache {
  canvas: HTMLCanvasElement;
  corners: Point[];
  score: number;
}

/**
 * キャッシュフレームの明示的メモリ解放
 */
const discardFrame = (frame: FrameCache) => {
  try {
    frame.canvas.width = 0;
    frame.canvas.height = 0;
  } catch (e) {
    console.warn("Failed to discard canvas memory:", e);
  }
};

interface UseScannerDetectionProps {
  cameraActive: boolean;
}

export function useScannerDetection({ cameraActive }: UseScannerDetectionProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModelLoaded, setAiModelLoaded] = useState(isAISegEngineLoaded());

  const smoothCornersRef = useRef<Point[] | null>(null);
  const cachedCornersRef = useRef<Point[] | null>(null);
  const lastValidCornersRef = useRef<Point[] | null>(null);
  const lastSeenDetectionTimeRef = useRef<number>(0);
  const lastDetectionTimeRef = useRef<number>(0);
  const lastFocusScoreTimeRef = useRef<number>(0);
  const recentFramesRef = useRef<FrameCache[]>([]);

  // Canvas アロケーション削減のためのプール
  const canvasPoolRef = useRef<HTMLCanvasElement[]>([]);
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const clearPool = useCallback(() => {
    canvasPoolRef.current.forEach(c => {
      c.width = 0;
      c.height = 0;
    });
    canvasPoolRef.current = [];
  }, []);

  const DETECTION_INTERVAL = 300; // AI推論の間隔 (300ms)
  const FOCUS_BUFFER_INTERVAL = 50; // キャッシュ蓄積の間隔 (50ms)
  const CORNER_KEEP_DURATION = 800; // 検出枠線を維持する時間 (800ms)
  const SMOOTHING_FACTOR = 0.35; // 座標のジッター平滑化係数

  // AIモデルのプリロード
  useEffect(() => {
    if (!aiModelLoaded && !aiLoading) {
      setAiLoading(true);
      initDocSegEngine()
        .then((session) => {
          if (session) {
            setAiModelLoaded(true);

          } else {
            setAiModelLoaded(false);
            console.warn("[useScannerDetection] AI model load failed.");
          }
        })
        .catch(err => {
          console.error("[useScannerDetection] Failed to preload AI model:", err);
        })
        .finally(() => {
          setAiLoading(false);
        });
    }
  }, [aiModelLoaded, aiLoading]);

  // カメラがオフになったらキャッシュをクリアする
  useEffect(() => {
    if (!cameraActive) {
      recentFramesRef.current.forEach(discardFrame);
      recentFramesRef.current = [];
      smoothCornersRef.current = null;
      cachedCornersRef.current = null;
      lastValidCornersRef.current = null;
      clearPool();
      if (smallCanvasRef.current) {
        smallCanvasRef.current.width = 0;
        smallCanvasRef.current.height = 0;
        smallCanvasRef.current = null;
      }
    }
  }, [cameraActive, clearPool]);

  /**
   * 毎フレームの検出とキャッシュ蓄積を処理する
   */
  const processDetectionFrame = useCallback(async (canvas: HTMLCanvasElement) => {
    if (!aiModelLoaded) return null;

    const now = performance.now();

    // 1. AI 境界検出の実行 (300ms 間隔)
    if (now - lastDetectionTimeRef.current > DETECTION_INTERVAL) {
      try {
        const detected = await detectDocumentAI(canvas);
        if (detected) {
          cachedCornersRef.current = detected;
          lastValidCornersRef.current = detected;
          lastSeenDetectionTimeRef.current = now;
        } else {
          cachedCornersRef.current = null;
        }
      } catch (err) {
        console.error("AI detection error during preview: ", err);
      }
      lastDetectionTimeRef.current = now;
    }

    // 2. 枠線の状態維持とジッター平滑化の計算
    let targetCorners: Point[] | null = null;
    if (cachedCornersRef.current) {
      targetCorners = cachedCornersRef.current;
    } else if (lastValidCornersRef.current && (now - lastSeenDetectionTimeRef.current < CORNER_KEEP_DURATION)) {
      targetCorners = lastValidCornersRef.current;
    } else {
      smoothCornersRef.current = null;
    }

    if (targetCorners) {
      if (!smoothCornersRef.current) {
        smoothCornersRef.current = targetCorners;
      } else {
        // 急激な移動を検知
        let totalDist = 0;
        for (let i = 0; i < 4; i++) {
          totalDist += Math.hypot(
            targetCorners[i].x - smoothCornersRef.current[i].x,
            targetCorners[i].y - smoothCornersRef.current[i].y
          );
        }
        const avgDist = totalDist / 4;
        const resetThreshold = Math.max(canvas.width, canvas.height) * 0.12;

        if (avgDist > resetThreshold) {
          smoothCornersRef.current = targetCorners;
        } else {
          smoothCornersRef.current = smoothCornersRef.current.map((pt, idx) => ({
            x: pt.x + (targetCorners![idx].x - pt.x) * SMOOTHING_FACTOR,
            y: pt.y + (targetCorners![idx].y - pt.y) * SMOOTHING_FACTOR
          }));
        }
      }
    }

    // 3. ピントの計測と高解像度フレームのキャッシュ蓄積
    if (smoothCornersRef.current && (now - lastFocusScoreTimeRef.current > FOCUS_BUFFER_INTERVAL)) {
      try {
        if (!smallCanvasRef.current) {
          smallCanvasRef.current = document.createElement('canvas');
        }
        resizeCanvasTo(canvas, smallCanvasRef.current, 300);
        const score = calculateFocusScore(smallCanvasRef.current);

        // プールからキャンバスを取得、なければ新規作成
        let tempCanvas: HTMLCanvasElement;
        if (canvasPoolRef.current.length > 0) {
          tempCanvas = canvasPoolRef.current.pop()!;
        } else {
          tempCanvas = document.createElement('canvas');
        }

        resizeCanvasTo(canvas, tempCanvas, 1920);

        const scaleX = tempCanvas.width / canvas.width;
        const scaleY = tempCanvas.height / canvas.height;
        const scaledCorners = smoothCornersRef.current.map(pt => ({
          x: pt.x * scaleX,
          y: pt.y * scaleY
        }));

        recentFramesRef.current.push({
          canvas: tempCanvas,
          corners: scaledCorners,
          score
        });

        if (recentFramesRef.current.length > 8) {
          const removed = recentFramesRef.current.shift();
          if (removed) {
            // 解放する代わりにプールに戻す
            canvasPoolRef.current.push(removed.canvas);
          }
        }

        lastFocusScoreTimeRef.current = now;
      } catch (e) {
        console.error("Error buffering frame: ", e);
      }
    }

    // 最終的にプレビュー描画用として返す平滑化後の座標に対して、厳しめの歪みチェック (0.800 ≒ 37度) を実施
    // 内部的な smoothCornersRef の追従（移動）は動かしつつ、画面に歪な形のまま描画されるのだけを防ぎます
    const resultCorners = smoothCornersRef.current && checkShapeValidity(smoothCornersRef.current, 0.800)
      ? smoothCornersRef.current
      : null;

    return resultCorners;
  }, [aiModelLoaded]);

  /**
   * キャッシュされたフレームからベストショットを取得する
   */
  const getBestCachedFrame = useCallback(() => {
    const cachedFrames = recentFramesRef.current;
    if (cachedFrames.length === 0) return null;

    let bestFrame = cachedFrames[0];
    for (let i = 1; i < cachedFrames.length; i++) {
      if (cachedFrames[i].score > bestFrame.score) {
        bestFrame = cachedFrames[i];
      }
    }
    return bestFrame;
  }, []);

  /**
   * キャッシュと状態のリセット
   */
  const resetDetection = useCallback(() => {
    recentFramesRef.current.forEach(discardFrame);
    recentFramesRef.current = [];
    smoothCornersRef.current = null;
    cachedCornersRef.current = null;
    lastValidCornersRef.current = null;
    clearPool();
  }, [clearPool]);

  return {
    aiLoading,
    aiModelLoaded,
    processDetectionFrame,
    getBestCachedFrame,
    resetDetection
  };
}

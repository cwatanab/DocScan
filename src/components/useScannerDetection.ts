import { useEffect, useRef, useState, useCallback } from 'react';
import type { Point } from '../utils/geometry';
import {
  assessDocumentCaptureQuality,
  type CaptureQualityLevel,
  type CaptureQualityReason
} from '../utils/opencvHelper';
import { detectDocumentAI, initDocSegEngine, isAISegEngineLoaded, checkShapeValidity } from '../utils/docSegHelper';
import { resizeCanvasTo } from '../utils/imageExportHelper';

export interface FrameCache {
  canvas: HTMLCanvasElement;
  corners: Point[];
  score: number;
}

export interface FrameQualityState {
  level: CaptureQualityLevel;
  reasons: CaptureQualityReason[];
  focusScore: number;
  meanLuma: number;
}

const EMPTY_QUALITY: FrameQualityState = {
  level: 'none',
  reasons: [],
  focusScore: 0,
  meanLuma: 128
};

/**
 * キャッシュフレームの明示的メモリ解放
 */
const discardFrame = (frame: FrameCache) => {
  try {
    frame.canvas.width = 0;
    frame.canvas.height = 0;
  } catch (e) {
    console.warn('Failed to discard canvas memory:', e);
  }
};

interface UseScannerDetectionProps {
  cameraActive: boolean;
}

export function useScannerDetection({ cameraActive }: UseScannerDetectionProps) {
  const [aiModelStatus, setAiModelStatus] = useState<'unloaded' | 'loading' | 'loaded' | 'failed'>(() => {
    return isAISegEngineLoaded() ? 'loaded' : 'unloaded';
  });
  const aiModelLoaded = aiModelStatus === 'loaded';
  const aiLoading = aiModelStatus === 'loading';

  const [frameQuality, setFrameQuality] = useState<FrameQualityState>(EMPTY_QUALITY);

  const isDetectingRef = useRef(false);
  const smoothCornersRef = useRef<Point[] | null>(null);
  const cachedCornersRef = useRef<Point[] | null>(null);
  const lastValidCornersRef = useRef<Point[] | null>(null);
  const lastSeenDetectionTimeRef = useRef<number>(0);
  const lastDetectionTimeRef = useRef<number>(0);
  const lastFocusScoreTimeRef = useRef<number>(0);
  const recentFramesRef = useRef<FrameCache[]>([]);

  // 画質のヒステリシス（チラつき防止）
  const qualityPendingRef = useRef<CaptureQualityLevel>('none');
  const qualityStableRef = useRef<CaptureQualityLevel>('none');
  const qualityStreakRef = useRef(0);
  const lastPublishedQualityRef = useRef<string>('');
  /** 検出中セッションでのピーク鮮明度（相対ブレ判定） */
  const peakFocusRef = useRef(0);

  const canvasPoolRef = useRef<HTMLCanvasElement[]>([]);
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const clearPool = useCallback(() => {
    canvasPoolRef.current.forEach((c) => {
      c.width = 0;
      c.height = 0;
    });
    canvasPoolRef.current = [];
  }, []);

  const DETECTION_INTERVAL = 300;
  const FOCUS_BUFFER_INTERVAL = 50;
  const CORNER_KEEP_DURATION = 800;
  const SMOOTHING_FACTOR = 0.35;
  /** 同じ品質レベルがこの回数連続したら UI に反映（約 50ms 間隔 × 回数） */
  const QUALITY_STREAK_ENTER = 2;
  /** good に戻るときは少し長めにして点滅を抑える */
  const QUALITY_STREAK_RECOVER = 3;

  const publishQuality = useCallback((next: FrameQualityState) => {
    const key = `${next.level}|${next.reasons.slice().sort().join(',')}`;
    if (key === lastPublishedQualityRef.current) return;
    lastPublishedQualityRef.current = key;
    setFrameQuality(next);
  }, []);

  const updateQualityWithHysteresis = useCallback(
    (rawLevel: CaptureQualityLevel, reasons: CaptureQualityReason[], focusScore: number, meanLuma: number) => {
      if (rawLevel === qualityPendingRef.current) {
        qualityStreakRef.current += 1;
      } else {
        qualityPendingRef.current = rawLevel;
        qualityStreakRef.current = 1;
      }

      const need =
        qualityStableRef.current === 'good' || qualityStableRef.current === 'none'
          ? QUALITY_STREAK_ENTER
          : rawLevel === 'good'
            ? QUALITY_STREAK_RECOVER
            : QUALITY_STREAK_ENTER;

      if (qualityStreakRef.current >= need) {
        qualityStableRef.current = rawLevel;
      }

      const stable = qualityStableRef.current;
      // 理由は最新 raw を使うが、level は安定値（none のときは理由クリア）
      publishQuality({
        level: stable,
        reasons: stable === 'none' || stable === 'good' ? [] : reasons,
        focusScore,
        meanLuma
      });
    },
    [publishQuality]
  );

  const resetQuality = useCallback(() => {
    qualityPendingRef.current = 'none';
    qualityStableRef.current = 'none';
    qualityStreakRef.current = 0;
    peakFocusRef.current = 0;
    publishQuality(EMPTY_QUALITY);
  }, [publishQuality]);

  useEffect(() => {
    if (aiModelStatus === 'unloaded') {
      setAiModelStatus('loading');
      initDocSegEngine()
        .then((session) => {
          if (session) {
            setAiModelStatus('loaded');
          } else {
            setAiModelStatus('failed');
            console.warn('[useScannerDetection] AI model load failed.');
          }
        })
        .catch((err) => {
          setAiModelStatus('failed');
          console.error('[useScannerDetection] Failed to preload AI model:', err);
        });
    }
  }, [aiModelStatus]);

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
      resetQuality();
    }
  }, [cameraActive, clearPool, resetQuality]);

  const processDetectionFrame = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!aiModelLoaded) return null;

      const now = performance.now();

      if (now - lastDetectionTimeRef.current > DETECTION_INTERVAL && !isDetectingRef.current) {
        isDetectingRef.current = true;
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI corner detection timeout')), 2000)
          );
          const detected = await Promise.race([detectDocumentAI(canvas), timeoutPromise]);

          if (detected) {
            cachedCornersRef.current = detected;
            lastValidCornersRef.current = detected;
            lastSeenDetectionTimeRef.current = now;
          } else {
            cachedCornersRef.current = null;
          }
        } catch (err) {
          console.error('AI detection error during preview: ', err);
        } finally {
          isDetectingRef.current = false;
        }
        lastDetectionTimeRef.current = now;
      }

      let targetCorners: Point[] | null = null;
      if (cachedCornersRef.current) {
        targetCorners = cachedCornersRef.current;
      } else if (
        lastValidCornersRef.current &&
        now - lastSeenDetectionTimeRef.current < CORNER_KEEP_DURATION
      ) {
        targetCorners = lastValidCornersRef.current;
      } else {
        smoothCornersRef.current = null;
      }

      if (targetCorners) {
        if (!smoothCornersRef.current) {
          smoothCornersRef.current = targetCorners;
        } else {
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

      const resultCorners =
        smoothCornersRef.current && checkShapeValidity(smoothCornersRef.current, 0.24, 1.25)
          ? smoothCornersRef.current
          : null;

      if (!resultCorners) {
        // 未検出が続くとピークをゆっくり減衰（別書類への持ち越しを弱める）
        peakFocusRef.current *= 0.92;
        if (peakFocusRef.current < 50) peakFocusRef.current = 0;
        updateQualityWithHysteresis('none', [], 0, 128);
      } else if (now - lastFocusScoreTimeRef.current > FOCUS_BUFFER_INTERVAL) {
        try {
          if (!smallCanvasRef.current) {
            smallCanvasRef.current = document.createElement('canvas');
          }
          // ベストフレーム用の縮小は従来どおり全面
          resizeCanvasTo(canvas, smallCanvasRef.current, 300);

          // 画質判定はドキュメント枠内 ROI（暗さ・文字の鮮明さに効く）
          const assessed = assessDocumentCaptureQuality(
            canvas,
            resultCorners,
            peakFocusRef.current
          );

          // ピーク更新: 上昇はすぐ反映、下降はゆっくり（一時的なブレで基準が消えないように）
          if (assessed.focusScore > peakFocusRef.current) {
            peakFocusRef.current = assessed.focusScore;
          } else {
            peakFocusRef.current = peakFocusRef.current * 0.995 + assessed.focusScore * 0.005;
          }

          updateQualityWithHysteresis(
            assessed.level,
            assessed.reasons,
            assessed.focusScore,
            assessed.meanLuma
          );

          let tempCanvas: HTMLCanvasElement;
          if (canvasPoolRef.current.length > 0) {
            tempCanvas = canvasPoolRef.current.pop()!;
          } else {
            tempCanvas = document.createElement('canvas');
          }

          resizeCanvasTo(canvas, tempCanvas, 1920);

          const scaleX = tempCanvas.width / canvas.width;
          const scaleY = tempCanvas.height / canvas.height;
          const scaledCorners = resultCorners.map((pt) => ({
            x: pt.x * scaleX,
            y: pt.y * scaleY
          }));

          recentFramesRef.current.push({
            canvas: tempCanvas,
            corners: scaledCorners,
            score: assessed.focusScore
          });

          if (recentFramesRef.current.length > 8) {
            const removed = recentFramesRef.current.shift();
            if (removed) {
              canvasPoolRef.current.push(removed.canvas);
            }
          }

          lastFocusScoreTimeRef.current = now;
        } catch (e) {
          console.error('Error buffering frame: ', e);
        }
      }

      return resultCorners;
    },
    [aiModelLoaded, updateQualityWithHysteresis]
  );

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

  const resetDetection = useCallback(() => {
    recentFramesRef.current.forEach(discardFrame);
    recentFramesRef.current = [];
    smoothCornersRef.current = null;
    cachedCornersRef.current = null;
    lastValidCornersRef.current = null;
    clearPool();
    resetQuality();
  }, [clearPool, resetQuality]);

  return {
    aiLoading,
    aiModelLoaded,
    frameQuality,
    processDetectionFrame,
    getBestCachedFrame,
    resetDetection
  };
}

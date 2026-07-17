import { useEffect, useState, useRef, useCallback } from 'react';

interface UseCameraStreamProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const useCameraStream = ({ videoRef }: UseCameraStreamProps) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // カメラ停止
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // カメラの起動
  useEffect(() => {
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
          
          // play() は非同期処理のため、割り込み（アンマウントや再ロード）による AbortError を安全にキャッチして無視します
          videoRef.current.play().catch((err: any) => {
            if (err.name !== 'AbortError') {
              console.error('[CameraStream] video.play() failed:', err);
            }
          });
          
          setCameraActive(true);
        }
      } catch (err: any) {
        console.error('Camera access error:', err);
        setErrorMsg('カメラの起動に失敗しました。ブラウザの設定でカメラ許可を確認してください。');
      }
    };

    startCamera();

    return () => {
      stopCamera();
    };
  }, [videoRef, stopCamera]);

  return {
    cameraActive,
    errorMsg,
    setErrorMsg,
    stopCamera,
    animationFrameRef
  };
};

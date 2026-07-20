import { useState, useRef, useEffect } from 'react';
import { sortPoints, type Point } from '../utils/geometry';

interface UseCropHandlesProps {
  initialCorners: Point[];
  imageSize: { width: number; height: number };
  displaySize: { width: number; height: number };
  imageRef: React.RefObject<HTMLImageElement | null>;
}

export const useCropHandles = ({
  initialCorners,
  imageSize,
  displaySize,
  imageRef
}: UseCropHandlesProps) => {
  const [corners, setCorners] = useState<Point[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // ルーペ（拡大鏡）のキャンバス描画
  const drawLoupe = (imgPt: Point) => {
    const loupeCanvas = loupeCanvasRef.current;
    if (!loupeCanvas || !imageRef.current) return;
    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) return;

    // Retina/高解像度対応のため、実ピクセルサイズは300px（CSSで150pxに縮小）
    const size = 300;
    if (loupeCanvas.width !== size || loupeCanvas.height !== size) {
      loupeCanvas.width = size;
      loupeCanvas.height = size;
    }

    ctx.clearRect(0, 0, size, size);

    // clip は save/restore で囲み、連続ドラッグ時にクリップ領域が積み重ならないようにする
    ctx.save();
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
    ctx.restore();

    // 十字線の描画
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    // 白い外枠の描画
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  };

  // ドラッグ中・移動
  const handleMove = (clientX: number, clientY: number) => {
    if (draggedIndex === null || !imageRef.current) return;

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
      y: boundedY
    });

    drawLoupe(newImagePoint);
  };

  // ドラッグ終了
  const handleEnd = () => {
    setDraggedIndex(null);
    setLoupe(null);
  };

  return {
    corners,
    setCorners,
    draggedIndex,
    loupe,
    loupeCanvasRef,
    toDisplayPoint,
    toImagePoint,
    handleStart,
    handleMove,
    handleEnd
  };
};

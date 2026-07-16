import React, { useEffect, useState, useRef } from 'react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({ src, alt, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  // タッチイベントを受け取るための画像コンテナへのRef
  const contentRef = useRef<HTMLDivElement>(null);
  
  // イベントリスナー内で常に最新のState値を参照するためのRef
  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // タッチ開始時の状態を保持するRef
  const touchStartRef = useRef<{
    distance: number;
    scale: number;
    x: number;
    y: number;
    posX: number;
    posY: number;
    isPinching: boolean;
  }>({ distance: 0, scale: 1, x: 0, y: 0, posX: 0, posY: 0, isPinching: false });

  const lastTapRef = useRef<number>(0);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    // タッチ開始時の処理
    const handleTouchStartRaw = (e: TouchEvent) => {
      const currentScale = scaleRef.current;
      const currentPos = positionRef.current;

      // ダブルタップ判定 (ダブルタップで拡大/等倍リセット)
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        e.preventDefault();
        if (currentScale > 1) {
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          setScale(2.5);
          setPosition({ x: 0, y: 0 });
        }
        lastTapRef.current = now;
        return;
      }
      lastTapRef.current = now;

      if (e.touches.length === 2) {
        // 2本指の場合: ピンチズームの初期化
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        
        touchStartRef.current = {
          distance: dist > 0 ? dist : 1, // 0除算を防止
          scale: currentScale,
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
          posX: currentPos.x,
          posY: currentPos.y,
          isPinching: true
        };
      } else if (e.touches.length === 1) {
        // 1本指の場合: ドラッグ（パン）の初期化
        const t = e.touches[0];
        touchStartRef.current = {
          distance: 0,
          scale: currentScale,
          x: t.clientX,
          y: t.clientY,
          posX: currentPos.x,
          posY: currentPos.y,
          isPinching: false
        };
      }
    };

    // タッチ中のドラッグ・ズーム処理
    const handleTouchMoveRaw = (e: TouchEvent) => {
      const currentScale = scaleRef.current;

      if (e.touches.length === 2 && touchStartRef.current.isPinching) {
        // ピンチズームの計算 (ブラウザ全体のズームを防止)
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        
        const startDist = touchStartRef.current.distance || 1;
        const factor = dist / startDist;
        const newScale = Math.max(1, Math.min(5, touchStartRef.current.scale * factor));
        setScale(newScale);
      } else if (e.touches.length === 1 && !touchStartRef.current.isPinching && currentScale > 1) {
        // ドラッグ（パン）の計算 (画像がズームしている時のみパン移動を許可し、背後のスクロールを抑止)
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - touchStartRef.current.x;
        const dy = t.clientY - touchStartRef.current.y;
        
        setPosition({
          x: touchStartRef.current.posX + dx,
          y: touchStartRef.current.posY + dy
        });
      }
    };

    // タッチ終了時の処理
    const handleTouchEndRaw = () => {
      const currentScale = scaleRef.current;
      // ズーム倍率が1以下になったら位置を中央リセットする
      if (currentScale <= 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    };

    // 画像コンテナに対してのみリスナー登録 (画像外タッチ時の誤入力をカット)
    element.addEventListener('touchstart', handleTouchStartRaw, { passive: false });
    element.addEventListener('touchmove', handleTouchMoveRaw, { passive: false });
    element.addEventListener('touchend', handleTouchEndRaw);

    return () => {
      element.removeEventListener('touchstart', handleTouchStartRaw);
      element.removeEventListener('touchmove', handleTouchMoveRaw);
      element.removeEventListener('touchend', handleTouchEndRaw);
    };
  }, []); // 依存配列を空にしてイベントが途切れないように固定

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      {/* 閉じるボタンをズーム対象の外側に配置し、スケールの影響を完全にシャットアウト */}
      <button 
        className="lightbox-close-btn"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        ✕
      </button>

      <div 
        ref={contentRef}
        className="lightbox-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible', // 画像がはみ出しても表示されるようにする
          touchAction: 'none'
        }}
      >
        {/* CSSの影響を受けないよう、画像(imgタグ)自体に対して直接transform(ズーム)を適用する */}
        <img 
          src={src} 
          alt={alt} 
          className="lightbox-image" 
          draggable={false}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: scale === 1 && position.x === 0 ? 'transform 0.2s ease-out' : 'none',
            maxWidth: '100%',
            maxHeight: '85vh',
            objectFit: 'contain'
          }}
        />
      </div>
    </div>
  );
};

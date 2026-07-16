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
  const imgRef = useRef<HTMLImageElement>(null);
  
  // イベントリスナー内で常に最新のState値を参照するためのRef
  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // タッチの直前の状態を保持するRef
  const lastTouchRef = useRef<{
    clientX: number;
    clientY: number;
    distance: number;
  }>({ clientX: 0, clientY: 0, distance: 0 });

  const lastTapRef = useRef<number>(0);

  // 画像のコンテナ内での実際の描画サイズを計算する
  const getImageRenderSize = (scaleVal: number) => {
    const img = imgRef.current;
    const container = contentRef.current;
    if (!img || !container) return { width: 0, height: 0, containerWidth: 0, containerHeight: 0 };

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // 画像の元のサイズ（アスペクト比計算用）
    const naturalWidth = img.naturalWidth || img.width || 1;
    const naturalHeight = img.naturalHeight || img.height || 1;
    
    const imgRatio = naturalWidth / naturalHeight;
    const containerRatio = containerWidth / containerHeight;

    let renderWidth = containerWidth;
    let renderHeight = containerHeight;

    // object-fit: contain の挙動をシミュレート
    if (imgRatio > containerRatio) {
      renderWidth = containerWidth;
      renderHeight = containerWidth / imgRatio;
    } else {
      renderHeight = containerHeight;
      renderWidth = containerHeight * imgRatio;
    }

    return {
      width: renderWidth * scaleVal,
      height: renderHeight * scaleVal,
      containerWidth,
      containerHeight
    };
  };

  // 画像の移動範囲を制限する（はみ出し防止）
  const getBoundedPosition = (x: number, y: number, currentScale: number) => {
    const { width, height, containerWidth, containerHeight } = getImageRenderSize(currentScale);
    if (width === 0 || height === 0) return { x, y };

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;

    // 幅が画面幅より大きければ、はみ出した分だけ移動可能にする
    if (width > containerWidth) {
      maxX = (width - containerWidth) / 2;
      minX = -maxX;
    }

    // 高さが画面高さより大きければ、はみ出した分だけ移動可能にする
    if (height > containerHeight) {
      maxY = (height - containerHeight) / 2;
      minY = -maxY;
    }

    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y))
    };
  };

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    // 指が画面に触れたとき、または離れたときに基準位置を再取得する
    const updateTouchPoints = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const clientX = (t1.clientX + t2.clientX) / 2;
        const clientY = (t1.clientY + t2.clientY) / 2;
        
        lastTouchRef.current = {
          clientX,
          clientY,
          distance: dist > 0 ? dist : 1,
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        lastTouchRef.current = {
          clientX: t.clientX,
          clientY: t.clientY,
          distance: 0,
        };
      }
    };

    // タッチ開始時の処理
    const handleTouchStartRaw = (e: TouchEvent) => {
      const currentScale = scaleRef.current;

      // ダブルタップ判定 (ダブルタップで拡大/等倍リセット)
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        e.preventDefault();
        if (currentScale > 1) {
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          // ダブルタップされた座標を取得して、そこを中心に拡大
          const rect = element.getBoundingClientRect();
          const touch = e.touches[0] || e.changedTouches[0];
          const pivotX = touch.clientX - rect.left - rect.width / 2;
          const pivotY = touch.clientY - rect.top - rect.height / 2;
          
          const newScale = 2.5;
          const newPos = getBoundedPosition(
            pivotX * (1 - newScale),
            pivotY * (1 - newScale),
            newScale
          );
          
          setScale(newScale);
          setPosition(newPos);
        }
        lastTapRef.current = now;
        return;
      }
      lastTapRef.current = now;

      // タッチ開始時の最新位置を基準点として記録
      updateTouchPoints(e);
    };

    // タッチ中のドラッグ・ズーム処理
    const handleTouchMoveRaw = (e: TouchEvent) => {
      const currentScale = scaleRef.current;
      const currentPos = positionRef.current;
      const rect = element.getBoundingClientRect();

      if (e.touches.length === 2) {
        // ピンチズーム（ブラウザ全体のズームを防止）
        e.preventDefault();
        
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const clientX = (t1.clientX + t2.clientX) / 2;
        const clientY = (t1.clientY + t2.clientY) / 2;

        const startDist = lastTouchRef.current.distance || 1;
        const factor = dist / startDist;
        
        // 新しいスケールの計算 (1.0 〜 5.0)
        const newScale = Math.max(1, Math.min(5, currentScale * factor));
        
        // ピボット（指の中間点）に基づいた移動量の計算
        const pivotX = clientX - rect.left - rect.width / 2;
        const pivotY = clientY - rect.top - rect.height / 2;
        const scaleRatio = newScale / currentScale;
        
        // 前回の中間点からのドラッグ移動量（パン）
        const dx = clientX - lastTouchRef.current.clientX;
        const dy = clientY - lastTouchRef.current.clientY;

        const newPosX = currentPos.x * scaleRatio + pivotX * (1 - scaleRatio) + dx;
        const newPosY = currentPos.y * scaleRatio + pivotY * (1 - scaleRatio) + dy;

        // 境界制限を適用
        const bounded = getBoundedPosition(newPosX, newPosY, newScale);

        setScale(newScale);
        setPosition(bounded);

        // 次のmoveイベントの基準として状態を更新
        lastTouchRef.current = {
          clientX,
          clientY,
          distance: dist > 0 ? dist : 1,
        };
      } else if (e.touches.length === 1 && currentScale > 1) {
        // ドラッグ（パン）の計算 (画像がズームしている時のみパン移動を許可し、背後のスクロールを抑止)
        e.preventDefault();
        
        const t = e.touches[0];
        const dx = t.clientX - lastTouchRef.current.clientX;
        const dy = t.clientY - lastTouchRef.current.clientY;

        const newPosX = currentPos.x + dx;
        const newPosY = currentPos.y + dy;

        // 境界制限を適用
        const bounded = getBoundedPosition(newPosX, newPosY, currentScale);
        setPosition(bounded);

        // 次のmoveイベントの基準として状態を更新
        lastTouchRef.current = {
          clientX: t.clientX,
          clientY: t.clientY,
          distance: 0,
        };
      }
    };

    // タッチ終了時の処理
    const handleTouchEndRaw = (e: TouchEvent) => {
      // 指が離れた時点で基準位置を再取得（残っている指へのスムーズな遷移）
      updateTouchPoints(e);

      if (e.touches.length === 0) {
        const currentScale = scaleRef.current;
        if (currentScale <= 1) {
          // ズーム倍率が1以下になったら位置を中央リセット
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          // 指を離した際にも位置の境界を再補正する
          const currentPos = positionRef.current;
          const bounded = getBoundedPosition(currentPos.x, currentPos.y, currentScale);
          setPosition(bounded);
        }
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
          ref={imgRef}
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

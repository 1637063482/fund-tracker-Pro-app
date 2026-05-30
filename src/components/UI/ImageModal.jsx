import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export const ImageModal = ({ src, alt, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const imgRef = useRef(null);

  // 关闭：Escape 键
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // 关闭：禁止背景滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const clampScale = (v) => Math.min(5, Math.max(0.5, v));

  // 鼠标滚轮缩放
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale(prev => {
      const next = clampScale(prev + delta);
      if (next <= 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // 拖拽平移
  const handleMouseDown = useCallback((e) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
  }, [scale, position]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setPosition({
      x: dragStart.current.posX + (e.clientX - dragStart.current.x),
      y: dragStart.current.posY + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 双击：切换 1x / 2x
  const handleDoubleClick = useCallback(() => {
    setScale(prev => {
      if (prev > 1.5) { setPosition({ x: 0, y: 0 }); return 1; }
      return 2;
    });
  }, []);

  // 触摸双指缩放
  const lastTouchDist = useRef(null);
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      lastTouchDist.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && lastTouchDist.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = (dist - lastTouchDist.current) * 0.01;
      setScale(prev => clampScale(prev + delta));
      lastTouchDist.current = dist;
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* 工具栏 */}
      <div className="absolute top-4 right-4 flex items-center gap-1 z-10">
        <button
          onClick={() => setScale(prev => clampScale(prev - 0.5))}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
          title="缩小"
        >
          <ZoomOut size={20} />
        </button>
        <span className="text-white/80 text-sm min-w-[48px] text-center font-mono">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => setScale(prev => clampScale(prev + 0.5))}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
          title="放大"
        >
          <ZoomIn size={20} />
        </button>
        <button
          onClick={resetZoom}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
          title="重置"
        >
          <RotateCcw size={20} />
        </button>
        <button
          onClick={onClose}
          className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors ml-2"
          title="关闭"
        >
          <X size={20} />
        </button>
      </div>

      {/* 图片容器 */}
      <div
        className={`max-w-[95vw] max-h-[95vh] flex items-center justify-center overflow-hidden ${scale > 1 ? 'cursor-grab' : 'cursor-default'} ${isDragging ? 'cursor-grabbing' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          className="max-w-full max-h-full object-contain select-none rounded-lg shadow-2xl"
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-4 text-white/40 text-xs text-center pointer-events-none">
        滚轮缩放 · 拖拽平移 · 双击复位 · Esc 关闭
      </div>
    </div>
  );
};

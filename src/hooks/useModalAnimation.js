// 模态框 FLIP 动画 Hook：计算触发按钮到面板中心的位移与缩放，实现弹出/关闭弹性过渡
// speed: 0.5 = faster, 1.0 = normal, 2.0 = slower
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useScrollLock } from './useScrollLock';

export function useModalAnimation(onClose, triggerRect, speed = 1.0, closeMultiplier = 2.0) {
  const [phase, setPhase] = useState('closed');
  const [mounted, setMounted] = useState(false);

  const scrollActive = phase === 'open' || phase === 'opening';
  useScrollLock(scrollActive);

  const openDur = 0.75 * speed;
  const closeDur = 0.75 * speed * closeMultiplier;
  const closeTimeout = Math.round(780 * speed * closeMultiplier);

  const open = useCallback(() => {
    setMounted(true);
    setPhase('opening');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPhase('open');
      });
    });
  }, []);

  const close = useCallback(() => {
    setPhase('closing');
    setTimeout(() => {
      setPhase('closed');
      setMounted(false);
      if (onClose) onClose();
    }, closeTimeout);
  }, [onClose, closeTimeout]);

  useEffect(() => {
    if (mounted && phase === 'closed') open();
  }, [mounted]);

  const isOpen = mounted && phase !== 'closed';

  const flip = useMemo(() => {
    if (!triggerRect) return { tx: 0, ty: 0, scale: 0.45 };
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const bx = triggerRect.left + triggerRect.width / 2;
    const by = triggerRect.top + triggerRect.height / 2;
    const tx = bx - cx;
    const ty = by - cy;
    const btnScale = Math.min(triggerRect.width / 600, 0.5);
    return { tx, ty, scale: Math.max(btnScale, 0.3) };
  }, [triggerRect]);

  const overlayStyle = {
    pointerEvents: (phase === 'open' || phase === 'opening') ? 'auto' : 'none',
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    backgroundColor: phase === 'open' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)',
    backdropFilter: phase === 'open' ? 'blur(4px)' : 'blur(0px)',
    WebkitBackdropFilter: phase === 'open' ? 'blur(4px)' : 'blur(0px)',
    transition: phase === 'closing'
      ? `background-color ${0.15 * speed}s ease-in, backdrop-filter ${0.15 * speed}s ease-in`
      : `background-color ${0.4 * speed}s ease-out, backdrop-filter ${0.3 * speed}s ease-out`,
  };

  const panelTransition = phase === 'closing'
    ? `transform ${closeDur}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.25 * speed}s ease-out`
    : `transform ${openDur}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${openDur}s ease-out`;

  const panelStyle = {
    transition: panelTransition,
    transform: phase === 'open'
      ? 'translate(0, 0) scale(1)'
      : `translate(${flip.tx}px, ${flip.ty}px) scale(${flip.scale})`,
    opacity: phase === 'open' ? 1 : 0,
    visibility: (phase === 'open' || phase === 'opening' || phase === 'closing') ? 'visible' : 'hidden',
  };

  return { isOpen, open, close, overlayStyle, panelStyle };
}

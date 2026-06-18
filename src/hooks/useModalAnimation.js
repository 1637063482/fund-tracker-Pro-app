// 模态框 FLIP 动画 Hook：计算触发按钮到面板中心的位移与缩放，实现弹出/关闭弹性过渡
// speed: 0.5 = faster, 1.0 = normal, 2.0 = slower
//
// FLIP 动画原理：
//   opening 阶段将 panel 定位到触发按钮位置（First），浏览器 paint 后通过
//   双 rAF 切换到居中状态（Last），CSS transition 在两个 paint 之间自动插值。
//   关闭时 panel 已在居中状态绘制多帧，直接切到 closing → closed 即可反向过渡。
//   关键：必须使用双 rAF 而非 useLayoutEffect 同步切换，因为条件渲染的模态框
//   DOM 是全新插入的——浏览器需要至少一帧来"建立"元素，否则 transition 被跳过。
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useScrollLock } from './useScrollLock';

export function useModalAnimation(onClose, triggerRect, speed = 1.0, closeMultiplier = 2.0, zIndex = 50, autoOpen = false) {
  // autoOpen: 模态框挂载即自动播放 FLIP（初始 phase = 'opening'），
  // 确保首次 DOM commit 就是起始位置，消除额外一帧 "closed" 导致的动画丢失。
  const [phase, setPhase] = useState(autoOpen ? 'opening' : 'closed');
  const [mounted, setMounted] = useState(autoOpen);
  const closeTimeoutRef = useRef(null);
  const rafRef = useRef(null);

  const scrollActive = phase === 'open' || phase === 'opening';
  useScrollLock(scrollActive);

  const openDur = 0.75 * speed;
  const closeDur = 0.75 * speed * closeMultiplier;
  const closeTimeout = Math.round(780 * speed * closeMultiplier);

  // ====================== cleanup ======================
  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  // ====================== open ======================
  // 仅 autoOpen=false（PortfolioChat 聊天框手动触发）时使用，
  // autoOpen=true 的模态框已在 useState 初始值中设置为 'opening'，无需再调用。
  const open = useCallback(() => {
    cleanup();
    setMounted(true);
    setPhase('opening');
    // 后续由 useEffect 检测到 phase==='opening' 后通过双 rAF 完成 FLIP
  }, [cleanup]);

  // phase 变为 'opening' 时，使用双 rAF 确保浏览器至少 paint 一帧起始状态
  // 再切换到 'open'。不能用 useLayoutEffect 同步切换——条件渲染的模态框 DOM
  // 是全新插入的，浏览器需要一帧来"建立"元素，否则 CSS transition 会被跳过。
  useEffect(() => {
    if (phase !== 'opening') return;

    // 取消上一轮可能残留的 rAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setPhase('open');
      });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [phase]);

  // ====================== close ======================
  const close = useCallback(() => {
    cleanup();
    setPhase('closing');
    closeTimeoutRef.current = setTimeout(() => {
      closeTimeoutRef.current = null;
      setPhase('closed');
      setMounted(false);
      if (onClose) onClose();
    }, closeTimeout);
  }, [onClose, closeTimeout, cleanup]);

  // 兜底：外部未调用 open() 但 mounted 被设为 true 时自动触发
  useEffect(() => {
    if (mounted && phase === 'closed') open();
  }, [mounted, phase, open]);

  // ====================== 样式 ======================
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
    zIndex,
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

// 焦点陷阱 Hook：弹窗/模态框激活时将 Tab 键盘焦点循环锁定在容器内，保障无障碍访问
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const el = containerRef.current;
    const prevFocused = document.activeElement;

    // Focus first focusable element
    const focusable = el.querySelectorAll(FOCUSABLE);
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;

      const focusable = el.querySelectorAll(FOCUSABLE);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);

    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      if (prevFocused && typeof prevFocused.focus === 'function') {
        // preventScroll 避免浏览器滚动到该元素，防止模态框关闭后页面跳动
        const sx = window.scrollX;
        const sy = window.scrollY;
        prevFocused.focus({ preventScroll: true });
        // Safari <15.4 不支持 preventScroll，兜底校正
        window.scrollTo(sx, sy);
      }
    };
  }, [active]);

  return containerRef;
}

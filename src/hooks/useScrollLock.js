// 页面滚动锁定 Hook：弹窗/模态框打开时禁止背景页面滚动，关闭后恢复，支持嵌套调用
// 使用 overflow:hidden 而非 position:fixed，避免 unlock 时 scrollTo 与用户滚动冲突导致页面跳动
import { useEffect, useRef } from 'react';

let lockCount = 0;
let originalHtmlOverflow = '';
let originalBodyOverflow = '';
let originalPaddingRight = '';
let scrollbarWidth = 0;

function getScrollbarWidth() {
  if (scrollbarWidth > 0) return scrollbarWidth;
  const div = document.createElement('div');
  div.style.width = '100px';
  div.style.height = '100px';
  div.style.overflow = 'scroll';
  div.style.position = 'absolute';
  div.style.top = '-9999px';
  document.body.appendChild(div);
  scrollbarWidth = div.offsetWidth - div.clientWidth;
  document.body.removeChild(div);
  return scrollbarWidth;
}

export function useScrollLock(active) {
  const locked = useRef(false);

  useEffect(() => {
    if (!active) {
      if (locked.current) {
        unlockBody();
        locked.current = false;
      }
      return;
    }

    lockBody();
    locked.current = true;

    return () => {
      if (locked.current) {
        unlockBody();
        locked.current = false;
      }
    };
  }, [active]);
}

function lockBody() {
  if (lockCount === 0) {
    originalHtmlOverflow = document.documentElement.style.overflow;
    originalBodyOverflow = document.body.style.overflow;
    originalPaddingRight = document.body.style.paddingRight;

    const sw = getScrollbarWidth();
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (sw > 0) {
      document.body.style.paddingRight = `${sw}px`;
    }
  }
  lockCount++;
}

function unlockBody() {
  if (lockCount === 0) return;
  lockCount--;
  if (lockCount === 0) {
    document.documentElement.style.overflow = originalHtmlOverflow;
    document.body.style.overflow = originalBodyOverflow;
    document.body.style.paddingRight = originalPaddingRight;
  }
}

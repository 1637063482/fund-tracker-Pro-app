// 页面滚动锁定 Hook：弹窗/模态框打开时禁止背景页面滚动，关闭后恢复，支持嵌套调用
// 滚动条宽度补偿由 CSS scrollbar-gutter: stable 统一处理，不再需要 JS 计算 paddingRight
import { useEffect, useRef } from 'react';

let lockCount = 0;
let originalHtmlOverflow = '';
let originalBodyOverflow = '';

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

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  lockCount++;
}

function unlockBody() {
  if (lockCount === 0) return;
  lockCount--;
  if (lockCount === 0) {
    document.documentElement.style.overflow = originalHtmlOverflow;
    document.body.style.overflow = originalBodyOverflow;
  }
}

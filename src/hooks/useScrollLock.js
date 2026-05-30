import { useEffect, useRef } from 'react';

let lockCount = 0;
let originalOverflow = '';
let originalPosition = '';
let originalTop = '';
let originalWidth = '';
let scrollY = 0;

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
    scrollY = window.scrollY;
    originalOverflow = document.body.style.overflow;
    originalPosition = document.body.style.position;
    originalTop = document.body.style.top;
    originalWidth = document.body.style.width;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
  }
  lockCount++;
}

function unlockBody() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow;
    document.body.style.position = originalPosition;
    document.body.style.top = originalTop;
    document.body.style.width = originalWidth;
    window.scrollTo(0, scrollY);
  }
}

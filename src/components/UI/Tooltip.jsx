// 悬浮提示组件：鼠标悬停时通过 Portal 在 body 层展示淡黄色提示气泡，避免被父级 transform 裁剪
import React, { useState } from 'react';
import { createPortal } from 'react-dom';

export const Tooltip = ({ children, content }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  return (
    <span
      className="inline-flex"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.bottom + 4 });
        setShow(true);
      }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && createPortal(
        <span
          className="fixed z-[200] px-3 py-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200 text-xs font-medium rounded-[0.625rem] shadow-lg pointer-events-none animate-in fade-in duration-150 whitespace-nowrap"
          style={{ left: `${pos.x}px`, top: `${pos.y}px`, transform: 'translateX(-50%)' }}
        >
          {content}
        </span>,
        document.body
      )}
    </span>
  );
};

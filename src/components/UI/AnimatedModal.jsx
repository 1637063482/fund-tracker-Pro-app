// 通用动画模态框组件：封装 useModalAnimation Hook，提供带 FLIP 过渡效果的遮罩层 + 面板容器
import React from 'react';
import { useModalAnimation } from '../../hooks/useModalAnimation';

export const AnimatedModal = ({ onClose, triggerRect, speed = 1.0, closeMultiplier = 2.0, zIndex, children, className = '' }) => {
  // autoOpen=true: 挂载即从 'opening' 状态开始 FLIP，确保首次 DOM commit 就在按钮位置
  const { isOpen, open, close, overlayStyle, panelStyle } = useModalAnimation(onClose, triggerRect, speed, closeMultiplier, zIndex, true);

  const childrenWithClose = typeof children === 'function' ? children(close) : children;

  return (
    <div style={overlayStyle}>
      <div style={panelStyle} className={className}>
        {childrenWithClose}
      </div>
    </div>
  );
};

// 数字动画组件：数值变化时以滚动/渐变动画过渡显示，支持自定义格式化函数
import React, { useState, useEffect, useRef } from 'react';
import { formatMoney } from '../../utils/helpers';

export const AnimatedNumber = ({ value, formatter = formatMoney, className = "" }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      setDisplayValue(value);
      isInitialMount.current = false;
      return;
    }

    let start = displayValue;
    let end = value;
    if (start === end) return;

    const duration = 400;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Spring easing with gentle overshoot
      const damping = 0.85;
      const stiffness = 0.4;
      const springProgress = 1 - Math.pow(damping, progress * 12) * Math.cos(progress * stiffness * 24);
      const current = start + (end - start) * springProgress;
      
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span className={`tabular-nums ${className}`}>{formatter(displayValue)}</span>;
};
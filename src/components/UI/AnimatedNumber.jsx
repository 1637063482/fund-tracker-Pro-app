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

    const duration = 500;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeProgress;
      
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
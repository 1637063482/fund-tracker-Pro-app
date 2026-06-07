// 行情卡片网格：内部管理 tick 方向动画状态，隔离行情 price 变化引发的 re-render
// tickDirs 状态变更仅影响本组件，不会向上传播触发 App 级重渲染
import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { AnimatedNumber } from '../UI/AnimatedNumber';

const MarketCardsGrid = React.memo(({ marketData }) => {
  const [tickDirs, setTickDirs] = useState({});
  const prevPricesRef = useRef({});
  const tickTimersRef = useRef({});

  // 检测行情数值变化方向，逐卡片独立计时触发跳动动画
  useEffect(() => {
    if (marketData.length === 0) return;
    const newDirs = { ...tickDirs };
    marketData.forEach(d => {
      const prev = prevPricesRef.current[d.id];
      if (prev !== undefined && prev !== d.price) {
        newDirs[d.id] = d.price > prev ? 'up' : 'down';
        // 已有动画在跑：先清除旧的
        if (tickTimersRef.current[d.id]) {
          clearTimeout(tickTimersRef.current[d.id]);
          delete tickTimersRef.current[d.id];
        }
        tickTimersRef.current[d.id] = setTimeout(() => {
          setTickDirs(prev => {
            const next = { ...prev };
            delete next[d.id];
            return next;
          });
          delete tickTimersRef.current[d.id];
        }, 1250);
      }
      prevPricesRef.current[d.id] = d.price;
    });
    if (Object.keys(newDirs).length !== Object.keys(tickDirs).length
        || Object.keys(newDirs).some(k => newDirs[k] !== tickDirs[k])) {
      setTickDirs(newDirs);
    }
    return () => {
      Object.values(tickTimersRef.current).forEach(clearTimeout);
    };
  }, [marketData]);

  // 组件卸载时兜底清理
  useEffect(() => () => {
    Object.values(tickTimersRef.current).forEach(clearTimeout);
  }, []);

  if (marketData.length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        {Array(5).fill(0).map((_, i) => (
          <div key={'skel'+i} className="bg-slate-50 dark:bg-slate-900 p-4 sm:p-5 rounded-[0.875rem] border border-slate-100 dark:border-slate-700 animate-pulse">
            <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded mb-3"></div>
            <div className="h-6 w-24 bg-slate-200 dark:bg-slate-800 rounded mb-2"></div>
            <div className="h-3 w-12 bg-slate-200 dark:bg-slate-800 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
      {marketData.map((data) => {
        const isPositive = data.change > 0;
        const textColor = isPositive ? 'text-red-500' : (data.change < 0 ? 'text-green-500' : 'text-slate-500');
        return (
          <div key={data.id} className={`apple-card-hover p-4 sm:p-5 transition-all duration-300 cursor-default hover:[transform:translateY(-8px)_scale(1.02)] ${tickDirs[data.id] === 'up' ? 'animate-tick-up' : tickDirs[data.id] === 'down' ? 'animate-tick-down' : ''} ${data.change > 0 ? 'bg-tick-up' : data.change < 0 ? 'bg-tick-down' : ''}`}>
            <div className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mb-1.5 font-bold tracking-wide truncate">{data.name}</div>
            <div className={`text-xl sm:text-2xl lg:text-3xl font-bold font-mono ${textColor} transition-colors duration-300 truncate w-full block`}>
              <AnimatedNumber value={data.price} formatter={(v) => v.toFixed(3)} privacy={false} />
            </div>
            <div className={`text-sm sm:text-base flex items-center mt-1.5 font-mono font-medium ${textColor} transition-colors duration-300 truncate`}>
              {isPositive ? <TrendingUp size={16} className="mr-1 shrink-0"/> : (data.change < 0 ? <TrendingDown size={16} className="mr-1 shrink-0"/> : null)}
              {isPositive ? '+' : ''}{(data.percent * 100).toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
});

MarketCardsGrid.displayName = 'MarketCardsGrid';

export { MarketCardsGrid };

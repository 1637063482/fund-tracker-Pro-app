// 静态复利推演卡片：基于当前 XIRR 推演目标日期的预计持仓总值
// 使用 React.memo 隔离，防止行情刷新等无关 state 变更时触发 re-render 导致烟花动效卡顿
import React from 'react';
import { TrendingUp } from 'lucide-react';
import FireworksBackground from '../Effects/FireworksBackground';
import { AnimatedNumber } from '../UI/AnimatedNumber';

const CompoundInterestCard = React.memo(({ projectedAssets, overallXirr, fmt }) => {
  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black rounded-[0.875rem] shadow-apple-lg border border-slate-700/60 p-6 sm:p-8 relative overflow-hidden text-white transition-all hover:shadow-xl hover:-translate-y-1 duration-300">
      <FireworksBackground />
      <div className="absolute -right-6 -bottom-6 text-white/5 pointer-events-none transform-gpu">
        <TrendingUp size={140} />
      </div>
      <h3 className="text-lg sm:text-xl font-bold mb-4 flex items-center relative z-10 text-blue-400">
        <TrendingUp className="mr-2" size={24} /> 静态复利推演
      </h3>
      <div className="space-y-4 relative z-10">
        <div className="text-slate-300 text-sm sm:text-base leading-relaxed">
          基于当前{' '}
          <span className="font-bold text-white tabular-nums text-base sm:text-lg bg-white/10 px-2 py-0.5 rounded-[0.625rem] ml-1 mr-1">
            {fmt.percent(overallXirr)}
          </span>{' '}
          综合年化收益率推演：
        </div>
        <div className="pt-2 border-t border-white/10 mt-2">
          <div className="text-slate-400 text-sm sm:text-base mb-1">
            至目标日期预计总持仓将达到:
          </div>
          <div className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-red-500 tracking-tight break-all drop-shadow-md">
            <AnimatedNumber value={projectedAssets} />
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数：仅当这些值实际变化时才 re-render
  return (
    prevProps.projectedAssets === nextProps.projectedAssets &&
    prevProps.overallXirr === nextProps.overallXirr &&
    prevProps.fmt === nextProps.fmt
  );
});

CompoundInterestCard.displayName = 'CompoundInterestCard';

export { CompoundInterestCard };

import React from 'react';
import { formatMoney, formatPercent } from '../../utils/helpers';

export const DonutChart = ({ data, valueFormatter = formatMoney, centerLabel = "总计" }) => {
  const COLORS =['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#84cc16'];
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  
  if (total === 0 || data.length === 0) {
    return <div className="flex items-center justify-center h-48 text-slate-400 text-sm animate-in fade-in duration-500">暂无数据</div>;
  }

  let cumulativePercent = 0;
  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return[x, y];
  };

  return (
    <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
      <div className="relative w-48 h-48 mb-6 group">
        <svg viewBox="-1 -1 2 2" className="w-full h-full transform -rotate-90 overflow-visible drop-shadow-md transition-transform duration-300 group-hover:scale-105">
          {data.map((slice, i) => {
            const value = Math.max(0, slice.value);
            if (value === 0) return null; 
            
            const percent = value / total;
            if (percent === 1) {
              return (
                <circle key={i} r="0.8" cx="0" cy="0" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="0.4" />
              );
            }

            const[startX, startY] = getCoordinatesForPercent(cumulativePercent);
            cumulativePercent += percent;
            const[endX, endY] = getCoordinatesForPercent(cumulativePercent);
            const largeArcFlag = percent > 0.5 ? 1 : 0;
            
            const pathData =[
              `M ${startX * 0.8} ${startY * 0.8}`,
              `A 0.8 0.8 0 ${largeArcFlag} 1 ${endX * 0.8} ${endY * 0.8}`
            ].join(' ');

            return (
              <path 
                key={i} 
                d={pathData} 
                fill="transparent" 
                stroke={COLORS[i % COLORS.length]} 
                strokeWidth="0.4" 
                className="transition-all duration-300 hover:stroke-[0.45] hover:opacity-80 cursor-pointer origin-center"
                style={{ transformOrigin: '0 0' }}
              >
                <title>{slice.name}: {valueFormatter(slice.value)} ({formatPercent(percent)})</title>
              </path>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-transform duration-300 group-hover:scale-105">
           <span className="text-xs text-slate-500 dark:text-slate-400">{centerLabel}</span>
           <span className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
             {valueFormatter === formatMoney && total >= 10000 ? (total / 10000).toFixed(2) + '万' : valueFormatter(total)}
           </span>
        </div>
      </div>
      
      <div className="w-full grid grid-cols-2 gap-x-2 gap-y-3 text-xs">
        {data.map((slice, i) => {
          if (slice.value <= 0) return null;
          return (
            <div key={i} className="flex flex-col truncate hover:-translate-y-0.5 transition-transform duration-200 cursor-default">
              <div className="flex items-center truncate mb-0.5">
                <div className="w-2.5 h-2.5 rounded-sm mr-1.5 shrink-0 shadow-sm" style={{backgroundColor: COLORS[i % COLORS.length]}}></div>
                <span className="truncate text-slate-600 dark:text-slate-400" title={slice.name}>{slice.name}</span>
              </div>
              <span className="font-mono text-slate-800 dark:text-slate-200 font-medium pl-4 tabular-nums">{formatPercent(slice.value/total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
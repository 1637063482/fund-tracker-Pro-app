// 环形图组件：纯 SVG 实现的圆环/饼图，用于展示持仓占比、资产配置等分布数据
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney, formatPercent } from '../../utils/helpers';
import { usePrivacyFormat } from '../../hooks/usePrivacyFormat';

export const DonutChart = ({ data, valueFormatter = formatMoney, centerLabel = "总计" }) => {
  const fmt = usePrivacyFormat();
  const [tooltip, setTooltip] = useState({ show: false, name: '', value: '', pct: '' });
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const COLORS = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FF2D55', '#5AC8FA', '#FF9F0A', '#30D158', '#64D2FF'];
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
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setTooltipPos({ x: r.left + r.width / 2, y: r.bottom + 4 });
                  setTooltip({
                    show: true,
                    name: slice.name,
                    value: valueFormatter(slice.value),
                    pct: fmt.percent(percent),
                  });
                }}
                onMouseLeave={() => {
                  setTooltip({ show: false, name: '', value: '', pct: '' });
                }}
              >
                <title>{slice.name}: {valueFormatter(slice.value)} ({fmt.percent(percent)})</title>
              </path>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-transform duration-300 group-hover:scale-105">
           <span className="text-xs sm:text-sm font-semibold tracking-wider text-slate-500 dark:text-slate-400">{centerLabel}</span>
           <span className="text-lg sm:text-xl font-bold font-mono text-slate-800 dark:text-slate-100 tabular-nums">
             {fmt.raw(valueFormatter === formatMoney && total >= 10000 ? (total / 10000).toFixed(2) + '万' : valueFormatter(total))}
           </span>
        </div>
      </div>
      
      {tooltip.show && createPortal(
        <span
          className="fixed z-[200] px-3 py-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200 text-xs font-medium rounded-[0.625rem] shadow-lg pointer-events-none animate-in fade-in duration-150 whitespace-nowrap"
          style={{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px', transform: 'translateX(-50%)' }}
        >
          {tooltip.name}: {tooltip.value}{tooltip.pct ? " (" + tooltip.pct + ")" : ""}
        </span>,
        document.body
      )}
      <div className="w-full grid grid-cols-2 gap-x-2 gap-y-3 text-xs sm:text-sm">
        {data.map((slice, i) => {
          if (slice.value <= 0) return null;
          return (
            <div key={i} className="flex flex-col truncate hover:-translate-y-0.5 transition-transform duration-200 cursor-default">
              <div className="flex items-center truncate mb-0.5">
                <div className="w-2.5 h-2.5 rounded-sm mr-1.5 shrink-0 shadow-sm" style={{backgroundColor: COLORS[i % COLORS.length]}}></div>
                <span className="truncate text-slate-700 dark:text-slate-300 font-medium"
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setTooltipPos({ x: r.left + r.width / 2, y: r.bottom + 4 });
                    setTooltip({
                      show: true,
                      name: slice.name,
                      value: '',
                      value: fmt.percent(slice.value/total),
                      pct: '',
                    });
                  }}
                  onMouseLeave={() => {
                    setTooltip({ show: false, name: '', value: '', pct: '' });
                  }}
                >{slice.name}</span>
              </div>
              <span className="font-mono text-slate-800 dark:text-slate-100 font-semibold pl-4 tabular-nums">{fmt.percent(slice.value/total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

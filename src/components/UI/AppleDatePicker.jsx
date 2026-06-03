// Apple 风格日历选择器：自定义下拉日历面板，Portal 到 body 避免父级 transform/overflow 裁剪
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 将 ISO 字符串 "2026-06-03" 格式化为紧凑显示 "2026/06/03"（避免中文格式过长导致换行） */
const formatDisplay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}/${m}/${d}`;
};

/** 获取某年某月的天数 */
const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

/** 获取某年某月第一天是星期几 (0=周日 → 调整为 0=周一) */
const firstDayOfWeek = (year, month) => {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
};

/** 今天的 ISO 字符串 */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const AppleDatePicker = ({ value, onChange, placeholder = '选择日期', className = '', disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    if (value) return parseInt(value.split('-')[0]);
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return parseInt(value.split('-')[1]) - 1;
    return new Date().getMonth();
  });

  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const positionRef = useRef({ top: 0, left: 0 });

  // 打开时：记录触发器屏幕位置 + 同步视图到选中日期
  const openPanel = useCallback(() => {
    if (disabled) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const panelH = 340;
      const panelW = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= panelH ? rect.bottom + 6 : rect.top - panelH - 6;
      let left = rect.left;
      if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
      if (left < 8) left = 8;
      positionRef.current = { top, left };
    }
    if (value) {
      setViewYear(parseInt(value.split('-')[0]));
      setViewMonth(parseInt(value.split('-')[1]) - 1);
    }
    setIsOpen(true);
  }, [disabled, value]);

  // 关闭（transition 驱动，避免 CSS animation fill-mode 兼容问题）
  const closePanel = useCallback(() => {
    const el = panelRef.current;
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'scale(0.94)';
      el.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    }
    setTimeout(() => setIsOpen(false), 200);
  }, []);

  // Portal 挂载后播放入场动画（transition 方式，无需 fill-mode）
  useEffect(() => {
    if (isOpen && panelRef.current) {
      const el = panelRef.current;
      // 初始状态已在 inline style 中：opacity:0, scale(0.94)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = 'opacity 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
          el.style.opacity = '1';
          el.style.transform = 'scale(1)';
        });
      });
    }
  }, [isOpen]);

  // 点击外部关闭（Portal 后 panel 不在 containerRef 内，需检查两个 ref）
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      const clickedInsideTrigger = containerRef.current?.contains(e.target);
      const clickedInsidePanel = panelRef.current?.contains(e.target);
      if (!clickedInsideTrigger && !clickedInsidePanel) {
        closePanel();
      }
    };
    // 用 mousedown 而非 click，避免用户拖选文字后误关闭
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [isOpen, closePanel]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closePanel]);

  const selectDate = useCallback((iso) => {
    onChange(iso);
    closePanel();
  }, [onChange, closePanel]);

  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const goNextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // 构建日历网格
  const calendarGrid = useMemo(() => {
    const today = todayISO();
    const totalDays = daysInMonth(viewYear, viewMonth);
    const startOffset = firstDayOfWeek(viewYear, viewMonth);
    const cells = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ type: 'empty', key: `e-${i}` });
    }
    for (let d = 1; d <= totalDays; d++) {
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        type: 'day',
        key: `d-${d}`,
        day: d,
        iso,
        isToday: iso === today,
        isSelected: iso === value,
      });
    }

    return cells;
  }, [viewYear, viewMonth, value]);

  const panel = isOpen ? (
    <div
      ref={panelRef}
      className="fixed z-[9999] w-[280px] bg-white dark:bg-slate-900 rounded-[1rem] shadow-apple-2xl border border-slate-200/60 dark:border-slate-700/40 p-4"
      style={{ top: positionRef.current.top, left: positionRef.current.left, opacity: 0, transform: 'scale(0.94)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 月导航头部 */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={goPrevMonth}
          className="p-1.5 rounded-[0.625rem] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors active:scale-90"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-bold text-slate-800 dark:text-slate-200 select-none">
          {viewYear}年{MONTHS[viewMonth]}
        </span>
        <button
          type="button"
          onClick={goNextMonth}
          className="p-1.5 rounded-[0.625rem] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors active:scale-90"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 星期标题 */}
      <div className="grid grid-cols-7 mb-1.5">
        {WEEKDAYS.map((wd, i) => (
          <div
            key={wd}
            className={`text-center text-[11px] font-bold py-1 select-none ${i >= 5 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}
          >
            {wd}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {calendarGrid.map((cell) => {
          if (cell.type === 'empty') {
            return <div key={cell.key} className="aspect-square" />;
          }
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => selectDate(cell.iso)}
              className={`
                aspect-square flex items-center justify-center text-sm font-medium rounded-full
                transition-all duration-150 active:scale-90
                ${cell.isSelected
                  ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25'
                  : cell.isToday
                    ? 'text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/40 dark:ring-blue-400/40'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }
              `}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {/* 底部快捷：跳转到今天 */}
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={() => selectDate(todayISO())}
          className="w-full py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-[0.625rem] transition-colors active:scale-[0.98]"
        >
          跳转到今天
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={`relative ${className || ''}`} style={{ background: 'transparent', border: 'none' }}>
      {/* 触发器：Apple 风格输入框 */}
      <button
        type="button"
        onClick={openPanel}
        disabled={disabled}
        className={`w-full flex items-center px-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:outline-none transition-all duration-300 text-left ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-900' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600'}`}
      >
        <span className={`flex-1 text-sm ${value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <Calendar size={16} className="text-slate-400 shrink-0 ml-2" />
      </button>

      {/* Portal 到 body：彻底脱离父级 transform/overflow 约束 */}
      {panel && createPortal(panel, document.body)}
    </div>
  );
};

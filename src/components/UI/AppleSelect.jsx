// Apple 风格选择器组件：Portal 渲染的自定义下拉菜单，支持点击外部关闭、键盘导航与滚动定位
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export const AppleSelect = ({ value, onChange, options = [], className = '', placeholder, triggerClassName = '' }) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const triggerRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({});

  const selected = options.find(o => o.value == value);
  const display = selected ? selected.label : (placeholder || '请选择');

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 120);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelStyle({
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.bottom + 4}px`,
      width: `${rect.width}px`,
      zIndex: 99999,
    });
  }, []);

  const handleOpen = useCallback(() => {
    updatePosition();
    setOpen(true);
    setClosing(false);
  }, [updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('keydown', handler);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const handleSelect = (optValue) => {
    onChange(optValue);
    close();
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? close() : handleOpen()}
        className={`w-full flex items-center justify-between text-left outline-none cursor-pointer font-sans ${triggerClassName}`}
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={14} className={`shrink-0 ml-1.5 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          style={panelStyle}
          className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-[0.75rem] shadow-xl py-1 max-h-60 overflow-y-auto custom-scrollbar ${closing ? 'opacity-0 scale-95' : 'opacity-100 scale-100'} transition-all duration-120 ease-out`}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.value); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                opt.value == value
                  ? 'bg-blue-50 text-blue-700 font-semibold dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

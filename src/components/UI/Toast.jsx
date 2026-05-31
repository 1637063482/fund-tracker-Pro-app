// 全局 Toast 通知系统：支持 success/error/info 三种类型，自动排队显示与定时消失，通过函数调用触发
import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

let toastId = 0;
let listeners = [];

function notify(toast) {
  listeners.forEach(fn => fn(prev => [...prev, toast]));
}

export function toast(message, type = 'info') {
  notify({ id: ++toastId, message, type });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const [exitingIds, setExitingIds] = useState(new Set());

  useEffect(() => {
    listeners.push(setToasts);
    return () => { listeners = listeners.filter(fn => fn !== setToasts); };
  }, []);

  const remove = useCallback((id) => {
    setExitingIds(prev => new Set([...prev, id]));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      setExitingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }, 300);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => remove(latest.id), 4000);
    return () => clearTimeout(timer);
  }, [toasts, remove]);

  if (toasts.length === 0) return null;

  const icons = { success: CheckCircle, error: AlertCircle, info: Info };
  const bgColors = {
    success: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800/40',
    error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800/40',
    info: 'bg-white/90 dark:bg-slate-900/90 border-slate-200/60 dark:border-slate-700/40',
  };

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col-reverse gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => {
        const Icon = icons[t.type] || Info;
        const isExiting = exitingIds.has(t.id);
        return (
          <div
            key={t.id}
            onClick={() => remove(t.id)}
            className={`pointer-events-auto px-4 py-3 rounded-[0.875rem] shadow-apple-lg text-sm font-medium flex items-start gap-2 cursor-pointer border ${bgColors[t.type] || bgColors.info} ${isExiting ? 'animate-toast-out' : 'animate-toast-in'}`}
          >
            <Icon size={18} className={`shrink-0 mt-0.5 ${t.type === 'success' ? 'text-emerald-500' : t.type === 'error' ? 'text-red-500' : 'text-slate-600 dark:text-slate-300'}`} />
            <span className="flex-1 leading-relaxed whitespace-pre-line text-slate-700 dark:text-slate-200">{t.message}</span>
            <X size={16} className="shrink-0 mt-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 opacity-60 hover:opacity-100 transition-opacity" />
          </div>
        );
      })}
    </div>
  );
}

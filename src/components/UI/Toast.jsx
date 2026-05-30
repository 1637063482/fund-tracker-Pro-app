import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

let toastId = 0;
let listeners = [];

function notify(toast) {
  listeners.forEach(fn => fn(toast));
}

export function toast(message, type = 'info') {
  notify({ id: ++toastId, message, type });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    listeners.push(setToasts);
    return () => { listeners = listeners.filter(fn => fn !== setToasts); };
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => remove(latest.id), 4000);
    return () => clearTimeout(timer);
  }, [toasts, remove]);

  if (toasts.length === 0) return null;

  const icons = { success: CheckCircle, error: AlertCircle, info: Info };
  const colors = {
    success: 'bg-emerald-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-slate-800 dark:bg-slate-700 text-white',
  };

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col-reverse gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => {
        const Icon = icons[t.type] || Info;
        return (
          <div
            key={t.id}
            onClick={() => remove(t.id)}
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-start gap-2 cursor-pointer animate-in slide-in-from-right-4 fade-in duration-200 ${colors[t.type] || colors.info}`}
          >
            <Icon size={18} className="shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed whitespace-pre-line">{t.message}</span>
            <X size={16} className="shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity" />
          </div>
        );
      })}
    </div>
  );
}

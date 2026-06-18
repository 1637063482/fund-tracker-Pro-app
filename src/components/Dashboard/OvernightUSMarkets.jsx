// 隔夜美股行情：Apple 风格浮标 + 实时美东时间
// 刷新受自动刷新开关 + 手动刷新 + 美股开/收盘状态三重控制
import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';

const OvernightUSMarkets = React.memo(({ isAutoRefresh, manualFetch }) => {
  const [usData, setUsData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState(false);
  const timerRef = useRef(null);
  const manualRef = useRef(0);

  // 美股是否在交易时段（北京时间 21:30 ~ 次日 04:00）
  const isUSOpen = () => {
    const h = new Date().getHours(), m = new Date().getMinutes();
    const cur = h * 60 + m;
    return cur >= 21 * 60 + 30 || cur < 4 * 60;
  };

  const fetchUS = async () => {
    try {
      const res = await fetch('https://qt.gtimg.cn/q=us.IXIC,us.INX,us.DJI', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buf);
      const items = [];
      (text || '').split(';').filter(l => l.includes('v_')).forEach(line => {
        const arr = line.substring(line.indexOf('="') + 2).split('~');
        if (arr.length < 5) return;
        const name = arr[1], price = parseFloat(arr[3]);
        const pct = parseFloat(arr[32]) || 0;
        const change = parseFloat(arr[31]) || 0;
        if (name && !isNaN(price)) items.push({ name, price, change, percent: pct });
      });
      if (items.length > 0) { setUsData(items); setError(false); }
      else setError(true);
    } catch (e) { setError(true); }
  };

  useEffect(() => {
    fetchUS(); // 挂载即拉一次
  }, []);

  // 手动刷新：外部 manualFetch 变化时触发
  useEffect(() => {
    if (manualFetch > manualRef.current) {
      manualRef.current = manualFetch;
      fetchUS();
    }
  }, [manualFetch]);

  // 自动刷新：仅当自动刷新开 + 美股交易中 + 页面可见
  useEffect(() => {
    let timerId = null;

    const startTimer = () => {
      if (timerId) clearInterval(timerId);
      if (isAutoRefresh && isUSOpen() && !document.hidden) {
        timerId = setInterval(fetchUS, 5000);
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (timerId) { clearInterval(timerId); timerId = null; }
      } else {
        startTimer();
      }
    };

    startTimer();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerId) clearInterval(timerId);
    };
  }, [isAutoRefresh]);

  // 实时时钟 — 页面不可见时暂停
  useEffect(() => {
    let clockId = null;

    const startClock = () => {
      if (clockId) clearInterval(clockId);
      if (!document.hidden) {
        clockId = setInterval(() => setNow(new Date()), 1000);
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (clockId) { clearInterval(clockId); clockId = null; }
      } else {
        startClock();
      }
    };

    startClock();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (clockId) clearInterval(clockId);
    };
  }, []);

  if (error || !usData || usData.length === 0) return null;

  const shortName = (n) => n.replace('综合指数', '').replace('指数', '').replace('标普500', '标普').replace('纳斯达克', '纳指').replace('道琼斯', '道指');

  const fmtET = (d) => {
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return `${et.getFullYear()}-${et.getMonth() + 1}-${et.getDate()} ${String(et.getHours()).padStart(2, '0')}:${String(et.getMinutes()).padStart(2, '0')}:${String(et.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2">
      {usData.map(d => {
        const isUp = d.change > 0;
        const colorClass = isUp ? 'text-red-500' : d.change < 0 ? 'text-green-500' : 'text-slate-400';
        const bgClass = isUp ? 'bg-red-50/60 dark:bg-red-950/20' : d.change < 0 ? 'bg-green-50/60 dark:bg-green-950/20' : 'bg-slate-50/60 dark:bg-slate-800/30';
        const borderClass = isUp ? 'border-red-100 dark:border-red-900/30' : d.change < 0 ? 'border-green-100 dark:border-green-900/30' : 'border-slate-100 dark:border-slate-700/30';
        return (
          <div key={d.name}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[0.625rem] border ${bgClass} ${borderClass} text-xs font-mono transition-all duration-300 cursor-default hover:[transform:translateY(-8px)_scale(1.02)] hover:shadow-md`}
          >
            <span className="text-slate-500 dark:text-slate-400 text-[10px]">{shortName(d.name)}</span>
            <span className={`font-bold ${colorClass}`}>{d.price.toFixed(2)}</span>
            <span className={`flex items-center text-[11px] font-medium ${colorClass}`}>
              {isUp ? <TrendingUp size={11} className="mr-0.5" /> : <TrendingDown size={11} className="mr-0.5" />}
              {d.change >= 0 ? '+' : ''}{d.percent.toFixed(2)}%
            </span>
          </div>
        );
      })}
      <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 font-mono flex items-center gap-0.5">
        <Clock size={11} />
        {fmtET(now)} ET
      </span>
    </div>
  );
});

OvernightUSMarkets.displayName = 'OvernightUSMarkets';
export { OvernightUSMarkets };

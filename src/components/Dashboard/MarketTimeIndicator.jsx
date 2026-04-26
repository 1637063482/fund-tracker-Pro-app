import React, { useState, useEffect } from 'react';
import { Clock, Bell } from 'lucide-react';

export const MarketTimeIndicator = () => {
  const [timeObj, setTimeObj] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTimeObj(new Date()), 1000);
    return () => clearInterval(timer);
  },[]);

  const formatTime = (date) => {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const getMarketStatus = (date) => {
    const day = date.getDay();
    const hours = date.getHours();
    const mins = date.getMinutes();
    const currentTimeInMinutes = hours * 60 + mins;

    if (day === 0 || day === 6) return { status: '休市中', isTrading: false, countdown: null };

    if (currentTimeInMinutes < 540) {
       return { status: '未开盘', isTrading: false, countdown: null };
    }

    if (currentTimeInMinutes >= 540 && currentTimeInMinutes < 570) {
       const minsLeft = 570 - currentTimeInMinutes;
       return { status: '盘前准备', isTrading: false, countdown: `距开盘仅剩 ${minsLeft} 分钟`, urgent: true };
    }

    if (currentTimeInMinutes >= 570 && currentTimeInMinutes < 690) {
       return { status: '交易中 (早盘)', isTrading: true, countdown: null };
    }
    
    if (currentTimeInMinutes >= 690 && currentTimeInMinutes < 780) {
       const minsLeft = 780 - currentTimeInMinutes;
       if (minsLeft <= 30) {
         return { status: '午间休市', isTrading: false, countdown: `距午盘开盘仅剩 ${minsLeft} 分钟`, urgent: true };
       }
       return { status: '午间休市', isTrading: false, countdown: null };
    }

    if (currentTimeInMinutes >= 780 && currentTimeInMinutes < 900) {
       const minsLeft = 900 - currentTimeInMinutes;
       if (minsLeft <= 30) {
          return { status: '交易中 (即将收盘)', isTrading: true, countdown: `距收盘仅剩 ${minsLeft} 分钟`, urgent: true };
       }
       return { status: '交易中 (午盘)', isTrading: true, countdown: null };
    }

    return { status: '已收盘', isTrading: false, countdown: null };
  };

  const { status, isTrading, countdown, urgent } = getMarketStatus(timeObj);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center text-sm font-medium transform-gpu" style={{ willChange: 'transform' }}>
      <div className="flex items-center space-x-3 mb-2 sm:mb-0 sm:mr-4">
         <div className="flex items-center text-slate-700 dark:text-slate-300">
           <Clock className="mr-1.5 text-slate-500 w-[18px] h-[18px] xl:w-[24px] xl:h-[24px]" />
           <span className="font-mono tabular-nums tracking-wide text-base sm:text-lg xl:text-2xl">{timeObj.toLocaleDateString().replace(/\//g, '-')} {formatTime(timeObj)}</span>
         </div>
         
         <div className={`px-2.5 py-0.5 rounded-full text-xs xl:text-sm flex items-center border transition-colors duration-500 ${isTrading ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}`}>
           {isTrading && <div className="w-1.5 h-1.5 xl:w-2 xl:h-2 rounded-full bg-green-500 mr-1.5 shadow-[0_0_6px_rgba(34,197,94,0.6)]"></div>}
           {status}
         </div>
      </div>
      
      {countdown && (
        <div className={`flex items-center px-3 py-1 rounded-md text-xs xl:text-sm font-bold transition-all duration-500 ${urgent ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 shadow-sm' : 'text-amber-600 dark:text-amber-500'}`}>
          <Bell className="mr-1 w-[14px] h-[14px] xl:w-[18px] xl:h-[18px] text-red-500" />
          {countdown}
        </div>
      )}
    </div>
  );
};
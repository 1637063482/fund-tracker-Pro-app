import React, { useState, useEffect, useMemo, useRef, Fragment, useCallback } from 'react';
import { 
  TrendingUp, TrendingDown, Plus, Trash2, Save, X, Target, Award, 
  PieChart, Activity, Sun, Moon, Edit3, RefreshCw, AlertCircle, 
  Zap, LogOut, Mail, Lock, LogIn, Cloud, CloudOff, ArrowUpDown, 
  ArrowUp, ArrowDown, Download, Settings, Database, Clock, Bell,
  Play, Pause, Archive, RefreshCcw, CheckCircle2
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';

const USER_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAHY-z7vomHW6AUVV-a4laSGogcC1BMGM0",
  authDomain: "fund-tracker-66e68.firebaseapp.com",
  projectId: "fund-tracker-66e68",
  storageBucket: "fund-tracker-66e68.firebasestorage.app",
  messagingSenderId: "199762393112",
  appId: "1:199762393112:web:ffa3efa00339108c0ceb6d",
  measurementId: "G-VM99BJCJSZ"
};

const firebaseConfig = (typeof __firebase_config !== 'undefined' && __firebase_config) 
  ? JSON.parse(__firebase_config) 
  : USER_FIREBASE_CONFIG;

const appId = typeof __app_id !== 'undefined' ? String(__app_id).replace(/\//g, '-') : 'my-fund-tracker';

let app, auth, db;
if (firebaseConfig.apiKey) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const evaluateExpression = (expr) => {
  if (typeof expr !== 'string') return expr || 0;
  let toEval = expr.trim();
  if (toEval.startsWith('=')) toEval = toEval.substring(1);
  if (!toEval) return 0;
  if (!/^[0-9+\-*/().\s]*$/.test(toEval)) return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr);
  try {
    const result = new Function('"use strict";return (' + toEval + ')')();
    return isNaN(result) || !isFinite(result) ? 0 : Number(result.toFixed(2));
  } catch (e) {
    return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr);
  }
};

const calculateXIRR = (cashFlows) => {
  const flows = cashFlows.map(cf => ({ amount: cf.amount, date: new Date(cf.date) })).filter(cf => !isNaN(cf.date.getTime()));
  if (flows.length < 2) return 0;
  
  flows.sort((a, b) => a.date - b.date);

  const hasPositive = flows.some(f => f.amount > 0);
  const hasNegative = flows.some(f => f.amount < 0);
  if (!hasPositive || !hasNegative) return 0;

  const d0 = flows[0].date;
  if (flows[flows.length - 1].date - d0 === 0) return 0;

  const xnpv = (rate) => {
    if (rate <= -1) return NaN;
    return flows.reduce((sum, cf) => {
      const years = (cf.date - d0) / 86400000 / 365.0;
      return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);
  };

  let low = -0.999999;
  let high = 10000;   
  let rate = 0;

  for (let i = 0; i < 100; i++) {
    rate = (low + high) / 2;
    let val = xnpv(rate);
    if (Math.abs(val) < 0.00001 || (high - low) < 0.000001) break;
    if (val > 0) low = rate; else high = rate;
  }
  return rate;
};

const formatMoney = (val) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(val);
const formatPercent = (val) => new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: 2 }).format(val);

const checkIsTradingTime = () => {
  const date = new Date();
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const mins = date.getHours() * 60 + date.getMinutes();
  return (mins >= 555 && mins <= 690) || (mins >= 780 && mins <= 905);
};

const ASSET_NAMES = {
  'sh000001': '上证指数',
  'sz399001': '深证成指',
  'sz399006': '创业板指',
  'sh511260': '10年期国债ETF',
  'sh511090': '30年期国债ETF'
};

const PROXY_NODES = [
  { name: '节点 1 (AllOrigins-Raw)', fetcher: async (url) => { const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); return await r.text(); } },
  { name: '节点 2 (ThingProxy)', fetcher: async (url) => { const r = await fetch(`https://thingproxy.freeboard.io/fetch/${url}`); return await r.text(); } },
  { name: '节点 3 (CorsProxy.io)', fetcher: async (url) => { const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`); return await r.text(); } },
  { name: '节点 4 (CodeTabs)', fetcher: async (url) => { const r = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`); return await r.text(); } },
  { name: '节点 5 (AllOrigins-JSON)', fetcher: async (url) => { const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`); const d = await r.json(); return d.contents; } }
];

const AnimatedNumber = ({ value, formatter = formatMoney, className = "" }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      setDisplayValue(value);
      isInitialMount.current = false;
      return;
    }

    let start = displayValue;
    let end = value;
    if (start === end) return;

    const duration = 500;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeProgress;
      
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span className={`tabular-nums ${className}`}>{formatter(displayValue)}</span>;
};

const SmartInput = ({ value, onChange, placeholder, className, isDate = false, type = "text", disabled = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => { if (!isEditing) setLocalValue(value || ''); }, [value, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    onChange(localValue, isDate ? localValue : evaluateExpression(localValue));
  };

  return (
    <input
      type={isDate ? "date" : type}
      value={isEditing ? localValue : (isDate ? localValue : (type === "number" ? localValue : evaluateExpression(localValue)))}
      onChange={(e) => setLocalValue(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={`px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all duration-300 dark:bg-slate-800 dark:border-slate-700 dark:text-white ${className} ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-900' : ''}`}
    />
  );
};

const DonutChart = ({ data, valueFormatter = formatMoney, centerLabel = "总计" }) => {
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#84cc16'];
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  
  if (total === 0 || data.length === 0) {
    return <div className="flex items-center justify-center h-48 text-slate-400 text-sm animate-in fade-in duration-500">暂无数据</div>;
  }

  let cumulativePercent = 0;
  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
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

            const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
            cumulativePercent += percent;
            const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
            const largeArcFlag = percent > 0.5 ? 1 : 0;
            
            const pathData = [
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

const MarketTimeIndicator = () => {
  const [timeObj, setTimeObj] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTimeObj(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
           {isTrading && <div className="w-1.5 h-1.5 xl:w-2 xl:h-2 rounded-full bg-green-500 mr-1.5 animate-pulse"></div>}
           {status}
         </div>
      </div>
      
      {countdown && (
        <div className={`flex items-center px-3 py-1 rounded-md text-xs xl:text-sm font-bold transition-all duration-500 ${urgent ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 animate-pulse-fast shadow-sm' : 'text-amber-600 dark:text-amber-500'}`}>
          <Bell className={`mr-1 w-[14px] h-[14px] xl:w-[18px] xl:h-[18px] ${urgent ? 'animate-bounce' : ''}`} />
          {countdown}
        </div>
      )}
    </div>
  );
};

const LoginScreen = ({ theme, setTheme, dbError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); 
    setError('');
    if (!auth) return setError('未检测到有效的 Firebase 配置，请检查源码参数。');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      let msg = "认证失败，请检查账号和密码。";
      if (err.code === 'auth/invalid-email') msg = "邮箱格式不正确。";
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') msg = "账号或密码错误。";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4 sm:px-6 lg:px-8 transition-colors duration-500">
      <div className="absolute top-4 right-4">
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2.5 rounded-full bg-white/50 hover:bg-white/80 dark:bg-slate-800/50 dark:hover:bg-slate-700/80 backdrop-blur-sm text-slate-500 dark:text-slate-400 transition-all hover:scale-110 active:scale-95 shadow-sm">
          {theme === 'dark' ? <Sun size={20} className="text-yellow-400"/> : <Moon size={20}/>}
        </button>
      </div>
      
      <div className="max-w-md w-full space-y-8 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-white/20 dark:border-slate-700/50 animate-in fade-in zoom-in-95 duration-500 slide-in-from-bottom-8">
        <div>
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg mb-6 transform transition-transform hover:rotate-12 duration-300">
            <Activity className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-center text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Fund Tracker</h2>
          <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">专属基金收益追踪系统 · 仅限授权访问</p>
        </div>

        {(dbError || error) && (
          <div className="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start text-red-700 dark:text-red-400 animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertCircle size={20} className="mr-3 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error || dbError}</p>
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 ml-1">授权邮箱</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-blue-500"><Mail size={18} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" /></div>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="block w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white transition-all outline-none hover:border-slate-300 dark:hover:border-slate-600" placeholder="admin@example.com" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 ml-1">访问密码</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-blue-500"><Lock size={18} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" /></div>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="block w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white transition-all outline-none hover:border-slate-300 dark:hover:border-slate-600" placeholder="••••••••" />
              </div>
            </div>
          </div>

          <div>
            <button type="submit" disabled={loading} className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-bold rounded-2xl text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden">
              <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                {loading ? <RefreshCw size={20} className="animate-spin text-blue-300"/> : <LogIn size={20} className="text-blue-300 group-hover:text-blue-200 group-hover:translate-x-1 transition-all duration-300" />}
              </span>
              {loading ? '正在验证身份...' : '进入系统'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ProxySettingsModal = ({ settings, onSave, onClose }) => {
  const [mode, setMode] = useState(settings.proxyMode || 'builtin');
  const [customUrl, setCustomUrl] = useState(settings.customProxyUrl || '');
  const [dataSource, setDataSource] = useState(settings.dataSource || 'tencent');
  const [navDataSource, setNavDataSource] = useState(settings.navDataSource || 'tiantian'); 
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200); 
  };

  return (
    <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-200 ${isClosing ? 'scale-95 translate-y-4' : 'scale-100 translate-y-0'} animate-in fade-in zoom-in-95 slide-in-from-bottom-4`}>
        
        <div className="flex justify-between items-center p-6 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <h3 className="text-xl font-bold flex items-center text-slate-800 dark:text-white"><Settings className="mr-2 text-blue-500 transition-transform hover:rotate-90 duration-500" /> 行情源与代理设置</h3>
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-full p-1.5 shadow-sm active:scale-90"><X size={20} /></button>
        </div>
        
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
          
          <div className="space-y-3">
            <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center"><Database size={16} className="mr-1.5 text-indigo-500"/> 实时行情数据源 (大盘/ETF)</label>
            <div className="grid grid-cols-3 gap-2">
              {['tencent', 'sina', 'xueqiu'].map((ds) => (
                <button key={ds} type="button" onClick={() => setDataSource(ds)} className={`p-2.5 border rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95 text-sm font-medium ${dataSource === ds ? 'bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-500 dark:text-indigo-300 shadow-sm' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/50'}`}>
                  {ds === 'tencent' ? '腾讯财经' : ds === 'sina' ? '新浪财经' : '雪球行情'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center"><PieChart size={16} className="mr-1.5 text-blue-500"/> 基金净值数据源 (自动估值)</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'tiantian', label: '天天(盘中)', desc: 'JSONP直连' },
                { id: 'tiantian_lsjz', label: '天天(历史)', desc: 'Web真净值' },
                { id: 'sina', label: '新浪财经', desc: '需代理' },
                { id: 'danjuan', label: '蛋卷基金', desc: '需代理格式佳' }
              ].map((src) => (
                <button key={src.id} type="button" onClick={() => setNavDataSource(src.id)} className={`p-2.5 border rounded-xl flex flex-col items-center justify-center transition-all duration-200 active:scale-95 text-sm font-medium ${navDataSource === src.id ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-300 shadow-sm' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/50'}`}>
                   <span>{src.label}</span>
                   <span className="text-[10px] font-normal opacity-80 mt-0.5">({src.desc})</span>
                </button>
              ))}
            </div>
          </div>

          <hr className="border-slate-200 dark:border-slate-700" />

          <div className="space-y-4">
             <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center"><Cloud size={16} className="mr-1.5 text-amber-500"/> 全局跨域代理模式</label>
            
            <label className={`flex items-center space-x-3 cursor-pointer p-3 rounded-xl border transition-all duration-200 ${mode === 'builtin' ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/20 shadow-sm' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
              <input type="radio" checked={mode === 'builtin'} onChange={() => setMode('builtin')} className="w-4 h-4 text-amber-600 focus:ring-amber-500 transition-colors" />
              <span className="text-slate-700 dark:text-slate-300 font-medium text-sm">使用内置公共代理池 (自动灾备切换)</span>
            </label>

            <label className={`flex items-start space-x-3 cursor-pointer p-4 rounded-xl border transition-all duration-200 ${mode === 'custom' ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/20 shadow-sm' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
              <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} className="w-4 h-4 text-amber-600 focus:ring-amber-500 mt-1 transition-colors" />
              <div className="flex-1">
                <span className="text-slate-700 dark:text-slate-300 font-medium text-sm block mb-2">使用自定义 Web API 代理</span>
                <input 
                  value={customUrl} 
                  onChange={e => setCustomUrl(e.target.value)} 
                  disabled={mode !== 'custom'}
                  placeholder="https://your-proxy.workers.dev/?url={{url}}" 
                  className={`w-full px-3 py-2 border rounded-lg text-sm transition-all duration-300 font-mono ${mode === 'custom' ? 'bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none shadow-inner' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed'}`} 
                />
                <p className={`text-xs mt-2 leading-relaxed transition-colors duration-300 ${mode === 'custom' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  注：请填入支持 CORS 转发的 API 端点。使用 <code>{`{{url}}`}</code> 作为目标请求地址的占位符。
                </p>
              </div>
            </label>
          </div>

        </div>
        
        <div className="p-6 border-t dark:border-slate-700 flex justify-end space-x-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl">
          <button type="button" onClick={handleClose} className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-medium active:scale-95">取消</button>
          <button type="button" onClick={() => onSave({ proxyMode: mode, customProxyUrl: customUrl, dataSource, navDataSource })} className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md hover:shadow-lg transition-all active:scale-95">保存设置</button>
        </div>
      </div>
    </div>
  );
};

const FundEditor = ({ fund, onSave, onCancel, fundNavs, fetchNavManually }) => {
  const [localFund, setLocalFund] = useState({
    id: fund.id, 
    name: fund.name || '',
    transactions: fund.transactions?.length > 0 ? [...fund.transactions] : [{ id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }],
    currentValueRaw: fund.currentValueRaw || '',
    mode: fund.mode || 'manual', 
    fundCode: fund.fundCode || '',
    shares: fund.shares || '',
    isArchived: fund.isArchived || false, 
    lastNav: fund.lastNav || 0
  });

  const [isFetchingLocalNav, setIsFetchingLocalNav] = useState(false);
  const [localNavError, setLocalNavError] = useState('');

  const handleUpdateTx = (index, field, val) => {
    const updated = [...localFund.transactions];
    updated[index] = { ...updated[index], [field]: val };
    setLocalFund({ ...localFund, transactions: updated });
  };

  const handleTriggerNavFetch = async () => {
     if (!localFund.fundCode) return;
     setIsFetchingLocalNav(true);
     setLocalNavError('');
     
     const result = await fetchNavManually(localFund.fundCode);
     if (!result) {
        setLocalNavError('获取失败，请检查代码或重试');
     } else {
        const isCurrentlyOfficial = Object.values(fundNavs).some(navObj => navObj.name === localFund.name);
        const canOverwriteName = !localFund.name || localFund.name === '未知名称' || isCurrentlyOfficial;

        if (result.name && result.name !== '未知名称' && canOverwriteName) {
           setLocalFund(prev => ({ ...prev, name: result.name }));
        }
     }
     setIsFetchingLocalNav(false);
  };

  const currentEstimatedValue = useMemo(() => {
     if (localFund.mode === 'auto') {
        const nav = fundNavs[localFund.fundCode]?.nav || localFund.lastNav || 0;
        return (Number(localFund.shares) || 0) * nav;
     }
     return evaluateExpression(localFund.currentValueRaw);
  }, [localFund, fundNavs]);

  const canArchive = currentEstimatedValue <= 0.01;

  const getTypeMeta = (type, amountStr) => {
    const rawAmt = evaluateExpression(amountStr);
    const inferredType = type || (rawAmt < 0 ? 'buy' : 'sell');
    switch(inferredType) {
        case 'buy': return { icon: <ArrowDown size={16} className="text-blue-500" />, color: 'text-blue-600 dark:text-blue-400' };
        case 'sell': return { icon: <ArrowUp size={16} className="text-amber-500" />, color: 'text-amber-600 dark:text-amber-400' };
        case 'dividend_cash': return { icon: <Zap size={16} className="text-rose-500" />, color: 'text-rose-600 dark:text-rose-400' };
        case 'dividend_reinvest': return { icon: <RefreshCw size={16} className="text-indigo-500" />, color: 'text-indigo-600 dark:text-indigo-400' };
        case 'fee': return { icon: <AlertCircle size={16} className="text-slate-500" />, color: 'text-slate-600 dark:text-slate-400' };
        default: return { icon: <Activity size={16} className="text-slate-300"/>, color: '' };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
         <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl w-full sm:w-fit shadow-inner h-fit">
            <button 
              type="button"
              onClick={() => setLocalFund({...localFund, mode: 'manual'})}
              className={`flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-lg transition-all duration-300 ${localFund.mode === 'manual' ? 'bg-white text-blue-600 dark:bg-slate-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'}`}
            >手动录入市值</button>
            <button 
              type="button"
              onClick={() => setLocalFund({...localFund, mode: 'auto'})}
              className={`flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-lg transition-all duration-300 flex items-center justify-center ${localFund.mode === 'auto' ? 'bg-white text-blue-600 dark:bg-slate-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'}`}
            ><RefreshCcw size={14} className="mr-1.5"/> 自动同步净值</button>
         </div>
         
         <div className="flex flex-col items-end w-full sm:w-auto">
           <label className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-xl border transition-all duration-300 w-full sm:w-auto ${!canArchive ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700' : (localFund.isArchived ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400 shadow-sm cursor-pointer' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer')}`}>
              <input type="checkbox" disabled={!canArchive} checked={!!localFund.isArchived} onChange={(e) => setLocalFund({...localFund, isArchived: e.target.checked})} className="rounded text-amber-500 focus:ring-amber-500 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 disabled:opacity-50" />
              <span className="text-sm font-bold flex items-center"><Archive size={16} className="mr-1.5"/> {localFund.isArchived ? '已归档 (隐藏不计入)' : '标记为已清仓/归档'}</span>
           </label>
           {!canArchive && <span className="text-xs text-red-500 mt-1.5 font-medium flex items-start max-w-[280px] text-right"><AlertCircle size={12} className="mr-1 shrink-0 mt-0.5"/>需现持仓金额为 0 才能清仓。请添加卖出记录，并确保将【当前持有总份额】清零。</span>}
         </div>
      </div>

      <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
        <div>
          <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1">基金/资产名称</label>
          <input value={localFund.name} onChange={(e) => setLocalFund({...localFund, name: e.target.value})} placeholder="例如: 易方达蓝筹精选混合" className="w-full px-4 py-3 border border-slate-200 rounded-xl dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm text-base" />
        </div>

        {localFund.mode === 'manual' ? (
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-300">
            <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1">现持仓总市值 (元)</label>
            <SmartInput value={localFund.currentValueRaw} onChange={(raw) => setLocalFund({...localFund, currentValueRaw: raw})} placeholder="请输入现在的账面总价值，支持简单公式如 =10000+500" className="w-full py-3 shadow-sm bg-white tabular-nums" />
          </div>
        ) : (
          <div className="bg-blue-50/50 dark:bg-slate-800/80 p-5 rounded-2xl border border-blue-100 dark:border-slate-700 animate-in zoom-in-95 duration-300 space-y-4 shadow-sm">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                   <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1 flex justify-between items-end">
                     基金代码
                   </label>
                   <div className="relative group">
                     <input value={localFund.fundCode} onChange={(e) => setLocalFund({...localFund, fundCode: e.target.value})} onBlur={handleTriggerNavFetch} placeholder="例如: 005827" className="w-full px-4 py-3 border border-slate-200 rounded-xl dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm text-base font-mono uppercase bg-white" />
                     <button type="button" onClick={handleTriggerNavFetch} className={`absolute right-2 top-2 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-all ${isFetchingLocalNav ? 'animate-spin text-blue-500' : ''}`} title="手动拉取净值"><RefreshCcw size={18}/></button>
                   </div>
                </div>
                <div>
                   <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1">当前持有总份额</label>
                   <input type="number" value={localFund.shares} onChange={(e) => setLocalFund({...localFund, shares: e.target.value})} placeholder="例如: 10500.55" className="w-full px-4 py-3 border border-slate-200 rounded-xl dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm text-base font-mono bg-white tabular-nums" />
                </div>
             </div>
             
             <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <span className="text-sm text-slate-500 font-medium">系统自动计算持仓市值：</span>
                    <span className="text-2xl font-black font-mono tabular-nums text-blue-600 dark:text-blue-400 tracking-tight">
                       {formatMoney(currentEstimatedValue)}
                    </span>
                </div>
                <div className="w-full h-px bg-slate-100 dark:bg-slate-800"></div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-sm gap-2">
                    <div className="flex items-center text-slate-500 flex-wrap gap-1">
                      <span>获取到的最新单位净值:</span>
                      {isFetchingLocalNav ? (
                        <span className="text-blue-500 flex items-center font-medium bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded"><RefreshCcw size={14} className="animate-spin mr-1.5"/> 拉取中...</span>
                      ) : (
                        <div className="flex items-center gap-2">
                           <span className={`font-bold font-mono tabular-nums text-base ${fundNavs[localFund.fundCode] ? 'text-indigo-600 dark:text-indigo-400' : (localNavError ? 'text-red-500' : 'text-slate-400')}`}>
                              {fundNavs[localFund.fundCode]?.nav || localFund.lastNav || localNavError || '等待拉取'}
                           </span>
                           {(fundNavs[localFund.fundCode]?.date || localFund.lastNavDate) && !localNavError && (
                             <span className="text-xs text-slate-400 font-mono tabular-nums">({fundNavs[localFund.fundCode]?.date || localFund.lastNavDate})</span>
                           )}
                           {fundNavs[localFund.fundCode] && (
                              <span className="flex items-center text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300 px-1.5 py-0.5 rounded-md font-medium">
                                <CheckCircle2 size={10} className="mr-1"/> {fundNavs[localFund.fundCode].source}
                              </span>
                           )}
                        </div>
                      )}
                    </div>
                    
                    {!!(localFund.currentValueRaw && !isNaN(evaluateExpression(localFund.currentValueRaw)) && evaluateExpression(localFund.currentValueRaw) > 0 && (fundNavs[localFund.fundCode]?.nav || localFund.lastNav)) ? (
                       <button type="button" onClick={() => setLocalFund({...localFund, shares: (evaluateExpression(localFund.currentValueRaw) / (fundNavs[localFund.fundCode]?.nav || localFund.lastNav)).toFixed(2)})} className="text-blue-500 hover:text-blue-700 font-medium hover:underline flex items-center transition-colors active:scale-95">
                         <Zap size={14} className="mr-1 text-amber-500"/> 用历史手动市值反推份额
                       </button>
                    ) : null}
                </div>
             </div>
          </div>
        )}
      </div>
      
      <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
        <div className="mb-4">
          <h4 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">历史现金流记录</h4>
          <div className="text-xs text-slate-500 flex items-center flex-wrap gap-3">
            <span className="flex items-center"><ArrowDown size={14} className="text-blue-500 mr-1"/>本金投入 / 费用 (记为负向)</span>
            <span className="flex items-center"><ArrowUp size={14} className="text-amber-500 mr-1"/>卖出 / 现金分红 (记为正向)</span>
          </div>
        </div>
        
        <div className="space-y-4 max-h-[35vh] overflow-y-auto pr-2 pb-2 custom-scrollbar">
          {localFund.transactions.map((tx, index) => {
            const meta = getTypeMeta(tx.type, tx.amountRaw);

            return (
            <div key={tx.id} className={`flex items-center bg-white dark:bg-slate-900 p-2 sm:p-3 rounded-xl border-y border-r border-l-4 shadow-sm hover:shadow-md transition-all group animate-in fade-in slide-in-from-left-4 duration-300 ${tx.type === 'buy' ? 'border-l-blue-500 border-y-slate-200 border-r-slate-200 dark:border-y-slate-700 dark:border-r-slate-700' : (tx.type === 'sell' || tx.type === 'dividend_cash') ? 'border-l-amber-500 border-y-slate-200 border-r-slate-200 dark:border-y-slate-700 dark:border-r-slate-700' : 'border-l-slate-300 border-y-slate-200 border-r-slate-200 dark:border-slate-700'}`}>
              
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono mr-3 shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {index + 1}
              </div>

              <div className="flex-1 flex flex-col lg:flex-row gap-2 lg:gap-4">
                 <SmartInput isDate={true} value={tx.date} onChange={(val) => handleUpdateTx(index, 'date', val)} className="w-full lg:w-36 py-2 text-sm tabular-nums bg-slate-50 dark:bg-slate-800/50 border-transparent hover:border-slate-300 focus:bg-white dark:focus:bg-slate-900" />
                 
                 <div className="flex flex-1 gap-2">
                   <select 
                     value={tx.type || (evaluateExpression(tx.amountRaw) < 0 ? 'buy' : 'sell')} 
                     onChange={(e) => handleUpdateTx(index, 'type', e.target.value)}
                     className="text-sm border-transparent bg-slate-50 dark:bg-slate-800/50 rounded-lg py-2 px-1 sm:px-2 focus:ring-blue-500 focus:outline-none font-bold text-slate-600 dark:text-slate-300 outline-none hover:bg-slate-100 dark:hover:bg-slate-800"
                   >
                     <option value="buy">买入建仓</option>
                     <option value="sell">卖出提现</option>
                     <option value="dividend_cash">现金分红</option>
                     <option value="dividend_reinvest">红利再投</option>
                     <option value="fee">手续费</option>
                   </select>

                   <div className="relative flex-1 flex items-center">
                     <div className="absolute left-3 pointer-events-none">{meta.icon}</div>
                     <SmartInput 
                       value={tx.amountRaw} 
                       onChange={(raw) => handleUpdateTx(index, 'amountRaw', raw)} 
                       placeholder="输入金额 (绝对值即可)" 
                       className={`w-full py-2 pl-9 font-mono tabular-nums font-medium text-base sm:text-lg bg-slate-50 dark:bg-slate-800/50 border-transparent hover:border-slate-300 focus:bg-white dark:focus:bg-slate-900 ${meta.color}`} 
                     />
                   </div>
                 </div>
              </div>

              <button type="button" onClick={() => setLocalFund({...localFund, transactions: localFund.transactions.filter((_, i) => i !== index)})} disabled={localFund.transactions.length <= 1} className="text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 p-2 sm:p-2.5 rounded-lg transition-all disabled:opacity-30 active:scale-90 ml-1 sm:ml-2 sm:opacity-0 group-hover:opacity-100"><Trash2 size={18}/></button>
            </div>
          )})}

          <button type="button" onClick={() => setLocalFund({...localFund, transactions: [...localFund.transactions, { id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }]})} className="w-full mt-2 py-3.5 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 rounded-xl flex items-center justify-center text-sm font-bold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-all bg-slate-50/50 hover:bg-blue-50/50 dark:bg-slate-800/20 dark:hover:bg-blue-900/20 active:scale-[0.99]">
            <Plus size={18} className="mr-2" /> 继续添加交易记录
          </button>
        </div>
      </div>
      
      <div className="flex justify-end space-x-3 pt-6 border-t border-slate-100 dark:border-slate-800 mt-2">
        <button type="button" onClick={onCancel} className="px-6 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-bold text-sm active:scale-95 shadow-sm">取消修改</button>
        <button type="button" onClick={() => onSave(localFund)} className="px-8 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-xl flex items-center transition-all font-bold text-sm shadow-md hover:shadow-lg active:scale-95"><Save size={18} className="mr-2"/> 确认保存</button>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null); 
  const [authLoading, setAuthLoading] = useState(true); 
  
  const [funds, setFunds] = useState([]); 
  const [settings, setSettings] = useState({ 
    targetAmount: 100000, 
    targetDate: '2030-12-31', 
    targetAnnualRate: 5,
    proxyMode: 'custom', 
    customProxyUrl: 'https://my-cors-proxy.wh1637063482.workers.dev/?url={{url}}', 
    dataSource: 'tencent',
    navDataSource: 'tiantian' 
  }); 
  const [theme, setTheme] = useState('light'); 
  
  const [marketData, setMarketData] = useState([]); 
  const [isFetchingMarket, setIsFetchingMarket] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [activeProxyIndex, setActiveProxyIndex] = useState(0); 
  const isFetchingRef = useRef(false); 
  const [isAutoRefresh, setIsAutoRefresh] = useState(checkIsTradingTime()); 

  const [editingFundId, setEditingFundId] = useState(null); 
  const [isProxyModalOpen, setProxyModalOpen] = useState(false); 
  const [dbError, setDbError] = useState(''); 
  const [isDbConnected, setIsDbConnected] = useState(false); 

  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' }); 
  const [fundTab, setFundTab] = useState('active'); 
  
  const [fundNavs, setFundNavs] = useState({}); 
  const [fetchingNavCodes, setFetchingNavCodes] = useState({}); 
  const [isClosingEditor, setIsClosingEditor] = useState(false); 
  
  const [xirrMap, setXirrMap] = useState({});
  const [overallXirr, setOverallXirr] = useState(0);

  const INACTIVITY_LIMIT = 10 * 60 * 1000; 
  const logoutTimerRef = useRef(null);
  const targetAmountTimeoutRef = useRef(null); 
  const targetDateTimeoutRef = useRef(null);
  const targetRateTimeoutRef = useRef(null);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (!authLoading) {
      const MIN_SPLASH_TIME = 1500; 
      const loadStartTime = window.__splashStartTime || Date.now();
      const elapsed = Date.now() - loadStartTime;
      const remaining = Math.max(0, MIN_SPLASH_TIME - elapsed);

      setTimeout(() => {
        const splash = document.getElementById('global-splash');
        if (splash) {
          splash.style.opacity = '0';
          setTimeout(() => {
            splash.style.display = 'none';
            splash.remove(); 
          }, 500); 
        }
        
        const hideNativeSplash = async () => {
          try {
            const { SplashScreen } = await import('@capacitor/splash-screen');
            await SplashScreen.hide();
          } catch (e) {
          }
        };
        hideNativeSplash();

      }, remaining);
    }
  }, [authLoading]);

  const handleSignOut = useCallback(() => {
    if (auth) {
      signOut(auth).then(() => {
        setFunds([]); setMarketData([]); setFundNavs({});
      });
    }
  }, []);

  const resetLogoutTimer = useCallback(() => {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (user) {
      logoutTimerRef.current = setTimeout(() => {
        console.log('长时间未操作，自动登出。');
        handleSignOut();
      }, INACTIVITY_LIMIT);
    }
  }, [user, handleSignOut]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetLogoutTimer();
    
    if (user) {
      events.forEach(e => window.addEventListener(e, handleActivity));
      resetLogoutTimer(); 
    }

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [user, resetLogoutTimer]);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Auth Init Error:", e);
      }
    };
    
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setDbError('');
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []); 

  useEffect(() => {
    if (!user || !db) return;
    
    setIsDbConnected(false);
    const fundsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'funds');
    
    const unsubFunds = onSnapshot(query(fundsRef), (snapshot) => {
      const data = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      setFunds(data);
      setDbError(''); 
      setIsDbConnected(true);
    }, (err) => {
      console.error(err);
      if (auth.currentUser) setDbError('读取资金数据失败，请检查 Firestore 规则。');
      setIsDbConnected(false);
    });

    const settingsDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general');
    const unsubSettings = onSnapshot(settingsDocRef, (docSnap) => {
      if (docSnap.exists()) {
         setSettings(prev => ({ ...prev, ...docSnap.data() }));
      }
    }, (err) => console.error("Settings error:", err));

    return () => { unsubFunds(); unsubSettings(); setIsDbConnected(false); };
  }, [user]);

  const fetchFundNavManually = async (codeToFetch = null) => {
     let codesToQuery = [];
     if (codeToFetch) {
         codesToQuery.push(codeToFetch);
         setFetchingNavCodes(prev => ({...prev, [codeToFetch]: true}));
     } else {
         codesToQuery = funds.filter(f => f.mode === 'auto' && !f.isArchived && f.fundCode).map(f => f.fundCode);
     }
     
     if (codesToQuery.length === 0) return false;
     codesToQuery = [...new Set(codesToQuery)];

     const newNavs = { ...fundNavs };
     let hasChanges = false;
     let fetchSuccess = false;
     let currentDataSource = settings.navDataSource || 'tiantian';

     const fetchViaProxy = async (targetUrl) => {
        let fetchUrl = '';
        if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
            fetchUrl = settings.customProxyUrl.includes('{{url}}') 
                ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
                : settings.customProxyUrl + targetUrl; 
        } else {
            fetchUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        }
        return await fetch(fetchUrl);
     };

     for (let code of codesToQuery) {
        try {
           const fundObj = funds.find(f => f.fundCode === code);
           const fallbackName = fundNavs[code]?.name || fundObj?.name || '未知名称';

           if (currentDataSource === 'tiantian') {
               const result = await new Promise((resolve, reject) => {
                  const script = document.createElement('script');
                  script.referrerPolicy = "no-referrer"; 
                  script.charset = "utf-8"; 
                  const timer = setTimeout(() => { script.remove(); reject(new Error('Timeout')); }, 8000);
                  
                  script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
                  
                  script.onload = () => {
                     clearTimeout(timer);
                     script.remove();
                     resolve(); 
                  };
                  script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('加载失败')); };
                  
                  const originalCallback = window.jsonpgz;
                  window.jsonpgz = (data) => {
                     if (data && data.fundcode === code) {
                         const actualNav = parseFloat(data.dwjz); 
                         if (!isNaN(actualNav)) {
                             const dateStr = data.gztime ? data.gztime.substring(5, 16) : (data.jzrq || '');
                             resolve({ nav: actualNav, name: data.name, source: '天天(盘中估值)', date: dateStr });
                         } else {
                             reject(new Error('无实际净值数据'));
                         }
                     }
                     if (originalCallback) originalCallback(data);
                  };
                  
                  document.head.appendChild(script);
               });

               if (result && !isNaN(result.nav)) {
                   newNavs[code] = { nav: result.nav, name: result.name, source: result.source, date: result.date };
                   hasChanges = true;
                   fetchSuccess = true;
               }
           } else if (currentDataSource === 'sina') {
               const targetUrl = `https://hq.sinajs.cn/list=f_${code}`;
               const res = await fetchViaProxy(targetUrl);
               
               const buffer = await res.arrayBuffer();
               const decoder = new TextDecoder('gbk');
               const text = decoder.decode(buffer);
               
               const match = text.match(new RegExp(`hq_str_f_${code}="([^"]*)";`));
               if (match && match[1]) {
                  const parts = match[1].split(',');
                  const currentNav = parseFloat(parts[1]); 
                  
                  if (!isNaN(currentNav)) {
                     const dateStr = parts[4] ? parts[4].substring(5) : ''; 
                     newNavs[code] = { nav: currentNav, name: parts[0], source: '新浪财经', date: dateStr };
                     hasChanges = true;
                     fetchSuccess = true;
                  }
               }
           } else if (currentDataSource === 'tiantian_lsjz') {
               const targetUrl = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`;
               const res = await fetchViaProxy(targetUrl);
               const data = await res.json();
               const navStr = data?.Data?.LSJZList?.[0]?.DWJZ;
               if (navStr) {
                   const nav = parseFloat(navStr);
                   if (!isNaN(nav)) {
                       const dateStr = data?.Data?.LSJZList?.[0]?.FSRQ?.substring(5) || '';
                       newNavs[code] = { nav, name: fallbackName, source: '天天(Web历史)', date: dateStr };
                       hasChanges = true; fetchSuccess = true;
                   }
               }
           } else if (currentDataSource === 'danjuan') {
               const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
               const res = await fetchViaProxy(targetUrl);
               const data = await res.json();
               const nav = parseFloat(data?.data?.fund_derived?.unit_nav);
               const name = data?.data?.fd_name || fallbackName;
               if (!isNaN(nav)) {
                   const dateStr = data?.data?.fund_derived?.end_date?.substring(5) || '';
                   newNavs[code] = { nav, name, source: '蛋卷基金', date: dateStr };
                   hasChanges = true; fetchSuccess = true;
               }
           }

        } catch(e) {
           console.warn(`拉取基金 ${code} 净值失败 (${currentDataSource}):`, e);
        }
     }

    if (hasChanges) {
         setFundNavs(newNavs);
     }
     
     if (codeToFetch) {
        setFetchingNavCodes(prev => ({...prev, [codeToFetch]: false}));
        return fetchSuccess ? newNavs[codeToFetch] : false;
     }
     return fetchSuccess;
  };

  useEffect(() => {
     if (!user || funds.length === 0) return;
     fetchFundNavManually();
  }, [user, funds, settings.proxyMode, settings.customProxyUrl, settings.navDataSource]);

  const fetchMarketAPI = async () => {
    if (!user) return; 
    
    let targetUrl = '';
    let dataSourceStr = settings.dataSource || 'tencent';
    
    const shCode = '000001';
    const szCode = '399001';
    const cyCode = '399006';
    const bond10 = '511260';
    const bond30 = '511090';

    if (dataSourceStr === 'tencent') {
        const codes = `sh${shCode},sz${szCode},sz${cyCode},sh${bond10},sh${bond30}`;
        targetUrl = `https://qt.gtimg.cn/q=${codes}`;
    } else if (dataSourceStr === 'sina') {
        const codes = `sh${shCode},sz${szCode},sz${cyCode},sh${bond10},sh${bond30}`;
        targetUrl = `https://hq.sinajs.cn/list=${codes}`;
    } else if (dataSourceStr === 'xueqiu') {
        const codes = `SH${shCode},SZ${szCode},SZ${cyCode},SH${bond10},SH${bond30}`;
        targetUrl = `https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${codes}`;
    }

    let textData = '';
    let isJsonResp = false;
    
    if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
       let fetchUrl = settings.customProxyUrl.includes('{{url}}') 
           ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
           : settings.customProxyUrl + targetUrl; 
       const r = await fetch(fetchUrl);
       if (dataSourceStr === 'xueqiu') {
          textData = await r.json(); 
          isJsonResp = true;
       } else {
          textData = await r.text();
       }
    } else {
       const node = PROXY_NODES[activeProxyIndex];
       if (dataSourceStr === 'xueqiu') {
         const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`);
         const d = await r.json();
         textData = JSON.parse(d.contents);
         isJsonResp = true;
       } else {
         textData = await node.fetcher(targetUrl);
       }
    }

    if (textData) {
      let parsedData = [];

      if (dataSourceStr === 'xueqiu' && isJsonResp && textData.data) {
         parsedData = textData.data.map(item => {
           let codeRaw = item.symbol.toLowerCase();
           return {
              id: codeRaw,
              name: ASSET_NAMES[codeRaw] || '未知资产',
              price: parseFloat(item.current),
              change: parseFloat(item.chg),
              percent: parseFloat(item.percent) / 100
           };
         });
      } else if (typeof textData === 'string') {
        const blocks = textData.split(';').filter(b => b.includes('='));
        parsedData = blocks.map(block => {
          if (dataSourceStr === 'tencent' && block.includes('v_')) {
              const codeMatch = block.match(/v_([a-z0-9]+)=/);
              if (!codeMatch) return null;
              const code = codeMatch[1];
              const vals = block.split('"')[1]?.split('~');
              if (!vals || vals.length < 33) return null;
              return {
                id: code, name: ASSET_NAMES[code] || vals[1],
                price: parseFloat(vals[3]), change: parseFloat(vals[31]), percent: parseFloat(vals[32]) / 100
              };
          } else if (dataSourceStr === 'sina' && block.includes('hq_str_')) {
              const codeMatch = block.match(/hq_str_([a-z0-9]+)=/);
              if (!codeMatch) return null;
              const code = codeMatch[1];
              const vals = block.split('"')[1]?.split(',');
              if (!vals || vals.length < 4) return null;
              const currentPrice = parseFloat(vals[3]);
              const prevClose = parseFloat(vals[2]);
              const change = currentPrice - prevClose;
              const percent = prevClose !== 0 ? change / prevClose : 0;
              return {
                id: code, name: ASSET_NAMES[code] || '未知资产',
                price: currentPrice, change: change, percent: percent
              };
          }
          return null;
        }).filter(Boolean); 
      }
      
      if (parsedData.length > 0) {
          const order = Object.keys(ASSET_NAMES);
          parsedData.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

          setMarketData(parsedData);
          setMarketError('');
          return true;
      }
    }
    throw new Error("Invalid data format or empty response");
  };

  const manualFetch = useCallback(async () => {
     if (isFetchingRef.current) return;
     isFetchingRef.current = true;
     setIsFetchingMarket(true);
     try {
        await fetchMarketAPI();
     } catch (error) {
        setMarketError(settings.proxyMode === 'custom' ? `代理/数据源请求失败 (${settings.dataSource})` : `节点不可用，正在切换...`);
        if (settings.proxyMode !== 'custom') {
           setActiveProxyIndex(prev => (prev + 1) % PROXY_NODES.length);
        }
     } finally {
        setIsFetchingMarket(false);
        isFetchingRef.current = false;
     }
  }, [activeProxyIndex, user, settings.proxyMode, settings.customProxyUrl, settings.dataSource]);

  useEffect(() => {
    if (!user) return;
    manualFetch(); 
    
    if (!isAutoRefresh) return; 
    const intervalId = setInterval(manualFetch, 5000); 
    return () => clearInterval(intervalId); 
  }, [isAutoRefresh, manualFetch, user]);


  const handleCloseEditor = () => {
     setIsClosingEditor(true);
     setTimeout(() => {
         setEditingFundId(null);
         setIsClosingEditor(false);
     }, 200); 
  };

  const handleSaveFund = async (fund) => {
    if (!user || !db) return alert("数据库未连接");
    const fundId = fund.id || Date.now().toString(); 
    const fundRef = doc(db, 'artifacts', appId, 'users', user.uid, 'funds', fundId);
    
    let finalCurrentValue = 0;
    if (fund.isArchived) {
       finalCurrentValue = 0;
    } else if (fund.mode === 'auto') {
       finalCurrentValue = (Number(fund.shares) || 0) * (fundNavs[fund.fundCode]?.nav || fund.lastNav || 0);
    } else {
       finalCurrentValue = evaluateExpression(fund.currentValueRaw) || 0;
    }

    const payload = {
      name: fund.name || '未命名基金',
      transactions: fund.transactions || [],
      currentValueRaw: fund.currentValueRaw || '0',
      currentValue: finalCurrentValue,
      mode: fund.mode === 'auto' ? 'auto' : 'manual',
      fundCode: fund.fundCode || '',
      shares: fund.shares ? Number(fund.shares) : 0,
      isArchived: !!fund.isArchived,
      lastNav: fundNavs[fund.fundCode]?.nav || fund.lastNav || 0,
      lastNavDate: fundNavs[fund.fundCode]?.date || fund.lastNavDate || '',
      updatedAt: new Date().toISOString()
    };

    try {
       await setDoc(fundRef, payload, { merge: true }); 
       handleCloseEditor();
    } catch (err) {
       console.error("保存失败", err);
       alert("保存失败，请检查Firebase数据库安全规则: " + err.message);
    }
  };

  const handleDeleteFund = async (id) => {
    if (!user || !db || !window.confirm('确认删除该记录吗？此操作无法恢复。建议使用“归档”功能保留历史收益。')) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'funds', id));
  };

  const handleSaveSettings = async (newSettings) => {
    if (!user || !db) return;
    setSettings(prev => ({ ...prev, ...newSettings }));
    try {
      const settingsDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general');
      await setDoc(settingsDocRef, newSettings, { merge: true });
    } catch (error) {
      console.error("保存云端设置失败:", error);
    }
  };

  const handleTargetAmountChange = (e) => {
    const val = e.target.value;
    const numVal = val === '' ? '' : Number(val);
    setSettings(prev => ({...prev, targetAmount: numVal}));

    if (targetAmountTimeoutRef.current) clearTimeout(targetAmountTimeoutRef.current);
    targetAmountTimeoutRef.current = setTimeout(() => { handleSaveSettings({ targetAmount: numVal }); }, 800); 
  };

  const handleTargetAmountBlur = (e) => {
    const val = e.target.value;
    const numVal = val === '' ? '' : Number(val);
    if (targetAmountTimeoutRef.current) clearTimeout(targetAmountTimeoutRef.current);
    handleSaveSettings({ targetAmount: numVal }); 
  };

  const handleTargetDateChange = (e) => {
    const val = e.target.value;
    setSettings(prev => ({...prev, targetDate: val}));

    if (targetDateTimeoutRef.current) clearTimeout(targetDateTimeoutRef.current);
    targetDateTimeoutRef.current = setTimeout(() => { handleSaveSettings({ targetDate: val }); }, 800);
  };

  const handleTargetDateBlur = (e) => {
    const val = e.target.value;
    if (targetDateTimeoutRef.current) clearTimeout(targetDateTimeoutRef.current);
    handleSaveSettings({ targetDate: val });
  };

  const handleTargetRateChange = (e) => {
    const val = e.target.value;
    const numVal = val === '' ? '' : Number(val);
    setSettings(prev => ({...prev, targetAnnualRate: numVal}));

    if (targetRateTimeoutRef.current) clearTimeout(targetRateTimeoutRef.current);
    targetRateTimeoutRef.current = setTimeout(() => { handleSaveSettings({ targetAnnualRate: numVal }); }, 800); 
  };

  const exportData = () => {
    const dataStr = JSON.stringify({ funds, settings }, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `fund-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // 【核心修复一】：彻底剥离 xirrMap，防止修改 xirr 时触发此基础数据的重新计算
  const { baseFundsData, preXirrPayloads, globalPreCashFlows } = useMemo(() => {
    const globalPreCashFlows = [];
    
    const baseFunds = funds.map(f => {
      let totalInvested = 0; 
      let realizedReturns = 0; 
      let cashFlowsForXirr = []; 
      
      f.transactions.forEach(t => {
        const rawAmt = evaluateExpression(t.amountRaw);
        const inferredType = t.type || (rawAmt < 0 ? 'buy' : 'sell');
        
        let amt = Math.round(Math.abs(rawAmt) * 100) / 100;
        
        if (inferredType === 'buy' || inferredType === 'fee') {
            totalInvested += amt;
            cashFlowsForXirr.push({ date: t.date, amount: -amt }); 
            globalPreCashFlows.push({ date: t.date, amount: -amt });
        } else if (inferredType === 'sell' || inferredType === 'dividend_cash') {
            realizedReturns += amt;
            cashFlowsForXirr.push({ date: t.date, amount: amt }); 
            globalPreCashFlows.push({ date: t.date, amount: amt });
        } else if (inferredType === 'dividend_reinvest') {
        }
      });

      let currentVal = 0;
      if (f.isArchived) {
          currentVal = 0; 
      } else if (f.mode === 'auto') {
          const navObj = fundNavs[f.fundCode];
          const nav = navObj ? navObj.nav : (f.lastNav || 0);
          currentVal = (Number(f.shares) || 0) * nav;
          if (currentVal === 0 && f.currentValueRaw) {
             const oldVal = evaluateExpression(f.currentValueRaw);
             if (!isNaN(oldVal)) currentVal = oldVal;
          }
      } else {
          currentVal = evaluateExpression(f.currentValueRaw) || 0;
      }

      currentVal = Math.round(currentVal * 100) / 100;

      if (currentVal > 0) {
        cashFlowsForXirr.push({ date: new Date().toISOString().split('T')[0], amount: currentVal });
      }

      const profit = currentVal + realizedReturns - totalInvested;
      const simpleReturn = totalInvested === 0 ? 0 : profit / totalInvested;
      const netInvested = Math.max(0, totalInvested - realizedReturns);

      return { ...f, profit, simpleReturn, totalInvested, netInvested, currentValue: currentVal, _flows: cashFlowsForXirr };
    });

    const totalCurrentValue = baseFunds.reduce((sum, f) => sum + f.currentValue, 0);
    const finalTotalCurrentValue = Math.round(totalCurrentValue * 100) / 100;
    
    if (finalTotalCurrentValue > 0) {
      globalPreCashFlows.push({ 
        date: new Date().toISOString().split('T')[0], 
        amount: finalTotalCurrentValue,
        isTerminal: true 
      });
    }

    const preXirrPayloads = baseFunds.map(f => ({ id: f.id, flows: f._flows }));

    return { baseFundsData: baseFunds, preXirrPayloads, globalPreCashFlows };
  }, [funds, fundNavs]); 

  // 【核心修复二】：使用函数式状态更新，避免相同的计算结果引发无限循环重绘
  useEffect(() => {
    let isCancelled = false;
    
    const computeAllXirrAsync = () => {
      setTimeout(() => {
        if (isCancelled) return;

        setXirrMap(prev => {
           let isChanged = false;
           const updatedMap = { ...prev };
           preXirrPayloads.forEach(p => {
               const res = calculateXIRR(p.flows);
               if (updatedMap[p.id] !== res) {
                   updatedMap[p.id] = res;
                   isChanged = true;
               }
           });
           return isChanged ? updatedMap : prev; 
        });

        const gRes = calculateXIRR(globalPreCashFlows);
        setOverallXirr(prev => (prev !== gRes ? gRes : prev));
      }, 0);
    };
    computeAllXirrAsync();

    return () => { isCancelled = true; };
  }, [preXirrPayloads, globalPreCashFlows]);

  const portfolioStats = useMemo(() => {
    // 【核心修复三】：在最终渲染层再把 XIRR 组合进去，避免破坏底层数据计算流
    const baseFunds = baseFundsData.map(f => ({ ...f, xirr: xirrMap[f.id] || 0 }));

    const portfolioTotalCurrentValue = baseFunds.reduce((sum, f) => sum + f.currentValue, 0);
    const portfolioTotalInvested = baseFunds.reduce((sum, f) => sum + f.totalInvested, 0);
    const portfolioTotalProfit = baseFunds.reduce((sum, f) => sum + f.profit, 0); 
    const overallSimpleReturn = portfolioTotalInvested === 0 ? 0 : portfolioTotalProfit / portfolioTotalInvested;

    const computedFundsWithMetrics = baseFunds.map(f => {
      const holdingWeight = portfolioTotalCurrentValue === 0 ? 0 : (f.currentValue / portfolioTotalCurrentValue);
      let profitWeight = 0;
      if (portfolioTotalProfit > 0 && f.profit > 0) {
        profitWeight = f.profit / portfolioTotalProfit;
      } else if (portfolioTotalProfit < 0 && f.profit < 0) {
        profitWeight = f.profit / portfolioTotalProfit;
      }
      const contribution = portfolioTotalInvested === 0 ? 0 : f.profit / portfolioTotalInvested;

      return { ...f, holdingWeight, profitWeight, contribution };
    });

    const pieData = computedFundsWithMetrics
      .filter(f => f.currentValue > 0 && !f.isArchived)
      .map(f => ({ name: f.name, value: f.currentValue }))
      .sort((a, b) => b.value - a.value);

    const contributionPieData = computedFundsWithMetrics
      .filter(f => f.contribution > 0)
      .map(f => ({ name: f.name, value: f.contribution }))
      .sort((a, b) => b.value - a.value);

    const rankedByXirr = [...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.xirr - a.xirr);
    const rankedByProfit = [...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.profit - a.profit);
    
    const netTotalInvested = Math.max(0, portfolioTotalCurrentValue - portfolioTotalProfit);
    
    const safeTargetAmount = Number(settings.targetAmount) || 0;
    const gap = Math.max(0, safeTargetAmount - portfolioTotalProfit); 
    const today = new Date();
    const target = new Date(settings.targetDate);
    const monthsLeft = Math.max(1, (target.getFullYear() - today.getFullYear()) * 12 + target.getMonth() - today.getMonth());

    let projectedAssets = portfolioTotalCurrentValue;
    if (overallXirr > 0 && monthsLeft > 0) {
       projectedAssets = portfolioTotalCurrentValue * Math.pow(1 + overallXirr, monthsLeft / 12);
    }

    const targetAnnualRate = Number(settings.targetAnnualRate) || 5;
    let expectedDailyProfit = 0;
    let daysToBreakEven = null;
    let baselineValue = 0;
    
    globalPreCashFlows.forEach(cf => {
       if (cf.amount < 0) {
           const days = (new Date() - new Date(cf.date)) / (1000 * 60 * 60 * 24);
           const years = Math.max(0, days / 365);
           baselineValue += Math.abs(cf.amount) * Math.pow(1 + (targetAnnualRate / 100), years); 
       } else if (cf.amount > 0 && !cf.isTerminal) { 
           baselineValue -= cf.amount;
       }
    });
    baselineValue = Math.max(0, baselineValue);
    
    const deviationAmount = portfolioTotalCurrentValue - baselineValue;

    if (portfolioTotalProfit < 0 && portfolioTotalInvested > 0) {
       expectedDailyProfit = (portfolioTotalInvested * (targetAnnualRate / 100)) / 365;
       if (expectedDailyProfit > 0) {
           daysToBreakEven = Math.ceil(Math.abs(portfolioTotalProfit) / expectedDailyProfit);
       }
    }
    
    return { 
      totalInvested: netTotalInvested, 
      totalCurrentValue: Math.round(portfolioTotalCurrentValue * 100) / 100,
      overallXirr, 
      totalProfit: Math.round(portfolioTotalProfit * 100) / 100, 
      overallSimpleReturn, 
      pieData,
      contributionPieData,
      rankedByXirr, 
      rankedByProfit,
      computedFundsWithMetrics,
      gap, monthsLeft, requiredMonthly: gap / monthsLeft,
      safeTargetAmount, targetAnnualRate,
      projectedAssets, daysToBreakEven, expectedDailyProfit,
      baselineValue, deviationAmount
    };
  }, [baseFundsData, settings, overallXirr, globalPreCashFlows, xirrMap]);

  const sortedFunds = useMemo(() => {
    let list = portfolioStats.computedFundsWithMetrics.filter(f => fundTab === 'active' ? !f.isArchived : f.isArchived);
    
    if (sortConfig.key !== null) {
      list.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return list;
  }, [portfolioStats.computedFundsWithMetrics, sortConfig, fundTab]);

  const requestSort = (key) => {
    let direction = 'desc'; 
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    } else if (sortConfig.key === key && sortConfig.direction === 'asc') {
      setSortConfig({ key: null, direction: 'asc' }); 
      return;
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (columnName) => {
    if (sortConfig.key !== columnName) {
      return <ArrowUpDown size={14} className="ml-1 opacity-20 group-hover:opacity-60 transition-opacity inline-block" />;
    }
    if (sortConfig.direction === 'asc') {
      return <ArrowUp size={14} className="ml-1 text-blue-500 inline-block transition-transform duration-300" />;
    }
    return <ArrowDown size={14} className="ml-1 text-blue-500 inline-block transition-transform duration-300" />;
  };

  const editingFundData = useMemo(() => {
    if (editingFundId === 'new') {
      return { name: '', transactions: [{ id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }], currentValueRaw: '', mode: 'manual', fundCode: '', shares: '', isArchived: false };
    }
    if (editingFundId) {
      return funds.find(f => f.id === editingFundId) || null;
    }
    return null;
  }, [editingFundId, funds]);

  return (
    <>
      {!authLoading && !user && (
         <LoginScreen theme={theme} setTheme={setTheme} dbError={dbError} />
      )}

      {!authLoading && user && (
        <div className="min-h-screen text-slate-800 dark:text-slate-200 pb-10 relative animate-in fade-in duration-700 bg-slate-50 dark:bg-slate-900">
          
          <header className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 shadow-sm transition-colors duration-500">
            <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
              <div className="flex items-center space-x-2 group cursor-pointer">
                <Activity className="text-blue-600 dark:text-blue-400 transform transition-transform duration-500 group-hover:rotate-180" size={28} />
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 hidden sm:block">
                  Fund Tracker Pro
                </h1>
              </div>

              <div className="flex items-center space-x-3 sm:space-x-4">
                <button type="button" onClick={exportData} title="导出数据至本地 JSON" className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors hidden sm:block active:scale-90">
                  <Download size={18} />
                </button>

                {dbError ? (
                  <div className="flex items-center space-x-1.5 text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-full border border-red-200 dark:border-red-800 transition-all duration-300">
                    <CloudOff size={14} />
                    <span className="hidden sm:inline font-medium">数据库异常</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1.5 text-xs bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-3 py-1.5 rounded-full border border-green-200 dark:border-green-800 transition-all duration-500">
                    {isDbConnected ? (
                      <Fragment>
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                        <span className="hidden sm:inline font-medium">云端同步中</span>
                      </Fragment>
                    ) : (
                      <Fragment>
                        <RefreshCw size={12} className="animate-spin" />
                        <span className="hidden sm:inline font-medium">连接中</span>
                      </Fragment>
                    )}
                  </div>
                )}

                <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90">
                  {theme === 'dark' ? <Sun size={20} className="text-yellow-400"/> : <Moon size={20}/>}
                </button>
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full pr-1 pl-3 py-1 transition-colors shadow-sm">
                  <span className="text-xs text-slate-600 dark:text-slate-300 mr-2 sm:mr-3 truncate max-w-[80px] sm:max-w-xs">{user.email || 'Admin'}</span>
                  <button type="button" onClick={handleSignOut} className="flex items-center text-xs bg-white dark:bg-slate-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/50 dark:hover:text-red-400 transition-colors rounded-full px-2 py-1 font-medium shadow-sm border border-slate-200 dark:border-slate-600 active:scale-95">
                    <LogOut size={12} className="sm:mr-1" /> <span className="hidden sm:inline">退出</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-[1600px] mx-auto px-4 py-6 sm:py-8 space-y-6">
            
            <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 relative overflow-hidden transition-colors duration-500">
              
              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-5 gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <h2 className="font-extrabold flex items-center text-xl sm:text-3xl xl:text-4xl tracking-wide text-slate-800 dark:text-white">
                    <Activity className="mr-2 text-blue-500 w-[24px] h-[24px] sm:w-[32px] sm:h-[32px] xl:w-[40px] xl:h-[40px]" /> 实时行情监控
                  </h2>
                  <div className="hidden sm:block w-px h-6 bg-slate-300 dark:bg-slate-600 mx-2"></div>
                  <MarketTimeIndicator />
                </div>
                
                <div className="flex flex-wrap items-center gap-2.5 text-sm w-full xl:w-auto">
                  <button type="button" onClick={() => setProxyModalOpen(true)} className="text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 flex items-center transition-colors bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-800 px-3 py-1.5 rounded-md border border-slate-100 dark:border-slate-700 font-medium active:scale-95">
                    <Settings size={14} className="mr-1" /> 行情/净值设置
                  </button>

                  <div className="hidden sm:block w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1"></div>
                  
                  <button type="button" onClick={() => setIsAutoRefresh(!isAutoRefresh)} className={`px-3 py-1.5 rounded-md flex items-center transition-all duration-300 shadow-sm border font-medium active:scale-95 ${isAutoRefresh ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                    {isAutoRefresh ? <Pause size={14} className="mr-1.5" /> : <Play size={14} className="mr-1.5" />}
                    {isAutoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
                  </button>

                  <button type="button" onClick={manualFetch} disabled={isFetchingMarket} className={`bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md flex items-center transition-all shadow-sm font-medium active:scale-95 disabled:opacity-50 group`}>
                    <RefreshCw size={14} className={`mr-1.5 transition-transform duration-500 group-hover:rotate-180 ${isFetchingMarket ? 'animate-spin' : ''}`}/> 刷新
                  </button>
                </div>
              </div>
              
              {marketError && <div className="text-amber-500 text-sm mb-4 flex items-center animate-in fade-in slide-in-from-top-2 duration-300"><AlertCircle size={14} className="mr-1"/>{marketError}</div>}
              
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
                {marketData.length === 0 ? (
                    Array(5).fill(0).map((_, i) => (
                      <div key={'skel'+i} className="bg-slate-50 dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-100 dark:border-slate-700 animate-pulse">
                        <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded mb-3"></div>
                        <div className="h-6 w-24 bg-slate-200 dark:bg-slate-800 rounded mb-2"></div>
                        <div className="h-3 w-12 bg-slate-200 dark:bg-slate-800 rounded"></div>
                      </div>
                    ))
                  ) : 
                  marketData.map((data) => {
                    const isPositive = data.change > 0;
                    const textColor = isPositive ? 'text-red-500' : (data.change < 0 ? 'text-green-500' : 'text-slate-500');
                    return (
                      <div key={data.id} className="bg-slate-50 dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-100 dark:border-slate-700 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-default transform-gpu" style={{ willChange: 'transform' }}>
                        <div className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mb-1.5 font-bold tracking-wide">{data.name}</div>
                        <div className={`text-2xl sm:text-4xl font-bold font-mono tabular-nums ${textColor}`}>
                          <AnimatedNumber value={data.price} formatter={(v) => v.toFixed(3)} />
                        </div>
                        <div className={`text-sm sm:text-base flex items-center mt-1.5 font-mono tabular-nums font-medium ${textColor}`}>
                          {isPositive ? <TrendingUp size={16} className="mr-1"/> : (data.change < 0 ? <TrendingDown size={16} className="mr-1"/> : null)}
                          {isPositive ? '+' : ''}{(data.percent * 100).toFixed(2)}%
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              <section className="lg:col-span-8 xl:col-span-9 space-y-6">
                
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col transition-colors duration-500">
                  
                  <div className="flex justify-between items-end border-b dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-5 pt-4 sm:pt-5 relative">
                    <div className="flex space-x-1 sm:space-x-4 h-full relative">
                      <button type="button" onClick={() => setFundTab('active')} className={`pb-3 px-2 sm:px-4 text-base sm:text-lg font-bold flex items-center transition-all duration-300 ${fundTab === 'active' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                          <PieChart className="mr-1.5" size={20}/> 投资组合持仓
                      </button>
                      <button type="button" onClick={() => setFundTab('archived')} className={`pb-3 px-2 sm:px-4 text-base sm:text-lg font-bold flex items-center transition-all duration-300 ${fundTab === 'archived' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                          <Archive className="mr-1.5" size={20}/> 已清仓历史
                      </button>
                      <div className={`absolute bottom-0 h-0.5 transition-all duration-300 ease-out ${fundTab === 'active' ? 'bg-blue-600 dark:bg-blue-400 w-32 sm:w-40 left-0' : 'bg-amber-500 dark:bg-amber-400 w-32 sm:w-40 translate-x-[8.5rem] sm:translate-x-[11rem]'}`}></div>
                    </div>
                    <button type="button" onClick={() => setEditingFundId('new')} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg text-sm font-medium flex items-center transition-all shadow-sm hover:shadow-md active:scale-95 mb-3 group">
                      <Plus size={18} className="mr-1 transition-transform group-hover:rotate-90 duration-300" /> <span className="hidden sm:inline">新增基金</span><span className="sm:hidden">新增</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto relative">
                    <table className="w-full text-center min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/80 text-slate-700 dark:text-slate-300 text-sm sm:text-base xl:text-lg border-b dark:border-slate-700 uppercase tracking-wider select-none">
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left" onClick={() => requestSort('name')}>
                            <div className="flex items-center">资产名称 {getSortIcon('name')}</div>
                          </th>
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center" onClick={() => requestSort('currentValue')}>
                            <div className="flex items-center justify-center">{fundTab === 'active' ? '现持仓总值' : '清仓时市值'} {getSortIcon('currentValue')}</div>
                          </th>
                          {fundTab === 'active' && (
                            <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-32 sm:w-40 text-center" onClick={() => requestSort('holdingWeight')}>
                              <div className="flex items-center justify-center">持仓占比 {getSortIcon('holdingWeight')}</div>
                            </th>
                          )}
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-32 sm:w-40 text-center" onClick={() => requestSort('profit')}>
                            <div className="flex items-center justify-center">总计盈亏 {getSortIcon('profit')}</div>
                          </th>
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center" onClick={() => requestSort('xirr')}>
                            <div className="flex items-center justify-center">年化(XIRR) {getSortIcon('xirr')}</div>
                          </th>
                          <th className="p-4 sm:p-5 font-bold text-center">操作</th>
                        </tr>
                      </thead>
                      
                      <tbody className="divide-y dark:divide-slate-700 text-sm sm:text-base xl:text-lg relative">
                        {sortedFunds.length === 0 ? <tr><td colSpan="6" className="text-center py-16 text-slate-400 animate-in fade-in duration-500">空空如也，这里很干净。</td></tr> : null}
                        {sortedFunds.map((fund, fIndex) => (
                          <tr key={fund.id} style={{animationDelay: `${fIndex * 50}ms`}} className={`group transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${fundTab === 'active' ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:-translate-y-px hover:shadow-sm relative z-10' : 'bg-slate-50/50 dark:bg-slate-900/30 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-80'}`}>
                            <td className="p-4 sm:p-5 font-medium min-w-[140px] sm:min-w-[160px] text-left">
                              <div className="flex flex-col">
                                <div className="flex items-center">
                                  <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full mr-2 sm:mr-3 shrink-0 transition-colors duration-500 ${fundTab==='archived'?'bg-amber-500':(fund.profit >= 0 ? 'bg-red-500' : 'bg-green-500')}`}></div>
                                  <span className={`transition-all duration-300 ${fundTab==='archived' ? 'line-through text-slate-500' : ''}`}>{fund.name}</span>
                                </div>
                                {fund.mode === 'auto' && fundTab === 'active' && (
                                  <div className="text-[11px] text-slate-500 mt-2 flex flex-wrap items-center gap-x-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 pl-1.5 pr-2 py-1 rounded-md w-fit shadow-sm">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); fetchFundNavManually(fund.fundCode); }} className={`p-1 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-indigo-500 transition-all active:scale-90 ${fetchingNavCodes[fund.fundCode] ? 'animate-spin text-indigo-600' : 'hover:rotate-180 duration-500'}`} title="单点强力刷新净值">
                                        <RefreshCcw size={12}/>
                                    </button>
                                    <span className="text-indigo-600 dark:text-indigo-400 font-mono font-medium tracking-wide">{fund.fundCode}</span>
                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                    <span className="text-slate-600 dark:text-slate-400 flex items-center">
                                        净值: <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono tabular-nums ml-1">{fundNavs[fund.fundCode]?.nav || fund.lastNav || '--'}</span>
                                        <span className="text-[10px] text-slate-400 ml-1.5 opacity-80 tabular-nums">({fundNavs[fund.fundCode]?.date || fund.lastNavDate || '未知'})</span>
                                    </span>
                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                    <span className="text-slate-600 dark:text-slate-400">份额: <span className="font-mono tabular-nums">{fund.shares || 0}</span></span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="p-4 sm:p-5 text-center font-mono font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                              <div className="text-base sm:text-lg xl:text-xl">{fundTab==='archived' ? '-' : <AnimatedNumber value={fund.currentValue} />}</div>
                              <div className="text-[10px] sm:text-xs text-slate-400 font-normal mt-1 transition-opacity opacity-70 group-hover:opacity-100 tabular-nums">净本金: {formatMoney(fund.netInvested)}</div>
                            </td>
                            {fundTab === 'active' && (
                              <td className="p-4 sm:p-5 text-center">
                                <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300 text-base sm:text-lg xl:text-xl"><AnimatedNumber value={fund.holdingWeight} formatter={formatPercent} /></div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full mt-2 overflow-hidden mx-auto max-w-[120px] flex justify-start shadow-inner transform-gpu">
                                  <div className="bg-gradient-to-r from-blue-400 to-indigo-500 h-full rounded-full transition-all duration-1000 ease-out" style={{width: `${Math.min(100, fund.holdingWeight * 100)}%`}}></div>
                                </div>
                              </td>
                            )}
                            <td className="p-4 sm:p-5 text-center tabular-nums">
                              <div className={`font-mono font-medium text-base sm:text-lg xl:text-xl transition-colors duration-500 ${fund.profit >= 0 ? 'text-red-500' : 'text-green-500'}`}><AnimatedNumber value={fund.profit} /></div>
                              <div className="text-[10px] sm:text-xs text-slate-400 font-normal mt-1 transition-opacity opacity-70 group-hover:opacity-100">占比: {formatPercent(fund.profitWeight)}</div>
                            </td>
                            <td className={`p-4 sm:p-5 text-center font-mono font-bold tabular-nums text-base sm:text-lg xl:text-xl transition-colors duration-500 ${fund.xirr >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                              <AnimatedNumber value={fund.xirr} formatter={formatPercent} />
                            </td>
                            <td className="p-4 sm:p-5 text-center whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <div className="flex justify-center items-center">
                                <button type="button" onClick={() => setEditingFundId(fund.id)} className="text-slate-400 hover:text-blue-600 mx-0.5 sm:mx-1 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 transition-all active:scale-90 shadow-sm" title="编辑这笔投资">
                                  <Edit3 size={18}/>
                                </button>
                                <button type="button" onClick={() => handleDeleteFund(fund.id)} className="text-slate-400 hover:text-red-600 mx-0.5 sm:mx-1 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-all active:scale-90 shadow-sm" title="永久删除">
                                  <Trash2 size={18}/>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 relative pt-2">
                  {[
                    { label: '投资总净本金', val: portfolioStats.totalInvested, color: '' },
                    { label: '全盘持仓总值', val: portfolioStats.totalCurrentValue, color: 'text-blue-600 dark:text-blue-400' },
                    { label: '全盘累计盈亏', val: portfolioStats.totalProfit, color: portfolioStats.totalProfit>=0?'text-red-500':'text-green-500' },
                    { label: '综合年化(XIRR)', val: portfolioStats.overallXirr, color: portfolioStats.overallXirr>=0?'text-red-500':'text-green-500', isPercent: true }
                  ].map((item, idx) => (
                    <div key={idx} className="bg-white dark:bg-slate-800 p-4 sm:p-6 xl:p-8 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden z-10 transition-colors duration-500 hover:shadow-md hover:-translate-y-0.5">
                      <div className="text-xs sm:text-sm xl:text-base font-bold text-slate-500 mb-1.5 sm:mb-2 relative z-10">{item.label}</div>
                      <div className={`text-lg sm:text-xl xl:text-3xl font-bold font-mono tabular-nums relative z-10 ${item.color} truncate transition-colors duration-500`} title={item.val}>
                          <AnimatedNumber value={item.val} formatter={item.isPercent ? formatPercent : formatMoney} />
                      </div>
                      {idx === 3 && <div className="absolute -right-2 -bottom-2 text-slate-100 dark:text-slate-700/50 transform-gpu"><Award size={90} className="w-[60px] h-[60px] sm:w-[80px] sm:h-[80px] xl:w-[100px] xl:h-[100px] transform rotate-12"/></div>}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  
                  <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-500">
                    <h3 className="text-base sm:text-lg font-bold p-4 sm:p-5 border-b dark:border-slate-700 flex items-center bg-slate-50 dark:bg-slate-900/50">
                      <Award className="mr-2 text-yellow-500"/> 按年化(XIRR)排序榜单
                    </h3>
                    <div className="divide-y dark:divide-slate-700 max-h-[350px] overflow-y-auto custom-scrollbar p-1">
                      {portfolioStats.rankedByXirr.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">暂无数据</div> : null}
                      {portfolioStats.rankedByXirr.map((f, i) => (
                        <div key={'xirr'+f.id} className="flex justify-between items-center p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors rounded-lg mx-1">
                          <span className="font-medium truncate flex items-center pr-2 text-sm sm:text-base">
                            <span className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full text-white text-xs sm:text-sm flex items-center justify-center mr-3 sm:mr-4 transition-transform hover:scale-110 ${i===0?'bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-md':i===1?'bg-gradient-to-br from-slate-300 to-slate-500 shadow-sm':i===2?'bg-gradient-to-br from-amber-600 to-amber-800 shadow-sm':'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{i+1}</span>
                            <span className="truncate" title={f.name}>{f.name}</span>
                          </span>
                          <span className={`font-mono font-bold shrink-0 text-base sm:text-lg tabular-nums ${f.xirr>=0?'text-red-500':'text-green-500'}`}>{formatPercent(f.xirr)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-500">
                    <h3 className="text-base sm:text-lg font-bold p-4 sm:p-5 border-b dark:border-slate-700 flex items-center bg-slate-50 dark:bg-slate-900/50">
                      <Award className="mr-2 text-yellow-500"/> 按累计收益排序榜单
                    </h3>
                    <div className="divide-y dark:divide-slate-700 max-h-[350px] overflow-y-auto custom-scrollbar p-1">
                      {portfolioStats.rankedByProfit.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">暂无数据</div> : null}
                      {portfolioStats.rankedByProfit.map((f, i) => (
                        <div key={'profit'+f.id} className="flex justify-between items-center p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors rounded-lg mx-1">
                          <span className="font-medium truncate flex items-center pr-2 text-sm sm:text-base">
                            <span className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full text-white text-xs sm:text-sm flex items-center justify-center mr-3 sm:mr-4 transition-transform hover:scale-110 ${i===0?'bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-md':i===1?'bg-gradient-to-br from-slate-300 to-slate-500 shadow-sm':i===2?'bg-gradient-to-br from-amber-600 to-amber-800 shadow-sm':'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{i+1}</span>
                            <span className="truncate" title={f.name}>{f.name}</span>
                          </span>
                          <span className={`font-mono font-bold shrink-0 text-base sm:text-lg tabular-nums ${f.profit>=0?'text-red-500':'text-green-500'}`}>{formatMoney(f.profit)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="lg:col-span-4 xl:col-span-3 space-y-6">
                
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 sm:p-6 transition-colors duration-500 hover:shadow-md">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-blue-500"/> 持仓资产分布</h3>
                  <DonutChart data={portfolioStats.pieData} />
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 sm:p-6 transition-colors duration-500 hover:shadow-md">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-blue-500"/> 正向盈利贡献分布</h3>
                  <DonutChart 
                    data={portfolioStats.contributionPieData} 
                    valueFormatter={formatPercent} 
                    centerLabel="总正向贡献比" 
                  />
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 sm:p-6 relative overflow-hidden transition-colors duration-500">
                  <div className="absolute -right-10 -top-10 text-blue-50 dark:text-blue-900/10 transition-transform duration-1000 hover:scale-110 hover:rotate-12 transform-gpu"><Target size={160}/></div>
                  
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center relative z-10"><Target className="mr-2 text-blue-500"/> 财富目标与年化复盘</h3>
                  <div className="space-y-4 relative z-10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">总目标金额 (元)</label>
                        <input 
                          type="number" 
                          value={settings.targetAmount === '' ? '' : settings.targetAmount} 
                          onChange={handleTargetAmountChange}
                          onBlur={handleTargetAmountBlur}
                          className="w-full px-3 py-2 border rounded-xl dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all duration-300 shadow-sm hover:shadow" 
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">预计达成日期</label>
                        <input 
                          type="date" 
                          value={settings.targetDate} 
                          onChange={handleTargetDateChange} 
                          onBlur={handleTargetDateBlur}
                          className="w-full px-3 py-2 border rounded-xl dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all duration-300 shadow-sm hover:shadow" 
                        />
                      </div>
                      <div className="sm:col-span-2 mt-1">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">基准年化收益率 (%)</label>
                        <input 
                           type="number" 
                           value={settings.targetAnnualRate} 
                           onChange={handleTargetRateChange} 
                           placeholder="例如: 5"
                           className="w-full px-3 py-2 font-bold text-blue-600 dark:text-blue-400 bg-slate-50 border rounded-xl dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all duration-300 shadow-inner" 
                        />
                      </div>
                    </div>

                    <div className="pt-5 sm:pt-6 border-t border-slate-100 dark:border-slate-700 space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-slate-400">当前资产偏离基准:</span>
                        <span className={`font-mono font-bold tabular-nums ${portfolioStats.deviationAmount >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {portfolioStats.deviationAmount >= 0 ? '+' : ''}{formatMoney(portfolioStats.deviationAmount)}
                        </span>
                      </div>
                      
                      <div className="w-full h-px bg-slate-100 dark:bg-slate-700 my-2"></div>
                      
                      <div className="flex justify-between text-sm"><span className="text-slate-500">距总收益目标还差</span><span className="font-bold font-mono text-base tabular-nums"><AnimatedNumber value={portfolioStats.gap} /></span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-500">剩余倒数时间</span><span className="font-bold text-base tabular-nums">{portfolioStats.monthsLeft} 个月</span></div>
                      
                      <div className="w-full bg-slate-100 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden mt-3 mb-1 shadow-inner transform-gpu">
                        <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-1000 ease-out" style={{width: `${Math.max(0, Math.min(100, (portfolioStats.totalProfit / (portfolioStats.safeTargetAmount || 1)) * 100))}%`}}></div>
                      </div>

                      <div className="flex flex-col text-sm bg-blue-50 dark:bg-blue-900/20 p-4 sm:p-5 rounded-xl mt-4 border border-blue-100 dark:border-blue-800/50 shadow-sm transition-colors duration-500">
                        <span className="text-blue-700 dark:text-blue-300 font-medium mb-1">为达成目标金额，每月需新增收益：</span>
                        <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 break-all"><AnimatedNumber value={portfolioStats.requiredMonthly} /></span>
                      </div>
                      
                      {portfolioStats.totalProfit < 0 && portfolioStats.daysToBreakEven !== null && (
                         <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800/50 mt-2 text-sm flex items-start animate-in fade-in zoom-in">
                            <AlertCircle size={16} className="text-amber-500 mr-2 shrink-0 mt-0.5" />
                            <div>
                              按照 <span className="font-bold">{settings.targetAnnualRate}%</span> 的设定基准年化复利推演，要填平当前的亏损缺口，预计还需要 <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400 text-base">{portfolioStats.daysToBreakEven}</span> 天。
                            </div>
                         </div>
                      )}
                      {portfolioStats.totalProfit >= 0 && (
                         <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-100 dark:border-green-800/50 mt-2 text-sm flex items-center animate-in fade-in zoom-in text-green-700 dark:text-green-400">
                            <CheckCircle2 size={16} className="mr-2 shrink-0" />
                            当前资产已处于整体盈利状态，无需推演回本周期。
                         </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black rounded-xl shadow-lg border border-slate-700 p-6 sm:p-8 relative overflow-hidden text-white transition-all hover:shadow-xl hover:-translate-y-1 duration-300">
                  <div className="absolute -right-6 -bottom-6 text-white/5 pointer-events-none transform-gpu"><TrendingUp size={140}/></div>
                  <h3 className="text-lg sm:text-xl font-bold mb-4 flex items-center relative z-10 text-blue-400">
                    <TrendingUp className="mr-2" size={24}/> 静态复利推演
                  </h3>
                  <div className="space-y-4 relative z-10">
                    <div className="text-slate-300 text-sm sm:text-base leading-relaxed">
                      基于当前 <span className="font-bold text-white tabular-nums text-base sm:text-lg bg-white/10 px-2 py-0.5 rounded-md ml-1 mr-1 shadow-inner">{formatPercent(portfolioStats.overallXirr)}</span> 综合年化收益率推演：
                    </div>
                    <div className="pt-2 border-t border-white/10 mt-2">
                      <div className="text-slate-400 text-sm sm:text-base mb-1">至目标日期预计总持仓将达到:</div>
                      <div className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-red-500 tracking-tight break-all drop-shadow-md">
                        <AnimatedNumber value={portfolioStats.projectedAssets} />
                      </div>
                    </div>
                  </div>
                </div>

              </section>
            </div>
          </main>

          {isProxyModalOpen && (
            <ProxySettingsModal 
              settings={settings} 
              onSave={(newSet) => { handleSaveSettings(newSet); setProxyModalOpen(false); }} 
              onClose={() => setProxyModalOpen(false)} 
            />
          )}

          {editingFundId && editingFundData && (
            <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 transition-opacity duration-200 ${isClosingEditor ? 'opacity-0' : 'opacity-100'}`}>
              <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] transform transition-all duration-200 ${isClosingEditor ? 'scale-95 translate-y-4' : 'scale-100 translate-y-0'} animate-in fade-in zoom-in-95 slide-in-from-bottom-4`}>
                <div className="flex justify-between items-center p-4 sm:p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 shrink-0">
                  <h3 className="text-lg sm:text-xl font-bold flex items-center text-slate-800 dark:text-white">
                    {editingFundId === 'new' ? <Plus className="mr-2 text-blue-500" /> : <Edit3 className="mr-2 text-blue-500" />} 
                    <span className="truncate max-w-[200px] sm:max-w-md">{editingFundId === 'new' ? '新增基金记录' : `修改资产参数`}</span>
                  </h3>
                  <button type="button" onClick={handleCloseEditor} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-full p-1.5 shadow-sm active:scale-90"><X size={20} /></button>
                </div>
                <div className="p-0 sm:p-5 overflow-y-auto custom-scrollbar flex-grow bg-white dark:bg-slate-800">
                  <FundEditor fund={editingFundData} onSave={handleSaveFund} onCancel={handleCloseEditor} fundNavs={fundNavs} fetchNavManually={fetchFundNavManually} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

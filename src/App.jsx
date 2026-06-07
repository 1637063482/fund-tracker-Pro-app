// 应用主组件：管理全局状态（用户认证、基金数据、行情、设置、主题），编排所有子组件与业务逻辑
import React, { useState, useEffect, useMemo, useRef, Fragment, useCallback, useContext } from 'react';
import {
  Activity, Download, CloudOff, RefreshCw, Sun, Moon, LogOut, Settings, Pause, Play,
  AlertCircle, PieChart, ArrowUpDown, ArrowUp, ArrowDown,
  Plus, Edit3, Award, Target, CheckCircle2, Sparkles, X, Cloud, Eye, EyeOff
} from 'lucide-react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
// 注意检查 firebase/firestore 导入中是否有 addDoc (如果没有请补上)
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, addDoc } from 'firebase/firestore';

// --- 引入拆分出来的功能 ---
import { auth, db, appId } from './config/firebase';
import { PROXY_NODES } from './config/constants';
import { evaluateExpression, formatMoney, formatPercent, checkIsTradingTime } from './utils/helpers';
import { fetchFundNavService } from './services/navFetcher';
import { fetchMarketService } from './services/marketFetcher';
import { AnimatedNumber } from './components/UI/AnimatedNumber';
import { DonutChart } from './components/UI/DonutChart';
import { MarketTimeIndicator } from './components/Dashboard/MarketTimeIndicator';
import { LoginScreen } from './components/Auth/LoginScreen';
import { ProxySettingsModal } from './components/Settings/ProxySettingsModal';
import { FundProfileModal } from './components/Fund/FundProfileModal';
import { FundEditor } from './components/Fund/FundEditor';
import { PortfolioAnalysisModal } from './components/Portfolio/PortfolioAnalysisModal';
import { TodoListCard } from './components/Dashboard/TodoListCard';

import { FundTable } from './components/Dashboard/FundTable';
import { useFundMetrics } from './hooks/useFundMetrics';
import { useModalAnimation } from './hooks/useModalAnimation';
import { debugLog } from './utils/debugLog';
import { AnimatedModal } from './components/UI/AnimatedModal';
import { SmartInput } from './components/UI/SmartInput';
import { Tooltip } from './components/UI/Tooltip';
import { toast, ToastContainer } from './components/UI/Toast';
import { PrivacyModeContext } from './contexts/PrivacyModeContext';

// 金额隐私开关按钮
const PrivacyEyeButton = () => {
  const { showAmounts, togglePrivacy } = useContext(PrivacyModeContext);
  return (
    <Tooltip content={showAmounts ? '隐藏金额' : '显示金额'}>
      <button type="button" onClick={togglePrivacy} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90" aria-label={showAmounts ? '隐藏金额' : '显示金额'}>
        {showAmounts ? <Eye size={20} className="text-slate-500" /> : <EyeOff size={20} className="text-amber-500" />}
      </button>
    </Tooltip>
  );
};

// ── React.memo 包裹的渲染子组件，阻断 App 重渲染向子树传播 ──

const PortfolioSummaryCards = React.memo(({ stats }) => {
  const items = [
    { label: '投资总净本金', val: stats.totalInvested, color: '' },
    { label: '全盘持仓总值', val: stats.totalCurrentValue, color: 'text-blue-600 dark:text-blue-400' },
    { label: '全盘累计盈亏', val: stats.totalProfit, color: stats.totalProfit>=0?'text-red-500':'text-green-500' },
    { label: '综合年化(XIRR)', val: stats.overallXirr, color: stats.overallXirr>=0?'text-red-500':'text-green-500', isPercent: true },
    { label: '简单收益率', val: stats.overallSimpleReturn, color: stats.overallSimpleReturn>=0?'text-red-500':'text-green-500', isPercent: true }
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 relative pt-2">
      {items.map((item, idx) => (
        <div key={idx} className="apple-card-hover p-3 sm:p-4 xl:p-5 relative overflow-hidden z-10 transition-colors duration-500">
          <div className="text-fluid-stat-sm font-bold text-slate-500 mb-1 sm:mb-1.5 relative z-10">{item.label}</div>
          <div className={`text-fluid-stat font-bold font-mono relative z-10 ${item.color} transition-colors duration-500`}>
              <AnimatedNumber value={item.val} formatter={item.isPercent ? formatPercent : formatMoney} />
          </div>
          {idx === 3 && <div className="absolute -right-2 -bottom-2 text-slate-100 dark:text-slate-700/50 transform-gpu"><Award size={90} className="w-[60px] h-[60px] sm:w-[80px] sm:h-[80px] xl:w-[100px] xl:h-[100px] transform rotate-12"/></div>}
        </div>
      ))}
    </div>
  );
});

const RankingPanels = React.memo(({ stats, fmt }) => {
  const panels = [
    { key: 'xirr', title: '按年化(XIRR)排序榜单', data: stats.rankedByXirr, valKey: 'xirr', isPercent: true },
    { key: 'profit', title: '按累计收益排序榜单', data: stats.rankedByProfit, valKey: 'profit', isPercent: false },
    { key: 'simple', title: '按简单收益率排序榜单', data: stats.rankedBySimpleReturn, valKey: 'simpleReturn', isPercent: true },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
      {panels.map(p => (
        <div key={p.key} className="apple-card overflow-hidden transition-colors duration-500">
          <h3 className="text-base sm:text-lg font-bold p-4 sm:p-5 border-b dark:border-slate-700 flex items-center bg-slate-50 dark:bg-slate-900/50">
            <Award className="mr-2 text-yellow-500"/> {p.title}
          </h3>
          <div className="divide-y dark:divide-slate-700 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
            {p.data.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">暂无数据</div> : null}
            {p.data.map((f, i) => (
              <div key={p.key + f.id} className="flex justify-between items-center p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors rounded-[0.875rem] mx-1">
                <span className="font-medium truncate flex items-center pr-2 text-sm sm:text-base">
                  <span className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full text-white text-xs sm:text-sm flex items-center justify-center mr-3 sm:mr-4 transition-transform hover:scale-110 ${i===0?'bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-md':i===1?'bg-gradient-to-br from-slate-300 to-slate-500 shadow-sm':i===2?'bg-gradient-to-br from-amber-600 to-amber-800 shadow-sm':'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{i+1}</span>
                  <span className="truncate" title={f.name}>{f.name}</span>
                </span>
                <span className={`font-mono font-bold shrink-0 text-base sm:text-lg tabular-nums ${f[p.valKey]>=0?'text-red-500':'text-green-500'}`}>{p.isPercent ? fmt.percent(f[p.valKey]) : fmt.money(f[p.valKey])}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

// 提取移除函数（核打击版：绝对防止移动端放大镜图层穿透）
const removeGlobalSplash = () => {
  const splash = document.getElementById('global-splash');
  if (splash) {
    // 1. 瞬间将其踢出 Z 轴的最底层，并剥夺触摸权限
    splash.style.zIndex = '-99999';
    splash.style.pointerEvents = 'none';
    
    // 2. 瞬间破坏它的物理几何尺寸，让系统放大镜彻底失去抓取目标
    splash.style.width = '1px';
    splash.style.height = '1px';
    splash.style.overflow = 'hidden';
    
    // 3. 将其移出屏幕可视区域外
    splash.style.transform = 'translate(-9999px, -9999px)';
    splash.style.opacity = '0';
    
    // 4. 毫不留情地从 DOM 树拔除（缩短到 50ms）
    setTimeout(() => {
      if (splash.parentNode) {
        splash.parentNode.removeChild(splash);
      }
    }, 50);
  }
};

// 【新增】引入对话副驾驶组件
import { PortfolioChat } from './components/Chat/PortfolioChat';
// 静态复利推演卡片（React.memo 隔离，防止行情刷新触发烟花重渲染）
import { CompoundInterestCard } from './components/Dashboard/CompoundInterestCard';
// 行情卡片网格（tickDirs 状态内部隔离，防止行情涨跌动画触发 App 级重渲染）
import { MarketCardsGrid } from './components/Dashboard/MarketCardsGrid';

// 刷新按钮：自管理 loading 状态（用内部 useState 替代全局 isFetchingMarket），
// 确保刷新请求不触发 App 级重渲染，仅按钮自身显示 spinner
const RefreshButton = React.memo(({ onClick }) => {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try { await onClick(); } finally { setLoading(false); }
  };
  return (
    <button type="button" onClick={handleClick} disabled={loading} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded-full flex items-center transition-all shadow-apple-sm font-medium active:scale-[0.97] disabled:opacity-50 group">
      <RefreshCw size={14} className={`mr-1.5 transition-transform duration-500 group-hover:rotate-180 ${loading ? 'animate-spin' : ''}`} /> 刷新
    </button>
  );
});
RefreshButton.displayName = 'RefreshButton';

export default function App() {
  const[user, setUser] = useState(null); 
  const[authLoading, setAuthLoading] = useState(true);
  const [funds, setFunds] = useState([]); 
  const [todos, setTodos] = useState([]);

  // 监听待办事项数据库
  useEffect(() => {
    if (!user || !db) return;
    const todosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'todos');
    const unsubTodos = onSnapshot(query(todosRef), (snapshot) => {
      const data = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      setTodos(data);
    }, (err) => {
      console.error('待办事项读取失败:', err);
      if (auth.currentUser) setDbError('读取待办数据失败，请检查 Firestore 规则。');
    });
    return () => unsubTodos();
  }, [user]);

  const handleAddTodo = async (todoData) => {
    if (!user || !db) return;
    const todosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'todos');
    await addDoc(todosRef, todoData);
  };

  const handleToggleTodo = async (id, isCompleted) => {
    if (!user || !db) return;
    const todoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'todos', id);
    await setDoc(todoRef, { isCompleted }, { merge: true });
  };

  const handleDeleteTodo = async (id) => {
    if (!user || !db) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'todos', id));
  };
  const handleUpdateTodo = async (id, newData) => {
    if (!user || !db) return;
    const todoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'todos', id);
    await setDoc(todoRef, newData, { merge: true });
  };
  const[settings, setSettings] = useState({
    targetAmount: 100000,
    targetDate: '2030-12-31',
    targetAnnualRate: 5,
    proxyMode: 'custom',
    customProxyUrl: '',
    dataSource: 'tencent',
    navDataSource: 'tiantian',
    aiProvider: 'gemini',
    aiApiKey: '',
    ntfyTopic: '',
    idleFunds: 0,
    tavilyApiKey: '',
    exaApiKey: '',
    serperApiKey: '',
    cfWorkerUrl: '',
    cfWorkerSecret: '',
    reasoningEffort: 'max',
    temperature: 0.1,
    topP: 0.1,
    maxOutputTokens: 8192,
    maxHistoryMessages: 20,
    maxToolLoops: 12,
    marketRefreshInterval: 5000,
    autoLogoutMinutes: 15,
    searchResultCount: 6
  });
  const[theme, setTheme] = useState('light'); 

  // ==========================================
  // 🌟 新增：全局法定节假日初始化引擎
  // ==========================================
  useEffect(() => {
    const initHolidayData = async () => {
      const targetYear = new Date().getFullYear();
      const cacheKey = `HOLIDAY_CN_${targetYear}`;
      const cached = localStorage.getItem(cacheKey);

      if (!cached) {
        try {
          const res = await fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${targetYear}.json`);
          if (res.ok) {
            const data = await res.json();
            localStorage.setItem(cacheKey, JSON.stringify(data.days || []));
          }
        } catch (e) {
          console.warn("前端日历同步失败", e);
        }
      }
    };
    initHolidayData();
  }, []);
  
  const [marketData, setMarketData] = useState([]);
  const[marketError, setMarketError] = useState('');
  const [activeProxyIndex, setActiveProxyIndex] = useState(0);

  // marketError 兜底：fetchMarketService 内部通过 setMarketError 更新，
  // 此处仅保留手动 catch 块中的 setMarketError 调用

  const isFetchingRef = useRef(false);
  const [settingsReady, setSettingsReady] = useState(false); // 防止 Firestore settings 未就绪时提前 fetch
  // 【关键修改1】初始状态默认开启，把控制权完全交给用户
  const [isAutoRefresh, setIsAutoRefresh] = useState(true); 

  const[editingFundId, setEditingFundId] = useState(null);
  const[isProxyModalOpen, setProxyModalOpen] = useState(false);
  const [modalTriggerRect, setModalTriggerRect] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, message, onConfirm }
  const[isPortfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const[dbError, setDbError] = useState(''); 
  const[isDbConnected, setIsDbConnected] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' }); 
  const[fundTab, setFundTab] = useState('active'); 
  
  const[fundNavs, setFundNavs] = useState({});
  const[fetchingNavCodes, setFetchingNavCodes] = useState({}); 
  
  const[fundProfiles, setFundProfiles] = useState({});
  const[viewingProfileCode, setViewingProfileCode] = useState(null);

  const [showAmounts, setShowAmounts] = useState(true);
  const togglePrivacy = useCallback(() => setShowAmounts(prev => !prev), []);
  const fmt = useMemo(() => ({
    money: (val) => showAmounts ? formatMoney(val) : '****',
    percent: (val) => showAmounts ? formatPercent(val) : '**.**%',
    raw: (val, suffix = '') => showAmounts ? `${val}${suffix}` : `***${suffix}`,
  }), [showAmounts]);

  const INACTIVITY_LIMIT = useMemo(
    () => (settings.autoLogoutMinutes ?? 15) * 60 * 1000,
    [settings.autoLogoutMinutes]
  );
  const logoutTimerRef = useRef(null);
  const targetAmountTimeoutRef = useRef(null);
  const targetDateTimeoutRef = useRef(null);
  const targetRateTimeoutRef = useRef(null);


// ==========================================
  // 【核心修复区 1】恢复昼夜模式的 CSS 类名切换驱动
  // ==========================================
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // ==========================================
  // 【核心修复区 3】处理前端 DOM 开屏动画 (跟随 authLoading)
  // ==========================================
  useEffect(() => {
    const ultimateFallbackTimer = setTimeout(() => {
      removeGlobalSplash();
    }, 5000);

    if (!authLoading) {
      const MIN_SPLASH_TIME = 600; 
      const timeElapsed = window.__splashStartTime ? (Date.now() - window.__splashStartTime) : 0;
      const delay = Math.max(0, MIN_SPLASH_TIME - timeElapsed);

      setTimeout(() => {
        removeGlobalSplash();
        clearTimeout(ultimateFallbackTimer);
      }, delay);
    }

    return () => clearTimeout(ultimateFallbackTimer);
  }, [authLoading]);

  const handleSyncToWorker = async () => {
    if (!settings.cfWorkerUrl || !settings.cfWorkerSecret) {
      toast('请先在设置中配置 Worker URL 和同步密码', 'error');
      return;
    }
    try {
      const res = await fetch(`${settings.cfWorkerUrl}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncSecret: settings.cfWorkerSecret,
          funds: funds,
          settings: settings,
          // 🌟 核心升级：把前端算好的绝对精确的统计数据和真实 XIRR 一起发给云大脑！
          portfolioStats: portfolioStats 
        })
      });
        
      if (res.ok) {
        toast('成功同步到云端大脑！\n您的私人 AI 基金经理已拿到最新账本，将在每个交易日晚上 22:00 准时为您发送巡检报告。', 'success');
      } else {
        toast('同步失败: 密钥错误或网络异常 (' + await res.text() + ')', 'error');
      }
    } catch (e) {
      toast('同步异常: ' + e.message, 'error');
    }
  };

  const handleSignOut = useCallback(() => {
    if (auth) {
      signOut(auth).then(() => {
        setFunds([]); setMarketData([]); setFundNavs({});
      });
    }
  },[]);

  // 自动登出：通过 ref 保证事件监听器只挂载一次，回调始终读取最新 INACTIVITY_LIMIT
  const resetLogoutTimerRef = useRef(() => {});
  resetLogoutTimerRef.current = () => {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (user && INACTIVITY_LIMIT > 0) {
      logoutTimerRef.current = setTimeout(() => {
        debugLog('长时间未操作，自动登出。');
        handleSignOut();
      }, INACTIVITY_LIMIT);
    }
  };

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetLogoutTimerRef.current();

    if (user) {
      events.forEach(e => window.addEventListener(e, handleActivity));
      resetLogoutTimerRef.current();
    }

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [user]);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      console.warn("Firebase 认证状态检测超时，强制解除开屏状态");
      setAuthLoading(false); 
    }, 5000);

    if (!auth) {
      clearTimeout(fallbackTimer);
      setAuthLoading(false);
      return;
    }
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      clearTimeout(fallbackTimer);
      setUser(currentUser);
      if (!currentUser) setDbError('');
      setAuthLoading(false); 
    }, (error) => {
      console.error("Auth State 监听错误:", error);
      clearTimeout(fallbackTimer);
      setAuthLoading(false);
    });
    
    return () => {
      clearTimeout(fallbackTimer);
      if (unsubscribe) unsubscribe();
    };
  },[]); 

  useEffect(() => {
    if (!user || !db) return;
    
    setIsDbConnected(false);
    const fundsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'funds');
    
    const unsubFunds = onSnapshot(query(fundsRef), (snapshot) => {
      const data =[];
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
      setSettingsReady(true);
      if (docSnap.exists()) {
         setSettings(prev => ({ ...prev, ...docSnap.data() }));
      }
    }, (err) => {
      console.error('设置读取失败:', err);
      if (auth.currentUser) setDbError('读取设置数据失败，请检查 Firestore 规则。');
    });

    return () => { unsubFunds(); unsubSettings(); setIsDbConnected(false); };
  }, [user]);

  const fetchDanjuanProfile = async (code) => {
      if (!code) return null;
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
      let fetchUrl = '';
      if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
          fetchUrl = settings.customProxyUrl.includes('{{url}}') 
              ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) 
              : settings.customProxyUrl + targetUrl;
      } else {
          fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      }

      try {
          const res = await fetch(fetchUrl);
          if (settings.proxyMode === 'custom') {
              const data = await res.json();
              return data?.data || null;
          } else {
              const data = await res.json();
              const parsed = JSON.parse(data.contents);
              return parsed?.data || null;
          }
      } catch (e) {
          console.warn(`拉取基金深度配置失败 (${code}):`, e);
          return null;
      }
  };

  useEffect(() => {
     const fetchAllProfiles = async () => {
         const codes =[...new Set(funds.filter(f => f.fundCode && f.mode === 'auto' && !f.isArchived).map(f => f.fundCode))];
         const newProfiles = { ...fundProfiles };
         let changed = false;
         for (const code of codes) {
             if (!newProfiles[code]) {
                 const profile = await fetchDanjuanProfile(code);
                 if (profile) { 
                    newProfiles[code] = profile; 
                    changed = true; 
                 }
             }
         }
         if (changed) setFundProfiles(newProfiles);
     };
     if (funds.length > 0) fetchAllProfiles();
  },[funds, settings.proxyMode, settings.customProxyUrl]); 

  const handleViewProfile = async (code) => {
      if (!code) return;
      setViewingProfileCode(code);
      if (!fundProfiles[code]) {
          const data = await fetchDanjuanProfile(code);
          if (data) setFundProfiles(prev => ({ ...prev,[code]: data }));
      }
  };

  const fetchFundNavManually = async (codeToFetch = null) => {
    return fetchFundNavService({
      codeToFetch, funds, fundNavs, settings,
      setFundNavs, setFetchingNavCodes
    });
  };

  useEffect(() => {
     if (!user || funds.length === 0) return;
     fetchFundNavManually();
  },[user, funds, settings.proxyMode, settings.customProxyUrl, settings.navDataSource]);

  const fetchMarketAPI = async () => {
    if (!user) return;
    return fetchMarketService({
      settings, activeProxyIndex,
      setMarketData, setMarketError
    });
  };

  const manualFetch = useCallback(async () => {
     if (isFetchingRef.current) return;
     isFetchingRef.current = true;
     try {
        await fetchMarketAPI();
     } catch (error) {
        setMarketError(settings.proxyMode === 'custom' ? `代理/数据源请求失败 (${settings.dataSource})` : `节点不可用，正在切换...`);
        if (settings.proxyMode !== 'custom') {
           setActiveProxyIndex(prev => (prev + 1) % PROXY_NODES.length);
        }
     } finally {
        isFetchingRef.current = false;
     }
  },[activeProxyIndex, user, settings.proxyMode, settings.customProxyUrl, settings.dataSource]);

   useEffect(() => {
    if (!user) return;
    // 等待 Firestore settings 就绪后再执行首次行情拉取，避免默认配置导致的虚假失败
    if (!settingsReady) return;
    manualFetch();

    if (!isAutoRefresh) return;
    const intervalId = setInterval(() => {
      // 【关键修改2】底层时钟动态拦截：即使用户开着自动刷新，只要当前是休市/节假日，就静默跳过请求，绝不浪费资源！
      if (checkIsTradingTime()) {
        manualFetch();
      }
    }, settings.marketRefreshInterval || 5000);
    return () => clearInterval(intervalId);
  },[isAutoRefresh, manualFetch, user, settings.marketRefreshInterval, settingsReady]);

  const handleCloseEditor = () => {
    setEditingFundId(null);
  };

  const handleSaveFund = async (fund) => {
    if (!user || !db) { toast('数据库未连接', 'error'); return; }
    const fundId = fund.id || Date.now().toString(); 
    const fundRef = doc(db, 'artifacts', appId, 'users', user.uid, 'funds', fundId);
    
    // 归档前的市值：auto 用净值×份额，manual 用录入值
    const preArchiveValue = fund.mode === 'auto'
      ? (Number(fund.shares) || 0) * (fundNavs[fund.fundCode]?.nav || fund.lastNav || 0)
      : evaluateExpression(fund.currentValueRaw) || 0;

    let finalCurrentValue = 0;
    if (fund.isArchived) {
       finalCurrentValue = 0;
    } else {
       finalCurrentValue = preArchiveValue;
    }

    const payload = {
      name: fund.name || '未命名基金',
      transactions: fund.transactions ||[],
      currentValueRaw: fund.currentValueRaw || '0',
      currentValue: finalCurrentValue,
      exitValue: fund.isArchived ? (fund.exitValue || preArchiveValue) : (fund.exitValue || 0),
      mode: fund.mode === 'auto' ? 'auto' : 'manual',
      fundCode: fund.fundCode || '',
      shares: fund.shares ? Number(fund.shares) : 0,
      isArchived: !!fund.isArchived,
      lastNav: fundNavs[fund.fundCode]?.nav || fund.lastNav || 0,
      lastNavDate: fundNavs[fund.fundCode]?.date || fund.lastNavDate || '',
      redemptionFees: fund.redemptionFees || {},
      updatedAt: new Date().toISOString()
    };

    try {
       await setDoc(fundRef, payload, { merge: true });
    } catch (err) {
       console.error("保存失败", err);
       toast('保存失败，请检查Firebase数据库安全规则: ' + err.message, 'error');
    }
  };

  const handleDeleteFund = async (id) => {
    if (!user || !db) return;
    setDeleteConfirm({ id });
  };

  const confirmDeleteFund = async () => {
    if (!deleteConfirm) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'funds', deleteConfirm.id));
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

  const handleTargetDateChange = (val) => {
    setSettings(prev => ({...prev, targetDate: val}));
    if (targetDateTimeoutRef.current) clearTimeout(targetDateTimeoutRef.current);
    targetDateTimeoutRef.current = setTimeout(() => { handleSaveSettings({ targetDate: val }); }, 800);
  };

  const handleTargetDateBlur = (val) => {
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

  const idleFundsTimeoutRef = useRef(null);
  const handleIdleFundsChange = (e) => {
    const val = e.target.value;
    const numVal = val === '' ? '' : Number(val);
    setSettings(prev => ({...prev, idleFunds: numVal}));

    if (idleFundsTimeoutRef.current) clearTimeout(idleFundsTimeoutRef.current);
    idleFundsTimeoutRef.current = setTimeout(() => { handleSaveSettings({ idleFunds: numVal }); }, 800); 
  };
  const handleIdleFundsBlur = (e) => {
    const val = e.target.value;
    const numVal = val === '' ? '' : Number(val);
    if (idleFundsTimeoutRef.current) clearTimeout(idleFundsTimeoutRef.current);
    handleSaveSettings({ idleFunds: numVal }); 
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

  const { baseFundsData, portfolioStats } = useFundMetrics(funds, fundNavs, settings, fundProfiles);

  const sortedFunds = useMemo(() => {
    if (!portfolioStats.computedFundsWithMetrics) return[];
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
  },[portfolioStats.computedFundsWithMetrics, sortConfig, fundTab]);

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
      return { name: '', transactions:[{ id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }], currentValueRaw: '', mode: 'manual', fundCode: '', shares: '', isArchived: false };
    }
    if (editingFundId) {
      return funds.find(f => f.id === editingFundId) || null;
    }
    return null;
  },[editingFundId, funds]);

  return (
    <PrivacyModeContext.Provider value={{ showAmounts, togglePrivacy }}>
    <>
      <ToastContainer />
      {viewingProfileCode && (
        <FundProfileModal 
           fund={portfolioStats.computedFundsWithMetrics.find(f => f.fundCode === viewingProfileCode)} 
           profile={fundProfiles[viewingProfileCode]}
           marketData={marketData}
           settings={settings}
           onClose={() => setViewingProfileCode(null)}
           triggerRect={modalTriggerRect}
        />
      )}

      {isPortfolioModalOpen && (
        <PortfolioAnalysisModal
           portfolioStats={portfolioStats}
           settings={settings}
           marketData={marketData}
           fundProfiles={fundProfiles}
           onClose={() => setPortfolioModalOpen(false)}
           triggerRect={modalTriggerRect}
        />
      )}

      {!authLoading && !user && (
         <LoginScreen theme={theme} setTheme={setTheme} dbError={dbError} />
      )}

      {!authLoading && user && (
        <div className="min-h-screen text-slate-800 dark:text-slate-200 pb-10 relative animate-in fade-in duration-700 bg-slate-50 dark:bg-slate-900">
          
          <header className="apple-glass sticky top-0 z-30 transition-colors duration-500 safe-top">
            <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
              <div className="flex items-center space-x-2 group cursor-pointer">
                <Activity className="text-blue-500 dark:text-blue-400 transform transition-transform duration-500 group-hover:rotate-180" size={24} />
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-blue-500 hidden sm:block">
                  Fund Tracker Pro
                </h1>
              </div>

              <div className="flex items-center space-x-3 sm:space-x-4">
                <Tooltip content="将最新账本同步至云端 AI 巡检大脑">
                  <button type="button" onClick={handleSyncToWorker} className="flex items-center text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-800/50 px-3 py-1.5 rounded-full font-bold shadow-sm border border-blue-200/60 dark:border-blue-800/40 transition-all active:scale-[0.97]">
                    <Cloud className="w-4 h-4 mr-1.5" /> <span className="hidden sm:inline">上传至云大脑</span>
                  </button>
                </Tooltip>

                <Tooltip content="导出数据至本地 JSON">
                  <button type="button" onClick={exportData} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors hidden sm:block active:scale-90">
                    <Download size={18} />
                  </button>
                </Tooltip>

                {dbError ? (
                  <div className="flex items-center space-x-1.5 text-xs bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 px-3 py-1.5 rounded-full border border-red-200/60 dark:border-red-800/40 transition-all duration-300">
                    <CloudOff size={14} />
                    <span className="hidden sm:inline font-medium">数据库异常</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1.5 text-xs bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 px-3 py-1.5 rounded-full border border-green-200/60 dark:border-green-800/40 transition-all duration-500">
                    {isDbConnected ? (
                      <Fragment>
                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                        <span className="hidden sm:inline font-medium">云端已同步</span>
                      </Fragment>
                    ) : (
                      <Fragment>
                        <RefreshCw size={12} />
                        <span className="hidden sm:inline font-medium">连接中</span>
                      </Fragment>
                    )}
                  </div>
                )}

                <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90">
                  {theme === 'dark' ? <Sun size={20} className="text-yellow-400"/> : <Moon size={20}/>}
                </button>
                <PrivacyEyeButton />
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full pr-1 pl-3 py-1 transition-colors shadow-sm">
                  <span className="text-xs text-slate-600 dark:text-slate-300 mr-2 sm:mr-3 truncate max-w-[80px] sm:max-w-xs">{user.email || 'Admin'}</span>
                  <button type="button" onClick={handleSignOut} className="flex items-center text-xs bg-white dark:bg-slate-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/50 dark:hover:text-red-400 transition-colors rounded-full px-2 py-1 font-medium shadow-sm border border-slate-200 dark:border-slate-600 active:scale-[0.97]">
                    <LogOut size={12} className="sm:mr-1" /> <span className="hidden sm:inline">退出</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-[1600px] mx-auto px-4 py-6 sm:py-8 space-y-6">
            
            <section className="apple-card p-4 sm:p-5 relative overflow-hidden transition-colors duration-500">
              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-5 gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <h2 className="font-extrabold flex items-center text-xl sm:text-3xl xl:text-4xl tracking-wide text-slate-800 dark:text-white">
                    <Activity className="mr-2 text-blue-500 w-[24px] h-[24px] sm:w-[32px] sm:h-[32px] xl:w-[40px] xl:h-[40px]" /> 实时行情监控
                  </h2>
                  <div className="hidden sm:block w-px h-6 bg-slate-300 dark:bg-slate-600 mx-2"></div>
                  <MarketTimeIndicator />
                </div>
                
                <div className="flex flex-wrap items-center gap-2.5 text-sm w-full xl:w-auto">
                  <button type="button" onClick={(e) => { setModalTriggerRect(e.currentTarget.getBoundingClientRect()); setProxyModalOpen(true); }} className="text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 flex items-center transition-colors bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-800 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 font-medium active:scale-[0.97]">
                    <Settings size={14} className="mr-1" /> 系统设置中心
                  </button>

                  <div className="hidden sm:block w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1"></div>
                  
                  <button type="button" onClick={() => setIsAutoRefresh(!isAutoRefresh)} className={`px-3 py-1.5 rounded-full flex items-center transition-all duration-300 shadow-sm border font-medium active:scale-[0.97] ${isAutoRefresh ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                    {isAutoRefresh ? <Pause size={14} className="mr-1.5" /> : <Play size={14} className="mr-1.5" />}
                    {isAutoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
                  </button>

                  <RefreshButton onClick={manualFetch} />
                </div>
              </div>
              
              {marketError && <div className="text-amber-500 text-sm mb-4 flex items-center animate-in fade-in slide-in-from-top-2 duration-300"><AlertCircle size={14} className="mr-1"/>{marketError}</div>}
              
              <MarketCardsGrid marketData={marketData} />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              <section className="lg:col-span-8 xl:col-span-9 space-y-6">
                
                <FundTable
                  sortedFunds={sortedFunds}
                  fundTab={fundTab}
                  setFundTab={setFundTab}
                  setEditingFundId={setEditingFundId}
                  requestSort={requestSort}
                  getSortIcon={getSortIcon}
                  handleViewProfile={handleViewProfile}
                  handleDeleteFund={handleDeleteFund}
                  fundProfiles={fundProfiles}
                  fundNavs={fundNavs}
                  fetchingNavCodes={fetchingNavCodes}
                  fetchFundNavManually={fetchFundNavManually}
                  onCaptureRect={setModalTriggerRect}
                />

                <PortfolioSummaryCards stats={portfolioStats} />

                <RankingPanels stats={portfolioStats} fmt={fmt} />

                {/* 🌟 新增：待办事项卡片 (它依然属于左侧大的 section 内部) */}
                <TodoListCard
                  todos={todos}
                  onAddTodo={handleAddTodo}
                  onToggleTodo={handleToggleTodo}
                  onDeleteTodo={handleDeleteTodo}
                  settings={settings}
                />

              </section> {/* 结束：左侧占宽度的 section */}

              {/* 开始：右侧占宽度的 section */}
              <section className="lg:col-span-4 xl:col-span-3 space-y-6">
                
                {/* 【新增入口】一键开启全盘资产体检 */}
                <button onClick={(e) => { setModalTriggerRect(e.currentTarget.getBoundingClientRect()); setPortfolioModalOpen(true); }} className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-apple-md flex justify-center items-center font-bold text-base transition-all active:scale-[0.97] group">
                   <Sparkles className="mr-2 group-hover:rotate-12 transition-transform" size={20}/>
                   一键开启全盘资产 AI 深度体检
                </button>

                <div className="apple-card-hover p-5 sm:p-6 transition-colors duration-500">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-indigo-500"/> 大类资产配置图</h3>
                  <DonutChart data={portfolioStats.assetAllocationData} centerLabel="类别比重" />
                </div>

                <div className="apple-card-hover p-5 sm:p-6 transition-colors duration-500">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-blue-500"/> 单一持仓比重分布</h3>
                  <DonutChart data={portfolioStats.pieData} />
                </div>

                <div className="apple-card-hover p-5 sm:p-6 transition-colors duration-500">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-blue-500"/> 正向盈利贡献分布</h3>
                  <DonutChart 
                    data={portfolioStats.contributionPieData} 
                    valueFormatter={formatPercent} 
                    centerLabel="总正向贡献比" 
                  />
                </div>

                <div className="apple-card apple-section p-5 sm:p-6 relative overflow-hidden transition-colors duration-500">
                  <div className="absolute -right-10 -top-10 text-blue-50 dark:text-blue-900/10 transition-transform duration-1000 hover:scale-110 hover:rotate-12 transform-gpu"><Target size={160}/></div>
                  
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center relative z-10"><Target className="mr-2 text-blue-500"/> 财富目标与年化复盘</h3>
                  <div className="space-y-4 relative z-10">
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* 【新增】空闲资金输入框 */}
                      <div className="sm:col-span-2 mb-1">
                        <label className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-1 block flex items-center"><Sparkles size={14} className="mr-1"/> 当前子弹 (可用空闲资金)</label>
                        <input
                          type={showAmounts ? 'number' : 'password'}
                          value={settings.idleFunds === '' ? '' : settings.idleFunds}
                          onChange={handleIdleFundsChange}
                          onBlur={handleIdleFundsBlur}
                          placeholder={showAmounts ? '例如: 10000' : '****'}
                          readOnly={!showAmounts}
                          className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-[0.75rem] dark:bg-slate-900 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:outline-none transition-all duration-300 shadow-sm font-mono text-indigo-700 dark:text-indigo-300 font-bold bg-indigo-50 dark:bg-indigo-900/20"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">总目标金额 (元)</label>
                        <input
                          type={showAmounts ? 'number' : 'password'}
                          value={settings.targetAmount === '' ? '' : settings.targetAmount}
                          onChange={handleTargetAmountChange}
                          onBlur={handleTargetAmountBlur}
                          readOnly={!showAmounts}
                          className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-[0.75rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:outline-none transition-all duration-300"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">预计达成日期</label>
                        <SmartInput
                          isDate={true}
                          value={settings.targetDate}
                          onChange={handleTargetDateChange}
                          className="w-full"
                        />
                      </div>
                      <div className="sm:col-span-2 mt-1">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">基准年化收益率 (%)</label>
                        <input 
                           type="number" 
                           value={settings.targetAnnualRate} 
                           onChange={handleTargetRateChange} 
                           placeholder="例如: 5"
                           step="0.01"
                           className="w-full px-3 py-3.5 text-sm font-bold text-blue-600 dark:text-blue-400 bg-slate-50 border border-slate-200 rounded-[0.75rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:outline-none transition-all duration-300"
                        />
                      </div>
                    </div>

                    <div className="pt-5 sm:pt-6 border-t border-slate-100 dark:border-slate-700 space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-slate-400">对比设定基准的超额收益 (Alpha):</span>
                        <span className={`font-mono font-bold tabular-nums text-base bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded shadow-inner ${portfolioStats.alpha >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {portfolioStats.alpha >= 0 ? '+' : ''}{fmt.percent(portfolioStats.alpha)}
                        </span>
                      </div>
                      
                      <div className="w-full h-px bg-slate-100 dark:bg-slate-700 my-2"></div>
                      
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-400">当前资产偏离基准轨迹:</span>
                        <span className={`font-mono font-bold tabular-nums ${portfolioStats.deviationAmount >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {portfolioStats.deviationAmount >= 0 ? '+' : ''}{fmt.money(portfolioStats.deviationAmount)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between text-sm"><span className="text-slate-500">距总收益目标还差</span><span className="font-bold font-mono text-base"><AnimatedNumber value={portfolioStats.gap} /></span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-500">剩余倒数时间</span><span className="font-bold text-base">{portfolioStats.monthsLeft} 个月</span></div>
                      <div className="w-full bg-slate-100 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden mt-3 mb-1 shadow-inner">
                        <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-1000 ease-out" style={{width: `${Math.max(0, Math.min(100, (portfolioStats.totalProfit / (portfolioStats.safeTargetAmount || 1)) * 100))}%`}}></div>
                      </div>

                      <div className="flex flex-col text-sm bg-blue-50 dark:bg-blue-900/20 p-4 sm:p-5 rounded-[0.875rem] mt-4 border border-blue-200/60 dark:border-blue-800/40 shadow-apple-sm hover:shadow-apple-md hover:-translate-y-0.5 transition-all duration-300">
                        <span className="text-blue-700 dark:text-blue-300 font-medium mb-1">为达成目标金额，每月需新增收益：</span>
                        <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 break-all"><AnimatedNumber value={portfolioStats.requiredMonthly} /></span>
                      </div>
                      
                      {portfolioStats.totalProfit < 0 && portfolioStats.daysToBreakEven !== null && (
                         <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-[0.875rem] border border-amber-200/60 dark:border-amber-800/40 mt-2 text-sm flex items-start animate-in fade-in zoom-in hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                            <AlertCircle size={16} className="text-amber-500 mr-2 shrink-0 mt-0.5" />
                            <div>
                              按照 <span className="font-bold">{settings.targetAnnualRate}%</span> 的设定基准年化复利推演，要填平当前的亏损缺口，预计还需要 <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400 text-base">{portfolioStats.daysToBreakEven}</span> 天。
                            </div>
                         </div>
                      )}
                      {portfolioStats.totalProfit >= 0 && (
                         <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-[0.875rem] border border-green-200/60 dark:border-green-800/40 mt-2 text-sm flex items-center animate-in fade-in zoom-in text-green-700 dark:text-green-400 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                            <CheckCircle2 size={16} className="mr-2 shrink-0" />
                            当前资产已处于整体盈利状态，无需推演回本周期。
                         </div>
                      )}
                    </div>
                  </div>
                </div>

                <CompoundInterestCard
                  projectedAssets={portfolioStats.projectedAssets}
                  overallXirr={portfolioStats.overallXirr}
                  fmt={fmt}
                />

              </section>
            </div>
          </main>

          {isProxyModalOpen && (
            <ProxySettingsModal
              settings={settings}
              onSave={(newSet) => handleSaveSettings(newSet)}
              onClose={() => setProxyModalOpen(false)}
              triggerRect={modalTriggerRect}
            />
          )}

          {editingFundId && editingFundData && (
            <AnimatedModal
              onClose={() => setEditingFundId(null)}
              triggerRect={modalTriggerRect}
              speed={settings.animationSpeed || 1.0}
              className="bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] border border-slate-200/60 dark:border-slate-700/40"
            >
              {(close) => (
                <>
                  <div className="flex justify-between items-center p-4 sm:p-6 border-b border-slate-200/60 dark:border-slate-700/40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-glass shrink-0">
                    <h3 className="text-lg font-bold flex items-center text-slate-800 dark:text-white tracking-tight">
                      {editingFundId === 'new' ? <Plus className="mr-2 text-blue-500" size={20} /> : <Edit3 className="mr-2 text-blue-500" size={20} />}
                      <span className="truncate max-w-[200px] sm:max-w-md">{editingFundId === 'new' ? '新增基金记录' : '修改资产参数'}</span>
                    </h3>
                    <button type="button" onClick={close} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1.5 active:scale-[0.92]"><X size={20} /></button>
                  </div>
                  <div className="p-0 sm:p-5 overflow-y-auto custom-scrollbar flex-grow bg-white dark:bg-slate-900">
                    <FundEditor fund={editingFundData} onSave={async (fund) => { await handleSaveFund(fund); close(); }} onCancel={close} fundNavs={fundNavs} fetchNavManually={fetchFundNavManually} />
                  </div>
                </>
              )}
            </AnimatedModal>
          )}
                     {/* 删除确认弹窗 */}
          {deleteConfirm && (
            <AnimatedModal onClose={() => setDeleteConfirm(null)} triggerRect={modalTriggerRect} speed={settings.animationSpeed || 1.0}>
              {(close) => (
                <div className="bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl p-6 mx-4 max-w-sm w-full border border-slate-200/60 dark:border-slate-700/40" onClick={e => e.stopPropagation()}>
                  <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">确认删除该记录吗？此操作无法恢复。<br/>建议使用"归档"功能保留历史收益。</p>
                  <div className="flex justify-end space-x-2">
                    <button onClick={close} className="px-4 py-2 rounded-full text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">取消</button>
                    <button onClick={() => { confirmDeleteFund(); close(); }} className="px-4 py-2 rounded-full text-sm font-medium text-white bg-red-500 hover:bg-red-600 active:scale-[0.97] transition-all">确认删除</button>
                  </div>
                </div>
              )}
            </AnimatedModal>
          )}

          {/* 👇 加上这一块：将悬浮聊天框挂载到全局 */}
          <PortfolioChat
             portfolioStats={portfolioStats}
             settings={settings}
             marketData={marketData}
             user={user}
             onAddTodo={handleAddTodo}
             onUpdateTodo={handleUpdateTodo}
             onDeleteTodo={handleDeleteTodo}
             onSaveSettings={handleSaveSettings}
             todos={todos} 
          />

        </div>
      )}
    </>
    </PrivacyModeContext.Provider>
  );
}
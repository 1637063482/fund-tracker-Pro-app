import React, { useState, useEffect, useMemo, useRef, Fragment, useCallback } from 'react';
import { 
  Activity, Download, CloudOff, RefreshCw, Sun, Moon, LogOut, Settings, Pause, Play, 
  AlertCircle, TrendingUp, TrendingDown, PieChart, Archive, ArrowUpDown, ArrowUp, ArrowDown, 
  Plus, Edit3, Trash2, Award, Target, CheckCircle2, RefreshCcw, Sparkles, X, Cloud
} from 'lucide-react';
import { SplashScreen } from '@capacitor/splash-screen';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';

// --- 引入拆分出来的功能 ---
import { auth, db, appId } from './config/firebase';
import { ASSET_NAMES, PROXY_NODES } from './config/constants';
import { evaluateExpression, calculateXIRR, formatMoney, formatPercent, checkIsTradingTime } from './utils/helpers';
import { AnimatedNumber } from './components/UI/AnimatedNumber';
import { DonutChart } from './components/UI/DonutChart';
import { MarketTimeIndicator } from './components/Dashboard/MarketTimeIndicator';
import { LoginScreen } from './components/Auth/LoginScreen';
import { ProxySettingsModal } from './components/Settings/ProxySettingsModal';
import { FundProfileModal } from './components/Fund/FundProfileModal';
import { FundEditor } from './components/Fund/FundEditor';
import { PortfolioAnalysisModal } from './components/Portfolio/PortfolioAnalysisModal';

// 提取移除函数（保持在组件外部或内部皆可，内部建议用 useCallback 包裹）
const removeGlobalSplash = () => {
  const splash = document.getElementById('global-splash');
  if (splash) {
    splash.style.transition = 'opacity 0.5s ease-out';
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 500);
  }
};

// 【新增】引入对话副驾驶组件
import { PortfolioChat } from './components/Chat/PortfolioChat';

export default function App() {
  const[user, setUser] = useState(null); 
  const[authLoading, setAuthLoading] = useState(true);
  const [funds, setFunds] = useState([]); 
  const[settings, setSettings] = useState({ 
    targetAmount: 100000, 
    targetDate: '2030-12-31', 
    targetAnnualRate: 5,
    proxyMode: 'custom', 
    customProxyUrl: 'https://my-cors-proxy.wh1637063482.workers.dev/?url={{url}}', 
    dataSource: 'tencent',
    navDataSource: 'tiantian',
    aiProvider: 'gemini',
    aiApiKey: '',
    aiModel: '',
    ntfyTopic: 'fund_tracker_my_secret_123',
    idleFunds: 0,
    tavilyApiKey: '', // 【新增】Tavily 搜索引擎 API Key
    cfWorkerUrl: 'https://fund-tracker-worker.wh1637063482.workers.dev', 
    cfWorkerSecret: 'my_super_password_888'
  });
  const[theme, setTheme] = useState('light'); 
  
  const [marketData, setMarketData] = useState([]); 
  const[isFetchingMarket, setIsFetchingMarket] = useState(false);
  const[marketError, setMarketError] = useState('');
  const [activeProxyIndex, setActiveProxyIndex] = useState(0); 
  const isFetchingRef = useRef(false); 
  // 【关键修改1】初始状态默认开启，把控制权完全交给用户
  const [isAutoRefresh, setIsAutoRefresh] = useState(true); 

  const[editingFundId, setEditingFundId] = useState(null);
  const[isProxyModalOpen, setProxyModalOpen] = useState(false); 
  const[isPortfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const[dbError, setDbError] = useState(''); 
  const[isDbConnected, setIsDbConnected] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' }); 
  const[fundTab, setFundTab] = useState('active'); 
  
  const[fundNavs, setFundNavs] = useState({});
  const[fetchingNavCodes, setFetchingNavCodes] = useState({}); 
  const[isClosingEditor, setIsClosingEditor] = useState(false); 
  
  const[xirrMap, setXirrMap] = useState({});
  const[overallXirr, setOverallXirr] = useState(0);

  const[fundProfiles, setFundProfiles] = useState({});
  const[viewingProfileCode, setViewingProfileCode] = useState(null);

  const INACTIVITY_LIMIT = 15 * 60 * 1000; 
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
  // 【核心修复区 2】瞬间隐藏原生 Android 启动页 (只挂载执行一次)
  // ==========================================
  useEffect(() => {
    const hideNativeSplash = async () => {
      try {
        if (typeof SplashScreen !== 'undefined' && SplashScreen.hide) {
          // 【防闪屏核心 3】传入 fadeOutDuration: 0，干掉 Capacitor 默认的渐隐，实现“瞬间交接”
          await SplashScreen.hide({ fadeOutDuration: 0 });
        }
      } catch (e) {
        console.warn("Native splash hide failed", e);
      }
    };
    hideNativeSplash();
  }, []);

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
      alert("⚠️ 请先在设置中配置 Worker URL 和同步密码！");
      return;
    }
    try {
      const res = await fetch(`${settings.cfWorkerUrl}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncSecret: settings.cfWorkerSecret,
          funds: funds,
          settings: settings
        })
      });
      if (res.ok) {
        alert("✅ 成功同步到云端大脑！\n\n您的私人 AI 基金经理已拿到最新账本，将在每个交易日晚上 22:00 准时为您发送巡检报告。");
      } else {
        alert("❌ 同步失败: 密钥错误或网络异常 (" + await res.text() + ")");
      }
    } catch (e) {
      alert("❌ 同步异常: " + e.message);
    }
  };

  const handleSignOut = useCallback(() => {
    if (auth) {
      signOut(auth).then(() => {
        setFunds([]); setMarketData([]); setFundNavs({});
      });
    }
  },[]);

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
    const events =['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetLogoutTimer();
    
    if (user) {
      events.forEach(e => window.addEventListener(e, handleActivity));
      resetLogoutTimer(); 
    }

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  },[user, resetLogoutTimer]);

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
      if (docSnap.exists()) {
         setSettings(prev => ({ ...prev, ...docSnap.data() }));
      }
    }, (err) => console.error("Settings error:", err));

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
     let codesToQuery =[];
     if (codeToFetch) {
         codesToQuery.push(codeToFetch);
         setFetchingNavCodes(prev => ({...prev,[codeToFetch]: true}));
     } else {
         codesToQuery = funds.filter(f => f.mode === 'auto' && !f.isArchived && f.fundCode).map(f => f.fundCode);
     }
     
     if (codesToQuery.length === 0) return false;
     codesToQuery =[...new Set(codesToQuery)];
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
        setFetchingNavCodes(prev => ({...prev,[codeToFetch]: false}));
        return fetchSuccess ? newNavs[codeToFetch] : false;
     }
     return fetchSuccess;
  };

  useEffect(() => {
     if (!user || funds.length === 0) return;
     fetchFundNavManually();
  },[user, funds, settings.proxyMode, settings.customProxyUrl, settings.navDataSource]);

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
      let parsedData =[];
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
  },[activeProxyIndex, user, settings.proxyMode, settings.customProxyUrl, settings.dataSource]);

   useEffect(() => {
    if (!user) return;
    manualFetch(); 
    
    if (!isAutoRefresh) return; 
    const intervalId = setInterval(() => {
      // 【关键修改2】底层时钟动态拦截：即使用户开着自动刷新，只要当前是休市/节假日，就静默跳过请求，绝不浪费资源！
      if (checkIsTradingTime()) {
        manualFetch();
      }
    }, 5000); 
    return () => clearInterval(intervalId); 
  },[isAutoRefresh, manualFetch, user]);

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
      transactions: fund.transactions ||[],
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

  const { baseFundsData, preXirrPayloads, globalPreCashFlows } = useMemo(() => {
    const globalPreCashFlows =[];
    
    const baseFundsData = funds.map(f => {
      let totalInvested = 0; 
      let realizedReturns = 0; 
      let cashFlowsForXirr = []; 
      
      (f.transactions ||[]).forEach(t => {
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
      return { ...f, xirr: xirrMap[f.id] || 0, profit, simpleReturn, totalInvested, netInvested, currentValue: currentVal, _flows: cashFlowsForXirr };
    });

    const totalCurrentValue = baseFundsData.reduce((sum, f) => sum + f.currentValue, 0);
    const finalTotalCurrentValue = Math.round(totalCurrentValue * 100) / 100;
    
    if (finalTotalCurrentValue > 0) {
      globalPreCashFlows.push({ 
        date: new Date().toISOString().split('T')[0], 
        amount: finalTotalCurrentValue,
        isTerminal: true 
      });
    }

    const preXirrPayloads = baseFundsData.map(f => ({ id: f.id, flows: f._flows }));
    return { baseFundsData, preXirrPayloads, globalPreCashFlows };
  },[funds, fundNavs, xirrMap]);

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
  },[preXirrPayloads, globalPreCashFlows]);

  const portfolioStats = useMemo(() => {
    if (!baseFundsData) return { pieData:[], contributionPieData: [], assetAllocationData:[], rankedByXirr: [], rankedByProfit:[], computedFundsWithMetrics:[], alpha: 0 };

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

    const assetAllocation = {};
    computedFundsWithMetrics.forEach(f => {
        if (f.currentValue <= 0 || f.isArchived) return;
        const profile = fundProfiles[f.fundCode];
        let category = "其他偏股/未分类"; 
        if (profile && profile.op_fund && profile.op_fund.fund_tags) {
            const typeTag = profile.op_fund.fund_tags.find(t => t.category === "1"); 
            if (typeTag) category = typeTag.name;
            else if (profile.type_desc) category = profile.type_desc;
        } else if (f.name.includes("债")) {
            category = "债券型"; 
        }
        assetAllocation[category] = (assetAllocation[category] || 0) + f.currentValue;
    });
    const assetAllocationData = Object.keys(assetAllocation).map(k => ({ name: k, value: assetAllocation[k] })).sort((a, b) => b.value - a.value);
      
    const rankedByXirr =[...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.xirr - a.xirr);
    const rankedByProfit =[...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.profit - a.profit);
    
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
    
    const alpha = overallXirr - (targetAnnualRate / 100);

    return { 
      totalInvested: netTotalInvested, 
      totalCurrentValue: Math.round(portfolioTotalCurrentValue * 100) / 100,
      overallXirr, 
      totalProfit: Math.round(portfolioTotalProfit * 100) / 100, 
      overallSimpleReturn, 
      pieData,
      contributionPieData,
      assetAllocationData, 
      rankedByXirr, 
      rankedByProfit,
      computedFundsWithMetrics,
      alpha, 
      gap, monthsLeft, requiredMonthly: gap / monthsLeft,
      safeTargetAmount, targetAnnualRate,
      projectedAssets, daysToBreakEven, expectedDailyProfit,
      baselineValue, deviationAmount
    };
  },[baseFundsData, settings, overallXirr, globalPreCashFlows, xirrMap, fundProfiles]);

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

  const renderSmartBadges = (fund) => {
      if (fundTab !== 'active' || fund.mode !== 'auto' || !fund.fundCode) return null;
      const profile = fundProfiles[fund.fundCode];
      if (!profile) return null;

      const isBond = fund.name.includes("债") || (profile.type_desc && profile.type_desc.includes("债"));
      const derived = profile.fund_derived || {};
      
      let rankPercentile = 0.5;
      if (derived.srank_l1y && derived.srank_l1y.includes('/')) {
         const parts = derived.srank_l1y.split('/');
         const pos = parseFloat(parts[0]);
         const total = parseFloat(parts[1]);
         if (!isNaN(pos) && !isNaN(total) && total > 0) {
             rankPercentile = pos / total;
         }
      }

      const returnRate = fund.totalInvested > 0 ? fund.profit / fund.totalInvested : 0;
      const grl1m = parseFloat(derived.nav_grl1m || 0);
      const badges =[];

      // 优化量化判定逻辑：排名垫底且亏钱才是真垃圾；排名垫底但不亏钱视为平庸防守资产
      const isGarbage = rankPercentile > 0.7 && returnRate < 0; 
      const isMediocre = rankPercentile > 0.7 && returnRate >= 0;
      const isTopTier = rankPercentile < 0.2;

      if (isGarbage) {
          badges.push(<span key="warn" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-red-50 text-red-500 border border-red-200 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400 leading-none shadow-sm whitespace-nowrap">⚠️ 弱势止损</span>);
      } else if (isMediocre) {
          badges.push(<span key="warn" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 leading-none shadow-sm whitespace-nowrap">🥱 表现平庸</span>);
      } else {  
          const profitThreshold = isBond ? 0.04 : 0.15; 
          const dropThreshold = isBond ? -0.5 : (isTopTier ? -3.0 : -5.0); 

          if (returnRate > profitThreshold) { 
              const badgeText = isBond ? "🥚 宜收蛋" : "📈 止盈区";
              badges.push(<span key="sell" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400 leading-none shadow-sm whitespace-nowrap">{badgeText}</span>);
          } else if (grl1m < dropThreshold) { 
              const badgeText = isBond ? "💧 加仓点" : (isTopTier ? "🔥 优质错杀" : "🔥 黄金坑");
              badges.push(<span key="buy" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-600 border border-green-200 dark:bg-green-900/30 dark:border-green-800 dark:text-green-400 leading-none shadow-sm whitespace-nowrap">{badgeText}</span>);
          }
      }
      return badges;
  };

  return (
    <>
      {viewingProfileCode && (
        <FundProfileModal 
           fund={portfolioStats.computedFundsWithMetrics.find(f => f.fundCode === viewingProfileCode)} 
           profile={fundProfiles[viewingProfileCode]}
           marketData={marketData}
           settings={settings}
           onClose={() => setViewingProfileCode(null)}
        />
      )}

      {isPortfolioModalOpen && (
        <PortfolioAnalysisModal
           portfolioStats={portfolioStats}
           settings={settings}
           marketData={marketData} // <--- 必须确保有这一行
           onClose={() => setPortfolioModalOpen(false)}
        />
      )}

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
                {/* 【新增】同步到 Cloudflare Worker 的按钮 */}
                <button 
                  type="button" 
                  onClick={handleSyncToWorker} 
                  title="将当前最新账本同步至云端 AI 巡检大脑" 
                  className="flex items-center text-xs bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-800/50 px-3 py-1.5 rounded-full font-bold shadow-sm border border-purple-200 dark:border-purple-800 transition-all active:scale-95"
                >
                  <Cloud className="w-4 h-4 mr-1.5" /> <span className="hidden sm:inline">上传至云大脑</span>
                </button>

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
                    <Settings size={14} className="mr-1" /> 系统设置中心
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
                      <div key={data.id} className="bg-slate-50 dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-100 dark:border-slate-700 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-default">
                        <div className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mb-1.5 font-bold tracking-wide truncate">{data.name}</div>
                        <div className={`text-xl sm:text-2xl lg:text-3xl font-bold font-mono ${textColor} transition-colors duration-300 truncate w-full block`}>
                          <AnimatedNumber value={data.price} formatter={(v) => v.toFixed(3)} />
                        </div>
                        <div className={`text-sm sm:text-base flex items-center mt-1.5 font-mono font-medium ${textColor} transition-colors duration-300 truncate`}>
                          {isPositive ? <TrendingUp size={16} className="mr-1 shrink-0"/> : (data.change < 0 ? <TrendingDown size={16} className="mr-1 shrink-0"/> : null)}
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
                  
                  <div className="flex justify-between items-end border-b dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 px-3 sm:px-5 pt-4 sm:pt-5 relative overflow-x-auto no-scrollbar">
                    
                    <div className="flex space-x-0 sm:space-x-4 h-full relative shrink-0">
                      <button type="button" onClick={() => setFundTab('active')} className={`pb-3 px-3 sm:px-4 text-sm sm:text-lg font-bold flex items-center whitespace-nowrap transition-all duration-300 ${fundTab === 'active' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                          <PieChart className="mr-1 sm:mr-1.5 w-4 h-4 sm:w-5 sm:h-5" /> 投资组合
                      </button>
                      <button type="button" onClick={() => setFundTab('archived')} className={`pb-3 px-3 sm:px-4 text-sm sm:text-lg font-bold flex items-center whitespace-nowrap transition-all duration-300 ${fundTab === 'archived' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                          <Archive className="mr-1 sm:mr-1.5 w-4 h-4 sm:w-5 sm:h-5" /> 清仓历史
                      </button>
                      
                      <div className={`absolute bottom-0 h-0.5 transition-all duration-300 ease-out rounded-t-full ${fundTab === 'active' ? 'bg-blue-600 dark:bg-blue-400 w-[5.5rem] sm:w-[8rem] left-0 ml-1.5 sm:ml-2' : 'bg-amber-500 dark:bg-amber-400 w-[5.5rem] sm:w-[8rem] translate-x-[5.5rem] sm:translate-x-[8.5rem]'}`}></div>
                    </div>
                    
                    <button type="button" onClick={() => setEditingFundId('new')} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-sm font-medium flex items-center shrink-0 transition-all shadow-sm hover:shadow-md active:scale-95 mb-2 group">
                      <Plus className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-1 transition-transform group-hover:rotate-90 duration-300" /> 
                      <span className="hidden sm:inline">新增资产</span><span className="sm:hidden ml-1">新增</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto relative">
                    <table className="w-full text-center min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/80 text-slate-700 dark:text-slate-300 text-sm sm:text-base xl:text-lg border-b dark:border-slate-700 uppercase tracking-wider select-none">
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left whitespace-nowrap" onClick={() => requestSort('name')}>
                            <div className="flex items-center">资产名称 {getSortIcon('name')}</div>
                          </th>
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center whitespace-nowrap" onClick={() => requestSort('currentValue')}>
                            <div className="flex items-center justify-center">{fundTab === 'active' ? '现持仓总值' : '清仓时市值'} {getSortIcon('currentValue')}</div>
                          </th>
                          {fundTab === 'active' && (
                            <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-32 sm:w-40 text-center whitespace-nowrap" onClick={() => requestSort('holdingWeight')}>
                              <div className="flex items-center justify-center">持仓占比 {getSortIcon('holdingWeight')}</div>
                            </th>
                          )}
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors w-32 sm:w-40 text-center whitespace-nowrap" onClick={() => requestSort('profit')}>
                            <div className="flex items-center justify-center">总计盈亏 {getSortIcon('profit')}</div>
                          </th>
                          <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center whitespace-nowrap" onClick={() => requestSort('xirr')}>
                            <div className="flex items-center justify-center">年化(XIRR) {getSortIcon('xirr')}</div>
                          </th>
                          <th className="p-4 sm:p-5 font-bold text-center whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      
                      <tbody className="divide-y dark:divide-slate-700 text-sm sm:text-base xl:text-lg relative">
                        {sortedFunds.length === 0 ? <tr><td colSpan="6" className="text-center py-16 text-slate-400 animate-in fade-in duration-500 whitespace-nowrap">空空如也，这里很干净。</td></tr> : null}
                        {sortedFunds.map((fund, fIndex) => (
                          <tr key={fund.id} style={{animationDelay: `${fIndex * 50}ms`}} className={`group transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${fundTab === 'active' ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:-translate-y-px hover:shadow-sm relative z-10' : 'bg-slate-50/50 dark:bg-slate-900/30 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-80'}`}>
                            <td className="p-4 sm:p-5 font-medium min-w-[140px] sm:min-w-[160px] text-left whitespace-nowrap">
                              <div className="flex flex-col">
                                <div className="flex items-center">
                                  <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full mr-2 sm:mr-3 shrink-0 transition-colors duration-500 ${fundTab==='archived'?'bg-amber-500':(fund.profit >= 0 ? 'bg-red-500' : 'bg-green-500')}`}></div>
                                  
                                  {fund.mode === 'auto' && fundTab === 'active' ? (
                                    <div className="flex items-center">
                                      <button type="button" onClick={() => handleViewProfile(fund.fundCode)} className="text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-300 font-bold whitespace-nowrap underline decoration-dashed decoration-blue-200 dark:decoration-blue-800 underline-offset-4">
                                        {fund.name}
                                      </button>
                                      {renderSmartBadges(fund)}
                                    </div>
                                  ) : (
                                    <span className={`transition-all duration-300 whitespace-nowrap ${fundTab==='archived' ? 'line-through text-slate-500' : ''}`}>{fund.name}</span>
                                  )}
                                  
                                </div>
                                {fund.mode === 'auto' && fundTab === 'active' && (
                                  <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-x-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 pl-1.5 pr-2 py-1 rounded-md w-fit shadow-sm whitespace-nowrap">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); fetchFundNavManually(fund.fundCode); }} className={`p-1 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-indigo-500 transition-all active:scale-90 ${fetchingNavCodes[fund.fundCode] ? 'animate-spin text-indigo-600' : 'hover:rotate-180 duration-500'}`} title="单点强力刷新净值">
                                      <RefreshCcw size={12}/>
                                    </button>
                                    <span className="text-indigo-600 dark:text-indigo-400 font-mono font-medium tracking-wide whitespace-nowrap">{fund.fundCode}</span>
                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                    <span className="text-slate-600 dark:text-slate-400 flex items-center whitespace-nowrap">
                                      净值: <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono ml-1 whitespace-nowrap">{fundNavs[fund.fundCode]?.nav || fund.lastNav || '--'}</span>
                                        <span className="text-[10px] text-slate-400 ml-1.5 opacity-80 whitespace-nowrap">({fundNavs[fund.fundCode]?.date || fund.lastNavDate || '未知'})</span>
                                    </span>
                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                    <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">份额: <span className="font-mono whitespace-nowrap">{fund.shares || 0}</span></span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="p-4 sm:p-5 text-center font-mono font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                              <div className="text-base sm:text-lg xl:text-xl whitespace-nowrap">{fundTab==='archived' ? '-' : <AnimatedNumber value={fund.currentValue} />}</div>
                              <div className="text-[10px] sm:text-xs text-slate-400 font-normal mt-1 transition-opacity opacity-70 group-hover:opacity-100 whitespace-nowrap">净本金: {formatMoney(fund.netInvested)}</div>
                            </td>
                            {fundTab === 'active' && (
                              <td className="p-4 sm:p-5 text-center whitespace-nowrap">
                                <div className="font-mono text-slate-700 dark:text-slate-300 text-base sm:text-lg xl:text-xl whitespace-nowrap"><AnimatedNumber value={fund.holdingWeight} formatter={formatPercent} /></div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full mt-2 overflow-hidden mx-auto max-w-[120px] flex justify-start shadow-inner">
                                  <div className="bg-gradient-to-r from-blue-400 to-indigo-500 h-full rounded-full transition-all duration-1000 ease-out" style={{width: `${Math.min(100, fund.holdingWeight * 100)}%`}}></div>
                                </div>
                              </td>
                            )}
                            <td className="p-4 sm:p-5 text-center whitespace-nowrap">
                               <div className={`font-mono font-medium text-base sm:text-lg xl:text-xl transition-colors duration-500 whitespace-nowrap ${fund.profit >= 0 ? 'text-red-500' : 'text-green-500'}`}><AnimatedNumber value={fund.profit} /></div>
                              <div className="text-[10px] sm:text-xs text-slate-400 font-normal mt-1 transition-opacity opacity-70 group-hover:opacity-100 whitespace-nowrap">占比: {formatPercent(fund.profitWeight)}</div>
                            </td>
                            <td className={`p-4 sm:p-5 text-center font-mono font-bold text-base sm:text-lg xl:text-xl transition-colors duration-500 whitespace-nowrap ${fund.xirr >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                              <AnimatedNumber value={fund.xirr} formatter={formatPercent} />
                            </td>
                            <td className="p-4 sm:p-5 text-center whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <div className="flex justify-center items-center">
                                <button type="button" onClick={() => setEditingFundId(fund.id)} className="text-slate-400 hover:text-blue-600 mx-0.5 sm:mx-1 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 transition-all active:scale-90 shadow-sm whitespace-nowrap" title="编辑这笔投资">
                                  <Edit3 size={18}/>
                                </button>
                                <button type="button" onClick={() => handleDeleteFund(fund.id)} className="text-slate-400 hover:text-red-600 mx-0.5 sm:mx-1 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-all active:scale-90 shadow-sm whitespace-nowrap" title="永久删除">
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
                
                {/* 【新增入口】一键开启全盘资产体检 */}
                <button onClick={() => setPortfolioModalOpen(true)} className="w-full py-4 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-xl shadow-lg flex justify-center items-center font-bold text-base transition-all active:scale-95 group">
                   <Sparkles className="mr-2 group-hover:rotate-12 transition-transform" size={20}/>
                   一键开启全盘资产 AI 深度体检
                </button>

                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 sm:p-6 transition-colors duration-500 hover:shadow-md">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-indigo-500"/> 大类资产配置图</h3>
                  <DonutChart data={portfolioStats.assetAllocationData} centerLabel="类别比重" />
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 sm:p-6 transition-colors duration-500 hover:shadow-md">
                  <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 flex items-center"><PieChart className="mr-2 text-blue-500"/> 单一持仓比重分布</h3>
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
                      {/* 【新增】空闲资金输入框 */}
                      <div className="sm:col-span-2 mb-1">
                        <label className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-1 block flex items-center"><Sparkles size={14} className="mr-1"/> 当前子弹 (可用空闲资金)</label>
                        <input 
                          type="number" 
                          value={settings.idleFunds === '' ? '' : settings.idleFunds} 
                          onChange={handleIdleFundsChange}
                          onBlur={handleIdleFundsBlur}
                          placeholder="例如: 10000"
                          className="w-full px-3 py-2 border border-indigo-200 dark:border-indigo-800 rounded-xl dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all duration-300 shadow-sm font-mono text-indigo-700 dark:text-indigo-300 font-bold bg-indigo-50 dark:bg-indigo-900/20" 
                        />
                      </div>
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
                        <span className="text-slate-600 dark:text-slate-400">对比设定基准的超额收益 (Alpha):</span>
                        <span className={`font-mono font-bold tabular-nums text-base bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded shadow-inner ${portfolioStats.alpha >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {portfolioStats.alpha >= 0 ? '+' : ''}{formatPercent(portfolioStats.alpha)}
                        </span>
                      </div>
                      
                      <div className="w-full h-px bg-slate-100 dark:bg-slate-700 my-2"></div>
                      
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-400">当前资产偏离基准轨迹:</span>
                        <span className={`font-mono font-bold tabular-nums ${portfolioStats.deviationAmount >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {portfolioStats.deviationAmount >= 0 ? '+' : ''}{formatMoney(portfolioStats.deviationAmount)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between text-sm"><span className="text-slate-500">距总收益目标还差</span><span className="font-bold font-mono text-base"><AnimatedNumber value={portfolioStats.gap} /></span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-500">剩余倒数时间</span><span className="font-bold text-base">{portfolioStats.monthsLeft} 个月</span></div>
                      <div className="w-full bg-slate-100 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden mt-3 mb-1 shadow-inner">
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
           {/* 👇 加上这一块：将悬浮聊天框挂载到全局 */}
          <PortfolioChat portfolioStats={portfolioStats} settings={settings} marketData={marketData} />

        </div>
      )}
    </>
  );
}
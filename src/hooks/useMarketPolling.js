// Hook: Market polling extracted from App.jsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { PROXY_NODES } from '../config/constants';
import { checkIsTradingTime } from '../utils/helpers';
import { fetchMarketService } from '../services/marketFetcher';

export function useMarketPolling(user, settings, settingsReady) {
  const [marketData, setMarketData] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [activeProxyIndex, setActiveProxyIndex] = useState(0);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [manualFetchCount, setManualFetchCount] = useState(0);
  const isFetchingRef = useRef(false);

  const fetchMarketAPI = useCallback(async () => {
    if (!user) return;
    return fetchMarketService({
      settings, activeProxyIndex,
      setMarketData, setMarketError
    });
  }, [user, settings, activeProxyIndex]);

  const manualFetch = useCallback(async () => {
    setManualFetchCount(c => c + 1);
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      await fetchMarketAPI();
    } catch (error) {
      setMarketError(settings.proxyMode === 'custom' ? 代理/数据源请求失败() : '节点不可用，正在切换...');
      if (settings.proxyMode !== 'custom') {
        setActiveProxyIndex(prev => (prev + 1) % PROXY_NODES.length);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [fetchMarketAPI, settings.proxyMode, settings.dataSource]);

  // Initial fetch + auto refresh interval
  useEffect(() => {
    if (!user || !settingsReady) return;
    manualFetch();
    if (!isAutoRefresh) return;
    let intervalId = null;
    const startRefreshInterval = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        if (checkIsTradingTime()) {
          manualFetch();
        }
      }, settings.marketRefreshInterval || 5000);
    };
    const stopRefreshInterval = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    };
    const handleVisibility = () => {
      if (document.hidden) stopRefreshInterval();
      else startRefreshInterval();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (!document.hidden) startRefreshInterval();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stopRefreshInterval();
    };
  }, [isAutoRefresh, manualFetch, user, settings.marketRefreshInterval, settingsReady]);

  return { marketData, marketError, isAutoRefresh, setIsAutoRefresh, manualFetch, manualFetchCount, activeProxyIndex };
}

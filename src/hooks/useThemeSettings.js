// Hook: Theme and settings management extracted from App.jsx
import { useState, useCallback, useEffect, useMemo } from 'react';
import { settingsDao } from '../services/firestoreDao';
import { db } from '../config/firebase';

const DEFAULT_SETTINGS = {
  targetAmount: 100000, targetDate: '2030-12-31', targetAnnualRate: 5,
  proxyMode: 'custom', customProxyUrl: '', dataSource: 'tencent', navDataSource: 'tiantian',
  aiProvider: 'gemini', aiApiKey: '', ntfyTopic: '', idleFunds: 0,
  tavilyApiKey: '', exaApiKey: '', serperApiKey: '',
  cfWorkerUrl: '', cfWorkerSecret: '',
  reasoningEffort: 'max', temperature: 0.1, topP: 0.1, maxOutputTokens: 8192,
  maxHistoryMessages: 20, maxToolLoops: 12, marketRefreshInterval: 5000,
  autoLogoutMinutes: 15, searchResultCount: 6
};

export function useThemeSettings(user) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [theme, setTheme] = useState('light');
  const [showAmounts, setShowAmounts] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);

  const togglePrivacy = useCallback(() => setShowAmounts(prev => !prev), []);
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    // 持久化主题偏好到 Firestore，确保 F5 刷新不丢失
    if (user && db) {
      settingsDao.set(user.uid, { theme: newTheme }).catch(err =>
        console.error('主题设置保存失败:', err)
      );
    }
  }, [user, theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Load settings via realtime DAO listener
  useEffect(() => {
    if (!user || !db) return;
    const unsub = settingsDao.getAll(user.uid, (data) => {
      if (data) {
        setSettings(prev => ({ ...prev, ...data }));
        if (data.theme) setTheme(data.theme);
      }
      setSettingsReady(true);
    });
    return () => unsub();
  }, [user]);

  const handleSaveSettings = async (newSettings) => {
    if (!user || !db) return;
    setSettings(prev => ({ ...prev, ...newSettings }));
    try {
      await settingsDao.set(user.uid, newSettings);
    } catch (error) {
      console.error('保存云端设置失败:', error);
      // Rollback local state on failure
      setSettings(prev => ({ ...prev }));
    }
  };

  const fmt = useMemo(() => {
    const formatMoney = (val) => {
      if (val == null) return '0.00';
      const prefix = val < 0 ? '-' : '';
      const abs = Math.abs(val);
      if (abs >= 100000000) return prefix + (abs / 100000000).toFixed(2) + '亿';
      if (abs >= 10000) return prefix + (abs / 10000).toFixed(2) + '万';
      return prefix + abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const formatPercent = (val) => {
      if (val == null) return '0.00%';
      return (val >= 0 ? '+' : '') + (val * 100).toFixed(2) + '%';
    };
    return {
      money: (val) => showAmounts ? formatMoney(val) : '****',
      percent: (val) => showAmounts ? formatPercent(val) : '**.**%',
      raw: (val, suffix = '') => showAmounts ? ('' + val + suffix) : ('***' + suffix),
    };
  }, [showAmounts]);

  return { settings, setSettings, settingsReady, theme, setTheme, toggleTheme, showAmounts, togglePrivacy, handleSaveSettings, fmt };
}

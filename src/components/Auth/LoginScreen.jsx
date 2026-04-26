import React, { useState } from 'react';
import { Sun, Moon, Activity, AlertCircle, Mail, Lock, RefreshCw, LogIn } from 'lucide-react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../config/firebase';

export const LoginScreen = ({ theme, setTheme, dbError }) => {
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
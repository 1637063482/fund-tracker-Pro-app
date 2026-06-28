// 设置面板组件：全局配置中心，管理 AI 供应商、API 密钥、代理模式、数据源、行情刷新等参数
import React, { useState, useEffect } from 'react';
import { Settings, X, Database, PieChart, Cloud, Sparkles, Bell, Plus } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { AppleSelect } from '../UI/AppleSelect';
import { useModalAnimation } from '../../hooks/useModalAnimation';

export const ProxySettingsModal = ({ settings, onSave, onClose, triggerRect }) => {
  const [mode, setMode] = useState(settings.proxyMode || 'builtin');
  const [customUrl, setCustomUrl] = useState(settings.customProxyUrl || '');
  const [dataSource, setDataSource] = useState(settings.dataSource || 'tencent');
  const[navDataSource, setNavDataSource] = useState(settings.navDataSource || 'tiantian');
  const[aiProvider, setAiProvider] = useState(settings.aiProvider || 'gemini');
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey || '');
  const[geminiModel, setGeminiModel] = useState(settings.geminiModel || 'gemini-2.5-pro');
  const [deepseekKey, setDeepseekKey] = useState(settings.deepseekApiKey || '');
  const [deepseekModel, setDeepseekModel] = useState(settings.deepseekModel || 'deepseek-v4-pro');
  const[siliconflowKey, setSiliconflowKey] = useState(settings.siliconflowApiKey || '');
  const[siliconflowModel, setSiliconflowModel] = useState(settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3');
  const[reasoningEffort, setReasoningEffort] = useState(settings.reasoningEffort || 'max');
  const[marketRefreshInterval, setMarketRefreshInterval] = useState(settings.marketRefreshInterval || 5000);
  const[autoLogoutMinutes, setAutoLogoutMinutes] = useState(String(settings.autoLogoutMinutes ?? 15));
  const[searchResultCount, setSearchResultCount] = useState(settings.searchResultCount || 6);
  const[tavilyKey, setTavilyKey] = useState(settings.tavilyApiKey || '');
  const[exaKey, setExaKey] = useState(settings.exaApiKey || '');
  const[serperKey, setSerperKey] = useState(settings.serperApiKey || '');
  const[ntfyTopic, setNtfyTopic] = useState(settings.ntfyTopic || 'fund_tracker_my_secret_123');
  const [cfWorkerUrl, setCfWorkerUrl] = useState(settings.cfWorkerUrl || '');
  const [cfWorkerSecret, setCfWorkerSecret] = useState(settings.cfWorkerSecret || '');
  const [animSpeed, setAnimSpeed] = useState(settings.animationSpeed || 1.0);
  const { isOpen, open, close: animClose, overlayStyle, panelStyle } = useModalAnimation(onClose, triggerRect, animSpeed);
  const focusRef = useFocusTrap(isOpen);

  useEffect(() => { open(); }, []);

  // 自定义 AI 提供商
  const [customProviders, setCustomProviders] = useState(settings.customAiProviders || []);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: '', model: '', key: '', apiBase: '', protocol: 'openai' });

  const handleClose = () => {
    animClose();
  };

  const handleSave = () => {
    // 构建完整 settings 对象时，剔除敏感字段的空字符串值，
    // 防止 merge:true 把真实 API Key 覆盖成空字符串导致数据丢失
    const raw = {
      proxyMode: mode,
      customProxyUrl: customUrl,
      dataSource,
      navDataSource,
      aiProvider,
      geminiApiKey: geminiKey,
      geminiModel: geminiModel,
      deepseekApiKey: deepseekKey,
      deepseekModel: deepseekModel,
      siliconflowApiKey: siliconflowKey,
      siliconflowModel: siliconflowModel,
      reasoningEffort: reasoningEffort,
      marketRefreshInterval: parseInt(marketRefreshInterval) || 5000,
      autoLogoutMinutes: (() => { const v = parseInt(autoLogoutMinutes); return isNaN(v) ? 15 : v; })(),
      searchResultCount: parseInt(searchResultCount) || 6,
      tavilyApiKey: tavilyKey,
      exaApiKey: exaKey,
      serperApiKey: serperKey,
      ntfyTopic: ntfyTopic,
      cfWorkerUrl: cfWorkerUrl,
      cfWorkerSecret: cfWorkerSecret,
      customAiProviders: customProviders,
      animationSpeed: animSpeed
    };

    // 剔除所有空字符串的敏感字段，避免 merge:true 覆盖 Firestore 中的真实值
    const sensitiveKeys = [
      'customProxyUrl', 'geminiApiKey', 'deepseekApiKey', 'siliconflowApiKey',
      'tavilyApiKey', 'exaApiKey', 'serperApiKey', 'cfWorkerUrl', 'cfWorkerSecret', 'ntfyTopic'
    ];
    const cleaned = {};
    for (const [key, val] of Object.entries(raw)) {
      if (sensitiveKeys.includes(key) && val === '') continue;  // 跳过空字符串的敏感字段
      cleaned[key] = val;
    }

    onSave(cleaned);
    animClose();
  };

  return (
    <div style={overlayStyle}>
      <div ref={focusRef} style={panelStyle} className="bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl w-full max-w-4xl overflow-hidden border border-slate-200/60 dark:border-slate-700/40">
        
        <div className="flex justify-between items-center p-6 border-b border-slate-200/60 dark:border-slate-700/40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-glass">
          <h3 className="text-lg font-bold flex items-center text-slate-800 dark:text-white tracking-tight"><Settings className="mr-2 text-blue-500 transition-transform hover:rotate-90 duration-500" size={20} /> 系统全局设置</h3>
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1.5 active:scale-[0.92]"><X size={20} /></button>
        </div>
        
        <div className="p-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* ================= 左列：AI 与 自动化配置 ================= */}
            <div className="space-y-6">
              
              {/* AI 诊断设置区 */}
              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/20">
                 <label className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                   <span className="flex items-center"><Sparkles size={16} className="mr-1.5 text-blue-500"/> AI 大模型引擎配置</span>
                   <button type="button" onClick={() => { setShowAddProvider(!showAddProvider); setNewProvider({ name: '', model: '', key: '', apiBase: '' }); }} className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-2 py-1 rounded-[0.625rem] transition-colors"><Plus size={14} /> 新增</button>
                 </label>
                 <div className="flex space-x-2">
                    <AppleSelect
                       value={aiProvider}
                       onChange={(val) => setAiProvider(val)}
                       className="flex-1"
                       triggerClassName="px-2 py-4 text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 shadow-inner"
                       options={[
                         { value: 'gemini', label: 'Google Gemini' },
                         { value: 'deepseek', label: 'DeepSeek 官方' },
                         { value: 'siliconflow', label: '硅基流动 (免费版)' },
                         ...customProviders.map(p => ({ value: p.id, label: p.name })),
                       ]}
                    />
                    {aiProvider === 'gemini' && <input type="text" value={geminiModel} onChange={e => setGeminiModel(e.target.value)} placeholder="gemini-2.5-pro" className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />}
                    {aiProvider === 'deepseek' && <input type="text" value={deepseekModel} onChange={e => setDeepseekModel(e.target.value)} placeholder="如: deepseek-v4-pro" className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />}
                    {aiProvider === 'siliconflow' && <input type="text" value={siliconflowModel} onChange={e => setSiliconflowModel(e.target.value)} placeholder="deepseek-ai/DeepSeek-V3" className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />}
                    {customProviders.find(p => p.id === aiProvider) && (
                      <input type="text" value={customProviders.find(p => p.id === aiProvider)?.model || ''} onChange={e => setCustomProviders(prev => prev.map(p => p.id === aiProvider ? {...p, model: e.target.value} : p))} placeholder="输入模型名称" className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />
                    )}
                 </div>

                 {aiProvider === 'gemini' && <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)} placeholder="输入 Google Gemini API Key" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />}
                 {aiProvider === 'deepseek' && <input type="password" value={deepseekKey} onChange={e => setDeepseekKey(e.target.value)} placeholder="输入 DeepSeek 官方 API Key (需充值)" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />}
                 {aiProvider === 'siliconflow' && <input type="password" value={siliconflowKey} onChange={e => setSiliconflowKey(e.target.value)} placeholder="输入 SiliconFlow 免费 API Key" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />}
                 {customProviders.find(p => p.id === aiProvider) && (
                   <>
                   <input type="password" value={customProviders.find(p => p.id === aiProvider)?.key || ''} onChange={e => setCustomProviders(prev => prev.map(p => p.id === aiProvider ? {...p, key: e.target.value} : p))} placeholder="输入 API Key" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" />
                   <select value={customProviders.find(p => p.id === aiProvider)?.protocol || 'openai'} onChange={e => setCustomProviders(prev => prev.map(p => p.id === aiProvider ? {...p, protocol: e.target.value} : p))} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner">
                     <option value="openai">OpenAI 格式 (chat/completions)</option>
                     <option value="anthropic">Anthropic 格式 (v1/messages)</option>
                   </select>
                   <input type="text" value={customProviders.find(p => p.id === aiProvider)?.apiBase || ''} onChange={e => setCustomProviders(prev => prev.map(p => p.id === aiProvider ? {...p, apiBase: e.target.value} : p))} placeholder="API 端点 (如: https://api.openai.com/v1)" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner mt-2" />
                   </>
                 )}

                 {/* 新增提供商表单 */}
                 {showAddProvider && (
                   <div className="bg-blue-50/50 dark:bg-blue-950/30 p-3 rounded-[0.75rem] border border-blue-200/60 dark:border-blue-800/40 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                     <input type="text" value={newProvider.name} onChange={e => setNewProvider({...newProvider, name: e.target.value})} placeholder="提供商名称 (如: OpenAI)" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none" />
                     <input type="text" value={newProvider.model} onChange={e => setNewProvider({...newProvider, model: e.target.value})} placeholder="默认模型 (如: gpt-4o)" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono" />
                     <input type="password" value={newProvider.key} onChange={e => setNewProvider({...newProvider, key: e.target.value})} placeholder="API Key" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono" />
                     <div className="flex gap-2">
                       <select value={newProvider.protocol} onChange={e => setNewProvider({...newProvider, protocol: e.target.value})} className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200">
                         <option value="openai">OpenAI 格式 (chat/completions)</option>
                         <option value="anthropic">Anthropic 格式 (v1/messages)</option>
                       </select>
                     </div>
                     <input type="text" value={newProvider.apiBase} onChange={e => setNewProvider({...newProvider, apiBase: e.target.value})} placeholder="API 端点 (如: https://api.openai.com/v1)" className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono" />
                     <div className="flex gap-2">
                       <button type="button" onClick={() => { if (newProvider.name.trim()) { const id = 'custom_' + Date.now(); setCustomProviders(prev => [...prev, {...newProvider, id}]); setAiProvider(id); setShowAddProvider(false); } }} disabled={!newProvider.name.trim()} className="px-3 py-1.5 text-xs font-bold bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white rounded-[0.625rem] transition-colors">确认添加</button>
                       <button type="button" onClick={() => setShowAddProvider(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-[0.625rem] transition-colors">取消</button>
                     </div>
                   </div>
                 )}

                 <p className="text-[11px] text-purple-600 dark:text-purple-400 opacity-80 leading-relaxed mt-1">
                   {aiProvider === 'gemini' && "自动开启 Google Search 实时联网检索宏观资讯。"}
                   {aiProvider === 'deepseek' && "注意：DeepSeek 官方 API 需预付费充值。建议填写旗舰模型 deepseek-v4-pro 以获得最佳量化推理能力。"}
                   {aiProvider === 'siliconflow' && "注册 siliconflow.cn 获取 Key，国内直连，免费无限制使用最强 DeepSeek-V3 模型。"}
                 </p>

              </div>

              {/* 矩阵联网检索配置 (多引擎智能路由) */}
              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20">
                 <label className="text-sm font-bold text-indigo-800 dark:text-indigo-300 flex items-center justify-between">
                   <span className="flex items-center"><Cloud size={16} className="mr-1.5 text-indigo-500"/> 🌐 矩阵联网检索配置 (双引擎+兜底)</span>
                 </label>
                 <div className="space-y-2">
                   <input 
                      type="password" value={exaKey} onChange={e => setExaKey(e.target.value)} 
                      placeholder="Exa.ai API Key (主节点A: 专攻深度研报与机构博客)" 
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-700 rounded-[0.75rem] text-xs sm:text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" 
                   />
                   <input 
                      type="password" value={tavilyKey} onChange={e => setTavilyKey(e.target.value)} 
                      placeholder="Tavily API Key (主节点B: 专攻突发新闻与宏观快讯)" 
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-700 rounded-[0.75rem] text-xs sm:text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" 
                   />
                   <input 
                      type="password" value={serperKey} onChange={e => setSerperKey(e.target.value)} 
                      placeholder="Serper.dev API Key (终极兜底: Google 搜索直连)" 
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-700 rounded-[0.75rem] text-xs sm:text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono text-slate-800 dark:text-slate-200 shadow-inner" 
                   />
                 </div>
                 <p className="text-[11px] text-indigo-600 dark:text-indigo-400 opacity-80 leading-relaxed mt-1">
                   构建投行级信息漏斗：系统将根据问题性质，自动调用 Exa (查深度) 或 Tavily (查快讯)。当主节点触发频控或宕机时，自动无感降级至 Serper 兜底。
                 </p>
              </div>

              {/* 移动端推送配置 */}
              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/20">
                 <label className="text-sm font-bold text-blue-800 dark:text-blue-300 flex items-center justify-between">
                   <span className="flex items-center"><Bell size={16} className="mr-1.5 text-blue-500"/> 移动端消息推送配置 (飞书/钉钉/Ntfy)</span>
                 </label>
                 <input 
                    type="text"
                    value={ntfyTopic} 
                    onChange={e => setNtfyTopic(e.target.value)} 
                    placeholder="输入 Webhook URL 或 Ntfy 主题" 
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner font-mono text-slate-800 dark:text-slate-200" 
                 />
                 <p className="text-[11px] text-blue-600 dark:text-blue-400 opacity-80 leading-relaxed mt-1">
                   支持飞书/钉钉群机器人 Webhook，或 Ntfy 主题。设置后可实现一键推送与云端定时播报。
                 </p>
              </div>

              {/* Cloudflare Worker 配置 */}
              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20">
                 <label className="text-sm font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                   <span className="flex items-center"><Cloud size={16} className="mr-1.5 text-emerald-500"/> Cloudflare AI 巡检大脑配置</span>
                 </label>
                 <input 
                    type="text"
                    value={cfWorkerUrl} 
                    onChange={e => setCfWorkerUrl(e.target.value)} 
                    placeholder="Worker 公网 URL (如: https://fund-tracker...workers.dev)" 
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-inner font-mono text-slate-800 dark:text-slate-200" 
                 />
                 <input 
                    type="password"
                    value={cfWorkerSecret} 
                    onChange={e => setCfWorkerSecret(e.target.value)} 
                    placeholder="Worker 同步握手密码 (SYNC_SECRET)" 
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-700 rounded-[0.75rem] text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-inner font-mono text-slate-800 dark:text-slate-200" 
                 />
                 <p className="text-[11px] text-emerald-600 dark:text-emerald-400 opacity-80 leading-relaxed mt-1">
                   填入您的专属 Worker 地址与密钥。配置完成后点击顶部导航栏的「上传至云大脑」，即可实现云端 7x24 小时全自动 AI 资产巡检。
                 </p>
              </div>
            </div>

            {/* ================= 右列：基础数据源与网络代理 ================= */}
            <div className="space-y-6">
              
              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/20">
                <label className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center"><Database size={16} className="mr-1.5 text-amber-500"/> 实时行情数据源 (大盘/ETF)</label>
                <div className="grid grid-cols-3 gap-2">
                  {['tencent', 'sina', 'xueqiu'].map((ds) => (
                    <button key={ds} type="button" onClick={() => setDataSource(ds)} className={`p-2.5 border rounded-[0.875rem] flex items-center justify-center transition-all duration-300 ease-spring hover:scale-[1.03] hover:-translate-y-0.5 active:scale-[0.97] text-sm font-medium ${dataSource === ds ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/30 dark:border-amber-500 dark:text-amber-300 shadow-md scale-[1.02]' : 'border-slate-200 text-slate-600 hover:bg-white hover:shadow-md dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                      {ds === 'tencent' ? '腾讯' : ds === 'sina' ? '新浪' : '雪球'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20">
                <label className="text-sm font-bold text-emerald-800 dark:text-emerald-300 flex items-center"><PieChart size={16} className="mr-1.5 text-emerald-500"/> 基金净值数据源 (自动估值)</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'tiantian', label: '天天(盘中)', desc: 'JSONP直连' },
                    { id: 'tiantian_lsjz', label: '天天(历史)', desc: 'Web真净值' },
                    { id: 'sina', label: '新浪财经', desc: '需代理' },
                    { id: 'danjuan', label: '蛋卷基金', desc: '需代理格式佳' }
                  ].map((src) => (
                    <button key={src.id} type="button" onClick={() => setNavDataSource(src.id)} className={`p-2.5 border rounded-[0.875rem] flex flex-col items-center justify-center transition-all duration-300 ease-spring hover:scale-[1.03] hover:-translate-y-0.5 active:scale-[0.97] text-sm font-medium ${navDataSource === src.id ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-300 shadow-md scale-[1.02]' : 'border-slate-200 text-slate-600 hover:bg-white hover:shadow-md dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                      <span>{src.label}</span>
                      <span className="text-[10px] font-normal opacity-80 mt-0.5">({src.desc})</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 apple-card apple-section p-4 border-l-4 border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/20">
                 <label className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center"><Cloud size={16} className="mr-1.5 text-amber-500"/> 跨域代理模式</label>
                
                <label className={`flex items-center space-x-3 cursor-pointer p-3 rounded-[0.875rem] border transition-all duration-300 ease-spring hover:scale-[1.01] ${mode === 'builtin' ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/20 shadow-sm' : 'border-transparent hover:bg-white dark:hover:bg-slate-700/50'}`}>
                  <input type="radio" checked={mode === 'builtin'} onChange={() => setMode('builtin')} className="w-4 h-4 text-amber-600 focus:ring-amber-500 transition-colors" />
                  <span className="text-slate-700 dark:text-slate-300 font-medium text-sm">内置公共代理池 (不建议)</span>
                </label>

                <label className={`flex items-start space-x-3 cursor-pointer p-4 rounded-[0.875rem] border transition-all duration-300 ease-spring hover:scale-[1.01] ${mode === 'custom' ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/20 shadow-sm' : 'border-transparent hover:bg-white dark:hover:bg-slate-700/50'}`}>
                  <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} className="w-4 h-4 text-amber-600 focus:ring-amber-500 mt-1 transition-colors" />
                  <div className="flex-1">
                    <span className="text-slate-700 dark:text-slate-300 font-medium text-sm block mb-2">使用自定义 Web API 代理</span>
                    <input 
                      value={customUrl} 
                      onChange={e => setCustomUrl(e.target.value)} 
                      disabled={mode !== 'custom'}
                      placeholder="https://your-proxy.workers.dev/?url={{url}}" 
                      className={`w-full px-3 py-2 border rounded-[0.75rem] text-sm transition-all duration-300 font-mono ${mode === 'custom' ? 'bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none shadow-inner' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed'}`} 
                    />
                  </div>
                </label>
              </div>

              {/* 系统行为 */}
              <div className="space-y-3 apple-card apple-section p-4 border-l-4 border-l-cyan-500 bg-cyan-50/30 dark:bg-cyan-950/20">
                <label className="text-sm font-bold text-cyan-800 dark:text-cyan-300 flex items-center">
                  <span className="flex items-center"><Settings size={16} className="mr-1.5 text-cyan-500"/> 系统行为</span>
                </label>

                <div>
                  <label className="text-xs text-cyan-700 dark:text-cyan-300 font-medium block mb-1">行情刷新间隔</label>
                  <AppleSelect value={marketRefreshInterval} onChange={(val) => setMarketRefreshInterval(val)}
                    className="w-full"
                    triggerClassName="px-3 py-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 shadow-inner"
                    options={[
                      { value: '2000', label: '2 秒' },
                      { value: '5000', label: '5 秒 (默认)' },
                      { value: '10000', label: '10 秒' },
                      { value: '30000', label: '30 秒' },
                    ]}
                  />
                </div>

                <div>
                  <label className="text-xs text-cyan-700 dark:text-cyan-300 font-medium block mb-1">自动登出时间</label>
                  <AppleSelect value={autoLogoutMinutes} onChange={(val) => setAutoLogoutMinutes(val)}
                    className="w-full"
                    triggerClassName="px-3 py-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 shadow-inner"
                    options={[
                      { value: '5', label: '5 分钟' },
                      { value: '15', label: '15 分钟 (默认)' },
                      { value: '30', label: '30 分钟' },
                      { value: '0', label: '永不' },
                    ]}
                  />
                </div>

                <div>
                  <label className="text-xs text-cyan-700 dark:text-cyan-300 font-medium block mb-1">搜索结果数量</label>
                  <AppleSelect value={searchResultCount} onChange={(val) => setSearchResultCount(val)}
                    className="w-full"
                    triggerClassName="px-3 py-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 shadow-inner"
                    options={[
                      { value: '2', label: '2 条' },
                      { value: '4', label: '4 条' },
                      { value: '6', label: '6 条 (默认)' },
                      { value: '8', label: '8 条' },
                    ]}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">界面动画速度</span>
                    <span className="text-[11px] font-mono font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 px-2 py-0.5 rounded-[0.625rem]">{animSpeed.toFixed(1)}x</span>
                  </div>
                  <input type="range" min="0.3" max="2.5" step="0.1" value={animSpeed}
                    onChange={e => setAnimSpeed(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-cyan-200 dark:bg-cyan-700 rounded-full appearance-none cursor-pointer accent-cyan-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:shadow" />
                  <p className="text-[9px] text-cyan-500 dark:text-cyan-400 mt-0.5">0.3x 极快 · 1.0x 标准 · 2.5x 慢速优雅</p>
                </div>
              </div>

            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200/60 dark:border-slate-700/40 flex justify-end space-x-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-glass shrink-0">
          <button type="button" onClick={handleClose} className="px-6 py-2.5 rounded-full border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-medium active:scale-[0.97]">取消</button>
          <button type="button" onClick={handleSave} className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white font-medium shadow-apple-sm transition-all active:scale-[0.97]">保存设置</button>
        </div>
      </div>
    </div>
  );
};
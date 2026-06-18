// 投资组合分析弹窗组件：AI 驱动的全盘持仓体检，包含 X 光透视、风险评级、相关性分析与优化建议
import React, { useState, useMemo, useEffect } from 'react';
import { X, Sparkles, RefreshCw, AlertTriangle, PieChart, Send, Check, Layers, AlertOctagon, Search, Play } from 'lucide-react';
import { analyzePortfolioWithAI } from '../../utils/ai';
import { toFeishuMarkdown } from '../../utils/feishuMarkdown';
import { renderMarkdown } from '../../utils/renderMarkdown';
import { calculatePortfolioXRay } from '../../utils/helpers';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalAnimation } from '../../hooks/useModalAnimation';

import { collection, getDocs } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';
import { getAuth } from 'firebase/auth'; // 用于获取当前用户

export const PortfolioAnalysisModal = ({ portfolioStats, settings, marketData, fundProfiles, onClose, triggerRect }) => {
  const [aiReport, setAiReport] = useState(null);
  const[aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const { isOpen, open, close, overlayStyle, panelStyle } = useModalAnimation(onClose, triggerRect, settings.animationSpeed || 1.0);
  const focusRef = useFocusTrap(isOpen);

  useEffect(() => { open(); }, []);

  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  // 控制 资产透视 引擎是否启动的开关
  // X-Ray 直接读取基金文档 assetAllocation，无需拉取 FOF 字典
  const [isXRayEnabled, setIsXRayEnabled] = useState(false);

  const { aggregatedHoldings, warnings, trueEquityTotalValue, equityExposureRate } = useMemo(() => {
    const result = calculatePortfolioXRay(
      portfolioStats?.computedFundsWithMetrics || [],
      portfolioStats?.totalCurrentValue || 0
    );
    return {
      aggregatedHoldings: [], warnings: [],
      trueEquityTotalValue: result.totalEquity || 0,
      equityExposureRate: result.equityExposureRate || 0
    };
  }, [portfolioStats]);

  const handleClose = () => close();

  const handleRunAiAnalysis = async () => {
    if (!settings.aiApiKey && !settings.geminiApiKey && !settings.deepseekApiKey && !settings.siliconflowApiKey) {
      setAiError("请先在系统设置中配置 AI 模型的 API Key");
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const report = await analyzePortfolioWithAI(settings, portfolioStats, marketData);
      setAiReport(report);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handlePushToNtfy = async () => {
    const pushToken = settings.ntfyTopic?.trim();
    if (!pushToken) {
      alert("请先在设置中配置推送 Webhook 或 Ntfy 主题！");
      return;
    }
    setIsPushing(true);
    try {
      const titleText = '💼 CIO 级全盘资产诊断报告';
      if (pushToken.startsWith('https://open.feishu.cn')) {
        await fetch(pushToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_type: "interactive", card: { config: { wide_screen_mode: true }, header: { title: { tag: "plain_text", content: titleText }, template: "purple" }, elements:[{ tag: "markdown", content: toFeishuMarkdown(aiReport) }] } })
        });
      } else {
        const topic = encodeURIComponent(pushToken);
        const ntfyUrl = `https://ntfy.sh/${topic}?title=${encodeURIComponent(titleText)}&tags=briefcase,sparkles&markdown=yes`;
        await fetch(ntfyUrl, { method: 'POST', body: aiReport });
      }
      setPushSuccess(true);
      setTimeout(() => setPushSuccess(false), 3000);
    } catch (e) {
      alert("推送失败：" + e.message);
    } finally {
      setIsPushing(false);
    }
  };
  
  const aiName = settings.aiProvider === 'siliconflow' ? 'SiliconFlow (DeepSeek)' : (settings.aiProvider === 'deepseek' ? 'DeepSeek 官方' : 'Google Gemini');

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div ref={focusRef} style={panelStyle} className="bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200/60 dark:border-slate-700/40" onClick={e => e.stopPropagation()}>
        
        <div className="flex justify-between items-center p-6 border-b border-slate-200/60 dark:border-slate-700/40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-glass shrink-0">
          <h3 className="text-lg font-bold flex items-center text-slate-800 dark:text-white tracking-tight">
             <PieChart className="mr-2 text-blue-500" size={20}/> 全盘资产深度体检
          </h3>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors active:scale-[0.92]"><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white dark:bg-slate-900">
            
            {!aiReport && !aiLoading && !aiError && (
               <div className="animate-in fade-in zoom-in">
                 
                 <div className="apple-card p-5 mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center">
                        <Layers className="mr-2 text-indigo-500" size={18}/> 底层真实重仓 资产透视
                      </h4>
                      {!isXRayEnabled ? (
                        <button 
                          onClick={() => setIsXRayEnabled(true)}
                          className="text-xs flex items-center bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-full font-bold transition-all active:scale-95 shadow-sm"
                        >
                          <Play size={12} className="mr-1.5 fill-current"/> 开启资产透视
                        </button>
                      ) : (
                        <span className="text-xs text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-400 px-2 py-1 rounded flex items-center">
                          <Check size={12} className="mr-1.5"/>资产透视已就绪
                        </span>
                      )}
                    </div>

                    {isXRayEnabled && (
                      <div className="animate-in fade-in slide-in-from-top-2">
                        {equityExposureRate > 0 ? (
                          <div className="space-y-4">
                            {/* 🌟 核心新增：FOF 权益暴露度仪表盘 */}
                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 border border-indigo-100 dark:border-indigo-800/50 p-4 rounded-xl text-center shadow-sm relative overflow-hidden">
                               <div className="text-xs text-indigo-800/70 dark:text-indigo-300/70 font-bold mb-1">🎯 剔除固收安全垫 · 真实权益敞口</div>
                               <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-blue-600 mb-1">
                                   {equityExposureRate?.toFixed(2) || 0}%
                               </div>
                               <div className="text-[11px] text-indigo-500/80 dark:text-indigo-400/80 font-mono">
                                   权益市值: ¥{trueEquityTotalValue?.toLocaleString(undefined, {minimumFractionDigits: 2})} / 固收市值: ¥{((portfolioStats?.totalCurrentValue || 0) - (trueEquityTotalValue || 0)).toLocaleString(undefined, {minimumFractionDigits: 2})}
                               </div>
                            </div>
                            {warnings.length > 0 && (
                              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 p-3 rounded-xl flex items-start">
                                <AlertOctagon className="text-red-500 mr-2 shrink-0 mt-0.5" size={18}/>
                                <div className="text-sm text-red-700 dark:text-red-400">
                                  <span className="font-bold block mb-1 text-xs">⚠️ 集中度红色警报</span>
                                  <ul className="list-disc list-inside text-[11px] opacity-90">
                                    {warnings.map(w => <li key={w.symbol}>{w.name} ({w.globalPercent.toFixed(2)}%)</li>)}
                                  </ul>
                                </div>
                              </div>
                            )}
                            <div className="space-y-3">
                              {aggregatedHoldings.slice(0, 8).map((h) => (
                                <div key={h.symbol} className="flex flex-col">
                                  <div className="flex justify-between text-[13px] mb-1">
                                    <span className="text-slate-600 dark:text-slate-400 flex items-center">
                                      <span className="text-[9px] px-1.5 py-0.5 rounded mr-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-bold tracking-wider">
                                          行业穿透
                                      </span>
                                      {h.name}
                                    </span>
                                    <span className="font-bold font-mono text-slate-700 dark:text-slate-300">{h.globalPercent.toFixed(2)}%</span>
                                  </div>
                                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                    {/* 注意：进度条飘红阈值提升到 30%，因为这是行业集中度 */}
                                    <div className={`h-full transition-all duration-1000 ${h.globalPercent >= 30 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${h.globalPercent}%` }}></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="py-6 text-center text-xs text-slate-400">穿透扫描完毕，未发现底层持仓明细。</div>
                        )}
                      </div>
                    )}

                    {!isXRayEnabled && (
                      <div className="py-6 text-center">
                        <p className="text-xs text-slate-400 max-w-[240px] mx-auto">
                          点击上方按钮撕开公募资产外衣，通过 Worker 代理穿透扫描底层真实重仓重合度。
                        </p>
                      </div>
                    )}
                 </div>

                 <div className="text-center py-6">
                   <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
                      <Sparkles size={40}/>
                   </div>
                   <h4 className="text-lg font-bold mb-2 text-slate-800 dark:text-white">准备好开启全盘上帝视角了吗？</h4>
                   <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 max-w-md mx-auto">
                      AI 将读取您的持仓权重、盈亏分布与交易流水，为您出具专业的资产配置报告。
                   </p>
                   <button onClick={handleRunAiAnalysis} className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold text-sm shadow-apple-sm transition-all active:scale-[0.97] flex items-center justify-center mx-auto">
                      <Sparkles size={18} className="mr-2" /> 立即唤醒 {aiName} 全盘诊断
                   </button>
                 </div>

               </div>
            )}

            {aiLoading && (
               <div className="flex flex-col items-center justify-center py-16 animate-pulse text-indigo-600 dark:text-indigo-400">
                 <RefreshCw size={36} className="animate-spin mb-4" />
                 <p className="font-medium text-sm">AI 正在调取全球宏观数据并透视您的资产负债表...</p>
               </div>
            )}

            {aiError && (
               <div className="bg-red-50 dark:bg-red-900/20 p-5 rounded-xl text-red-600 dark:text-red-400 flex items-start border border-red-100 dark:border-red-800/50">
                 <AlertTriangle size={20} className="mr-3 shrink-0 mt-0.5" />
                 <div><span className="font-bold">诊断失败：</span>{aiError} <button onClick={() => setAiError('')} className="ml-3 underline hover:text-red-700">重试</button></div>
               </div>
            )}

            {aiReport && (
               <div className="bg-indigo-50/50 dark:bg-slate-800 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-800/50 shadow-sm animate-in slide-in-from-bottom-4 duration-500 relative">
                 <div className="absolute -top-3 -left-3 bg-gradient-to-r from-indigo-500 to-blue-500 text-white p-1.5 rounded-full shadow-md"><Sparkles size={16} /></div>
                 <h3 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-blue-600 mb-2 pl-3">
                    {aiName} 首席配置报告
                 </h3>
                 <div className="w-full h-px bg-gradient-to-r from-indigo-200 to-transparent dark:from-indigo-900/50 mb-3"></div>
                 <div className="space-y-1">
                    {renderMarkdown(aiReport)}
                 </div>
                 <div className="mt-6 pt-4 border-t border-indigo-100 dark:border-indigo-900/30 flex justify-end">
                   <button 
                     onClick={handlePushToNtfy} 
                     disabled={isPushing || pushSuccess} 
                     className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center transition-all shadow-sm ${pushSuccess ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                   >
                     {pushSuccess ? <><Check size={16} className="mr-1.5"/> 报告已推送成功</> : (isPushing ? <><RefreshCw size={16} className="mr-1.5 animate-spin"/> 发送中...</> : <><Send size={16} className="mr-1.5"/> 推送到手机</>)}
                   </button>
                 </div>
               </div>
            )}
        </div>
      </div>
    </div>
  );
};
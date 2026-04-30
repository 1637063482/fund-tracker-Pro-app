import React, { useState } from 'react';
import { RefreshCw, X, BarChart2, Award, User, PieChart, Calendar, TrendingDown, Target, Activity, Sparkles, AlertTriangle, Send, Check } from 'lucide-react';
import { analyzeFundWithAI } from '../../utils/ai';

export const FundProfileModal = ({ fund, profile, marketData, settings, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const[aiReport, setAiReport] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  
  const[isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 250); 
  };

  const handleRunAiAnalysis = async () => {
    if (!settings.aiApiKey && !settings.geminiApiKey) {
      setAiError("请先在页面右上角设置中心配置 AI 模型 API Key");
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const report = await analyzeFundWithAI(settings, fund, profile, marketData);
      setAiReport(report);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  /// 智能多通道发送请求的方法
  const handlePushToNtfy = async () => {
    const pushToken = settings.ntfyTopic?.trim();
    if (!pushToken) {
      alert("请先在设置中配置推送 Webhook 或 Ntfy 主题！");
      return;
    }
    setIsPushing(true);
    try {
      const titleText = `🤖【${fund?.name || '资产'}】单基体检报告已出`;

      if (pushToken.startsWith('https://open.feishu.cn') || pushToken.startsWith('https://open.larksuite.com')) {
        // 飞书通道
        const res = await fetch(pushToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msg_type: "interactive",
            card: {
              config: { wide_screen_mode: true },
              header: { title: { tag: "plain_text", content: titleText }, template: "blue" },
              elements: [{ tag: "markdown", content: aiReport }]
            }
          })
        });
        const resData = await res.json();
        if (resData.code !== 0) throw new Error(`飞书拦截: ${resData.msg}`);
      } else if (pushToken.startsWith('https://oapi.dingtalk.com')) {
        // 钉钉通道
        const res = await fetch(pushToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: "markdown",
            markdown: { title: "资产", text: `### ${titleText}\n\n${aiReport}` }
          })
        });
        const resData = await res.json();
        if (resData.errcode !== 0) throw new Error(`钉钉拦截: ${resData.errmsg}`);
      } else {
        // Ntfy 通道
        const topic = encodeURIComponent(pushToken);
        const title = encodeURIComponent(titleText);
        const tags = 'robot,chart_with_upwards_trend';
        const ntfyUrl = `https://ntfy.sh/${topic}?title=${title}&tags=${tags}&markdown=yes`;
        const response = await fetch(ntfyUrl, { method: 'POST', body: aiReport });
        if (!response.ok) throw new Error(`Ntfy HTTP ${response.status}`);
      }

      setPushSuccess(true);
      setTimeout(() => setPushSuccess(false), 3000);
    } catch (e) {
      alert("推送失败：" + e.message);
    } finally {
      setIsPushing(false);
    }
  };

  if (!profile) {
    return (
      <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity duration-250 ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl flex flex-col items-center shadow-2xl">
          <RefreshCw size={32} className="animate-spin text-blue-500 mb-4" />
          <p className="text-slate-500 dark:text-slate-400 font-medium">正在深度解析底层配置...</p>
        </div>
      </div>
    );
  }

  const derived = profile.fund_derived || {};
  const baseData = profile.sec_header_base_data ||[];
  
  const maxDrawdown = baseData.find(d => d.data_name === '最大回撤')?.data_value_str || '--';
  const manager = baseData.find(d => d.data_name === '基金经理')?.data_value_str || profile.manager_name || '--';
  const foundDate = profile.found_date || '--';
  const scale = baseData.find(d => d.data_name === '基金规模')?.data_value_str || profile.totshare || '--';
  const typeDesc = profile.type_desc || '--';
  const rank1y = derived.srank_l1y || '--';
  const rank3y = derived.srank_l3y || '--';
  
  const tips = profile.tips || profile.op_fund?.tips || '';
  const fundTags = profile.op_fund?.fund_tags ||[];
  const yieldHistory = derived.yield_history ||[];
  const investTarget = profile.invest_target || profile.invest_orientation || '这只基金的基金经理很懒，什么都没写。';
  
  const annualPerformance = (derived.annual_performance_list ||[])
    .filter(a => !a.period.includes('以来'))
    .slice(0, 5)
    .reverse();

  // 【修复】Markdown 使用 div 替代 p，完美兼容 DeepSeek 的多层级思维链
  const renderMarkdown = (text) => {
    return text.split('\n').map((line, idx) => {
      if (!line.trim()) return <div key={idx} className="h-2"></div>;
      if (line.startsWith('### ')) {
        return <h4 key={idx} className="font-bold text-purple-800 dark:text-purple-300 mt-4 mb-2 text-base flex items-center"><Sparkles size={14} className="mr-1.5 shrink-0"/>{line.replace('### ', '')}</h4>;
      }
      let formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return <div key={idx} className="mb-1 text-slate-700 dark:text-slate-300 leading-relaxed text-sm break-words" dangerouslySetInnerHTML={{ __html: formattedLine }} />;
    });
  };

  const aiName = settings.aiProvider === 'siliconflow' ? 'SiliconFlow (DeepSeek)' 
               : (settings.aiProvider === 'deepseek' ? 'DeepSeek 官方' : 'Google Gemini');

  return (
    <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 transition-opacity duration-250 ${isClosing ? 'opacity-0' : 'opacity-100'}`} onClick={handleClose}>
      <div className={`bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col transform transition-all duration-250 ${isClosing ? 'scale-95 translate-y-4' : 'scale-100 translate-y-0'} animate-in fade-in zoom-in-95`} onClick={e => e.stopPropagation()}>
        
        <div className="shrink-0 bg-gradient-to-r from-blue-600 to-indigo-600 p-5 sm:p-6 text-white relative overflow-hidden">
          <div className="absolute right-0 top-0 opacity-10 transform scale-150 -translate-y-4 translate-x-4">
            <BarChart2 size={120} />
          </div>
          <div className="flex justify-between items-start relative z-10">
            <div className="pr-4">
              <div className="text-blue-100 text-sm font-mono mb-1.5 bg-white/20 px-2 py-0.5 rounded inline-block shadow-sm">
                {fund?.fundCode}
              </div>
              <h2 className="text-lg sm:text-2xl font-bold tracking-tight leading-tight">
                {profile.fd_name || fund?.name}
              </h2>
            </div>
            <button onClick={handleClose} className="p-1.5 bg-white/10 hover:bg-white/30 rounded-full transition-colors active:scale-90 shrink-0 shadow-sm">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 flex flex-col bg-slate-50 dark:bg-slate-900">
          
          {/* AI 诊断面板区域 */}
          <div className="p-4 sm:p-6 bg-gradient-to-b from-purple-50 to-white dark:from-purple-900/20 dark:to-slate-900 border-b border-slate-100 dark:border-slate-700">
             {!aiReport && !aiLoading && !aiError && (
               <button onClick={handleRunAiAnalysis} className="w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 flex items-center justify-center">
                 <Sparkles size={18} className="mr-2" /> 召唤 {aiName} 全息诊断 (含现金流轨迹)
               </button>
             )}
             
             {aiLoading && (
               <div className="flex flex-col items-center justify-center py-6 animate-pulse text-purple-600 dark:text-purple-400">
                 <RefreshCw size={28} className="animate-spin mb-3" />
                 <p className="text-sm font-medium">{aiName} 正在分析历史现金流并结合当下宏观环境推演...</p>
               </div>
             )}

             {aiError && (
               <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl text-red-600 dark:text-red-400 text-sm flex items-start border border-red-100 dark:border-red-800/50">
                 <AlertTriangle size={18} className="mr-2 shrink-0 mt-0.5" />
                 <div>
                    <span className="font-bold">分析失败：</span>{aiError}
                    <button onClick={() => setAiError('')} className="ml-3 underline hover:text-red-700">重试</button>
                 </div>
               </div>
             )}

             {aiReport && (
               <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-purple-200 dark:border-purple-800 shadow-sm animate-in slide-in-from-top-4 duration-500 relative">
                 <div className="absolute -top-3 -left-3 bg-gradient-to-r from-purple-500 to-indigo-500 text-white p-1.5 rounded-full shadow-md">
                   <Sparkles size={16} />
                 </div>
                 <h3 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 mb-2 pl-3">基于宏观环境与现金流的智能研判</h3>
                 <div className="w-full h-px bg-gradient-to-r from-purple-100 to-transparent dark:from-purple-900/50 mb-3"></div>
                 <div className="space-y-1">
                   {renderMarkdown(aiReport)}
                 </div>
                 {/* 【新增】推送按钮 */}
                 <div className="mt-5 pt-3 border-t border-purple-50 dark:border-purple-900/30 flex justify-end">
                   <button 
                     onClick={handlePushToNtfy} 
                     disabled={isPushing || pushSuccess} 
                     className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center transition-all shadow-sm ${pushSuccess ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-purple-50 hover:bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:hover:bg-purple-800/50 dark:text-purple-300 active:scale-95 border border-purple-100 dark:border-purple-800/50'}`}
                   >
                     {pushSuccess ? <><Check size={16} className="mr-1.5"/> 报告已成功推送</> : (isPushing ? <><RefreshCw size={16} className="mr-1.5 animate-spin"/> 正在发送...</> : <><Send size={16} className="mr-1.5"/> 一键推送到手机</>)}
                   </button>
                 </div>
               </div>
             )}
          </div>

          <div className="p-4 sm:p-6 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
             {tips && (
               <div className="text-amber-600 dark:text-amber-500 font-medium text-sm sm:text-base mb-3 flex items-start">
                 <Award size={18} className="mr-1.5 shrink-0 mt-0.5"/> {tips}
               </div>
             )}
             <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-100 dark:border-blue-800 px-2.5 py-1 rounded-md shadow-sm">
                  {typeDesc}
                </span>
                {fundTags.map((tag, i) => (
                  <span key={i} className="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 px-2.5 py-1 rounded-md shadow-sm">
                    {tag.name}
                  </span>
                ))}
                <span className={`px-2.5 py-1 rounded-md border shadow-sm ${profile.fund_status === "0" ? 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>
                  {profile.fund_status === "0" ? "开放申赎" : "限制交易"}
                </span>
             </div>
          </div>

          <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 sm:gap-y-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-xs sm:text-sm">
             <div className="space-y-3">
               <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                 <span className="text-slate-500 flex items-center"><User size={14} className="mr-1.5"/>基金经理</span>
                 <span className="font-medium text-slate-800 dark:text-slate-200">{manager}</span>
               </div>
               <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                 <span className="text-slate-500 flex items-center"><PieChart size={14} className="mr-1.5"/>资产规模</span>
                 <span className="font-medium text-slate-800 dark:text-slate-200">{scale}</span>
               </div>
               <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                 <span className="text-slate-500 flex items-center"><Calendar size={14} className="mr-1.5"/>成立日期</span>
                 <span className="font-mono text-slate-800 dark:text-slate-200">{foundDate}</span>
               </div>
             </div>
             <div className="space-y-3">
               <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                 <span className="text-slate-500 flex items-center"><TrendingDown size={14} className="mr-1.5"/>最大回撤</span>
                 <span className="font-mono font-bold text-green-500">{maxDrawdown}</span>
               </div>
               <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                 <span className="text-slate-500 flex items-center"><Target size={14} className="mr-1.5"/>近1年排名</span>
                 <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{rank1y}</span>
               </div>
               <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                 <span className="text-slate-500 flex items-center"><Target size={14} className="mr-1.5"/>近3年排名</span>
                 <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{rank3y}</span>
               </div>
             </div>
          </div>

          {yieldHistory.length > 0 && (
            <div className="p-4 sm:p-6 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700">
               <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center">
                 <Activity size={16} className="mr-1.5 text-indigo-500"/> 阶段涨跌幅看板
               </h3>
               <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
                  {yieldHistory.map((yh, idx) => {
                    const v = parseFloat(yh.yield);
                    const isPos = v > 0;
                    return (
                       <div key={idx} className="bg-slate-50 dark:bg-slate-800 p-2 sm:p-3 rounded-xl border border-slate-100 dark:border-slate-700 flex flex-col items-center justify-center shadow-sm">
                         <span className="text-[10px] sm:text-xs text-slate-500 mb-1">{yh.name}</span>
                         <span className={`font-mono font-bold text-sm sm:text-base tracking-tight ${isPos ? 'text-red-500' : (v < 0 ? 'text-green-500' : 'text-slate-500')}`}>
                           {isPos ? '+' : ''}{yh.yield}%
                         </span>
                       </div>
                    )
                  })}
               </div>
            </div>
          )}

          <div className="p-4 sm:p-6 bg-amber-50/50 dark:bg-slate-800/30">
             <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center">
               <Target size={16} className="mr-1.5 text-amber-500"/> 底层投资策略
             </h3>
             <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed text-justify">
               {investTarget}
             </p>
          </div>
        </div>
      </div>
    </div>
  );
};

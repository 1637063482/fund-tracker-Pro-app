// 基金编辑器组件：手动/自动双模式基金录入表单，管理交易流水、净值同步、清仓归档与退出市值记录
import React, { useState, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, Zap, RefreshCw, AlertCircle, Activity, RefreshCcw, Archive, Trash2, Plus, Save, CheckCircle2 } from 'lucide-react';
import { SmartInput } from '../UI/SmartInput';
import { AppleSelect } from '../UI/AppleSelect';
import { evaluateExpression, formatMoney } from '../../utils/helpers';
export const FundEditor = ({ fund, onSave, onCancel, fundNavs, fetchNavManually }) => {
  const [localFund, setLocalFund] = useState({
    id: fund.id,
    name: fund.name || '',
    transactions: fund.transactions?.length > 0 ? [...fund.transactions] :[{ id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }],
    currentValueRaw: fund.currentValueRaw || '',
    mode: fund.mode || 'manual',
    fundCode: fund.fundCode || '',
    shares: fund.shares || '',
    isArchived: fund.isArchived || false,
    lastNav: fund.lastNav || 0,
    redemptionFees: fund.redemptionFees?.breakpoints
      ? { ...fund.redemptionFees }
      : fund.redemptionFees?.d0_7 !== undefined
        ? { breakpoints: [7, 30, 180, 365], rates: [fund.redemptionFees.d0_7 || '', fund.redemptionFees.d7_30 || '', fund.redemptionFees.d30_180 || '', fund.redemptionFees.d180_365 || '', fund.redemptionFees.d365_plus || ''] }
        : { breakpoints: [7, 30, 180, 365], rates: ['', '', '', '', ''] }
  });
  const [showFeeEditor, setShowFeeEditor] = useState(false);

  const DEFAULT_BREAKPOINTS = [7, 30, 180, 365];
  const bp = localFund.redemptionFees?.breakpoints || DEFAULT_BREAKPOINTS;
  const rt = localFund.redemptionFees?.rates || ['', '', '', '', ''];

  const handleBreakpointChange = (index, val) => {
    const newBp = [...bp];
    newBp[index] = val === '' ? '' : Math.max(1, parseInt(val) || 0);
    setLocalFund(prev => ({ ...prev, redemptionFees: { ...prev.redemptionFees, breakpoints: newBp } }));
  };
  const handleRateChange = (index, val) => {
    const newRt = [...rt];
    newRt[index] = val;
    setLocalFund(prev => ({ ...prev, redemptionFees: { ...prev.redemptionFees, rates: newRt } }));
  };

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

  // 持续快照最后一次非零市值，用于归档时保存为退出市值
  const exitValueSnapshot = useRef(fund.exitValue || fund.currentValue || 0);
  if (currentEstimatedValue > 0.01) {
    exitValueSnapshot.current = currentEstimatedValue;
  }

  const isAutoModeMissingNav = localFund.mode === 'auto' && Number(localFund.shares) > 0 && !fundNavs[localFund.fundCode]?.nav && !localFund.lastNav;
  const isManualModeEmptyValue = localFund.mode === 'manual' && (!localFund.currentValueRaw || localFund.currentValueRaw.trim() === '');
  const canArchive = !isAutoModeMissingNav && !isManualModeEmptyValue && currentEstimatedValue <= 0.01;

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
         <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-full w-full sm:w-fit shadow-inner h-fit">
            <button
              type="button"
              onClick={() => setLocalFund({...localFund, mode: 'manual'})}
              className={`flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-full transition-all duration-300 ${localFund.mode === 'manual' ? 'bg-white text-blue-600 dark:bg-slate-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'}`}
            >手动录入市值</button>
            <button
              type="button"
              onClick={() => setLocalFund({...localFund, mode: 'auto'})}
              className={`flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-full transition-all duration-300 flex items-center justify-center ${localFund.mode === 'auto' ? 'bg-white text-blue-600 dark:bg-slate-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'}`}
            ><RefreshCcw size={14} className="mr-1.5"/> 自动同步净值</button>
         </div>
         
         <div className="flex flex-col items-end w-full sm:w-auto">
           {canArchive && !localFund.isArchived && exitValueSnapshot.current > 0.01 && (
             <span className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1.5 flex items-center">
               <Archive size={12} className="mr-1"/> 清仓时市值: {formatMoney(exitValueSnapshot.current)}
             </span>
           )}
           {localFund.isArchived && localFund.exitValue > 0.01 && (
             <span className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1.5 flex items-center">
               <Archive size={12} className="mr-1"/> 退出市值: {formatMoney(localFund.exitValue)}
             </span>
           )}
           <label className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-xl border transition-all duration-300 w-full sm:w-auto ${!canArchive ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700' : (localFund.isArchived ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400 shadow-sm cursor-pointer' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer')}`}>
              <input type="checkbox" disabled={!canArchive} checked={!!localFund.isArchived} onChange={(e) => setLocalFund({...localFund, isArchived: e.target.checked, exitValue: e.target.checked ? exitValueSnapshot.current : (localFund.exitValue || 0)})} className="rounded text-amber-500 focus:ring-amber-500 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 disabled:opacity-50" />
              <span className="text-sm font-bold flex items-center"><Archive size={16} className="mr-1.5"/> {localFund.isArchived ? '已归档 (隐藏不计入)' : '标记为已清仓/归档'}</span>
           </label>
           {!canArchive && (
             <span className="text-xs text-red-500 mt-1.5 font-medium flex items-start max-w-[280px] text-right">
               <AlertCircle size={12} className="mr-1 shrink-0 mt-0.5"/>
               {isAutoModeMissingNav
                 ? '尚未拉取净值，无法判定持仓市值。请先填入基金代码并点击右侧刷新按钮获取净值。'
                 : isManualModeEmptyValue
                   ? '请先填写现持仓总市值，确认金额为 0 后方可归档。'
                   : '需现持仓金额为 0 才能清仓。请添加卖出记录，并确保将【当前持有总份额】清零。'}
             </span>
           )}
         </div>
      </div>

      <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
        <div>
          <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1">基金/资产名称</label>
          <input value={localFund.name} onChange={(e) => setLocalFund({...localFund, name: e.target.value})} placeholder="例如: 易方达蓝筹精选混合" className="w-full px-4 py-3 border border-slate-200 rounded-[0.75rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition-all text-base" />
        </div>

        {localFund.mode === 'manual' ? (
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-[0.875rem] border border-slate-200/60 dark:border-slate-700/40 animate-in zoom-in-95 duration-300">
            <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1">现持仓总市值 (元)</label>
            <SmartInput value={localFund.currentValueRaw} onChange={(raw) => setLocalFund({...localFund, currentValueRaw: raw})} placeholder="请输入现在的账面总价值，支持简单公式如 =10000+500" className="w-full py-2.5 shadow-sm bg-white tabular-nums" />
          </div>
        ) : (
          <div className="apple-card p-5 border-l-4 border-l-blue-500 animate-in zoom-in-95 duration-300 space-y-4 shadow-sm">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                   <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1 flex justify-between items-end">
                     基金代码
                   </label>
                   <div className="relative group">
                     <input value={localFund.fundCode} onChange={(e) => setLocalFund({...localFund, fundCode: e.target.value})} onBlur={handleTriggerNavFetch} placeholder="例如: 005827" className="w-full px-4 py-3 border border-slate-200 rounded-[0.75rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition-all text-base font-mono uppercase bg-white" />
                     <button type="button" onClick={handleTriggerNavFetch} className={`absolute right-2 top-2 p-1.5 rounded-[0.625rem] text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-all ${isFetchingLocalNav ? 'animate-spin text-blue-500' : ''}`} title="手动拉取净值"><RefreshCcw size={18}/></button>
                   </div>
                </div>
                <div>
                   <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300 pl-1">当前持有总份额</label>
                   <input type="number" value={localFund.shares} onChange={(e) => setLocalFund({...localFund, shares: e.target.value})} placeholder="例如: 10500.55" className="w-full px-4 py-3 border border-slate-200 rounded-[0.75rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition-all text-base font-mono bg-white tabular-nums" />
                </div>
             </div>
             
             <div className="bg-white dark:bg-slate-900 p-4 rounded-[0.875rem] shadow-apple-sm border border-slate-200/60 dark:border-slate-700/40 flex flex-col gap-3">
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
                              <span className="flex items-center text-[10px] bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded-[0.625rem] font-medium">
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
      
      {/* 赎回费率设置 — 可折叠，自定义天数阈值 */}
      <div className="pt-2">
        <button type="button" onClick={() => setShowFeeEditor(!showFeeEditor)} className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
          <span className={`transition-transform ${showFeeEditor ? 'rotate-90' : ''}`}>▸</span>
          赎回费率设置（卖出摩擦成本计算用）
          {rt.some(v => v !== '' && v !== undefined) && (
            <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">已配置</span>
          )}
        </button>
        {showFeeEditor && (
          <div className="mt-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-[0.875rem] border border-slate-200/60 dark:border-slate-700/40 animate-in fade-in duration-200">
            <p className="text-xs text-slate-500 mb-4">填写该基金在各持有天数的赎回费率（%），天数阈值和费率均可修改。可在天天基金或基金公告中查询真实费率。</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {bp.map((b, i) => {
                const label = i === 0 ? `< ${b} 天` : `${bp[i - 1]}-${b} 天`;
                return (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</span>
                    <div className="flex items-center gap-1">
                      <input type="number" min="1" step="1" value={b} onChange={(e) => handleBreakpointChange(i, e.target.value)}
                        className="w-12 py-1 border border-slate-200 rounded-[0.5rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none text-xs font-mono text-center text-slate-700 dark:text-slate-300 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      <span className="text-[11px] text-slate-400">天</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.01" min="0" max="2" value={rt[i] ?? ''} onChange={(e) => handleRateChange(i, e.target.value)}
                        placeholder="1.50" className="w-12 py-1 border border-slate-200 rounded-[0.5rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none text-xs font-mono font-bold text-center text-blue-600 dark:text-blue-400 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      <span className="text-[11px] text-slate-400">%</span>
                    </div>
                  </div>
                );
              })}
              {/* 最后一档 */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{`> ${bp[bp.length - 1] || '?'} 天`}</span>
                <span className="text-xs text-slate-300 dark:text-slate-600 py-1.5">—</span>
                <div className="flex items-center gap-1">
                  <input type="number" step="0.01" min="0" max="2" value={rt[rt.length - 1] ?? ''} onChange={(e) => handleRateChange(rt.length - 1, e.target.value)}
                    placeholder="0" className="w-12 py-1 border border-slate-200 rounded-[0.5rem] dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none text-xs font-mono font-bold text-center text-blue-600 dark:text-blue-400 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-[11px] text-slate-400">%</span>
                </div>
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
            <div key={tx.id} className={`flex items-center bg-white dark:bg-slate-900 p-2 sm:p-3 rounded-[0.875rem] border-y border-r border-l-4 shadow-apple-sm hover:shadow-apple-md transition-all group animate-in fade-in slide-in-from-left-4 duration-300 ${tx.type === 'buy' ? 'border-l-blue-500 border-y-slate-200 border-r-slate-200 dark:border-y-slate-700 dark:border-r-slate-700' : (tx.type === 'sell' || tx.type === 'dividend_cash') ? 'border-l-amber-500 border-y-slate-200 border-r-slate-200 dark:border-y-slate-700 dark:border-r-slate-700' : 'border-l-slate-300 border-y-slate-200 border-r-slate-200 dark:border-slate-700'}`}>
              
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono mr-3 shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {index + 1}
              </div>

              <div className="flex-1 flex flex-col lg:flex-row gap-2 lg:gap-4">
                 <SmartInput isDate={true} value={tx.date} onChange={(val) => handleUpdateTx(index, 'date', val)} className="w-full lg:w-[8.5rem]" />
                 <div className="flex flex-1 gap-2">
                   <AppleSelect
                     value={tx.type || (evaluateExpression(tx.amountRaw) < 0 ? 'buy' : 'sell')}
                     onChange={(val) => handleUpdateTx(index, 'type', val)}
                     className="w-32"
                     triggerClassName="text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-[0.75rem] py-2.5 px-2 sm:px-2.5 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 font-bold text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                     options={[
                       { value: 'buy', label: '买入建仓' },
                       { value: 'sell', label: '卖出提现' },
                       { value: 'dividend_cash', label: '现金分红' },
                       { value: 'dividend_reinvest', label: '红利再投' },
                       { value: 'fee', label: '手续费' },
                     ]}
                   />

                   <div className="relative flex-1 flex items-center">
                     <div className="absolute left-3 pointer-events-none">{meta.icon}</div>
                     <SmartInput 
                        value={tx.amountRaw} 
                       onChange={(raw) => handleUpdateTx(index, 'amountRaw', raw)} 
                       placeholder="输入金额 (绝对值即可)" 
                       className={`w-full py-2.5 pl-9 pr-3 font-mono font-medium text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 focus:outline-none transition-all duration-300 hover:border-slate-300 dark:hover:border-slate-600 ${meta.color}`}
                      />
                   </div>
                 </div>
              </div>

              <button type="button" onClick={() => setLocalFund({...localFund, transactions: localFund.transactions.filter((_, i) => i !== index)})} disabled={localFund.transactions.length <= 1} className="text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 p-2 sm:p-2.5 rounded-[0.625rem] transition-all disabled:opacity-30 active:scale-[0.92] ml-1 sm:ml-2 sm:opacity-0 group-hover:opacity-100"><Trash2 size={18}/></button>
            </div>
          )})}

          <button type="button" onClick={() => setLocalFund({...localFund, transactions:[...localFund.transactions, { id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }]})} className="w-full mt-2 py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 rounded-[0.875rem] flex items-center justify-center text-sm font-bold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-all bg-slate-50/50 hover:bg-blue-50/50 dark:bg-slate-800/20 dark:hover:bg-blue-900/20 active:scale-[0.99]">
            <Plus size={18} className="mr-2" /> 继续添加交易记录
          </button>
        </div>
      </div>
      
      <div className="flex justify-end space-x-3 pt-6 border-t border-slate-100 dark:border-slate-800 mt-2">
        <button type="button" onClick={onCancel} className="px-6 py-2.5 border border-slate-200 dark:border-slate-700 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-bold text-sm active:scale-[0.97] shadow-sm">取消修改</button>
        <button type="button" onClick={() => onSave(localFund)} className="px-8 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center transition-all font-bold text-sm shadow-apple-sm active:scale-[0.97]"><Save size={18} className="mr-2"/> 确认保存</button>
      </div>
    </div>
  );
};
import React, { useState, useMemo } from 'react';
import { ArrowDown, ArrowUp, Zap, RefreshCw, AlertCircle, Activity, RefreshCcw, Archive, Trash2, Plus, Save, CheckCircle2 } from 'lucide-react';
import { SmartInput } from '../UI/SmartInput';
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
                 <SmartInput isDate={true} value={tx.date} onChange={(val) => handleUpdateTx(index, 'date', val)} className="w-full lg:w-36 py-2 text-sm bg-slate-50 dark:bg-slate-800/50 border-transparent hover:border-slate-300 focus:bg-white dark:focus:bg-slate-900" />
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
                       className={`w-full py-2 pl-9 font-mono font-medium text-base sm:text-lg bg-slate-50 dark:bg-slate-800/50 border-transparent hover:border-slate-300 focus:bg-white dark:focus:bg-slate-900 ${meta.color}`} 
                      />
                   </div>
                 </div>
              </div>

              <button type="button" onClick={() => setLocalFund({...localFund, transactions: localFund.transactions.filter((_, i) => i !== index)})} disabled={localFund.transactions.length <= 1} className="text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 p-2 sm:p-2.5 rounded-lg transition-all disabled:opacity-30 active:scale-90 ml-1 sm:ml-2 sm:opacity-0 group-hover:opacity-100"><Trash2 size={18}/></button>
            </div>
          )})}

          <button type="button" onClick={() => setLocalFund({...localFund, transactions:[...localFund.transactions, { id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amountRaw: '', type: 'buy' }]})} className="w-full mt-2 py-3.5 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 rounded-xl flex items-center justify-center text-sm font-bold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-all bg-slate-50/50 hover:bg-blue-50/50 dark:bg-slate-800/20 dark:hover:bg-blue-900/20 active:scale-[0.99]">
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
import React from 'react';
import { PieChart, Archive, Plus, Edit3, Trash2, RefreshCcw } from 'lucide-react';
import { AnimatedNumber } from '../UI/AnimatedNumber';
import { SmartBadges } from '../Fund/SmartBadges';

export const FundTable = ({
  sortedFunds, fundTab, setFundTab, setEditingFundId,
  requestSort, getSortIcon, handleViewProfile, handleDeleteFund,
  fundProfiles, fundNavs, fetchingNavCodes, fetchFundNavManually,
  formatPercent, formatMoney
}) => (
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
      <table className="w-full text-center min-w-[720px]">
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
            <th className="p-4 sm:p-5 font-bold cursor-pointer group hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-center whitespace-nowrap" onClick={() => requestSort('simpleReturn')}>
              <div className="flex items-center justify-center">简单收益率 {getSortIcon('simpleReturn')}</div>
            </th>
            <th className="p-4 sm:p-5 font-bold text-center whitespace-nowrap touch-visible-actions">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700 text-sm sm:text-base xl:text-lg relative">
          {sortedFunds.length === 0 ? <tr><td colSpan="7" className="text-center py-16 text-slate-400 animate-in fade-in duration-500 whitespace-nowrap">空空如也，这里很干净。</td></tr> : null}
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
                        <SmartBadges fund={fund} fundTab={fundTab} fundProfiles={fundProfiles} />
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
              <td className={`p-4 sm:p-5 text-center font-mono font-bold text-base sm:text-lg xl:text-xl transition-colors duration-500 whitespace-nowrap ${fund.simpleReturn >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                <AnimatedNumber value={fund.simpleReturn} formatter={formatPercent} />
              </td>
              <td className="p-4 sm:p-5 text-center whitespace-nowrap touch-visible-actions opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                <div className="flex justify-center items-center">
                  <button type="button" onClick={() => setEditingFundId(fund.id)} className="text-slate-400 hover:text-blue-600 mx-0.5 sm:mx-1 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 transition-all active:scale-90 shadow-sm whitespace-nowrap touch-target" title="编辑这笔投资">
                    <Edit3 size={18}/>
                  </button>
                  <button type="button" onClick={() => handleDeleteFund(fund.id)} className="text-slate-400 hover:text-red-600 mx-0.5 sm:mx-1 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-all active:scale-90 shadow-sm whitespace-nowrap touch-target" title="永久删除">
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
);

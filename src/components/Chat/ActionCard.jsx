// AI 操作卡片组件：渲染 AI 生成的确认/执行卡片（数据确认、交易记录、备忘录更新等），支持表单交互
import React, { useState } from 'react';
import { Activity } from 'lucide-react';

export const ActionCard = React.memo(({ action, onConfirm, onCancel, todos = [] }) => {
  const [form, setForm] = useState({
    date: action.date || new Date().toISOString().split('T')[0],
    feeInput: '',
    shares: '',
    extractedText: action.extractedText || ''
  });
  const [feeMode, setFeeMode] = useState('rate');

  const isPending = action.status === 'pending';
  const rawAmount = Number(action.amount) || 0;

  let targetTodo = null;
  const actualId = action.id || action.todoId;
  if (action.toolType === 'todo' && actualId) {
    targetTodo = todos.find(t => String(t.id) === String(actualId));
  }

  const handleConfirmClick = () => {
    let finalFeeAmount = 0;
    const inputVal = Number(form.feeInput);
    if (!isNaN(inputVal) && inputVal > 0) {
      finalFeeAmount = feeMode === 'rate' ? rawAmount * (inputVal / 100) : inputVal;
    }
    onConfirm(action, { date: form.date, fee: finalFeeAmount, shares: form.shares, extractedText: form.extractedText, stockPct: form.stockPct, bondPct: form.bondPct, fundPct: form.fundPct, cashPct: form.cashPct, otherPct: form.otherPct });
  };

  return (
    <div className={`mt-3 border rounded-[0.875rem] p-4 select-none transition-all duration-500 ${
      action.status === 'completed' ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40 opacity-90' :
      action.status === 'cancelled' ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/40 opacity-60 grayscale' :
      'bg-blue-50/50 dark:bg-slate-900 border-blue-200/60 dark:border-blue-700/40'
    }`}>
      <div className="flex justify-between items-center mb-3">
        <span className={`font-bold flex items-center ${action.status === 'completed' ? 'text-green-700 dark:text-green-400' : action.status === 'cancelled' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
          {action.status === 'completed'
            ? (action.toolType === 'data_confirmation' ? '✅ 数据已核验并传输' : action.toolType === 'memo' ? '✅ 记忆已存入大脑' : action.toolType === 'fof_dict' ? '✅ 底层穿透已入库' : '✅ 调仓/计划已处理')
            : action.status === 'cancelled'
            ? '⛔ 操作已撤销'
            : (action.toolType === 'data_confirmation' ? '👀 智算眼：数据解析核验' : action.toolType === 'memo' ? '🧠 AI 战略备忘录' : action.toolType === 'fof_dict' ? '🧬 FOF 资产穿透' : action.toolType === 'todo' ? '📅 AI 交易计划单' : '🤖 AI 自动化单据')}
        </span>

        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
          action.status === 'completed' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
          action.status === 'cancelled' ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' :
          (action.toolType === 'data_confirmation' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30' :
          action.toolType === 'memo' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30' : action.toolType === 'fof_dict' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30' :
          (action.manageType === 'delete' || action.actionType === 'delete') ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400' :
          (action.manageType === 'update' || action.actionType === 'update') ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' :
          (action.tradeDirection === 'buy' || action.actionType === 'buy') ? 'bg-red-100 text-red-600 dark:bg-red-900/30' :
          (action.tradeDirection === 'sell' || action.actionType === 'sell') ? 'bg-green-100 text-green-600 dark:bg-green-900/30' :
          'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300')
        }`}>
          {action.toolType === 'data_confirmation' ? 'Human-in-Loop' :
           action.toolType === 'memo' ? '战略定调' :
           action.toolType === 'fof_dict' ? 'X-Ray 字典' :
           (action.manageType === 'delete' || action.actionType === 'delete') ? '计划废除' :
           (action.manageType === 'update' || action.actionType === 'update') ? '计划顺延' :
           (action.tradeDirection === 'buy' || action.actionType === 'buy') ? '买入' :
           (action.tradeDirection === 'sell' || action.actionType === 'sell') ? '卖出' : '操作记录'}
        </span>
      </div>

      <div className={`text-sm space-y-1 font-mono ${action.status === 'completed' ? 'text-green-800/70 dark:text-green-200/70' : action.status === 'cancelled' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-600 dark:text-slate-400'}`}>

        <div>标的代码：<span className={isPending ? 'font-bold text-indigo-600 dark:text-indigo-400' : ''}>{action.fundCode || action.target || targetTodo?.fundCode}</span></div>
        <div>标的名称：{action.fundName || action.targetName || targetTodo?.fundName || '未知匹配'}</div>

        {action.toolType === 'ledger' && <div>目标金额：<span className={isPending ? 'font-bold text-slate-800 dark:text-slate-200' : ''}>{action.amount} 元</span></div>}

        {action.toolType === 'todo' && (
          <div className="mt-2 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-[0.875rem] border border-amber-200/60 dark:border-amber-800/30 relative overflow-hidden">

            {action.manageType !== 'delete' && (
              <div className={`absolute top-0 right-0 px-2 py-1 rounded-bl-lg text-[10px] font-bold text-white shadow-sm ${action.priority === 'high' ? 'bg-red-500' : action.priority === 'low' ? 'bg-slate-400' : 'bg-amber-500'}`}>
                {action.priority === 'high' ? '🔴 优先级: 高' : action.priority === 'low' ? '⚪ 优先级: 低' : '🟡 优先级: 中'}
              </div>
            )}

            {action.manageType === 'delete' ? (
              <>
                <div className="text-red-600 dark:text-red-400 font-bold mb-2">🗑️ AI 请求废除/取消此计划</div>
                {targetTodo ? (
                  <div className="text-sm bg-white/50 dark:bg-slate-900/50 p-2 rounded border border-red-100 dark:border-red-900/30">
                    <div>方向：{targetTodo.actionType === 'buy' ? '买入' : '卖出'} <span className="font-bold text-slate-800 dark:text-slate-200">{targetTodo.amount} 元</span></div>
                    <div className="text-xs mt-1 text-slate-500">原条件：{targetTodo.condition}</div>
                  </div>
                ) : (
                  <div className="text-xs text-amber-500">⚠ 本地未找到该计划详情 (可能已被手动删除)</div>
                )}
              </>
            ) : (
              <>
                {action.manageType === 'update' && <div className="text-blue-600 dark:text-blue-400 font-bold mb-2">🔄 AI 请求顺延/修改此计划</div>}

                {(action.amount || targetTodo?.amount) && <div className="text-slate-600 dark:text-slate-400 mt-1">预备金额：<span className="font-bold text-slate-800 dark:text-slate-200">{action.amount || targetTodo?.amount} 元</span></div>}
                <div className="mt-1 text-amber-600 dark:text-amber-500">触发条件：<span className="font-bold">{action.condition || targetTodo?.condition}</span></div>
                {action.manageType === 'update' && <div className="text-[10px] text-slate-400 mt-1.5">*(以上为更新后的最新计划内容)*</div>}
              </>
            )}
          </div>
        )}

        {action.toolType === 'memo' && (
          <div className="mt-2 bg-purple-50 dark:bg-purple-900/20 p-2 rounded-[0.875rem] border border-purple-200/60 dark:border-purple-800/40">
            <div className="text-purple-700 dark:text-purple-300 mb-1">战略方向：<span className="font-bold">{action.decisionType}</span></div>
            <div className="text-slate-600 dark:text-slate-400 whitespace-normal leading-relaxed">核心逻辑：{action.coreLogic}</div>
          </div>
        )}

        {action.toolType === 'fof_dict' && (
          <div className="mt-2 space-y-2">
            {/* 用户手动补充五栏 */}
            {isPending && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-[0.875rem] border border-amber-200/60 dark:border-amber-800/40">
                <div className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-2">
                  ⚠️ 穿透仅覆盖前十大，无法获取总仓位占比。请根据季报/年报手动填入（留空则不覆盖已有数据）：
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { key: 'stockPct', label: '股票%', hint: '如22' },
                    { key: 'bondPct', label: '债券%', hint: '如70' },
                    { key: 'fundPct', label: '基金%', hint: '如0' },
                    { key: 'cashPct', label: '现金%', hint: '如5' },
                    { key: 'otherPct', label: '其他%', hint: '如3' },
                  ].map(field => (
                    <div key={field.key} className="text-center">
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">{field.label}</div>
                      <input
                        type="number"
                        min="0" max="100" step="0.1"
                        placeholder={field.hint}
                        value={form[field.key] || ''}
                        onChange={e => setForm({ ...form, [field.key]: e.target.value })}
                        className="w-full text-center text-xs font-mono font-bold border border-amber-200 dark:border-amber-700 rounded-[0.625rem] px-1 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 穿透明细 — 仅展示前十大和行业分布，不展示 AI 估算仓位 */}
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-[0.875rem] border border-blue-200/60 dark:border-blue-800/40">
              <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-2">
                📊 前十大持仓穿透（占净值比例）— 总仓位请在上方手动填写
              </div>
              <div className="text-slate-600 dark:text-slate-400 text-xs space-y-1">
                {Object.entries(action.sectors || {}).map(([sec, ratio]) => (
                  <div key={sec} className="flex justify-between items-center">
                    <span>{sec}</span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{(ratio * 100).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
              {!Object.keys(action.sectors || {}).length && (
                <div className="text-xs text-slate-400">无行业分布数据（纯债/货币基金）</div>
              )}
            </div>
          </div>
        )}

        {action.toolType === 'data_confirmation' && (
          <div className="mt-2 space-y-2">
            <div className="text-xs text-amber-600 dark:text-amber-500 font-bold mb-1.5 flex items-center">
              <Activity size={14} className="mr-1" />
              涉及真实资金决策，请务必核对下方 OCR 提取的内容，您可直接修改修正：
            </div>
            {action.previewUrl && (
              <img src={action.previewUrl} alt="原始图片" className="max-h-32 object-contain rounded-[0.875rem] border border-slate-200 dark:border-slate-700 shadow-sm mb-2 opacity-90" />
            )}
            <textarea
              disabled={action.status !== 'pending'}
              value={form.extractedText}
              onChange={e => setForm({ ...form, extractedText: e.target.value })}
              className={`w-full p-3 text-[13px] leading-relaxed font-mono bg-white dark:bg-slate-950 border border-teal-200 dark:border-teal-800/60 rounded-xl outline-none custom-scrollbar transition-all ${action.status === 'pending' ? 'focus:ring-2 focus:ring-teal-500 min-h-[160px]' : 'min-h-[80px] text-slate-500'}`}
            />
          </div>
        )}

        {isPending && action.toolType === 'ledger' && action.actionType !== 'delete' && (
          <div className="mt-3 p-3 bg-white/50 dark:bg-slate-950/30 rounded-[0.875rem] border border-slate-200/60 dark:border-slate-700/40 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400 font-medium">交易日期:</span>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="border border-slate-200 dark:border-slate-700 rounded-[0.75rem] px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-[130px] outline-none" />
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center text-slate-600 dark:text-slate-400 font-medium">
                预估手续费:
                <button onClick={() => setFeeMode(feeMode === 'rate' ? 'amount' : 'rate')} className="ml-2 px-1.5 py-0.5 rounded-[0.625rem] bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400 hover:bg-blue-200 active:scale-[0.97]">{feeMode === 'rate' ? '按费率(%) ⇄' : '按金额(元) ⇄'}</button>
              </div>
              <div className="relative">
                <input type="number" placeholder={feeMode === 'rate' ? "0.15" : "0.00"} value={form.feeInput} onChange={e => setForm({ ...form, feeInput: e.target.value })} className="border border-slate-200 dark:border-slate-700 rounded-[0.75rem] py-1 pl-2 pr-6 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-[90px] outline-none text-right" />
                <span className="absolute right-2 top-1 text-slate-400">{feeMode === 'rate' ? '%' : '元'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-indigo-600 dark:text-indigo-400">实际确认份额:</span>
              <input type="number" placeholder="留空按净值估算" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} className="border border-indigo-200 dark:border-indigo-700 rounded-[0.75rem] px-2 py-1 bg-indigo-50/50 text-indigo-700 w-32 outline-none font-bold text-right" />
            </div>
          </div>
        )}
      </div>

      {isPending && (
        <div className="flex space-x-3 mt-4">
          <button onClick={() => onCancel(action)} className="flex-1 py-1.5 rounded-[0.625rem] border border-slate-200 dark:border-slate-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-[0.97]">驳回修改</button>
          <button onClick={handleConfirmClick} className={`flex-1 py-1.5 rounded-[0.625rem] text-white text-sm font-medium shadow-apple-sm transition-all active:scale-[0.97] ${
            action.toolType === 'data_confirmation' ? 'bg-teal-500 hover:bg-teal-600' :
            action.toolType === 'memo' ? 'bg-blue-500 hover:bg-blue-600' :
            action.toolType === 'fof_dict' ? 'bg-blue-500 hover:bg-blue-600' :
            action.toolType === 'todo' ? (action.manageType === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600') :
            (action.actionType === 'delete' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-500 hover:bg-blue-600')
          }`}>
            {action.toolType === 'data_confirmation' ? '✅ 数据无误，请求深度分析' :
             action.toolType === 'memo' ? '确认写入长期记忆' :
             action.toolType === 'fof_dict' ? '确认写入云端字典' :
             action.toolType === 'todo' ? (action.manageType === 'delete' ? '确认废除此计划' : action.manageType === 'update' ? '确认顺延/更新计划' : '确认加入待办') :
             (action.actionType === 'delete' ? '确认撤销记录' : '确认并入账')}
          </button>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较：只在这些关键字段变化时才重新渲染
  return (
    prevProps.action.cardId === nextProps.action.cardId &&
    prevProps.action.status === nextProps.action.status &&
    prevProps.action.toolType === nextProps.action.toolType &&
    prevProps.action.amount === nextProps.action.amount &&
    prevProps.action.fundCode === nextProps.action.fundCode &&
    prevProps.action.fundName === nextProps.action.fundName &&
    prevProps.action.coreLogic === nextProps.action.coreLogic &&
    prevProps.action.decisionType === nextProps.action.decisionType &&
    prevProps.action.condition === nextProps.action.condition &&
    prevProps.action.manageType === nextProps.action.manageType &&
    prevProps.action.actionType === nextProps.action.actionType &&
    prevProps.todos === nextProps.todos
  );
});

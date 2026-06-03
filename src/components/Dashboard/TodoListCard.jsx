// 待办事项卡片组件：投资纪律清单，支持添加/完成/删除待办、设置优先级与截止日期
import React, { useState } from 'react';
import { CheckCircle2, Circle, Trash2, Plus, Clock, Target, AlertCircle, Flag } from 'lucide-react';
import { AppleSelect } from '../UI/AppleSelect';
import { AnimatedModal } from '../UI/AnimatedModal';
import { Tooltip } from '../UI/Tooltip';
import { usePrivacyFormat } from '../../hooks/usePrivacyFormat';

export const TodoListCard = ({ todos, onAddTodo, onToggleTodo, onDeleteTodo, settings }) => {
  const fmt = usePrivacyFormat();
  const [showForm, setShowForm] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [triggerRect, setTriggerRect] = useState(null);
  const [formType, setFormType] = useState('buy');
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCondition, setFormCondition] = useState('');
  const [formPriority, setFormPriority] = useState('medium');
  const [formErrors, setFormErrors] = useState({});
  const [shakeKey, setShakeKey] = useState(0);

  // 重置表单字段到初始状态
  const resetForm = () => {
    setFormCode('');
    setFormName('');
    setFormAmount('');
    setFormCondition('');
    setFormPriority('medium');
    setFormType('buy');
    setFormErrors({});
  };

  // 关闭表单弹窗（同时重置状态）
  const closeForm = () => {
    resetForm();
    setShowForm(false);
  };

  const handleManualAdd = (e) => {
    e.preventDefault();
    const errors = {};
    if (!formCode.trim()) errors.code = '请输入基金代码';
    if (!formAmount || Number(formAmount) <= 0) errors.amount = '请输入有效金额';
    if (!formCondition.trim()) errors.condition = '请输入触发条件';
    if (Object.keys(errors).length > 0) { setFormErrors(errors); setShakeKey(k => k + 1); return false; }
    onAddTodo({
      type: 'ai_plan',
      actionType: formType,
      fundCode: formCode.trim() || '--',
      fundName: formName.trim() || '自定义计划',
      amount: formAmount ? Number(formAmount) : null,
      condition: formCondition.trim() || '待定',
      priority: formPriority,
      isCompleted: false,
      createdAt: new Date().toISOString()
    });
    resetForm();
    return true;
  };

  // 🌟 核心算法：权重映射字典
  const priorityWeight = { high: 3, medium: 2, low: 1 };

  // 🌟 核心算法：双重排序 (先按优先级从高到低，同优先级按创建时间从新到旧)
  const sortTodos = (list) => {
      return list.sort((a, b) => {
          const weightA = priorityWeight[a.priority] || 2;
          const weightB = priorityWeight[b.priority] || 2;
          if (weightA !== weightB) return weightB - weightA;
          return new Date(b.createdAt) - new Date(a.createdAt);
      });
  };

  const pendingTodos = sortTodos(todos.filter(t => !t.isCompleted));
  const completedTodos = sortTodos(todos.filter(t => t.isCompleted));

  // 优先级小旗帜组件 — 使用项目统一的 Tooltip 替代原生 title 属性
  const PriorityBadge = ({ priority, isCompleted }) => {
      if (isCompleted) return null;
      const config = {
        high:   { color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 shadow-sm', label: '高优先级 — 紧急处理，置顶显示' },
        medium: { color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 shadow-sm', label: '中优先级 — 常规跟进' },
        low:    { color: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 shadow-sm', label: '低优先级 — 远端观察' },
      }[priority] || { color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 shadow-sm', label: '中优先级 — 常规跟进' };
      return (
        <Tooltip content={config.label}>
          <span className={`flex shrink-0 items-center justify-center w-5 h-5 rounded-full ${config.color} cursor-default`}>
            <Flag size={12}/>
          </span>
        </Tooltip>
      );
  };

  const renderTodoItem = (todo) => (
    <div key={todo.id} className={`group flex items-start p-4 rounded-[0.875rem] border transition-all duration-300 relative overflow-hidden ${todo.isCompleted ? 'bg-slate-50 dark:bg-slate-800/30 border-transparent opacity-60' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:shadow-sm hover:-translate-y-px'}`}>

      {/* 🌟 视觉强化：高优先级左侧给个醒目的红色小边栏 */}
      {!todo.isCompleted && todo.priority === 'high' && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div>}

      <button onClick={(e) => { setTriggerRect(e.currentTarget.getBoundingClientRect()); setConfirmAction({ type: 'toggle', todo }); }} className="mt-0.5 mr-3 shrink-0 text-slate-400 hover:text-indigo-500 transition-colors">
        {todo.isCompleted ? <CheckCircle2 className="text-green-500" size={20} /> : <Circle size={20} />}
      </button>

      <div className="flex-1 min-w-0">
        {todo.type === 'ai_plan' ? (
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
              <PriorityBadge priority={todo.priority} isCompleted={todo.isCompleted} />
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${todo.actionType === 'buy' ? 'bg-red-100 text-red-600' : todo.actionType === 'sell' ? 'bg-green-100 text-green-600' : 'bg-indigo-100 text-indigo-600'}`}>
                {todo.actionType === 'buy' ? '计划买入' : todo.actionType === 'sell' ? '计划卖出' : '持续观察'}
              </span>
              <span className={`font-bold text-sm ${todo.isCompleted ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                {todo.fundName} ({todo.fundCode})
              </span>
            </div>
            <p className={`text-xs leading-relaxed break-words ${todo.isCompleted ? 'text-slate-400' : 'text-slate-600 dark:text-slate-400'}`}>
              <Target size={12} className="inline mr-1 text-amber-500 shrink-0" />
              条件: <span className={!todo.isCompleted && todo.priority==='high' ? 'font-bold text-red-600 dark:text-red-400' : ''}>{todo.condition}</span> {todo.amount ? `| 预备金额: ${fmt.raw(todo.amount, '元')}` : ''}
            </p>
          </div>
        ) : (
          <div className="flex items-center space-x-2 pt-0.5">
            <PriorityBadge priority={todo.priority} isCompleted={todo.isCompleted} />
            <p className={`text-sm ${todo.isCompleted ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>{todo.text}</p>
          </div>
        )}
      </div>
      <button onClick={(e) => { setTriggerRect(e.currentTarget.getBoundingClientRect()); setConfirmAction({ type: 'delete', todo }); }} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 ml-2 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-[0.625rem] transition-all touch-target shrink-0">
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="apple-card overflow-hidden mt-6 transition-colors duration-500 flex flex-col h-[700px] md:h-[830px]">
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-base sm:text-lg font-bold flex items-center text-slate-800 dark:text-white">
            <Clock className="mr-2 text-indigo-500" /> 交易计划与待办事项
          </h3>
          <button onClick={(e) => { setTriggerRect(e.currentTarget.getBoundingClientRect()); setShowForm(true); }} className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center transition-colors active:scale-[0.97]">
            <Plus size={14} className="mr-1" /> 添加
          </button>
        </div>

        {showForm && (
          <AnimatedModal onClose={closeForm} triggerRect={triggerRect} speed={settings.animationSpeed || 1.0}>
            {(close) => (
            <form onSubmit={(e) => { if (handleManualAdd(e)) close(); }} className={`bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl p-6 mx-4 max-w-lg w-full border border-slate-200/60 dark:border-slate-700/40 space-y-3 ${Object.keys(formErrors).length > 0 ? 'animate-shake' : ''}`} onClick={e => e.stopPropagation()} key={shakeKey}>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">新建交易计划</h3>
              <div className="flex gap-2">
                <AppleSelect value={formType} onChange={setFormType} className="w-28"
                  triggerClassName="px-2 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] font-medium text-slate-700 dark:text-slate-300"
                  options={[{ value: 'buy', label: '计划买入' }, { value: 'sell', label: '计划卖出' }]}
                />
                <div className="flex-1">
                <input type="text" value={formCode} onChange={e => { setFormCode(e.target.value); setFormErrors({}); }} placeholder="基金代码 *" className={`w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border rounded-[0.75rem] focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono uppercase ${formErrors.code ? 'border-red-400 dark:border-red-500' : 'border-slate-200 dark:border-slate-700'}`} />
                {formErrors.code && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.code}</p>}
              </div>
              </div>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="基金名称 (可选)" className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none" />
              <div className="flex gap-2">
                <div className="flex-1">
                <input type="number" value={formAmount} onChange={e => { setFormAmount(e.target.value); setFormErrors({}); }} placeholder="金额 *" className={`w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border rounded-[0.75rem] focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none font-mono ${formErrors.amount ? 'border-red-400 dark:border-red-500' : 'border-slate-200 dark:border-slate-700'}`} />
                {formErrors.amount && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.amount}</p>}
              </div>
                <AppleSelect value={formPriority} onChange={setFormPriority} className="flex-1"
                  triggerClassName="px-2 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] font-medium text-slate-600 dark:text-slate-300"
                  options={[{ value: 'high', label: '🔴 紧急' }, { value: 'medium', label: '🟡 常规' }, { value: 'low', label: '⚪ 远端' }]}
                />
              </div>
              <div>
                <textarea value={formCondition} onChange={e => { setFormCondition(e.target.value); setFormErrors({}); }} placeholder="触发条件 *" rows={3} className={`w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border rounded-[0.75rem] focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none resize-none ${formErrors.condition ? 'border-red-400 dark:border-red-500' : 'border-slate-200 dark:border-slate-700'}`} />
                {formErrors.condition && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.condition}</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={closeForm} className="flex-1 py-2.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">取消</button>
                <button type="submit" className="flex-1 py-2.5 bg-blue-500 text-white text-sm font-medium rounded-full hover:bg-blue-600 transition-colors active:scale-[0.97]">添加计划</button>
              </div>
            </form>
            )}
          </AnimatedModal>
        )}

        {confirmAction && (
          <AnimatedModal onClose={() => setConfirmAction(null)} triggerRect={triggerRect} speed={settings.animationSpeed || 1.0}>
            {(close) => (
            <div className="bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl p-5 mx-4 max-w-md w-full border border-slate-200/60 dark:border-slate-700/40" onClick={e => e.stopPropagation()}>
              <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                {confirmAction.type === 'delete' ? '确认删除该计划吗？' : confirmAction.todo.isCompleted ? '确认标记为未完成？' : '确认标记为已完成？'}
              </p>
              <div className="flex justify-end space-x-2">
                <button onClick={close} className="px-4 py-2 rounded-full text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">取消</button>
                <button onClick={() => {
                  if (confirmAction.type === 'delete') onDeleteTodo(confirmAction.todo.id);
                  else onToggleTodo(confirmAction.todo.id, !confirmAction.todo.isCompleted);
                  close();
                }} className={`px-4 py-2 rounded-full text-sm font-medium text-white active:scale-[0.97] transition-all ${confirmAction.type === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}`}>
                  {confirmAction.type === 'delete' ? '确认删除' : '确认'}
                </button>
              </div>
            </div>
            )}
          </AnimatedModal>
        )}

      </div>

      {/* 移动端统一滚动，桌面端左右分栏独立滚动 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar md:overflow-hidden md:flex md:flex-row">
        {/* 左栏：待办 */}
        <div className="flex flex-col border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-700 w-full md:w-1/2 md:flex-1 md:overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-500 border-b border-slate-100 dark:border-slate-700 shrink-0 flex justify-between items-center">
            <span>⏳ 进行中 ({pendingTodos.length})</span>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 hidden sm:inline">高优先级置顶</span>
          </div>
          <div className="md:flex-1 md:overflow-y-auto custom-scrollbar p-3 space-y-2 bg-slate-50/30 dark:bg-slate-900/20">
            {pendingTodos.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-slate-400 opacity-70 py-8">
                <AlertCircle size={32} className="mb-2" />
                <span className="text-sm">暂无待办计划</span>
              </div>
            ) : pendingTodos.map(renderTodoItem)}
          </div>
        </div>

        {/* 右栏：已完成 */}
        <div className="flex flex-col w-full md:w-1/2 md:flex-1 md:overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-500 border-b border-slate-100 dark:border-slate-700 shrink-0">
            ✅ 已完成 ({completedTodos.length})
          </div>
          <div className="md:flex-1 md:overflow-y-auto custom-scrollbar p-3 space-y-2 bg-slate-50/10 dark:bg-slate-900/10">
            {completedTodos.length === 0 ? (
              <div className="flex items-center justify-center text-slate-400 opacity-50 text-sm py-8">空空如也</div>
            ) : completedTodos.map(renderTodoItem)}
          </div>
        </div>
      </div>
    </div>
  );
};

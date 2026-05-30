// src/components/Dashboard/TodoListCard.jsx
import React, { useState } from 'react';
import { CheckCircle2, Circle, Trash2, Plus, Clock, Target, AlertCircle, Flag } from 'lucide-react';

export const TodoListCard = ({ todos, onAddTodo, onToggleTodo, onDeleteTodo }) => {
  const [inputValue, setInputValue] = useState('');
  const [inputPriority, setInputPriority] = useState('medium'); // 🌟 新增：手动选择优先级

  const handleManualAdd = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onAddTodo({
      text: inputValue.trim(),
      type: 'manual',
      priority: inputPriority,
      isCompleted: false,
      createdAt: new Date().toISOString()
    });
    setInputValue('');
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

  // 优先级小旗帜组件
  const PriorityBadge = ({ priority, isCompleted }) => {
      if (isCompleted) return null; 
      if (priority === 'high') return <span className="flex shrink-0 items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 shadow-sm" title="高优先级"><Flag size={12}/></span>;
      if (priority === 'low') return <span className="flex shrink-0 items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="低优先级"><Flag size={12}/></span>;
      return <span className="flex shrink-0 items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" title="中优先级"><Flag size={12}/></span>;
  };

  const renderTodoItem = (todo) => (
    <div key={todo.id} className={`group flex items-start p-4 rounded-xl border transition-all duration-300 relative overflow-hidden ${todo.isCompleted ? 'bg-slate-50 dark:bg-slate-800/30 border-transparent opacity-60' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:shadow-sm hover:-translate-y-px'}`}>
      
      {/* 🌟 视觉强化：高优先级左侧给个醒目的红色小边栏 */}
      {!todo.isCompleted && todo.priority === 'high' && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div>}

      <button onClick={() => onToggleTodo(todo.id, !todo.isCompleted)} className="mt-0.5 mr-3 shrink-0 text-slate-400 hover:text-indigo-500 transition-colors">
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
              条件: <span className={!todo.isCompleted && todo.priority==='high' ? 'font-bold text-red-600 dark:text-red-400' : ''}>{todo.condition}</span> {todo.amount ? `| 预备金额: ${todo.amount}元` : ''}
            </p>
          </div>
        ) : (
          <div className="flex items-center space-x-2 pt-0.5">
            <PriorityBadge priority={todo.priority} isCompleted={todo.isCompleted} />
            <p className={`text-sm ${todo.isCompleted ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>{todo.text}</p>
          </div>
        )}
      </div>
      <button onClick={() => onDeleteTodo(todo.id)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 ml-2 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all touch-target shrink-0">
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden mt-6 transition-colors duration-500 flex flex-col h-[700px] md:h-[830px]">
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 shrink-0">
        <h3 className="text-base sm:text-lg font-bold flex items-center text-slate-800 dark:text-white">
          <Clock className="mr-2 text-indigo-500" /> 交易计划与待办事项
        </h3>
        <form onSubmit={handleManualAdd} className="mt-3 flex gap-2">
          {/* 🌟 优化：手动添加时也可以选优先级 */}
          <select 
            value={inputPriority} 
            onChange={e => setInputPriority(e.target.value)}
            className="px-2 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none font-medium text-slate-600 dark:text-slate-300 cursor-pointer hover:border-indigo-400 transition-colors"
          >
            <option value="high">🔴 紧急</option>
            <option value="medium">🟡 常规</option>
            <option value="low">⚪ 远端</option>
          </select>
          <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="手动添加一条待办事项..." className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow" />
          <button type="submit" disabled={!inputValue.trim()} className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"><Plus size={18} /></button>
        </form>
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
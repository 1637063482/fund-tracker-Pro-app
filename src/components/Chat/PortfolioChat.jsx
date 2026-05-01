import React, { useState, useRef, useEffect } from 'react';
// 【关键修改1】引入 Globe 图标
import { MessageSquare, X, Send, RefreshCw, Trash2, Bot, User, Sparkles, Globe } from 'lucide-react';
import { chatWithPortfolioAI } from '../../utils/ai';
// 【新增】引入 Firebase 数据库组件
import { doc, setDoc, onSnapshot, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';

// 【修改】接收 user 参数
export const PortfolioChat = ({ portfolioStats, settings, marketData, user }) => {
  const [isOpen, setIsOpen] = useState(false);
  // 【关键修改2】新增联网搜索的用户开关状态（默认开启）
  const[useWebSearch, setUseWebSearch] = useState(true);
  const [pendingAction, setPendingAction] = useState(null); // 🌟 新增：拦截 AI 的操作指令
  const[messages, setMessages] = useState([
    { role: 'assistant', content: '您好！我是您的私人基金copilot。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };
  // 【关键修复】把 isOpen 加入依赖，并在打开聊天框时也触发一次滚动
  useEffect(() => { scrollToBottom(); }, [messages, isLoading, isOpen]);

  // 【新增】组件加载时，实时监听云端聊天记录
  useEffect(() => {
    if (!user || !db) return;
    const chatRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history');
    const unsubscribe = onSnapshot(chatRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        }
      }
    });
    return () => unsubscribe();
  }, [user]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    const newMessages =[...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    // 【新增】用户发消息瞬间，立刻同步上云
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: newMessages }, { merge: true }).catch(e => console.error(e));
    }

    try {
      // 过滤掉第一条欢迎语，只把真实对话发给 AI
      const chatHistory = newMessages.filter((_, idx) => idx > 0 && idx < newMessages.length - 1);
       // 【关键修改3】将 useWebSearch 状态传给底层引擎
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, marketData, useWebSearch);
      
      let finalMessages;
      // 🌟 核心拦截：如果 AI 返回的是一个操作对象，而不是普通文本
      if (typeof reply === 'object' && reply.type === 'ACTION_REQUIRED') {
          setPendingAction(reply.payload);
          finalMessages =[...newMessages, { 
              role: 'assistant', 
              content: `已为您生成【${reply.payload.actionType === 'buy' ? '买入' : '卖出'}】调仓指令，请核对后确认执行：`,
              isAction: true // 标记这是一条包含操作卡的特殊消息
          }];
      } else {
          finalMessages =[...newMessages, { role: 'assistant', content: reply }];
      }
      setMessages(finalMessages);
      
      // 【新增】AI 回复完毕后，把完整的上下文同步上云
      if (user && db) {
        setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: finalMessages }, { merge: true }).catch(e => console.error(e));
      }
    } catch (e) {
      const errorMessages =[...newMessages, { role: 'assistant', content: `❌ 抱歉，连接大脑失败：${e.message}` }];
      setMessages(errorMessages);
      if (user && db) {
        setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: errorMessages }, { merge: true }).catch(e => console.error(e));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 🌟 终极执行引擎：AI 交易单入账 + 实时净值抓取 + 份额自动换算 + 撤销回滚
  const handleConfirmAction = async () => {
    if (!user || !db || !pendingAction) return;
    setIsLoading(true);
    try {
      const { fundCode, amount, actionType } = pendingAction;
      const parsedAmount = Number(amount);

      // 1. 全局声明数据库查询变量 (解决重复声明报错)
      const fundsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'funds');
      const q = query(fundsRef, where('fundCode', '==', fundCode));
      const querySnapshot = await getDocs(q);
      const todayStr = new Date().toISOString().split('T')[0];

      // ==========================================
      // 🛑 场景 C：执行“删除/撤销”操作
      // ==========================================
      if (actionType === 'delete') {
          if (querySnapshot.empty) throw new Error("未找到该基金的持仓记录，无法删除。");
          
          const fundDoc = querySnapshot.docs[0];
          const fundData = fundDoc.data();
          const transactions = fundData.transactions || [];
          
          // 寻找最近一笔金额匹配的记录（从后往前找）
          const targetIndex = transactions.slice().reverse().findIndex(t => Number(t.amountRaw) === parsedAmount);
          if (targetIndex === -1) throw new Error(`未找到金额为 ${parsedAmount} 的历史记录。`);
          
          // 换算回真实的数组索引并提取该记录
          const realIndex = transactions.length - 1 - targetIndex;
          const targetTx = transactions[realIndex];
          
          // 从数组中剔除该记录
          transactions.splice(realIndex, 1);
          
          // 回滚份额
          const fallbackNav = fundData.lastNav || 1;
          const sharesToRevert = Number((parsedAmount / fallbackNav).toFixed(2));
          let newShares = Number(fundData.shares || 0);
          
          if (targetTx.type === 'buy') newShares = Math.max(0, newShares - sharesToRevert);
          if (targetTx.type === 'sell') newShares += sharesToRevert;

          // 🌟 核心修复：强制截断加减法产生的浮点数尾巴
          newShares = Number(newShares.toFixed(2));

          await updateDoc(fundDoc.ref, { 
              transactions: transactions,
              shares: newShares
          });

          // 回滚空闲资金
          if (settings.idleFunds !== undefined) {
              let newIdle = Number(settings.idleFunds);
              if (targetTx.type === 'buy') newIdle += parsedAmount; // 撤销买入，钱退回来
              if (targetTx.type === 'sell') newIdle = Math.max(0, newIdle - parsedAmount); // 撤销卖出，钱扣回去
              await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general'), { idleFunds: newIdle }, { merge: true });
          }

          setMessages(prev => [...prev, { role: 'assistant', content: `✅ 撤销成功！已为您删除了那笔 ${parsedAmount} 元的【${targetTx.type === 'buy' ? '买入' : '卖出'}】记录，资金和份额已回滚。` }]);
          setPendingAction(null);
          return; // 删除逻辑结束，直接返回
      }

      // ==========================================
      // 🟢 场景 A & B：执行正常的“买入/卖出”操作
      // ==========================================
      let currentNav = 1; 
      try {
          const targetUrl = `https://danjuanfunds.com/djapi/fund/${fundCode}`;
          let fetchUrl = '';
          if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
              fetchUrl = settings.customProxyUrl.includes('{{url}}')
                  ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
                  : settings.customProxyUrl + targetUrl;
          } else {
              fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
          }
          const res = await fetch(fetchUrl);
          const data = await res.json();
          const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
          const fetchedNav = parseFloat(actualData?.data?.fund_derived?.unit_nav);
          if (!isNaN(fetchedNav) && fetchedNav > 0) currentNav = fetchedNav;
      } catch (e) {
          console.warn(`[净值抓取] 失败，已降级按净值 1.0 估算份额:`, e);
      }

      // 核心换算：操作金额 ÷ 实时净值 = 变动份额 (保留两小位)
      let sharesDelta = Number((parsedAmount / currentNav).toFixed(2));

      const newTx = {
          id: Date.now().toString(),
          date: todayStr,
          amountRaw: parsedAmount.toString(),
          type: actionType
      };

      // 💾 数据库反写与合并
      if (!querySnapshot.empty) {
          // 场景 A：持仓中已有该基金，合并追加
          const fundDoc = querySnapshot.docs[0];
          const fundData = fundDoc.data();
          const updatedTransactions = [...(fundData.transactions || []), newTx];
          
          let currentShares = Number(fundData.shares || 0);
          if (actionType === 'buy') {
              currentShares += sharesDelta;
          } else if (actionType === 'sell') {
              currentShares = Math.max(0, currentShares - sharesDelta); // 熔断保护：禁止份额扣成负数
          }
          
          // 🌟 核心修复：强制截断加减法产生的浮点数尾巴
          currentShares = Number(currentShares.toFixed(2));
          
          await updateDoc(fundDoc.ref, { 
              transactions: updatedTransactions,
              shares: currentShares,       
              lastNav: currentNav,         
              lastNavDate: todayStr
          });
      } else {
          // 场景 B：全新基金，自动建仓开户
          const newFundRef = doc(fundsRef, Date.now().toString());
          await setDoc(newFundRef, {
              name: pendingAction.fundName || fundCode,
              fundCode: fundCode,
              mode: 'auto',
              shares: actionType === 'buy' ? sharesDelta : 0, 
              currentValueRaw: '0',
              currentValue: 0, 
              isArchived: false,
              lastNav: currentNav,
              lastNavDate: todayStr,
              transactions: [newTx]
          });
      }

      // 💰 子弹库 (空闲资金) 联动扣除或反哺
      if (settings.idleFunds !== undefined) {
          let newIdle = Number(settings.idleFunds);
          if (actionType === 'buy') {
              newIdle = Math.max(0, newIdle - parsedAmount); // 买入扣钱
          } else if (actionType === 'sell') {
              newIdle += parsedAmount; // 卖出回血
          }
          await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general'), { idleFunds: newIdle }, { merge: true });
      }

      setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `✅ 交易入账成功！\n- **方向**：${actionType === 'buy' ? '买入建仓' : '卖出减仓'} ${parsedAmount} 元\n- **折算**：按实时净值 ${currentNav} 折算约 **${sharesDelta} 份**\n\n系统底座数据已更新，您可以关闭聊天框查看最新图表。` 
      }]);
      setPendingAction(null);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ 写入账本失败: ${e.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 🌟 补充缺失的取消交易函数
  const handleCancelAction = () => {
      setPendingAction(null);
      setMessages(prev => [...prev, { role: 'assistant', content: '⛔ 操作已取消。账本未做任何修改。' }]);
  };

  // 一键清空记忆，防止幻觉
  const handleClear = () => {
    if (window.confirm("确定要开启新对话吗？这会清空之前的聊天上下文，防止 AI 产生幻觉。")) {
      const resetMsg =[{ role: 'assistant', content: '记忆已清空。我已经重新加载了您的最新账本底表，我们重新开始吧！' }];
      setMessages(resetMsg);
      // 【新增】同时清空云端记忆
      if (user && db) {
        setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: resetMsg }, { merge: true }).catch(e => console.error(e));
      }
    }
  };

  // 优雅渲染 Markdown
  const renderMarkdown = (text) => {
    return text.split('\n').map((line, idx) => {
      if (!line.trim()) return <div key={idx} className="h-1"></div>;
      if (line.startsWith('### ')) {
        return <h4 key={idx} className="font-bold text-indigo-700 dark:text-indigo-300 mt-2 mb-1 text-[13px]">{line.replace('### ', '')}</h4>;
      }
      let formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return <div key={idx} className="mb-0.5 text-slate-700 dark:text-slate-300 leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: formattedLine }} />;
    });
  };

  return (
    <>
      {/* 右下角悬浮入口按钮 (保持不变) */}
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-2xl transition-all duration-300 hover:scale-110 z-40 ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}
      >
        <MessageSquare size={28} />
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
        </span>
      </button>

      {/* 【全新升级】移动端全屏沉浸，PC端优雅悬浮 */}
      <div 
        className={`fixed inset-0 z-50 flex items-center justify-center sm:p-6 bg-slate-900/60 backdrop-blur-sm transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsOpen(false)}
      >
        <div 
          className={`w-full h-[100dvh] sm:h-[85vh] sm:max-w-3xl bg-white dark:bg-slate-800 sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden transform transition-all duration-300 sm:border border-slate-100 dark:border-slate-700 ${isOpen ? 'scale-100 translate-y-0' : 'sm:scale-95 translate-y-full sm:translate-y-8'}`}
          onClick={e => e.stopPropagation()}
        >
          
          {/* 头部 */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-4 sm:p-5 flex justify-between items-center text-white shrink-0 shadow-md relative z-10">
            <div className="flex items-center">
              <Sparkles size={22} className="mr-2" />
              <span className="font-bold text-lg">私人投资copilot</span>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={handleClear} title="开启新对话 (防幻觉)" className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"><Trash2 size={18} /></button>
              <button onClick={() => setIsOpen(false)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"><X size={18} /></button>
            </div>
          </div>

          {/* 消息列表区 */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-5 bg-slate-50 dark:bg-slate-900 custom-scrollbar relative">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[95%] sm:max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm mt-0.5 sm:mt-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600 ml-2 sm:ml-3' : 'bg-indigo-100 text-indigo-600 mr-2 sm:mr-3'}`}>
                    {msg.role === 'user' ? <User size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Bot size={18} className="sm:w-[20px] sm:h-[20px]" />}
                  </div>
                  <div className={`px-3.5 py-2.5 sm:px-5 sm:py-3.5 text-[15px] sm:text-base shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm'}`}>
                    {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
                    {msg.isAction && pendingAction && (
                        <div className="mt-3 bg-indigo-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-700 rounded-xl p-4 shadow-sm select-none">
                            {/* 【修改右上角的标签颜色】 */}
                            <div className="flex justify-between items-center mb-2">
                                <span className="font-bold text-slate-800 dark:text-slate-200">🤖 AI 自动化调仓单</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    pendingAction.actionType === 'buy' ? 'bg-red-100 text-red-600' : 
                                    pendingAction.actionType === 'sell' ? 'bg-green-100 text-green-600' : 
                                    'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                }`}>
                                    {pendingAction.actionType === 'buy' ? '买入' : pendingAction.actionType === 'sell' ? '卖出' : '撤销记录'}
                                </span>
                            </div>
                            
                            <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1 mb-4 font-mono">
                                <div>标的代码：<span className="font-bold text-indigo-600 dark:text-indigo-400">{pendingAction.fundCode}</span></div>
                                <div>标的名称：{pendingAction.fundName || '未知匹配'}</div>
                                <div>目标金额：<span className="font-bold text-slate-800 dark:text-slate-200">{pendingAction.amount} 元</span></div>
                                
                                {/* 【根据操作类型动态提示】 */}
                                <div className={`text-[11px] mt-2 p-1.5 rounded ${pendingAction.actionType === 'delete' ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/30' : 'text-indigo-500 bg-indigo-100/50 dark:bg-indigo-900/30'}`}>
                                  {pendingAction.actionType === 'delete' 
                                    ? '⚠️ 点击确认后，系统将寻找最近一笔匹配金额的记录进行剔除，并自动回滚资金与份额。' 
                                    : '⚡ 点击确认后，系统将自动抓取该基金实时净值并为您换算成精确份额入账。'}
                                </div>
                            </div>

                            <div className="flex space-x-3">
                                <button onClick={handleCancelAction} className="flex-1 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">驳回修改</button>
                                <button onClick={handleConfirmAction} className={`flex-1 py-1.5 rounded-lg text-white text-sm font-medium shadow-md transition-colors ${pendingAction.actionType === 'delete' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                                    {pendingAction.actionType === 'delete' ? '确认撤销该记录' : '确认并自动换算'}
                                </button>
                            </div>
                        </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex flex-row max-w-[80%]">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-indigo-100 text-indigo-600 mr-3">
                    <RefreshCw size={18} className="animate-spin" />
                  </div>
                  <div className="px-5 py-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"></span>
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="p-3 sm:p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0">
            <div className="flex items-end bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-1.5 focus-within:ring-2 focus-within:ring-indigo-500 transition-shadow">
            {/* 【关键修改4】在 textarea 左侧新增一个联网开关按钮 */}
            <button
              onClick={() => setUseWebSearch(!useWebSearch)}
              title={useWebSearch ? "联网搜索已开启 (耗时较长，适合查新闻)" : "联网搜索已关闭 (纯本地账本模式，秒回)"}
              className={`m-1 p-2.5 rounded-xl transition-colors shrink-0 flex items-center justify-center ${useWebSearch ? 'text-indigo-600 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-400 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700'}`}
            >
              <Globe size={20} className={useWebSearch ? '' : 'opacity-50'} />
            </button>
            <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="询问关于您的持仓建议..."
                className="flex-1 max-h-40 min-h-[50px] bg-transparent border-none focus:ring-0 resize-none p-3 text-sm sm:text-base dark:text-white outline-none"
                rows={1}
              />
              <button 
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="m-1.5 p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 shadow-sm"
              >
                <Send size={20} className={input.trim() && !isLoading ? 'translate-x-0.5 -translate-y-0.5 transition-transform' : ''} />
              </button>
            </div>
            <div className="text-center mt-2.5 text-xs text-slate-400">
              Shift + Enter 换行，Enter 发送。账本数据已脱敏注入。
            </div>
          </div>

        </div>
      </div>
    </>
  );
};
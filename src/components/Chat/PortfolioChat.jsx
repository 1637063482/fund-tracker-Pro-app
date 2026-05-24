import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
// 【关键修改1】引入 Globe 图标
import { MessageSquare, X, Send, RefreshCw, Trash2, Bot, User, Sparkles, Globe, Target, Brain, Activity } from 'lucide-react';
import { chatWithPortfolioAI } from '../../utils/ai';
// 【新增】引入 Firebase 数据库组件
import { doc, setDoc, onSnapshot, getDocs, collection, query, where, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';

// 【性能优化核心】将 Markdown 渲染器移出组件，避免每次渲染重复创建函数和执行正则
const renderMarkdown = (text) => {
  return text.split('\n').map((line, idx) => {
    if (!line.trim()) return <div key={idx} className="h-1"></div>;
    
    // 1. 处理 H3 标题
    if (line.startsWith('### ')) {
      return <h4 key={idx} className="font-bold text-indigo-700 dark:text-indigo-300 mt-2 mb-1 text-[13px]">{line.replace('### ', '')}</h4>;
    }
    
    let formattedLine = line;

    // 2. 🌟 核心修复：处理 Markdown 图片标签 ![alt](url)
    formattedLine = formattedLine.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g, 
      '<img src="$2" alt="$1" class="max-w-full h-auto object-contain rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 my-3 bg-white" loading="lazy" />'
    );
    // 3. 处理加粗
    formattedLine = formattedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return <div key={idx} className="mb-0.5 text-slate-700 dark:text-slate-300 leading-relaxed break-words max-w-full overflow-x-auto custom-scrollbar" dangerouslySetInnerHTML={{ __html: formattedLine }} />;
  });
};

// 【修改】接收 user 参数
export const PortfolioChat = ({ portfolioStats, settings, marketData, user, onAddTodo, onUpdateTodo, onDeleteTodo, todos }) => {
  // 🌟 核心修复：状态声明正确移入组件内部
  const [memos, setMemos] = useState([]); 

  // 🌟 核心修复：Effect 监听器正确移入组件内部
  useEffect(() => {
    if (!user || !db) return;
    const memosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'ai_memos');
    const unsubMemos = onSnapshot(query(memosRef), (snapshot) => {
      const data = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      setMemos(data);
    });
    return () => unsubMemos();
  }, [user]);

  const [isOpen, setIsOpen] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(true);
  // 🌟 核心新增 1：控制宏观雷达的开关状态
  const [enableMacroRadar, setEnableMacroRadar] = useState(false); 
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);

  // 🌟 新增：周五例行巡检黄条的显示状态
  const [showInspectionBanner, setShowInspectionBanner] = useState(false);

  // 🌟 新增：挂载时检测是否需要弹出巡检黄条
  useEffect(() => {
      const today = new Date();
      const isFriday = today.getDay() === 5; // 0是周日，5是周五
      
      if (isFriday) {
          const todayStr = today.toISOString().split('T')[0]; // 获取 YYYY-MM-DD
          const lastInspection = localStorage.getItem('last_inspection_date');
          
          // 如果今天是周五，且今天还没有执行过巡检，则弹出黄条
          if (lastInspection !== todayStr) {
              setShowInspectionBanner(true);
          }
      }
  }, []);

  // 🌟 新增：物理抹除 AI 记忆的函数
  const handleDeleteMemo = async (memoId) => {
      if (!window.confirm("确定要强行抹除 AI 的这条战略记忆吗？抹除后它将不再受此逻辑约束。")) return;
      try {
          await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'ai_memos', memoId));
      } catch (error) {
          alert(`删除失败: ${error.message}`);
      }
  };

// 🌟 新增：统一的巡检触发函数 (黄条和弹窗按钮共用)
  const handleTriggerInspection = useCallback(() => {
      // 1. 关闭所有提示和弹窗
      setShowInspectionBanner(false);
      setIsMemoModalOpen(false);
      
      // 2. 记录今天已巡检，本周五不再弹黄条
      const todayStr = new Date().toISOString().split('T')[0];
      localStorage.setItem('last_inspection_date', todayStr);
      
      // 3. 填入最高级系统指令
      const inspectionPrompt = "【系统自动触发：记忆库例行深度巡检】当前是例行维护日。请提取当前备忘录中的所有基金/资产代码，主动调用工具获取它们的最新精确净值与涨跌幅。然后，请使用 update_decision_memo 逐一覆写并更新那些包含‘过时时效性数字’（如：近1月收益、当前距离击球区的百分比、最新价格等）的记忆卡片。注意：除非基本面逻辑破裂，否则请保留原有的【战略定调】和【击球区阈值】。全部更新完毕后，请输出一份《记忆库洗盘与资产巡检报告》。";
      setInput(inspectionPrompt);
      
      // 4. 延迟 200ms 等待 React 状态更新后，模拟点击发送按钮
      setTimeout(() => {
          const sendBtn = document.getElementById('chat-send-btn');
          if (sendBtn) sendBtn.click();
      }, 200);
  }, []);

  const [messages, setMessages] = useState([
    { role: 'assistant', content: '您好！我是您的私人基金copilot。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？' }
  ]);
  const[input, setInput] = useState('');
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
    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: newMessages }, { merge: true }).catch(e => console.error(e));
    }

    try {
      const chatHistory = newMessages.filter((_, idx) => idx > 0 && idx < newMessages.length - 1);
      
      // 🌟 核心拦截：如果开启则下发授权口令，如果关闭则下发系统禁令，防止模型幻觉
      const activeMarketData = enableMacroRadar 
          ? "FETCH_NOW" 
          : "【系统指令：用户已手动关闭大盘雷达，本次对话进入纯净模式。严禁读取、臆测或分析任何 A股、债市的大盘宏观走势！请彻底抛弃大盘数据，完全基于用户的具体基金持仓和提问作答。】";         
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, activeMarketData, useWebSearch, todos, memos);
      
      
      let finalMessages;
      // 🌟 核心拦截：如果 AI 返回的是一个操作对象，而不是普通文本
      if (typeof reply === 'object' && reply.type === 'ACTION_REQUIRED') {
          // 👇==== 将这段 map 逻辑替换 ====👇
          const actionsWithStatus = reply.payload.map((act, idx) => ({
              ...act, // 展开 AI 传回来的所有字段 (包括真实的 id)
              cardId: `act_${Date.now()}_${idx}`, // 🌟 新增：专门给前端 UI 用的唯一标识，不再占用 id 字段！
              status: 'pending'
          }));
          
          finalMessages = [...newMessages, { 
              role: 'assistant', 
              content: reply.text || `已为您生成以下操作卡片，请逐一核对：`,
              isAction: true,
              actions: actionsWithStatus
          }];
      }else {
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

  // 🌟 核心升级：接收特定的 action 和 formData
  const handleConfirmAction = useCallback(async (action, formData = {}) => {
    if (!user || !db || !action) return;
    setIsLoading(true);
    
    try {
        if (typeof onAddTodo !== 'function') throw new Error("前端传参丢失：onAddTodo 未定义");

        // 🌟 新增：处理备忘录写入
        if (action.toolType === 'memo') {
            const memoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ai_memos', action.target);
            await setDoc(memoRef, {
                target: action.target,
                targetName: action.targetName,
                decisionType: action.decisionType,
                coreLogic: action.coreLogic,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } 
        else if (action.toolType === 'fof_dict') {
            const dictRef = doc(db, 'artifacts', appId, 'users', user.uid, 'fof_dict', action.fundCode);
            await setDoc(dictRef, {
                fundCode: action.fundCode,
                fundName: action.fundName,
                equityRatio: action.equityRatio,
                sectors: action.sectors,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        }
        else if (action.toolType === 'todo') {
            // 🌟 终极容错推断引擎：不信任大模型的字段，只看特征！
            let mType = 'add';
            const cleanId = action.id ? String(action.id).replace(/[^a-zA-Z0-9_-]/g, '') : null;

            if (action.manageType === 'delete' || action.actionType === 'delete') {
                mType = 'delete';
            } else if (action.manageType === 'update' || action.actionType === 'update') {
                mType = 'update';
            } else if (cleanId && !action.fundCode) {
                // 🚨 核心杀手锏：有ID无代码，绝对是在顺延旧计划，强行扭转为 update
                mType = 'update';
            }

            if (mType === 'add') {
                // 防御墙：拦截残缺参数，绝不产生空白行
                if (!action.fundCode || !action.fundName) {
                    throw new Error("大模型生成了无效的新增卡片 (丢失核心参数)，已安全拦截，请驳回修改。");
                }
                await onAddTodo({
                    type: 'ai_plan',
                    fundCode: action.fundCode,
                    fundName: action.fundName,
                    actionType: action.tradeDirection || action.actionType || 'observe',
                    amount: action.amount || 0,
                    condition: action.condition || '',
                    priority: action.priority || 'medium', // 🌟 新增：保存优先级
                    isCompleted: false,
                    createdAt: new Date().toISOString()
                });
            } else if (mType === 'update') {
                if (!cleanId) throw new Error("大模型未返回有效的待办ID，无法顺延/更新。");
                
                const updatePayload = { updatedAt: new Date().toISOString() };
                if (action.condition) updatePayload.condition = action.condition;
                if (action.amount !== undefined) updatePayload.amount = action.amount;
                if (action.priority) updatePayload.priority = action.priority; // 🌟 新增：支持更新优先级
                
                await onUpdateTodo(cleanId, updatePayload);
            } else if (mType === 'delete') {
                if (!cleanId) throw new Error("大模型未返回有效的待办ID，无法删除。");
                await onDeleteTodo(cleanId);
            }
        }
        else {
            const parsedAmount = Number(action.amount);
            const fundsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'funds');
            const q = query(fundsRef, where('fundCode', '==', action.fundCode));
            const querySnapshot = await getDocs(q);
            const todayStr = new Date().toISOString().split('T')[0];

            if (action.actionType === 'delete') {
                if (querySnapshot.empty) throw new Error("未找到该基金的持仓记录。");
                const fundDoc = querySnapshot.docs[0];
                const fundData = fundDoc.data();
                const transactions = fundData.transactions || [];
                const targetIndex = transactions.slice().reverse().findIndex(t => Number(t.amountRaw) === parsedAmount);
                if (targetIndex === -1) throw new Error(`未找到金额为 ${parsedAmount} 的记录。`);
                
                const realIndex = transactions.length - 1 - targetIndex;
                const targetTx = transactions[realIndex];
                transactions.splice(realIndex, 1);
                
                const fallbackNav = fundData.lastNav || 1;
                const sharesToRevert = Number((parsedAmount / fallbackNav).toFixed(2));
                let newShares = Number(fundData.shares || 0);
                if (targetTx.type === 'buy') newShares = Math.max(0, newShares - sharesToRevert);
                if (targetTx.type === 'sell') newShares += sharesToRevert;

                await updateDoc(fundDoc.ref, { transactions, shares: Number(newShares.toFixed(2)) });
                
                if (settings.idleFunds !== undefined) {
                    let newIdle = Number(settings.idleFunds);
                    if (targetTx.type === 'buy') newIdle += parsedAmount;
                    if (targetTx.type === 'sell') newIdle = Math.max(0, newIdle - parsedAmount);
                    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general'), { idleFunds: newIdle }, { merge: true });
                }
            } else {
                let currentNav = 1; 
                try {
                    const targetUrl = `https://danjuanfunds.com/djapi/fund/${action.fundCode}`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl) : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
                    const res = await fetch(fetchUrl);
                    const data = await res.json();
                    const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
                    const fetchedNav = parseFloat(actualData?.data?.fund_derived?.unit_nav);
                    if (!isNaN(fetchedNav) && fetchedNav > 0) currentNav = fetchedNav;
                } catch (e) { console.warn("净值抓取失败"); }

                const txDate = formData.date || todayStr;
                const feeAmount = Number(formData.fee) || 0;
                let sharesDelta = 0;
                
                if (formData.shares && Number(formData.shares) > 0) {
                    sharesDelta = Number(formData.shares);
                } else {
                    let netAmount = parsedAmount;
                    if (action.actionType === 'buy') netAmount -= feeAmount; 
                    if (action.actionType === 'sell') netAmount += feeAmount; 
                    sharesDelta = Number((netAmount / currentNav).toFixed(2));
                }

                const newTx = { id: Date.now().toString(), date: txDate, amountRaw: parsedAmount.toString(), type: action.actionType };

                if (!querySnapshot.empty) {
                    const fundDoc = querySnapshot.docs[0];
                    const fundData = fundDoc.data();
                    const updatedTransactions = [...(fundData.transactions || []), newTx];
                    let currentShares = Number(fundData.shares || 0);
                    if (action.actionType === 'buy') currentShares += sharesDelta;
                    else if (action.actionType === 'sell') currentShares = Math.max(0, currentShares - sharesDelta);
                    
                    await updateDoc(fundDoc.ref, { transactions: updatedTransactions, shares: Number(currentShares.toFixed(2)), lastNav: currentNav, lastNavDate: todayStr });
                } else {
                    const newFundRef = doc(fundsRef, Date.now().toString());
                    await setDoc(newFundRef, {
                        name: action.fundName || action.fundCode, fundCode: action.fundCode, mode: 'auto',
                        shares: action.actionType === 'buy' ? sharesDelta : 0, currentValueRaw: '0', currentValue: 0, isArchived: false,
                        lastNav: currentNav, lastNavDate: txDate, transactions: [newTx], updatedAt: new Date().toISOString()
                    });
                }

                if (settings.idleFunds !== undefined) {
                    let newIdle = Number(settings.idleFunds);
                    if (action.actionType === 'buy') newIdle = Math.max(0, newIdle - parsedAmount);
                    else if (action.actionType === 'sell') newIdle += parsedAmount;
                    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general'), { idleFunds: newIdle }, { merge: true });
                }
            }
        }

        // 🌟 终极绝杀：精确定位到消息数组中的那个 action，仅仅将它的状态改为 completed！
        setMessages(prev => {
            const newMsgs = prev.map(m => {
                if (m.isAction && m.actions) {
                    // 把 a.id === action.id 换成 a.cardId === action.cardId
                    return { ...m, actions: m.actions.map(a => a.cardId === action.cardId ? { ...a, status: 'completed' } : a) };
                }
                return m;
            });
            if (user && db) setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: newMsgs }, { merge: true }).catch(e=>e);
            return newMsgs;
        });

    } catch (e) {
        console.error("写入失败:", e);
        alert(`写入失败: ${e.message}\n请按 F12 查看控制台红字报错！`);
        setMessages(prev => {
            const newMsgs = prev.map(m => {
                if (m.isAction && m.actions) return { ...m, actions: m.actions.map(a => a.cardId === action.cardId ? { ...a, status: 'cancelled' } : a) };
                return m;
            });
            return [...newMsgs, { role: 'assistant', content: `❌ 操作失败: ${e.message}` }];
        });
    } finally {
        setIsLoading(false);
    }
  }, [user, settings, onAddTodo]); 

  // 精准取消函数
  const handleCancelAction = useCallback((action) => {
      setMessages(prev => {
          const newMsgs = prev.map(m => {
              if (m.isAction && m.actions) {
                  // 把 a.id === action.id 换成 a.cardId === action.cardId
                  return { ...m, actions: m.actions.map(a => a.cardId === action.cardId ? { ...a, status: 'cancelled' } : a) };
              }
              return m;
          });
          if (user && db) setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: newMsgs }, { merge: true }).catch(e=>e);
          return newMsgs;
      });
  }, [user]); // 添加 user 依赖

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

  // 【核心性能修复】使用 useMemo 阻断打字时触发的无效历史消息渲染
  const renderedMessages = useMemo(() => {
    return messages.map((msg, idx) => (
      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`flex max-w-[95%] sm:max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm mt-0.5 sm:mt-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600 ml-2 sm:ml-3' : 'bg-indigo-100 text-indigo-600 mr-2 sm:mr-3'}`}>
            {msg.role === 'user' ? <User size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Bot size={18} className="sm:w-[20px] sm:h-[20px]" />}
          </div>
          <div className={`px-3.5 py-2.5 sm:px-5 sm:py-3.5 text-[15px] sm:text-base shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm'}`}>
            {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
            
            {/* 🌟 核心：遍历 msg.actions 渲染多个卡片 */}
            {msg.isAction && msg.actions && msg.actions.map(action => (
                <ActionCard 
                    key={action.cardId}
                    action={action} 
                    onConfirm={handleConfirmAction} 
                    onCancel={handleCancelAction} 
                    todos={todos}
                />
            ))}
          </div>
        </div>
      </div>
    ));
}, [messages, handleCancelAction, handleConfirmAction]);

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
          // 🌟 UI升级：高度从 85vh 提升到 90vh，宽度从 max-w-3xl 提升到 max-w-5xl (最高可达1024px，极其宽敞)
          className={`w-full h-[100dvh] sm:h-[95vh] sm:max-w-7xl bg-white dark:bg-slate-800 sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden transform transition-all duration-300 sm:border border-slate-100 dark:border-slate-700 ${isOpen ? 'scale-100 translate-y-0' : 'sm:scale-95 translate-y-full sm:translate-y-8'}`}
          onClick={e => e.stopPropagation()}
        >
          
          {/* 头部 */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-4 sm:p-5 flex justify-between items-center text-white shrink-0 shadow-md relative z-10">
            <div className="flex items-center">
              <Sparkles size={22} className="mr-2" />
              <span className="font-bold text-lg">投资copilot</span>
            </div>
            <div className="flex items-center space-x-2">
             <button onClick={() => setIsMemoModalOpen(true)} title="管理 AI 长期记忆" className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors relative">
                <Brain size={18} />
                {/* 如果有记忆，显示一个小红点数量 */}
                {memos.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 border border-indigo-600 text-[9px] font-bold">
                        {memos.length}
                    </span>
                )}
              </button>
              <button onClick={handleClear} title="开启新对话 (防幻觉)" className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"><Trash2 size={18} /></button>
              <button onClick={() => setIsOpen(false)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"><X size={18} /></button>
            </div>
          </div>

{/* 🌟 新增：周五例行巡检醒目黄条 */}
          {showInspectionBanner && (
              <div className="bg-amber-100 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between shadow-sm shrink-0 z-10 animate-in slide-in-from-top-2">
                  <div className="flex items-center text-amber-800 text-[13px] sm:text-sm font-medium">
                      <span className="text-lg mr-2">⚠️</span>
                      距离上次记忆库维护已过一周，建议立即执行例行巡检洗盘。
                  </div>
                  <div className="flex items-center space-x-2 shrink-0 ml-2">
                      <button 
                          onClick={handleTriggerInspection}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm transition-colors whitespace-nowrap"
                      >
                          立即巡检
                      </button>
                      <button 
                          onClick={() => setShowInspectionBanner(false)}
                          className="p-1.5 text-amber-600 hover:bg-amber-200 hover:text-amber-700 rounded-lg transition-colors"
                      >
                          <X size={16} />
                      </button>
                  </div>
              </div>
          )}

          {/* 消息列表区 */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-5 bg-slate-50 dark:bg-slate-900 custom-scrollbar relative">
            
            {/* 🌟 这里直接使用我们缓存好的渲染列表 */}
            {renderedMessages}

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
            
            {/* 🌟 核心新增 3：宏观雷达开关按钮 */}
            <button
              onClick={() => setEnableMacroRadar(!enableMacroRadar)}
              title={enableMacroRadar ? "双核盘口探针：已开启 (精准诊断大盘，耗 Token)" : "双核盘口探针：已关闭 (纯净省流模式)"}
              className={`m-1 p-2.5 rounded-xl transition-colors shrink-0 flex items-center justify-center ${enableMacroRadar ? 'text-blue-600 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400' : 'text-slate-400 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700'}`}
            >
              <Activity size={20} className={enableMacroRadar ? 'animate-pulse' : 'opacity-50'} />
            </button>

            {/* 联网开关按钮 */}
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
                className="flex-1 max-h-40 min-h-[50px] bg-transparent border-none focus:ring-0 resize-none p-3 text-sm sm:text-base dark:text-white outline-none custom-scrollbar"
                rows={1}
              />
              <button 
                id="chat-send-btn"
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

          {/* 🌟 新增：AI 战略记忆库弹窗 */}
          {isMemoModalOpen && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsMemoModalOpen(false)}>
              <div className="w-full max-w-lg bg-slate-50 dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
                  <h3 className="font-bold flex items-center text-slate-800 dark:text-slate-200">
                      <Brain className="mr-2 text-purple-500" size={20}/> 
                      AI 专属战略记忆库
                  </h3>
                  <div className="flex items-center space-x-2">
                      {/* 🌟 新增：例行巡检按钮 */}
                      <button 
                          onClick={handleTriggerInspection} 
                          className="flex items-center px-3 py-1.5 text-xs font-bold bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 rounded-lg transition-colors"
                      >
                          <RefreshCw size={14} className="mr-1.5" />
                          例行巡检
                      
                      </button>
                      <button onClick={() => setIsMemoModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"><X size={18}/></button>
                  </div>
                </div>

                <div className="p-4 overflow-y-auto max-h-[60vh] space-y-3 custom-scrollbar">
                  {memos.length === 0 ? (
                      <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                          <Brain size={48} className="opacity-20 mb-3" />
                          <span>AI 当前的大脑一片空白，没有长期战略记忆。</span>
                      </div>
                  ) : (
                      memos.map(memo => (
                          <div key={memo.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-purple-100 dark:border-purple-800/30 shadow-sm relative group transition-all hover:shadow-md">
                              
                              <button 
                                onClick={() => handleDeleteMemo(memo.id)} 
                                title="抹除此记忆"
                                className="absolute top-3 right-3 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-50 hover:bg-red-50 dark:bg-slate-900 dark:hover:bg-red-900/30 p-1.5 rounded-lg"
                              >
                                  <Trash2 size={16}/>
                              </button>

                              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1 pr-8">
                                  {memo.targetName} <span className="text-slate-400 font-mono text-xs font-normal">({memo.target})</span>
                              </div>
                              <div className="text-xs text-purple-600 dark:text-purple-400 font-bold mb-2 inline-block bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded">
                                  定调方向: {memo.decisionType}
                              </div>
                              <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700/50">
                                  {memo.coreLogic}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-3 text-right">
                                  最后觉醒于: {new Date(memo.updatedAt).toLocaleString('zh-CN')}
                              </div>
                          </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}

        </div> {/* 整个聊天框大界面的 div 闭合处 */}
      </div> {/* 遮罩层的 div 闭合处 */}
    </>
  );
};

// 🌟 支持多实例并发与“原计划反查”的优化版 ActionCard
const ActionCard = ({ action, onConfirm, onCancel, todos = [] }) => { // 🌟 优化1：增加 todos 传参
    const [form, setForm] = useState({
        date: action.date || new Date().toISOString().split('T')[0],
        feeInput: '',
        shares: ''
    });
    const [feeMode, setFeeMode] = useState('rate');
    
    const isPending = action.status === 'pending';
    const rawAmount = Number(action.amount) || 0;

    // 🌟 优化2：核心反查逻辑。如果是修改/删除，去本地待办列表里找到原计划的数据
    let targetTodo = null;
    if (action.toolType === 'todo' && action.todoId) {
        targetTodo = todos.find(t => t.id === action.todoId);
    }

    const handleConfirmClick = () => {
        let finalFeeAmount = 0;
        const inputVal = Number(form.feeInput);
        if (!isNaN(inputVal) && inputVal > 0) {
            finalFeeAmount = feeMode === 'rate' ? rawAmount * (inputVal / 100) : inputVal;
        }
        onConfirm(action, { date: form.date, fee: finalFeeAmount, shares: form.shares });
    };

    return (
        <div className={`mt-3 border rounded-xl p-4 shadow-sm select-none transition-all duration-500 ${
            action.status === 'completed' ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800/50 opacity-90' :
            action.status === 'cancelled' ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-60 grayscale' :
            'bg-indigo-50 dark:bg-slate-900 border-indigo-200 dark:border-indigo-700'
        }`}>
            <div className="flex justify-between items-center mb-3">
                        <span className={`font-bold flex items-center ${action.status === 'completed' ? 'text-green-700 dark:text-green-400' : action.status === 'cancelled' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                            {action.status === 'completed'
                                ? (action.toolType === 'memo' ? '✅ 记忆已存入大脑' : action.toolType === 'fof_dict' ? '✅ 底层穿透已入库' : '✅ 调仓/计划已处理')
                                : action.status === 'cancelled'
                                ? '⛔ 操作已撤销'
                                : (action.toolType === 'memo' ? '🧠 AI 战略备忘录' : action.toolType === 'fof_dict' ? '🧬 FOF 资产穿透' : action.toolType === 'todo' ? '📅 AI 交易计划单' : '🤖 AI 自动化单据')}
                        </span>

                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            action.status === 'completed' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
                            action.status === 'cancelled' ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' :
                            (action.toolType === 'memo' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30' :
                            action.toolType === 'fof_dict' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30' : // 🌟 为 X-Ray 字典分配科技蓝色标签
                            (action.manageType === 'delete' || action.actionType === 'delete') ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400' :
                            (action.manageType === 'update' || action.actionType === 'update') ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' :
                            (action.tradeDirection === 'buy' || action.actionType === 'buy') ? 'bg-red-100 text-red-600 dark:bg-red-900/30' :
                            (action.tradeDirection === 'sell' || action.actionType === 'sell') ? 'bg-green-100 text-green-600 dark:bg-green-900/30' :
                            'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300')
                        }`}>
                            {action.toolType === 'memo' ? '战略定调' :
                             action.toolType === 'fof_dict' ? 'X-Ray 字典' : // 🌟 右上角小徽章文字
                             (action.manageType === 'delete' || action.actionType === 'delete') ? '计划废除' :
                             (action.manageType === 'update' || action.actionType === 'update') ? '计划顺延' :
                             (action.tradeDirection === 'buy' || action.actionType === 'buy') ? '买入' :
                             (action.tradeDirection === 'sell' || action.actionType === 'sell') ? '卖出' : '操作记录'}
                        </span>
                    </div>
            
            <div className={`text-sm space-y-1 font-mono ${action.status === 'completed' ? 'text-green-800/70 dark:text-green-200/70' : action.status === 'cancelled' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-600 dark:text-slate-400'}`}>
                
                {/* 🌟 优化3：名字和代码支持从 targetTodo 反查回显！ */}
                <div>标的代码：<span className={isPending ? 'font-bold text-indigo-600 dark:text-indigo-400' : ''}>{action.fundCode || action.target || targetTodo?.fundCode}</span></div>
                <div>标的名称：{action.fundName || action.targetName || targetTodo?.fundName || '未知匹配'}</div>
                
                {/* 💳 1. 记账单专属显示 */}
                {action.toolType === 'ledger' && <div>目标金额：<span className={isPending ? 'font-bold text-slate-800 dark:text-slate-200' : ''}>{action.amount} 元</span></div>}

                {/* 📝 2. 待办单专属显示 */}
                {action.toolType === 'todo' && (
                   <div className="mt-2 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-100 dark:border-amber-800/30 relative overflow-hidden">
                     
                     {/* 🌟 新增：在卡片右上角显示 AI 评定的优先级 */}
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

                {/* 🧠 3. 备忘录专属显示 */}
                {action.toolType === 'memo' && (
                   <div className="mt-2 bg-purple-50 dark:bg-purple-900/20 p-2 rounded-lg border border-purple-200 dark:border-purple-800/50">
                     <div className="text-purple-700 dark:text-purple-300 mb-1">战略方向：<span className="font-bold">{action.decisionType}</span></div>
                     <div className="text-slate-600 dark:text-slate-400 whitespace-normal leading-relaxed">核心逻辑：{action.coreLogic}</div>
                   </div>
                )}

                {/* 🔍 4. FOF 穿透字典专属显示 */}
                {action.toolType === 'fof_dict' && (
                   <div className="mt-2 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800/50">
                     <div className="text-blue-700 dark:text-blue-300 font-bold mb-2 border-b border-blue-200/50 pb-1">
                         真实权益仓位：<span className="text-lg">{(action.equityRatio * 100).toFixed(2)}%</span>
                     </div>
                     <div className="text-slate-600 dark:text-slate-400 text-xs space-y-1">
                         {Object.entries(action.sectors || {}).map(([sec, ratio]) => (
                             <div key={sec} className="flex justify-between items-center">
                                 <span>{sec}</span>
                                 <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{(ratio * 100).toFixed(2)}%</span>
                             </div>
                         ))}
                     </div>
                   </div>
                )}

                {/* 仅记账单处于 pending 时，才渲染具体的交易表单 */}
                {isPending && action.toolType === 'ledger' && action.actionType !== 'delete' && (
                    <div className="mt-3 p-3 bg-white/50 dark:bg-slate-950/30 rounded-lg border border-indigo-100 dark:border-indigo-800/50 space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400 font-medium">交易日期:</span>
                            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-[130px] outline-none" />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center text-slate-600 dark:text-slate-400 font-medium">
                                预估手续费:
                                <button onClick={() => setFeeMode(feeMode === 'rate' ? 'amount' : 'rate')} className="ml-2 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 hover:bg-indigo-200 active:scale-95">{feeMode === 'rate' ? '按费率(%) ⇄' : '按金额(元) ⇄'}</button>
                            </div>
                            <div className="relative">
                                <input type="number" placeholder={feeMode === 'rate' ? "0.15" : "0.00"} value={form.feeInput} onChange={e => setForm({...form, feeInput: e.target.value})} className="border border-slate-200 dark:border-slate-700 rounded py-1 pl-2 pr-6 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-[90px] outline-none text-right" />
                                <span className="absolute right-2 top-1 text-slate-400">{feeMode === 'rate' ? '%' : '元'}</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">实际确认份额:</span>
                            <input type="number" placeholder="留空按净值估算" value={form.shares} onChange={e => setForm({...form, shares: e.target.value})} className="border border-indigo-200 dark:border-indigo-700 rounded px-2 py-1 bg-indigo-50/50 text-indigo-700 w-32 outline-none font-bold text-right" />
                        </div>
                    </div>
                )}
            </div>

            {isPending && (
                <div className="flex space-x-3 mt-4">
                    <button onClick={() => onCancel(action)} className="flex-1 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">驳回修改</button>
                    <button onClick={handleConfirmClick} className={`flex-1 py-1.5 rounded-lg text-white text-sm font-medium shadow-md transition-colors ${
                        action.toolType === 'memo' ? 'bg-purple-600 hover:bg-purple-700' : 
                        action.toolType === 'fof_dict' ? 'bg-blue-600 hover:bg-blue-700' : 
                        action.toolType === 'todo' ? (action.manageType === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600') : 
                        (action.actionType === 'delete' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700')
                    }`}>
                        {action.toolType === 'memo' ? '确认写入长期记忆' : 
                         action.toolType === 'fof_dict' ? '确认写入云端字典' :
                         action.toolType === 'todo' ? (action.manageType === 'delete' ? '确认废除此计划' : action.manageType === 'update' ? '确认顺延/更新计划' : '确认加入待办') : 
                         (action.actionType === 'delete' ? '确认撤销记录' : '确认并入账')}
                    </button>
                </div>
            )}
        </div>
    );
};
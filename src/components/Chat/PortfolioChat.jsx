import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MessageSquare, X, Send, RefreshCw, Trash2, Bot, User, Sparkles, Globe, Target, Brain, Activity, Paperclip, Edit, Check } from 'lucide-react';
import { chatWithPortfolioAI } from '../../utils/ai';
import { extractDataFromImage } from '../../services/fileParser';
import { renderMarkdown } from '../../utils/renderMarkdown';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ActionCard } from './ActionCard';
import { dispatchAction } from './actionHandlers';
import { ImageModal } from '../UI/ImageModal';
import { doc, setDoc, onSnapshot, collection, query, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';

export const PortfolioChat = ({ portfolioStats, settings, marketData, user, onAddTodo, onUpdateTodo, onDeleteTodo, todos }) => {
  // 🌟 核心修复：状态声明正确移入组件内部
  const [memos, setMemos] = useState([]);
  const sendBtnRef = useRef(null); 

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
  useScrollLock(isOpen);
  const focusRef = useFocusTrap(isOpen);
  const [useWebSearch, setUseWebSearch] = useState(true);
  // 🌟 核心新增 1：控制宏观雷达的开关状态
  const [enableMacroRadar, setEnableMacroRadar] = useState(false); 
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null); // 图片放大查看

  // 🌟 核心新增：附件与预览状态
  const [attachment, setAttachment] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  // 🌟 新增：OCR 视觉引擎切换状态 (默认 gemini)
  const [ocrEngine, setOcrEngine] = useState('gemini');

  const handleFileChange = (e) => {
      const file = e.target.files[0];
      if (file) {
          setAttachment(file);
          setPreviewUrl(URL.createObjectURL(file));
      }
  };

  const removeAttachment = () => {
      setAttachment(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 🌟 新增：周五例行巡检黄条的显示状态
  const [showInspectionBanner, setShowInspectionBanner] = useState(false);

  // 🌟 周五例行巡检黄条：从 Firestore 读取状态，跨设备同步
  useEffect(() => {
      const today = new Date();
      const isFriday = today.getDay() === 5;
      const todayStr = today.toISOString().split('T')[0];
      const lastInspection = settings.lastInspectionDate;

      if (isFriday && lastInspection !== todayStr) {
          setShowInspectionBanner(true);
      } else {
          setShowInspectionBanner(false);
      }
  }, [settings.lastInspectionDate]);

  // 🌟 新增：物理抹除 AI 记忆的函数
  const handleDeleteMemo = async (memoId) => {
      if (!window.confirm("确定要强行抹除 AI 的这条战略记忆吗？抹除后它将不再受此逻辑约束。")) return;
      try {
          await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'ai_memos', memoId));
      } catch (error) {
          alert(`删除失败: ${error.message}`);
      }
  };

  // 🌟 新增：备忘录编辑状态
  const [editingMemoId, setEditingMemoId] = useState(null);
  const [editMemoForm, setEditMemoForm] = useState({ decisionType: '', coreLogic: '' });

  // 🌟 新增：保存人工修改的备忘录
  const handleSaveMemoEdit = async (memoId) => {
      if (!editMemoForm.coreLogic.trim()) return;
      try {
          const memoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ai_memos', memoId);
          await updateDoc(memoRef, {
              decisionType: editMemoForm.decisionType,
              coreLogic: editMemoForm.coreLogic.trim(),
              updatedAt: new Date().toISOString()
          });
          setEditingMemoId(null); // 退出编辑模式
      } catch (error) {
          alert(`保存修改失败: ${error.message}`);
      }
  };

// 🌟 新增：统一的巡检触发函数 (黄条和弹窗按钮共用)
  const handleTriggerInspection = useCallback(async () => {
      // 1. 关闭所有提示和弹窗
      setShowInspectionBanner(false);
      setIsMemoModalOpen(false);
      
      // 2. 记录今天已巡检到 Firestore（跨设备同步），本周五不再弹黄条
      const todayStr = new Date().toISOString().split('T')[0];
      try {
        const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general');
        await setDoc(settingsRef, { lastInspectionDate: todayStr }, { merge: true });
      } catch (e) {
        console.error('写入巡检日期失败:', e);
      }
      
      // 3. 填入最高级系统指令
      const inspectionPrompt = "【系统自动触发：记忆库例行深度巡检】当前是例行维护日。请提取当前备忘录中的所有基金/资产代码，主动调用工具获取它们的最新精确净值与涨跌幅。然后，请使用 update_decision_memo 逐一覆写并更新那些包含‘过时时效性数字’（如：近1月收益、当前距离击球区的百分比、最新价格等）的记忆卡片。注意：除非基本面逻辑破裂，否则请保留原有的【战略定调】和【击球区阈值】。全部更新完毕后，请输出一份《记忆库洗盘与资产巡检报告》。";
      setInput(inspectionPrompt);
      
      // 4. 延迟 200ms 等待 React 状态更新后触发发送
      setTimeout(() => {
          sendBtnRef.current?.click();
      }, 200);
  }, []);

  const [messages, setMessages] = useState([
    { role: 'assistant', content: '您好！我是您的私人基金copilot。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？' }
  ]);
  const[input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null); // { type:'thinking'|'tool', label, tool?, round? }
   const messagesEndRef = useRef(null);

  // 🌟 修复：精准控制滚动时机，防止确认卡片时画面乱跳
  const prevMsgLengthRef = useRef(messages.length);
  const prevIsOpenRef = useRef(isOpen);

  useEffect(() => {
    // 场景 1：聊天框刚刚被打开
    if (isOpen && !prevIsOpenRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // 场景 2：消息数组的“长度”增加了（发送了新消息或AI回复了新消息）
    else if (isOpen && messages.length > prevMsgLengthRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // 更新历史记录
    prevMsgLengthRef.current = messages.length;
    prevIsOpenRef.current = isOpen;
  }, [messages.length, isOpen]); // 🚨 核心：依赖项换成 messages.length，彻底剔除 isLoading 和整体 messages 对象

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
    // 🌟 修改：允许不打字只发图片
    if ((!input.trim() && !attachment) || isLoading) return;
    const userMessage = input.trim();
    setInput('');
    
    // 生成用户消息
    const newMessages = [...messages, { role: 'user', content: userMessage || '请帮我分析这张图片中的数据。' }];
    setMessages(newMessages);
    setIsLoading(true);

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: newMessages }, { merge: true }).catch(e => console.error(e));
    }

    // 🌟 核心拦截层：如果有附件，先走 OCR/解析，不调用 AI
    if (attachment) {
        try {
            // 🌟 新增：将当前选择的引擎传给底层解析器
            const extractedText = await extractDataFromImage(attachment, settings, ocrEngine);
            
            const actionCard = {
                cardId: `act_${Date.now()}_ocr`,
                type: 'ACTION_REQUIRED',
                toolType: 'data_confirmation',
                status: 'pending',
                extractedText: extractedText,
                originalMessage: userMessage,
                // previewUrl: previewUrl
            };
            
            const finalMessages = [...newMessages, { 
                role: 'assistant', 
                content: `我已经为您解析了上传的文件。为确保交易决策基于**绝对真实的数据**，请您先核对以下提取内容，确认无误后再交由大脑进行深度分析：`,
                isAction: true,
                actions: [actionCard]
            }];
            
            setMessages(finalMessages);
            removeAttachment(); // 发送后清空附件
            
            if (user && db) {
                setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history'), { messages: finalMessages }, { merge: true }).catch(e => console.error(e));
            }
        } catch (e) {
            setMessages([...newMessages, { role: 'assistant', content: `❌ 文件解析失败: ${e.message}` }]);
        } finally {
            setIsLoading(false);
        }
        return; // 🚨 阻断！在这里停止执行，等待用户确认卡片
    }

    try {
      const chatHistory = newMessages.filter((_, idx) => idx > 0 && idx < newMessages.length - 1);
      
      // 🌟 核心拦截：如果开启则下发授权口令，如果关闭则下发系统禁令，防止模型幻觉
      const activeMarketData = enableMacroRadar 
          ? "FETCH_NOW" 
          : "【系统指令：用户已手动关闭大盘雷达，本次对话进入纯净模式。严禁读取、臆测或分析任何 A股、债市的大盘宏观走势！请彻底抛弃大盘数据，完全基于用户的具体基金持仓和提问作答。】";         
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, activeMarketData, useWebSearch, todos, memos, setAiStatus);
      setAiStatus(null);

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

  const handleConfirmAction = useCallback(async (action, formData = {}) => {
    if (!user || !db || !action) return;
    if (typeof onAddTodo !== 'function') throw new Error("前端传参丢失：onAddTodo 未定义");
    setIsLoading(true);
    try {
      await dispatchAction(action, formData, {
        user, settings,
        setMessages, setIsLoading,
        onAddTodo, onUpdateTodo, onDeleteTodo,
        enableMacroRadar, useWebSearch,
        portfolioStats, todos, memos, messages,
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
  }, [user, settings, onAddTodo, onUpdateTodo, onDeleteTodo, enableMacroRadar, useWebSearch, portfolioStats, todos, memos, messages]);

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
          ref={focusRef}
          className={`w-full h-[100dvh] sm:h-[95vh] sm:max-w-7xl bg-white dark:bg-slate-800 sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden transform transition-all duration-300 sm:border border-slate-100 dark:border-slate-700 safe-top ${isOpen ? 'scale-100 translate-y-0' : 'sm:scale-95 translate-y-full sm:translate-y-8'}`}
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
          <div
            className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-5 bg-slate-50 dark:bg-slate-900 custom-scrollbar relative"
            onClick={(e) => {
              if (e.target.tagName === 'IMG' && e.target.dataset.zoomable === 'true') {
                setZoomedImage({ src: e.target.src, alt: e.target.alt });
              }
            }}
          >
            
            {/* 🌟 这里直接使用我们缓存好的渲染列表 */}
            {renderedMessages}

            {isLoading && (
              <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-row max-w-[85%]">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 mr-3">
                    {aiStatus?.type === 'tool'
                      ? <Activity size={18} className="animate-pulse" />
                      : <RefreshCw size={18} className="animate-spin" />
                    }
                  </div>
                  <div className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm">
                    {aiStatus ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-600 dark:text-slate-300">{aiStatus.label}</span>
                        {aiStatus.type === 'thinking' && (
                          <span className="flex space-x-1">
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                          </span>
                        )}
                        {aiStatus.type === 'tool' && (
                          <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full font-mono">{aiStatus.round ? 'R' + aiStatus.round : ''}</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center space-x-1.5">
                        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="p-3 sm:p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0 relative safe-bottom">
            
            {/* 🌟 新增：OCR 引擎切换开关 (仅在选择了附件时显示，保持界面清爽) */}
            {attachment && (
                <div className="absolute -top-[90px] left-6 flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm animate-in fade-in">
                    <button 
                        onClick={() => setOcrEngine('gemini')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${ocrEngine === 'gemini' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <Sparkles size={12} className="inline mr-1 mb-0.5"/> Gemini 视觉
                    </button>
                </div>
            )}

            {/* 🌟 核心新增 4：附件预览区 */}
            {previewUrl && (
                <div className="absolute -top-16 left-6 p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg flex items-center animate-in fade-in slide-in-from-bottom-2">
                    <img src={previewUrl} alt="预览" className="h-12 w-12 object-cover rounded-lg mr-2" />
                    <div className="flex flex-col mr-2 text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">{attachment?.name}</span>
                        <span className="text-slate-400">{ocrEngine === 'gemini' ? 'Gemini 待命' : 'Deepseek 待命'}</span>
                    </div>
                    <button onClick={removeAttachment} className="p-1 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 dark:bg-slate-700 dark:hover:bg-red-900/30 rounded-full transition-colors">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* 🌟 核心优化：上下流式输入框布局 */}
            <div className="flex flex-col bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-2 focus-within:ring-2 focus-within:ring-indigo-500 transition-shadow">
            
              {/* 隐藏的 File Input */}
              <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept="image/*,application/pdf" 
              />
              
              {/* 1. 上半部分：文字输入区，独占一行 */}
              <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="询问关于您的持仓建议..."
                  className="w-full max-h-40 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none px-3 py-2 text-sm sm:text-base dark:text-white outline-none custom-scrollbar"
                  rows={1}
              />

              {/* 2. 下半部分：操作底栏 */}
              <div className="flex items-center justify-between mt-1 px-1">
                
                {/* 左侧：工具功能组 */}
                <div className="flex items-center space-x-1.5 sm:space-x-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="上传走势截图或研报"
                    className="p-2 rounded-xl transition-colors text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-400"
                  >
                    <Paperclip size={18} />
                  </button>

                  <button
                    onClick={() => setEnableMacroRadar(!enableMacroRadar)}
                    title={enableMacroRadar ? "双核盘口探针：已开启 (精准诊断大盘，耗 Token)" : "双核盘口探针：已关闭 (纯净省流模式)"}
                    className={`p-2 rounded-xl transition-colors ${enableMacroRadar ? 'text-blue-600 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                  >
                    <Activity size={18} className={enableMacroRadar ? 'animate-pulse' : 'opacity-50'} />
                  </button>

                  <button
                    onClick={() => setUseWebSearch(!useWebSearch)}
                    title={useWebSearch ? "联网搜索已开启 (耗时较长，适合查新闻)" : "联网搜索已关闭 (纯本地账本模式，秒回)"}
                    className={`p-2 rounded-xl transition-colors ${useWebSearch ? 'text-indigo-600 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                  >
                    <Globe size={18} className={useWebSearch ? '' : 'opacity-50'} />
                  </button>
                </div>

                {/* 右侧：发送按钮 (修复了仅传图片无法发送的逻辑) */}
                <button
                  ref={sendBtnRef}
                  onClick={handleSend}
                  disabled={isLoading || (!input.trim() && !attachment)}
                  className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <Send size={18} className={(input.trim() || attachment) && !isLoading ? 'translate-x-[1px] -translate-y-[1px] transition-transform' : ''} />
                </button>
              </div>

            </div>

            <div className="text-center mt-2 text-xs text-slate-400">
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
                              
                              {/* 🌟 判断是否处于编辑模式 */}
                              {editingMemoId === memo.id ? (
                                  <div className="space-y-3">
                                      <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                          {memo.targetName} <span className="text-slate-400 font-mono text-xs font-normal">({memo.target})</span>
                                      </div>
                                      
                                      <select 
                                          value={editMemoForm.decisionType}
                                          onChange={(e) => setEditMemoForm({...editMemoForm, decisionType: e.target.value})}
                                          className="w-full p-2 text-xs border border-purple-200 dark:border-purple-700 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-bold outline-none focus:ring-2 focus:ring-purple-500"
                                      >
                                          <option value="BUY_STRATEGY">BUY_STRATEGY (战略看多/底仓)</option>
                                          <option value="WATCH_GRID">WATCH_GRID (网格震荡/波段)</option>
                                          <option value="HOLD_STRATEGY">HOLD_STRATEGY (持有观望)</option>
                                          <option value="BLACK_LIST">BLACK_LIST (黑名单/不碰)</option>
                                          <option value="GLOBAL_MACRO">GLOBAL_MACRO (宏观大盘定调)</option>
                                      </select>

                                      <textarea 
                                          value={editMemoForm.coreLogic}
                                          onChange={(e) => setEditMemoForm({...editMemoForm, coreLogic: e.target.value})}
                                          className="w-full p-2.5 text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 min-h-[100px] custom-scrollbar"
                                      />

                                      <div className="flex justify-end space-x-2 pt-1">
                                          <button 
                                              onClick={() => setEditingMemoId(null)}
                                              className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
                                          >
                                              取消
                                          </button>
                                          <button 
                                              onClick={() => handleSaveMemoEdit(memo.id)}
                                              className="flex items-center px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-md shadow-sm transition-colors"
                                          >
                                              <Check size={14} className="mr-1" /> 保存修改
                                          </button>
                                      </div>
                                  </div>
                              ) : (
                                  <>
                                      {/* 默认的只读展示模式 */}
                                      {/* 🌟 核心修复：手机端常显(opacity-100)，PC端悬浮(sm:opacity-0)，提升层级(z-10) */}
                                      <div className="absolute top-3 right-3 flex space-x-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10">
                                          <button 
                                              onClick={() => {
                                                  setEditingMemoId(memo.id);
                                                  setEditMemoForm({ decisionType: memo.decisionType, coreLogic: memo.coreLogic });
                                              }} 
                                              title="人工修改记忆"
                                              className="text-slate-500 hover:text-blue-500 bg-slate-100 hover:bg-blue-50 dark:text-slate-400 dark:bg-slate-700/80 dark:hover:bg-blue-900/30 p-2 rounded-lg transition-colors shadow-sm active:scale-90"
                                          >
                                              <Edit size={16}/>
                                          </button>
                                          <button 
                                              onClick={() => handleDeleteMemo(memo.id)} 
                                              title="抹除此记忆"
                                              className="text-slate-500 hover:text-red-500 bg-slate-100 hover:bg-red-50 dark:text-slate-400 dark:bg-slate-700/80 dark:hover:bg-red-900/30 p-2 rounded-lg transition-colors shadow-sm active:scale-90"
                                          >
                                              <Trash2 size={16}/>
                                          </button>
                                      </div>

                                      {/* 为了防止文字与放大的常显按钮重叠，把 pr-16 扩大到 pr-20 */}
                                      <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1 pr-20">
                                          {memo.targetName} <span className="text-slate-400 font-mono text-xs font-normal">({memo.target})</span>
                                      </div>
                                      <div className="text-xs text-purple-600 dark:text-purple-400 font-bold mb-2 inline-block bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded shadow-sm">
                                          定调方向: {memo.decisionType}
                                      </div>
                                      <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700/50">
                                          {memo.coreLogic}
                                      </div>
                                      <div className="text-[10px] text-slate-400 mt-3 text-right">
                                          最后修改于: {new Date(memo.updatedAt).toLocaleString('zh-CN')}
                                      </div>
                                  </>
                              )}
                          </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}

        </div> {/* 整个聊天框大界面的 div 闭合处 */}
      </div> {/* 遮罩层的 div 闭合处 */}

      {/* 图片放大查看器 */}
      {zoomedImage && (
        <ImageModal
          src={zoomedImage.src}
          alt={zoomedImage.alt}
          onClose={() => setZoomedImage(null)}
        />
      )}

    </>
  );
};
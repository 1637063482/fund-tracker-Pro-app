// Hook: Chat messages management extracted from PortfolioChat.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, appId } from '../config/firebase';
import { chatWithPortfolioAI } from '../utils/ai';
import { extractDataFromImage } from '../services/fileParser';
import { handleScoreRecord } from '../components/Chat/actionHandlers';
import { debugLog } from '../utils/debugLog';

export function useChatMessages(
  user, settings, portfolioStats, marketData,
  todos, memos, activeConvId, persistConversation, setConvLoading,
  conversations, useWebSearch, enableMacroRadar, ocrEngine
) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '您好！我是您的私人基金Copilot。我已经读取了您当前的全部持仓和流水，以及您手持的空闲资金。请问有什么可以帮您？', timestamp: new Date().toISOString() }
  ]);
  const [input, setInput] = useState('');
  const [aiStatus, setAiStatus] = useState(null);
  const messagesEndRef = useRef(null);
  const activeConvIdRef = useRef(activeConvId);
  const pendingConvIdRef = useRef(null);
  const portfolioStatsRef = useRef(portfolioStats);
  portfolioStatsRef.current = portfolioStats;
  const todosRef = useRef(todos);
  todosRef.current = todos;
  const memosRef = useRef(memos);
  memosRef.current = memos;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const [zoomedImage, setZoomedImage] = useState(null);

  // Scroll management
  const prevMsgLengthRef = useRef(messages.length);
  const scrollTimerRef = useRef(null);
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (messages.length > prevMsgLengthRef.current) {
      scrollToBottom('auto');
      scrollTimerRef.current = setTimeout(() => scrollToBottom('smooth'), 200);
    }
    prevMsgLengthRef.current = messages.length;
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
  }, [messages.length, scrollToBottom]);

  // Update ref when activeConvId changes
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  // Load messages from Firestore when activeConvId changes
  useEffect(() => {
    if (!user || !db) return;
    const loadMessages = async () => {
      setConvLoading(activeConvId, true);
      try {
        const convRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', activeConvId);
        const snap = await getDoc(convRef);
        if (snap.exists() && snap.data().messages?.length > 0) {
          setMessages(snap.data().messages);
        } else {
          setMessages([
            { role: 'assistant', content: '您好！我是您的私人基金Copilot。我已经读取了您当前的全部持仓和流水，以及您手持的空闲资金。请问有什么可以帮您？', timestamp: new Date().toISOString() }
          ]);
        }
      } catch (err) {
        console.warn('加载对话消息失败:', err);
      } finally {
        setConvLoading(activeConvId, false);
      }
    };
    loadMessages();
  }, [activeConvId, user]);

  const handleClear = useCallback(() => {
    setMessages([
      { role: 'assistant', content: '您好！我是您的私人基金Copilot。我已经读取了您当前的全部持仓和流水，以及您手持的空闲资金。请问有什么可以帮您？', timestamp: new Date().toISOString() }
    ]);
  }, []);

  const handleSend = async (attachment, removeAttachmentFn) => {
    if ((!input.trim() && !attachment)) return;
    const userMessage = input.trim();
    setInput('');
    const requestConvId = activeConvId;
    pendingConvIdRef.current = requestConvId;
    const newMessages = [...messages, { role: 'user', content: userMessage || '请帮我分析这张图片中的数据。', timestamp: new Date().toISOString() }];
    setMessages(newMessages);
    setConvLoading(requestConvId, true);
    persistConversation(requestConvId, newMessages).catch(err => console.error('保存用户消息失败:', err));

    if (attachment) {
      try {
        const extractedText = await extractDataFromImage(attachment, settings, ocrEngine || 'gemini');
        if (activeConvIdRef.current !== requestConvId) {
          pendingConvIdRef.current = null;
          setConvLoading(requestConvId, false);
          return;
        }
        const actionCard = {
          cardId: 'act_' + Date.now() + '_ocr',
          type: 'ACTION_REQUIRED',
          toolType: 'data_confirmation',
          status: 'pending',
          extractedText: extractedText,
          originalMessage: userMessage
        };
        const finalMessages = [...newMessages, {
          role: 'assistant',
          content: '我已经为您解析了上传的文件。为确保交易决策基于**绝对真实的数据**，请您先核对以下提取内容，确认无误后再交由大脑进行深度分析：',
          isAction: true,
          actions: [actionCard],
          timestamp: new Date().toISOString()
        }];
        setMessages(finalMessages);
        removeAttachmentFn();
        persistConversation(requestConvId, finalMessages).catch(err => console.warn('保存OCR回复失败:', err));
      } catch (e) {
        console.error('文件解析失败:', e);
        if (activeConvIdRef.current === requestConvId) {
          setMessages([...newMessages, { role: 'assistant', content: '文件解析失败: ' + e.message, timestamp: new Date().toISOString() }]);
        }
      } finally {
        pendingConvIdRef.current = null;
        setConvLoading(requestConvId, false);
      }
      return;
    }

    try {
      const chatHistory = newMessages.filter((_, idx) => idx > 0 && idx < newMessages.length - 1);
      const activeMarketData = enableMacroRadar ? 'FETCH_NOW' : '【系统指令：用户已手动关闭大盘雷达，本次对话进入纯净模式。严禁读取、臆测或分析任何 A股、债市的大盘宏观走势！请彻底抛弃大盘数据，完全基于用户的具体基金持仓和提问作答。】';
      const firestoreContext = user && db ? { db, userId: user.uid, appId } : null;
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, activeMarketData, useWebSearch, todos, memos, setAiStatus, firestoreContext);
      setAiStatus(null);

      if (activeConvIdRef.current !== requestConvId) {
        debugLog('AI回复属于对话 [' + requestConvId + ']，但用户已切到 [' + activeConvIdRef.current + ']，静默归档');
        try {
          let replyMessages;
          if (typeof reply === 'object' && reply !== null && reply.type === 'ACTION_REQUIRED') {
            const scoreActs = (reply.payload || []).filter(act => act.toolType === 'score_record');
            const otherActs = (reply.payload || []).filter(act => act.toolType !== 'score_record');
            for (const scoreAct of scoreActs) {
              handleScoreRecord({ action: scoreAct, user }).catch(err => console.error('打分快照自动存储失败:', err));
            }
            const archiveActions = otherActs.map((act, idx) => ({ ...act, cardId: 'act_' + Date.now() + '_' + idx, status: 'pending' }));
            replyMessages = [...newMessages, { role: 'assistant', content: reply.text || (otherActs.length > 0 ? '已为您生成操作卡片' : ''), isAction: otherActs.length > 0, ...(otherActs.length > 0 ? { actions: archiveActions } : {}), timestamp: new Date().toISOString() }];
          } else {
            replyMessages = [...newMessages, { role: 'assistant', content: typeof reply === 'string' ? reply : String(reply || ''), timestamp: new Date().toISOString() }];
          }
          persistConversation(requestConvId, replyMessages).catch(err => console.error('归档AI回复失败:', err));
        } catch (archiveErr) {
          console.error('归档AI回复时异常', archiveErr);
        }
        pendingConvIdRef.current = null;
        setConvLoading(requestConvId, false);
        return;
      }

      let finalMessages;
      if (typeof reply === 'object' && reply !== null && reply.type === 'ACTION_REQUIRED') {
        const scoreActions = (reply.payload || []).filter(act => act.toolType === 'score_record');
        const otherActions = (reply.payload || []).filter(act => act.toolType !== 'score_record');
        for (const scoreAct of scoreActions) {
          handleScoreRecord({ action: scoreAct, user }).catch(err => console.error('打分快照自动存储失败:', err));
        }
        const actionsWithStatus = otherActions.map((act, idx) => ({
          ...act,
          cardId: 'act_' + Date.now() + '_' + idx,
          status: 'pending'
        }));
        finalMessages = [...newMessages, {
          role: 'assistant',
          content: reply.text || (otherActions.length > 0 ? '已为您生成以下操作卡片，请逐一核对：' : ''),
          isAction: otherActions.length > 0,
          ...(otherActions.length > 0 ? { actions: actionsWithStatus } : {}),
          timestamp: new Date().toISOString()
        }];
      } else {
        finalMessages = [...newMessages, { role: 'assistant', content: typeof reply === 'string' ? reply : String(reply || ''), timestamp: new Date().toISOString() }];
      }
      setMessages(finalMessages);
      persistConversation(requestConvId, finalMessages).catch(err => console.error('保存AI回复失败:', err));
    } catch (e) {
      console.error('AI请求失败:', e);
      if (activeConvIdRef.current === requestConvId) {
        setMessages([...newMessages, { role: 'assistant', content: 'AI请求失败: ' + e.message, timestamp: new Date().toISOString() }]);
      }
    } finally {
      pendingConvIdRef.current = null;
      setConvLoading(requestConvId, false);
    }
  };

  const handleConfirmAction = useCallback((cardId, status) => {
    setMessages(prev => prev.map(m => {
      if (m.isAction && m.actions) {
        return { ...m, actions: m.actions.map(a => a.cardId === cardId ? { ...a, status } : a) };
      }
      return m;
    }));
  }, []);

  const handleCancelAction = useCallback((cardId) => {
    setMessages(prev => prev.map(m => {
      if (m.isAction && m.actions) {
        return { ...m, actions: m.actions.map(a => a.cardId === cardId ? { ...a, status: 'cancelled' } : a) };
      }
      return m;
    }));
  }, []);

  return {
    messages, setMessages,
    input, setInput,
    aiStatus, setAiStatus,
    messagesEndRef,
    activeConvIdRef,
    pendingConvIdRef,
    handleSend, handleClear,
    handleConfirmAction, handleCancelAction,
    zoomedImage, setZoomedImage,
    scrollToBottom
  };
}

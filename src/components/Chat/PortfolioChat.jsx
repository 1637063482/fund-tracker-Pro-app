// AI 投资对话组件：资产 Copilot 聊天面板，支持联网搜索、大盘雷达、文件上传解析、AI 参数调节与战略记忆库
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MessageSquare, X, Send, RefreshCw, Trash2, Bot, User, Sparkles, Globe, Target, Brain, Activity, Paperclip, Edit, Check, SlidersHorizontal, Plus, ChevronDown, Share2, MessageCircle } from 'lucide-react';
import { chatWithPortfolioAI } from '../../utils/ai';
import { extractDataFromImage } from '../../services/fileParser';
import { debugLog } from '../../utils/debugLog';
import { renderMarkdown, renderMarkdownForPrint } from '../../utils/renderMarkdown';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalAnimation } from '../../hooks/useModalAnimation';
import { useFileUpload } from '../../hooks/useFileUpload';
import { ActionCard } from './ActionCard';
import { dispatchAction, handleScoreRecord } from './actionHandlers';
import { ImageModal } from '../UI/ImageModal';
import { AppleSelect } from '../UI/AppleSelect';
import { Tooltip } from '../UI/Tooltip';
import { AnimatedModal } from '../UI/AnimatedModal';
import { doc, setDoc, getDoc, getDocs, onSnapshot, collection, query, orderBy, limit, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';

// 渲染AI备忘录核心逻辑：复用对话框的 Markdown 解析器，AI 可自由选择颜色/格式
const renderMemoText = (text) => {
  if (!text) return text;
  return renderMarkdown(text);
};

// 消息时间格式化：今天显示"今天 HH:mm"，昨天显示"昨天 HH:mm"，更早显示"M月D日 HH:mm"
const formatMessageTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (msgDate.getTime() === today.getTime()) {
    return `今天 ${timeStr}`;
  } else if (msgDate.getTime() === yesterday.getTime()) {
    return `昨天 ${timeStr}`;
  } else {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
  }
};

// === Firestore 持久化工具：消除 5 处重复的 setDoc 模板 ===
const persistConversation = (convId, msgs, user, conversations) => {
  if (!user) return Promise.resolve();
  const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId);
  const existing = conversations[convId]?.createdAt;
  const payload = { messages: msgs, updatedAt: new Date().toISOString() };
  if (!existing) {
    const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
    payload.title = lastUserMsg ? lastUserMsg.content.substring(0, 30) + (lastUserMsg.content.length > 30 ? '...' : '') : '新对话';
    payload.createdAt = new Date().toISOString();
  } else {
    payload.createdAt = existing;
  }
  return setDoc(ref, payload, { merge: true });
};

export const PortfolioChat = ({ portfolioStats, settings, marketData, user, onAddTodo, onUpdateTodo, onDeleteTodo, onSaveSettings, todos }) => {
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

  const [chatTriggerRect, setChatTriggerRect] = useState(null);
  const [memoTriggerRect, setMemoTriggerRect] = useState(null);
  const [showButton, setShowButton] = useState(true);
  const { isOpen, open, close: animClose, overlayStyle, panelStyle } = useModalAnimation(null, chatTriggerRect, settings.animationSpeed || 1.0);

  const handleOpen = useCallback((e) => {
    setChatTriggerRect(e.currentTarget.getBoundingClientRect());
    setShowButton(false);
    setIsChatClosing(false);
    // 打开面板时如果仍在 default 或当前对话已不存在，立即切换到最近对话（不依赖 onSnapshot 异步时序）
    const curId = activeConvIdRef.current;
    if (curId === 'default' || !conversationsRef.current[curId]) {
      const entries = Object.entries(conversationsRef.current)
        .filter(([id]) => id !== 'default')
        .sort(([,a], [,b]) => {
          const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return tb - ta;
        });
      if (entries.length > 0) {
        activeConvIdRef.current = entries[0][0];
        setActiveConvId(entries[0][0]);
      }
    }
    open();
  }, [open]);

  const handleClose = useCallback(() => {
    setShowButton(true);
    setShowAiParams(false);
    setIsChatClosing(true);
    animClose();
  }, [animClose]);
  const focusRef = useFocusTrap(isOpen);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [enableMacroRadar, setEnableMacroRadar] = useState(false);
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  // [attachment/previewUrl/fileInputRef/ocrEngine now provided by useFileUpload hook]
  const { attachment, setAttachment, previewUrl, setPreviewUrl, ocrEngine, setOcrEngine, fileInputRef, handleFileChange, removeAttachment: removeAttachmentHook } = useFileUpload();
  const [showAiParams, setShowAiParams] = useState(false);
  const [aiParamsTriggerRect, setAiParamsTriggerRect] = useState(null);
  const [isChatClosing, setIsChatClosing] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmTriggerRect, setConfirmTriggerRect] = useState(null);
  const [isMemoClosing, setIsMemoClosing] = useState(false);
  const [isMemoOpening, setIsMemoOpening] = useState(true);
  const [scoringHistory, setScoringHistory] = useState(null); // 当前展示的打分历史（null=面板关闭）
  const [isScoringClosing, setIsScoringClosing] = useState(false);
  const [isScoringOpening, setIsScoringOpening] = useState(true);
  const [scoringTriggerRect, setScoringTriggerRect] = useState(null);
  const [isScoringLoading, setIsScoringLoading] = useState(false);   // 硬加载（无缓存时显示 spinner）
  const [isScoringRefreshing, setIsScoringRefreshing] = useState(false); // 后台刷新中（显示小指示器）
  const scoringCacheRef = useRef({ data: null, fetchedAt: 0 });     // 内存缓存（供FLIP动效即时展示）
  const scoringUnsubRef = useRef(null);                              // onSnapshot 取消订阅

  // onSnapshot 后台监听：保持缓存新鲜，store_scoring_snapshot写入后自动更新
  useEffect(() => {
    if (!user || !db || !appId) return;
    if (scoringUnsubRef.current) { scoringUnsubRef.current(); }

    const snapRef = collection(db, 'artifacts', appId, 'users', user.uid, 'scoring_snapshots');
    const q = query(snapRef, orderBy('date', 'desc'), limit(30));

    scoringUnsubRef.current = onSnapshot(q, (snapshot) => {
      const data = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      scoringCacheRef.current = { data, fetchedAt: Date.now() };
      setIsScoringLoading(false);
      // 如果面板已打开，同步更新UI
      setScoringHistory(prev => prev !== null ? data : prev);
    }, (err) => {
      console.error('打分快照监听失败:', err);
    });

    return () => { if (scoringUnsubRef.current) { scoringUnsubRef.current(); scoringUnsubRef.current = null; } };
  }, [user, db, appId]);

  // 带即时缓存的打分快照拉取（缓存保证FLIP动效不被打断）
  const openScoringPanel = useCallback(() => {
    if (!user || !db) return;
    const cache = scoringCacheRef.current;
    if (cache.data !== null) {
      // 有缓存 → 立即展示（FLIP动画期间内容不变）
      setScoringHistory(cache.data);
      setIsScoringLoading(false);
      setIsScoringRefreshing(false);
    } else {
      // 无缓存 → 显示加载（首次打开，无动画冲突）
      setIsScoringLoading(true);
      setScoringHistory([]);
    }
  }, [user, db]);

  // FLIP calculation for desktop expand-from-button
  const chatFlip = useMemo(() => {
    if (!chatTriggerRect) return null;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const bx = chatTriggerRect.left + chatTriggerRect.width / 2;
    const by = chatTriggerRect.top + chatTriggerRect.height / 2;
    return { tx: bx - cx, ty: by - cy, scale: Math.max(chatTriggerRect.width / 600, 0.12) };
  }, [chatTriggerRect]);

  const memoFlip = useMemo(() => {
    if (!memoTriggerRect) return null;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const bx = memoTriggerRect.left + memoTriggerRect.width / 2;
    const by = memoTriggerRect.top + memoTriggerRect.height / 2;
    return { tx: bx - cx, ty: by - cy, scale: Math.max(memoTriggerRect.width / 600, 0.12) };
  }, [memoTriggerRect]);

  const scoringFlip = useMemo(() => {
    if (!scoringTriggerRect) return null;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const bx = scoringTriggerRect.left + scoringTriggerRect.width / 2;
    const by = scoringTriggerRect.top + scoringTriggerRect.height / 2;
    return { tx: bx - cx, ty: by - cy, scale: Math.max(scoringTriggerRect.width / 600, 0.12) };
  }, [scoringTriggerRect]);

  // [handleFileChange/removeAttachment now provided by useFileUpload hook]
  const removeAttachment = removeAttachmentHook;

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
      setConfirmAction({
        message: '确定要抹除 AI 的这条战略记忆吗？',
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'ai_memos', memoId));
          } catch (error) {
            // 删除失败，错误已在控制台输出；关闭由 close() 处理
          }
        }
      });
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
      const inspectionPrompt = "执行例行巡检。\n\n请严格按照第五层批量巡检步骤执行：\n1. 量化重算：get_market_historical_intraday(sh000001,day,120)取ATR/RSI/年筹码 → 遍历权益标的调get_fund_risk_metrics取MDD+IR → 基于ATR×1.5重算网格步长+筹码验证+斐波那契\n2. 执行第四层完整打分\n3. 战术拦截：逐只按标签+得分矩阵分发指令\n4. 防污染墙：禁止单日战术分篡改长线战略备忘\n5. 输出巡检报告：每只标注得分|CIO判定|击球区(ATR步长)|MDD约束|筹码支撑。过时净值/快照数据直接覆写，战略定调仅在基本面逻辑破裂时修改。";
      setInput(inspectionPrompt);
      
      // 4. 延迟 200ms 等待 React 状态更新后触发发送
      setTimeout(() => {
          sendBtnRef.current?.click();
      }, 200);
  }, []);

  // 多对话状态
  const [conversations, setConversations] = useState({}); // { convId: { title, createdAt, lastMessage } }
  const [activeConvId, setActiveConvId] = useState('default');
  const [showConvList, setShowConvList] = useState(false);
  const [convListTriggerRect, setConvListTriggerRect] = useState(null);
  const [isConvListOpening, setIsConvListOpening] = useState(true);
  const [isConvListClosing, setIsConvListClosing] = useState(false);
  const [editingConvId, setEditingConvId] = useState(null);
  const [editTitleValue, setEditTitleValue] = useState('');

  const handleStartEditTitle = useCallback((convId, currentTitle) => {
    setEditingConvId(convId);
    setEditTitleValue(currentTitle || '');
  }, []);

  const handleSaveTitle = useCallback(async (convId) => {
    const newTitle = editTitleValue.trim();
    if (newTitle && user && db) {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId), { title: newTitle }).catch(err => console.warn('更新对话标题失败:', err));
    }
    setEditingConvId(null);
  }, [editTitleValue, user, db]);

  const convListFlip = useMemo(() => {
    if (!convListTriggerRect) return null;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const bx = convListTriggerRect.left + convListTriggerRect.width / 2;
    const by = convListTriggerRect.top + convListTriggerRect.height / 2;
    return { tx: bx - cx, ty: by - cy, scale: Math.max(convListTriggerRect.width / 600, 0.12) };
  }, [convListTriggerRect]);

  const [messages, setMessages] = useState([
    { role: 'assistant', content: '您好！我是您的私人基金copilot。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？', timestamp: new Date().toISOString() }
  ]);
  const[input, setInput] = useState('');
  const [loadingConvs, setLoadingConvs] = useState({}); // 🌟 按对话追踪加载状态，支持多对话并发
  const [aiStatus, setAiStatus] = useState(null);
  const messagesEndRef = useRef(null);
  const activeConvIdRef = useRef(activeConvId); // 🌟 追踪当前对话ID，防止AI回复串线
  const pendingConvIdRef = useRef(null); // 🌟 追踪哪个对话有正在进行的AI请求，用于恢复loading状态
  // 性能优化：用 ref 持有高频变化的值，避免 useCallback 依赖数组爆炸导致 renderedMessages 频繁重算
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

  // 🌟 按对话设置加载状态
  const setConvLoading = useCallback((convId, loading) => {
    setLoadingConvs(prev => {
      if (loading) return { ...prev, [convId]: true };
      const next = { ...prev };
      delete next[convId];
      return next;
    });
  }, []);

  // 🌟 当前对话是否在加载中（派生值，用于 scroll effect 等）
  const isLoading = !!loadingConvs[activeConvId];

  const prevIsLoadingRef = useRef(isLoading);
  const prevMsgLengthRef = useRef(messages.length);
  const prevScrollMsgLenRef = useRef(messages.length);
  const prevIsOpenRef = useRef(isOpen);
  const prevConvIdRef = useRef(activeConvId); // 🌟 追踪对话切换，触发滚底
  const scrollTimerRef = useRef(null);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    // 场景 1：聊天框刚刚被打开 → 等 FLIP 动画播完再滚动
    if (isOpen && !prevIsOpenRef.current) {
      const openDelay = Math.round(800 * (settings.animationSpeed || 1));
      scrollTimerRef.current = setTimeout(() => scrollToBottom('smooth'), openDelay);
    }
    // 场景 2：新消息到达 → 立即滚 + 延迟补滚（等 markdown/卡片渲染完）
    else if (isOpen && messages.length > prevMsgLengthRef.current) {
      scrollToBottom('auto'); // 先瞬间跳底
      scrollTimerRef.current = setTimeout(() => scrollToBottom('smooth'), 200);
    }

    prevMsgLengthRef.current = messages.length;
    prevIsOpenRef.current = isOpen;

    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [messages.length, isOpen, settings.animationSpeed, scrollToBottom]);

  // 场景 3：AI 回复完成 → 补一次滚底。仅当有新消息加入时才滚，卡片状态变更不触发
  useEffect(() => {
    if (isOpen && !isLoading && prevIsLoadingRef.current && messages.length > prevScrollMsgLenRef.current) {
      scrollTimerRef.current = setTimeout(() => scrollToBottom('smooth'), 250);
    }
    prevIsLoadingRef.current = isLoading;
    prevScrollMsgLenRef.current = messages.length;
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [isLoading, isOpen, messages.length, scrollToBottom]);

  // 🌟 场景 4：切换对话时滚动到底部（等消息加载后渲染完成）
  useEffect(() => {
    if (isOpen && activeConvId !== prevConvIdRef.current) {
      prevConvIdRef.current = activeConvId;
      const timer = setTimeout(() => scrollToBottom('smooth'), 400);
      return () => clearTimeout(timer);
    }
    prevConvIdRef.current = activeConvId;
  }, [activeConvId, isOpen, scrollToBottom]);

  // 从 chat_convs 集合直接加载对话列表（每个文档自带 title+createdAt）
  useEffect(() => {
    if (!user || !db) return;
    const convsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chat_convs');
    const unsub = onSnapshot(query(convsRef), (snapshot) => {
      const list = {};
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        if (d.messages?.length > 0) {
          const lastUserMsg = [...d.messages].reverse().find(m => m.role === 'user');
          list[docSnap.id] = {
            title: d.title || (lastUserMsg ? lastUserMsg.content.substring(0, 30) : '新对话'),
            createdAt: d.createdAt || '',
            updatedAt: d.updatedAt || '', // 🌟 读取 updatedAt 用于排序
            lastMessage: d.title || ''
          };
        }
      });
      // 确保 default 始终存在
      if (!list.default) {
        list.default = { title: '默认对话', createdAt: '', updatedAt: '', lastMessage: '' };
      }
      setConversations(list);
    }, (err) => {
      console.error('❌ 加载对话列表失败，请检查 Firestore 规则是否包含 chat_convs:', err);
      // 即使云端加载失败，也确保 default 对话在本地可用
      setConversations(prev => {
        if (Object.keys(prev).length === 0) {
          return { default: { title: '默认对话', createdAt: '', lastMessage: '' } };
        }
        return prev;
      });
    });
    return () => unsub();
  }, [user]);

  // 加载当前对话的消息 + 旧版迁移
  useEffect(() => {
    if (!user || !db) return;
    let cancelled = false;
    const msgRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', activeConvId);
    getDoc(msgRef).then(snap => {
      if (cancelled) return;
      if (snap.exists() && snap.data().messages?.length > 0) {
        setMessages(snap.data().messages);
      } else {
        setMessages([{
            role: 'assistant',
            content: activeConvId === 'default'
                ? '您好！我是您的私人基金copilot。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？'
                : '新对话已开启。我已加载您的最新持仓数据，请问有什么可以帮您？',
            timestamp: new Date().toISOString()
        }]);
      }
    }).catch(err => {
      console.error(`❌ 加载对话 [${activeConvId}] 失败:`, err);
    });

    // 🌟 一次性迁移：旧版 chat/history → chat_convs/default，完成后删除旧文档防止重复覆盖
    if (activeConvId === 'default') {
      const legacyRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history');
      getDoc(legacyRef).then(legacySnap => {
        if (legacySnap.exists() && legacySnap.data().messages?.length > 0) {
          const legacyMsgs = legacySnap.data().messages;
          // 检查 chat_convs/default 是否已有 >= 旧数据的消息数，有则跳过迁移
          getDoc(msgRef).then(currentSnap => {
            const currentLen = currentSnap.exists() ? (currentSnap.data().messages?.length || 0) : 0;
            if (legacyMsgs.length > currentLen) {
              // 旧数据更长 → 执行迁移
              const lastUserMsg = [...legacyMsgs].reverse().find(m => m.role === 'user');
              const title = lastUserMsg ? lastUserMsg.content.substring(0, 30) : '默认对话';
              setDoc(msgRef, { messages: legacyMsgs, title, createdAt: new Date().toISOString() }, { merge: true }).then(() => {
                debugLog('✅ 旧版 chat/history 已迁移到 chat_convs/default');
                deleteDoc(legacyRef).catch(err => console.warn('清理旧版chat/history失败:', err));
              }).catch(err => console.warn('迁移写入chat_convs失败:', err));
            } else {
              debugLog('🧹 chat_convs/default 数据已更新，清理旧版 chat/history');
              deleteDoc(legacyRef).catch(err => console.warn('清理旧版chat/history失败:', err));
            }
          }).catch(err => console.warn('读取chat_convs失败:', err));
        }
      }).catch(() => {});
    }

    return () => { cancelled = true; };
  }, [user, activeConvId]);

  // 保存消息 + 同步更新 title 到消息文档自身
  const saveMessages = useCallback(async (msgs) => {
    persistConversation(activeConvId, msgs, user, conversationsRef.current).catch(err => console.error('❌ 保存对话失败:', err));
  }, [user, activeConvId]);

  const handleNewConversation = useCallback(() => {
    const newId = `conv_${Date.now()}`;
    const createdAt = new Date().toISOString();
    // 🌟 用时间生成可区分的默认标题，如 "新对话 14:30"
    const now = new Date();
    const timeLabel = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const dateLabel = `${now.getMonth()+1}月${now.getDate()}日`;
    const defaultTitle = `新对话 ${dateLabel} ${timeLabel}`;
    activeConvIdRef.current = newId; // 🌟 同步更新 ref
    setActiveConvId(newId);
    const welcomeMsg = [{ role: 'assistant', content: '新对话已开启。我已加载您的最新持仓数据，请问有什么可以帮您？', timestamp: createdAt }];
    setMessages(welcomeMsg);
    // 立即写入 Firestore 确保对话出现在列表中
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', newId), {
        messages: welcomeMsg, title: defaultTitle, createdAt
      }, { merge: true }).catch(err => console.error('❌ 新建对话写入失败:', err));
    }
    setShowConvList(false);
  }, [user, db]);

  const handleSwitchConversation = useCallback((convId) => {
    if (convId === activeConvId) { setShowConvList(false); return; }
    // 🌟 同步更新 ref（不用 useEffect，避免微任务时序问题）
    activeConvIdRef.current = convId;
    // 🌟 不再无条件清除 loading：如果切回有在途请求的对话，loading 指示器会恢复
    // loading 的显示由 pendingConvIdRef === activeConvId 控制
    setActiveConvId(convId);
    setShowConvList(false);
  }, [activeConvId]);

  // 🌟 删除历史对话（含确认弹窗，复用全局 AnimatedModal 动效）
  const handleDeleteConversation = useCallback((convId, e) => {
    e.stopPropagation(); // 阻止冒泡触发切换对话
    setConfirmTriggerRect(e.currentTarget.getBoundingClientRect());
    setConfirmAction({
      message: '确定要删除这条对话记录吗？此操作无法恢复。',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId));
          // 如果删除的是当前活跃对话，自动切回 default
          if (convId === activeConvId) {
            setActiveConvId('default');
          }
        } catch (err) {
          console.error('❌ 删除对话失败:', err);
        }
      }
    });
  }, [user, db, activeConvId]);

  // 🌟 将 AI 回复转换为可直接打印/保存为 PDF 的 HTML，使用 renderMarkdownForPrint 生成内联样式 HTML
  const handleShareAsPDF = useCallback((msg) => {
    const content = msg.content || '';
    let renderedHTML = '';

    try {
        renderedHTML = renderMarkdownForPrint(content);
    } catch (e) {
        // Fallback: 极少数情况报错时做简单降级
        renderedHTML = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
    }

    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>AI 投资分析报告</title>
<style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;max-width:760px;margin:0 auto;padding:28px 20px;color:#1e293b;line-height:1.6;font-size:11px;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}img{max-width:100%;height:auto}@media print{body{margin:0;padding:24px}@page{margin:20mm}}</style></head>
<body>${renderedHTML}</body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  }, []);

  const handleSend = async () => {
    // 🌟 修改：允许不打字只发图片
    if ((!input.trim() && !attachment) || isLoading) return;
    const userMessage = input.trim();
    setInput('');

    // 🌟 核心防串线：记录发起请求时的对话ID，AI回复回来时做比对
    const requestConvId = activeConvId;
    pendingConvIdRef.current = requestConvId; // 🌟 标记在途请求，切回时恢复loading状态

    // 生成用户消息
    const newMessages = [...messages, { role: 'user', content: userMessage || '请帮我分析这张图片中的数据。', timestamp: new Date().toISOString() }];
    setMessages(newMessages);
    setConvLoading(requestConvId, true);

    // 保存用户消息
    persistConversation(requestConvId, newMessages, user, conversationsRef.current).catch(err => console.error('❌ 保存用户消息失败:', err));

    // 🌟 核心拦截层：如果有附件，先走 OCR/解析，不调用 AI
    if (attachment) {
        try {
            // 🌟 新增：将当前选择的引擎传给底层解析器
            const extractedText = await extractDataFromImage(attachment, settings, ocrEngine);

            // 🌟 防串线检查
            if (activeConvIdRef.current !== requestConvId) {
              pendingConvIdRef.current = null;
              setConvLoading(requestConvId, false);
              return;
            }

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
                actions: [actionCard],
                timestamp: new Date().toISOString()
            }];

            setMessages(finalMessages);
            removeAttachment(); // 发送后清空附件

            persistConversation(requestConvId, finalMessages, user, conversationsRef.current).catch(err => console.warn('保存OCR回复失败:', err));
        } catch (e) {
            console.error(`❌ 文件解析失败 [${requestConvId}]:`, e);
            if (activeConvIdRef.current === requestConvId) {
              setMessages([...newMessages, { role: 'assistant', content: `❌ 文件解析失败: ${e.message}`, timestamp: new Date().toISOString() }]);
            }
        } finally {
            pendingConvIdRef.current = null;
            setConvLoading(requestConvId, false);
        }
        return; // 🚨 阻断！在这里停止执行，等待用户确认卡片
    }

    try {
      const chatHistory = newMessages.filter((_, idx) => idx > 0 && idx < newMessages.length - 1);

      // 当前架构：所有非问候消息全量注入（system prompt 缓存命中 10× 折扣，路由省不了多少 token，不如直接全量保质量）
      const activeMarketData = enableMacroRadar
          ? "FETCH_NOW"
          : "【系统指令：用户已手动关闭大盘雷达，本次对话进入纯净模式。严禁读取、臆测或分析任何 A股、债市的大盘宏观走势！请彻底抛弃大盘数据，完全基于用户的具体基金持仓和提问作答。】";
      debugLog('%c[大盘雷达] enableMacroRadar=' + enableMacroRadar + ' | activeMarketData=' + (activeMarketData === 'FETCH_NOW' ? 'FETCH_NOW' : 'PURE_MODE'), 'color: #f59e0b; font-weight: bold;');
      const firestoreContext = user && db ? { db, userId: user.uid, appId } : null;
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, activeMarketData, useWebSearch, todos, memos, setAiStatus, firestoreContext);
      setAiStatus(null);

      // 🌟 核心防串线：AI 回复到达时，检查用户是否已切到其他对话
      if (activeConvIdRef.current !== requestConvId) {
        // 用户已切换对话！将 AI 回复静默写入原始对话的 Firestore，不更新当前 UI
        debugLog(`⏭️ AI 回复属于对话 [${requestConvId}]，但用户已切到 [${activeConvIdRef.current}]，静默归档`);
        try {
          let replyMessages;
          if (typeof reply === 'object' && reply !== null && reply.type === 'ACTION_REQUIRED') {
            // 自动处理 score_record（打分快照无需用户确认，即使已切走也要存储）
            const scoreActs = (reply.payload || []).filter(act => act.toolType === 'score_record');
            const otherActs = (reply.payload || []).filter(act => act.toolType !== 'score_record');
            for (const scoreAct of scoreActs) {
              handleScoreRecord({ action: scoreAct, user }).catch(err => console.error('打分快照自动存储失败:', err));
            }
            const archiveActions = otherActs.map((act, idx) => ({ ...act, cardId: `act_${Date.now()}_${idx}`, status: 'pending' }));
          replyMessages = [...newMessages, { role: 'assistant', content: reply.text || (otherActs.length > 0 ? '已为您生成操作卡片' : ''), isAction: otherActs.length > 0, ...(otherActs.length > 0 ? { actions: archiveActions } : {}), timestamp: new Date().toISOString() }];
          } else {
            replyMessages = [...newMessages, { role: 'assistant', content: typeof reply === 'string' ? reply : String(reply || ''), timestamp: new Date().toISOString() }];
          }
          persistConversation(requestConvId, replyMessages, user, conversationsRef.current).catch(err => console.error('❌ 归档AI回复失败:', err));
        } catch (archiveErr) {
          console.error('❌ 归档AI回复时异常:', archiveErr);
        }
        pendingConvIdRef.current = null;
        setConvLoading(requestConvId, false);
        return;
      }

      // 🔒 到此说明用户仍在原对话中，正常渲染 AI 回复
      let finalMessages;
      if (typeof reply === 'object' && reply !== null && reply.type === 'ACTION_REQUIRED') {
          // 自动处理 score_record 类型（打分快照无需用户确认）
          const scoreActions = (reply.payload || []).filter(act => act.toolType === 'score_record');
          const otherActions = (reply.payload || []).filter(act => act.toolType !== 'score_record');
          for (const scoreAct of scoreActions) {
            handleScoreRecord({ action: scoreAct, user }).catch(err => console.error('打分快照自动存储失败:', err));
          }
          const actionsWithStatus = otherActions.map((act, idx) => ({
              ...act,
              cardId: `act_${Date.now()}_${idx}`,
              status: 'pending'
          }));
          finalMessages = [...newMessages, {
              role: 'assistant',
              content: reply.text || (otherActions.length > 0 ? `已为您生成以下操作卡片，请逐一核对：` : ''),
              isAction: otherActions.length > 0,
              ...(otherActions.length > 0 ? { actions: actionsWithStatus } : {}),
              timestamp: new Date().toISOString()
          }];
      } else {
          finalMessages = [...newMessages, { role: 'assistant', content: typeof reply === 'string' ? reply : String(reply || ''), timestamp: new Date().toISOString() }];
      }
      setMessages(finalMessages);

      // 保存 AI 回复到 Firestore
      persistConversation(requestConvId, finalMessages, user, conversationsRef.current).catch(err => console.error('❌ 保存AI回复失败:', err));
    } catch (e) {
      console.error(`❌ AI 对话异常 [${requestConvId}]:`, e);
      // 🌟 始终在当前对话显示错误（仅当用户未切走时）
      if (activeConvIdRef.current === requestConvId) {
        const errorMessages = [...newMessages, { role: 'assistant', content: `❌ 抱歉，连接大脑失败：${e.message}`, timestamp: new Date().toISOString() }];
        setMessages(errorMessages);
        persistConversation(requestConvId, errorMessages, user, conversationsRef.current).catch(err => console.warn('保存错误消息失败:', err));
      }
    } finally {
      // 🌟 无论成功、失败、归档，始终清除该对话的 loading 状态
      pendingConvIdRef.current = null;
      setConvLoading(requestConvId, false);
    }
  };

  const handleConfirmAction = useCallback(async (action, formData = {}) => {
    if (!user || !db || !action) return;
    if (typeof onAddTodo !== 'function') throw new Error("前端传参丢失：onAddTodo 未定义");
    const confirmConvId = activeConvIdRef.current;
    setConvLoading(confirmConvId, true);
    try {
      await dispatchAction(action, formData, {
        user, settings,
        setMessages, setConvLoading, activeConvId: confirmConvId,
        onAddTodo, onUpdateTodo, onDeleteTodo,
        enableMacroRadar, useWebSearch,
        portfolioStats: portfolioStatsRef.current,
        todos: todosRef.current,
        memos: memosRef.current,
        messages: messagesRef.current,
      });
    } catch (e) {
      console.error("写入失败:", e);
      setMessages(prev => {
        const newMsgs = prev.map(m => {
          if (m.isAction && m.actions) return { ...m, actions: m.actions.map(a => a.cardId === action.cardId ? { ...a, status: 'cancelled' } : a) };
          return m;
        });
        return [...newMsgs, { role: 'assistant', content: `❌ 操作失败: ${e.message}`, timestamp: new Date().toISOString() }];
      });
    } finally {
      setConvLoading(confirmConvId, false);
    }
  }, [user, settings, onAddTodo, onUpdateTodo, onDeleteTodo, enableMacroRadar, useWebSearch, setConvLoading]); // activeConvId/portfolioStats/todos/memos/messages via ref 避免级联重建

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
          saveMessages(newMsgs);
          return newMsgs;
      });
  }, [user, saveMessages]);

  // 一键清空记忆，防止幻觉
  const handleClear = () => {
    setConfirmAction({
      message: '确定要清空记忆吗？这会清空之前的聊天上下文。',
      onConfirm: () => {
        const resetMsg = [{ role: 'assistant', content: '记忆已清空。我已经重新加载了您的最新账本底表，我们重新开始吧！', timestamp: new Date().toISOString() }];
        setMessages(resetMsg);
        if (user && db) {
          saveMessages(resetMsg);
        }
      }
    });
  };

  // 删除单条消息：从数组中移除 → 更新 state → 同步 Firestore → 被删内容不再注入 AI 上下文
  const handleDeleteMessage = useCallback((index, e) => {
    if (e?.currentTarget) {
      setConfirmTriggerRect(e.currentTarget.getBoundingClientRect());
    }
    const targetMsg = messages[index];
    const roleLabel = targetMsg?.role === 'user' ? '你的提问' : 'AI 的回复';
    const preview = (targetMsg?.content || '').substring(0, 40).replace(/\n/g, ' ');
    setConfirmAction({
      message: `确定要删除这条${roleLabel}吗？\n\n"${preview}${(targetMsg?.content || '').length > 40 ? '…' : ''}"\n\n删除后该内容将不再注入 AI 上下文。`,
      onConfirm: () => {
        setMessages(prev => {
          const updated = prev.filter((_, i) => i !== index);
          if (user && db) {
            persistConversation(activeConvIdRef.current, updated, user, conversationsRef.current)
              .catch(err => console.error('删除消息同步失败:', err));
          }
          return updated;
        });
      }
    });
  }, [messages, user, db]);

  // 【核心性能修复】使用 useMemo 阻断打字时触发的无效历史消息渲染
  const renderedMessages = useMemo(() => {
    return messages.map((msg, idx) => (
      <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group`}>
        <div className={`flex max-w-[90%] sm:max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm ring-2 ring-white dark:ring-slate-900 ${msg.role === 'user' ? 'bg-blue-500 text-white ml-2 sm:ml-3' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 mr-2 sm:mr-3'}`}>
            {msg.role === 'user' ? <User size={14} /> : <Bot size={15} />}
          </div>
          <div className={`px-4 py-3 text-[15px] leading-relaxed min-w-0 overflow-x-auto custom-scrollbar ${msg.role === 'user' ? 'bg-blue-500 text-white rounded-[1.25rem] shadow-apple-sm' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-[1.25rem] shadow-apple-sm'}`}>
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
            {/* AI 回复分享按钮 */}
            {msg.role === 'assistant' && msg.content && (
              <div className="flex justify-end mt-2 pt-1 border-t border-slate-100 dark:border-slate-700/30">
                <button
                  onClick={() => handleShareAsPDF(msg)}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors px-2 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <Share2 size={12} /> 分享PDF
                </button>
              </div>
            )}
          </div>
        </div>
        {/* 消息时间戳 + 删除按钮 — 默认隐藏，鼠标悬浮显示 */}
        <div className={`text-[10px] text-slate-400 dark:text-slate-500 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none inline-flex items-center gap-0.5 ${msg.role === 'user' ? 'mr-1' : 'ml-1'}`}>
          <Tooltip content="删除此消息（不再注入AI上下文）">
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteMessage(idx, e); }}
              className="p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 dark:text-slate-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </Tooltip>
          <span>{formatMessageTime(msg.timestamp)}</span>
        </div>
      </div>
    ));
}, [messages, handleCancelAction, handleConfirmAction, handleShareAsPDF, handleDeleteMessage, todos]);

  return (
    <>
      {/* 右下角悬浮入口按钮 — Apple风格 */}
      <button
        onClick={handleOpen}
        className={`fixed bottom-6 right-6 p-4 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-apple-xl transition-all duration-150 ease-spring hover:scale-110 active:scale-95 z-40 ring-4 ring-white/80 dark:ring-slate-900/80 ${showButton ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`}
      >
        <MessageSquare size={24} />
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm" />
      </button>

      {/* 遮罩层 + 面板 — FLIP动画 */}
      <div style={overlayStyle} onClick={handleClose} className={isChatClosing ? "pointer-events-none" : ""}>
        <div ref={focusRef} style={panelStyle} className="w-full h-[92dvh] sm:h-[98vh] sm:max-w-5xl bg-white dark:bg-slate-900 sm:rounded-[1.25rem] rounded-[1.75rem] shadow-apple-2xl flex flex-col overflow-hidden border border-slate-200/50 dark:border-slate-700/40 safe-top safe-bottom" onClick={e => e.stopPropagation()}>
          
          {/* 头部 — Apple毛玻璃风格 */}
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-glass border-b border-slate-200/50 dark:border-slate-700/30 px-4 sm:px-6 py-3.5 sm:py-4 flex justify-between items-center shrink-0">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-500 rounded-[10px] flex items-center justify-center mr-3 shadow-sm">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <span className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white">资产Copilot</span>
                <span className="block text-[11px] text-slate-400 dark:text-slate-500 leading-tight">AI 投资助手</span>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              {/* Ω 回测准确率指示器 */}
              <Tooltip content={
                settings.omegaAccuracy != null && settings.omegaAccuracy > 0
                  ? 'AI回测准确率 ' + (settings.omegaAccuracy*100).toFixed(0) + '% | ' + (settings.omegaSamples||'?') + '样本 | Ω=' + (settings.omegaRecommended||0.5).toFixed(2)
                  : '尚未回测。对AI说"执行回测"来验证评分准确率'
              }>
                <span className={'text-[11px] font-mono font-bold px-2 py-1 rounded-full ' + (
                  settings.omegaAccuracy != null && settings.omegaAccuracy > 0
                    ? (settings.omegaAccuracy > 0.65 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                       settings.omegaAccuracy > 0.55 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                       'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400')
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 cursor-help'
                )}>
                  {settings.omegaAccuracy != null && settings.omegaAccuracy > 0
                    ? (settings.omegaAccuracy*100).toFixed(0) + '% Ω'
                    : '-- Ω'}
                </span>
              </Tooltip>
             <Tooltip content="管理 AI 长期记忆">
                <button onClick={(e) => { setMemoTriggerRect(e.currentTarget.getBoundingClientRect()); setIsMemoModalOpen(true); setIsMemoOpening(true); requestAnimationFrame(() => requestAnimationFrame(() => setIsMemoOpening(false))); }} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-[0.625rem] transition-colors relative">
                  <Brain size={18} />
                  {memos.length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow-sm border border-white dark:border-slate-900">
                          {memos.length}
                      </span>
                  )}
                </button>
              </Tooltip>
              {/* 打分历史按钮（手动拉取，无实时监听） */}
              <Tooltip key={`score-tip-${scoringHistory !== null}`} content="量化打分历史">
                <button onClick={(e) => { setScoringTriggerRect(e.currentTarget.getBoundingClientRect()); setIsScoringOpening(true); requestAnimationFrame(() => requestAnimationFrame(() => setIsScoringOpening(false))); openScoringPanel(); }} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-[0.625rem] transition-colors relative">
                  <Activity size={18} />
                  {(isScoringLoading || isScoringRefreshing) && <span className="absolute inset-0 flex items-center justify-center"><RefreshCw size={12} className={`animate-spin ${isScoringRefreshing ? 'text-indigo-300' : 'text-indigo-500'}`} /></span>}
                </button>
              </Tooltip>
              {/* 新建对话按钮 */}
              <Tooltip content="新建对话"><button onClick={handleNewConversation} className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 rounded-[0.625rem] transition-colors"><Plus size={18} /></button></Tooltip>
              {/* 历史对话按钮 */}
              <Tooltip content="切换对话"><button onClick={(e) => { setConvListTriggerRect(e.currentTarget.getBoundingClientRect()); setShowConvList(true); setIsConvListOpening(true); requestAnimationFrame(() => requestAnimationFrame(() => setIsConvListOpening(false))); }} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-[0.625rem] transition-colors"><MessageCircle size={18} /></button></Tooltip>
              {/* 清空当前对话 */}
              <Tooltip content="清空当前对话"><button onClick={(e) => { setConfirmTriggerRect(e.currentTarget.getBoundingClientRect()); handleClear(); }} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-[0.625rem] transition-colors"><Trash2 size={18} /></button></Tooltip>
              <button onClick={handleClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-[0.625rem] transition-colors"><X size={18} /></button>
            </div>
          </div>

{/* 🌟 新增：周五例行巡检醒目黄条 */}
          {showInspectionBanner && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200/60 dark:border-amber-800/30 px-4 py-2.5 flex items-center justify-between shrink-0 z-10 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center text-amber-800 dark:text-amber-300 text-[13px] sm:text-sm font-medium">
                      距离上次记忆库维护已过一周，建议立即执行例行巡检。
                  </div>
                  <div className="flex items-center space-x-2 shrink-0 ml-2">
                      <button
                          onClick={handleTriggerInspection}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-[0.625rem] shadow-sm transition-colors whitespace-nowrap active:scale-[0.97]"
                      >
                          立即巡检
                      </button>
                      <button
                          onClick={() => setShowInspectionBanner(false)}
                          className="p-1.5 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300 rounded-[0.625rem] transition-colors"
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

            {/* 🌟 按对话显示 loading：切到其他对话自动隐藏，切回自动恢复 */}
            {isLoading && (
              <div className="flex justify-start animate-fade-in-up">
                <div className="flex flex-row max-w-[85%]">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm ring-2 ring-white dark:ring-slate-900 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 mr-2 sm:mr-3">
                    {aiStatus?.type === 'tool'
                      ? <Activity size={15} className="animate-pulse" />
                      : <RefreshCw size={15} className="animate-spin" />
                    }
                  </div>
                  <div className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-[1.25rem] shadow-apple-sm">
                    {aiStatus ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500 dark:text-slate-400">{aiStatus.label}</span>
                        {aiStatus.type === 'thinking' && (
                          <span className="flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce-dot" />
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce-dot" style={{ animationDelay: '0.2s' }} />
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce-dot" style={{ animationDelay: '0.4s' }} />
                          </span>
                        )}
                        {aiStatus.type === 'tool' && (
                          <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full font-mono">{aiStatus.round ? 'R' + aiStatus.round : ''}</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce-dot" />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce-dot" style={{ animationDelay: '0.2s' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce-dot" style={{ animationDelay: '0.4s' }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 — Apple风格 */}
          <div className="p-3 sm:p-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-glass border-t border-slate-200/50 dark:border-slate-700/30 shrink-0 relative safe-bottom">
            
            {/* 🌟 新增：OCR 引擎切换开关 (仅在选择了附件时显示，保持界面清爽) */}
            {attachment && (
                <div className="absolute -top-[90px] left-6 flex items-center p-1 bg-white dark:bg-slate-800 rounded-[0.875rem] border border-slate-200/60 dark:border-slate-700/40 shadow-apple-md animate-in fade-in">
                    <button
                        onClick={() => setOcrEngine('gemini')}
                        className={`px-3 py-1 text-xs font-medium rounded-[0.625rem] transition-all ${ocrEngine === 'gemini' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <Sparkles size={12} className="inline mr-1 mb-0.5"/> Gemini 视觉
                    </button>
                </div>
            )}

            {/* 附件预览区 */}
            {previewUrl && (
                <div className="absolute -top-16 left-6 p-1.5 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/40 rounded-[0.875rem] shadow-apple-md flex items-center animate-in fade-in slide-in-from-bottom-2">
                    <img src={previewUrl} alt="预览" className="h-12 w-12 object-cover rounded-[0.625rem] mr-2" />
                    <div className="flex flex-col mr-2 text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">{attachment?.name}</span>
                        <span className="text-slate-400">{ocrEngine === 'gemini' ? 'Gemini 待命' : 'Deepseek 待命'}</span>
                    </div>
                    <button onClick={removeAttachment} className="p-1 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 dark:bg-slate-700 dark:hover:bg-red-900/30 rounded-full transition-colors">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* 输入框容器 — Apple pill风格 */}
            <div className="relative flex flex-col bg-slate-100 dark:bg-slate-800 rounded-[1.25rem] border border-slate-200/60 dark:border-slate-700/40 p-2 focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-400 transition-all duration-300 ease-spring">
            
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
                  placeholder="询问投资建议..."
                  className="w-full max-h-40 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none px-3 py-2 text-sm sm:text-base dark:text-white outline-none custom-scrollbar"
                  rows={1}
              />

              {/* 2. 下半部分：操作底栏 */}
              <div className="flex items-center justify-between mt-1 px-1">

                {/* 左侧：工具功能组 */}
                <div className="flex items-center space-x-1 sm:space-x-1.5">
                  <Tooltip content="上传走势截图或研报">
                    <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-[0.625rem] transition-colors text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-500">
                      <Paperclip size={18} />
                    </button>
                  </Tooltip>

                  <Tooltip content={enableMacroRadar ? "大盘雷达：已开启" : "大盘雷达：已关闭"}>
                    <button onClick={() => setEnableMacroRadar(!enableMacroRadar)} className={`p-2 rounded-[0.625rem] transition-colors ${enableMacroRadar ? 'text-blue-500 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-500'}`}>
                      <Activity size={18} className={enableMacroRadar ? 'animate-pulse' : ''} />
                    </button>
                  </Tooltip>

                  <Tooltip content={useWebSearch ? "联网搜索：已开启" : "联网搜索：已关闭"}>
                    <button onClick={() => setUseWebSearch(!useWebSearch)} className={`p-2 rounded-[0.625rem] transition-colors ${useWebSearch ? 'text-blue-500 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-500'}`}>
                      <Globe size={18} />
                    </button>
                  </Tooltip>

                  <Tooltip content="AI 参数设置">
                    <button onClick={(e) => { setAiParamsTriggerRect(e.currentTarget.getBoundingClientRect()); setShowAiParams(!showAiParams); }} className={`p-2 rounded-[0.625rem] transition-colors ${showAiParams ? 'text-purple-500 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-500'}`}>
                      <SlidersHorizontal size={18} />
                    </button>
                  </Tooltip>
                </div>

                <button
                  ref={sendBtnRef}
                  onClick={handleSend}
                  disabled={isLoading || (!input.trim() && !attachment)}
                  className="p-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-[0.75rem] transition-all duration-200 ease-spring disabled:opacity-40 disabled:cursor-not-allowed shadow-apple-sm active:scale-[0.94]"
                >
                  <Send size={18} />
                </button>
              </div>

            </div>

          </div>

          {/* AI 战略记忆库弹窗 — Apple风格 */}
          {isMemoModalOpen && (
            <div
              style={{ transition: `opacity ${0.2 * (settings.animationSpeed || 1) * (isMemoClosing ? 2.0 : 1)}s ease-out` }}
              className={`absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ${isMemoOpening || isMemoClosing ? "pointer-events-none" : ""} ${isMemoOpening ? 'opacity-0' : isMemoClosing ? 'opacity-0' : 'opacity-100'}`}
              onClick={() => { setIsMemoClosing(true); setTimeout(() => { setIsMemoModalOpen(false); setIsMemoClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }}
            >
              <div
                style={{
                  transition: isMemoClosing
                    ? `transform ${0.75 * (settings.animationSpeed || 1) * 2.0}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.25 * (settings.animationSpeed || 1)}s ease-out`
                    : `transform ${0.75 * (settings.animationSpeed || 1)}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.75 * (settings.animationSpeed || 1)}s ease-out`,
                  ...(memoFlip && (isMemoOpening || isMemoClosing) ? { transform: `translate(${memoFlip.tx}px, ${memoFlip.ty}px) scale(${memoFlip.scale})`, opacity: 0 } : {})
                }}
                className={`w-full max-w-xl bg-slate-50 dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl flex flex-col overflow-hidden border border-slate-200/60 dark:border-slate-700/40 ${isMemoOpening || isMemoClosing ? '' : 'scale-100 opacity-100'}`}
                onClick={e => e.stopPropagation()}
              >

                <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40 flex justify-between items-center bg-white dark:bg-slate-800">
                  <h3 className="font-bold flex items-center text-slate-800 dark:text-slate-200">
                      <Brain className="mr-2 text-purple-500" size={20}/>
                      AI 专属战略记忆库
                  </h3>
                  <div className="flex items-center space-x-2">
                      <button
                          onClick={handleTriggerInspection}
                          className="flex items-center px-3 py-1.5 text-xs font-bold bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 rounded-[0.625rem] transition-colors"
                      >
                          <RefreshCw size={14} className="mr-1.5" />
                          例行巡检
                      </button>
                      <button
                        onClick={() => { setIsMemoClosing(true); setTimeout(() => { setIsMemoModalOpen(false); setIsMemoClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                      ><X size={18}/></button>
                  </div>
                </div>

                <div className="p-4 overflow-y-auto max-h-[75vh] space-y-3 custom-scrollbar">
                  {memos.length === 0 ? (
                      <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                          <Brain size={48} className="text-purple-300 dark:text-purple-700 opacity-30 mb-3" />
                          <span>AI 当前的大脑一片空白，没有长期战略记忆。</span>
                      </div>
                  ) : (
                      memos.map(memo => (
                          <div key={memo.id} className="bg-white dark:bg-slate-800 p-4 rounded-[0.875rem] border border-purple-100 dark:border-purple-800/30 shadow-apple-sm relative group transition-all hover:shadow-apple-md">
                              
                              {/* 🌟 判断是否处于编辑模式 */}
                              {editingMemoId === memo.id ? (
                                  <div className="space-y-3">
                                      <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                          {memo.targetName} <span className="text-slate-400 font-mono text-xs font-normal">({memo.target})</span>
                                      </div>
                                      
                                      <AppleSelect
                                          value={editMemoForm.decisionType}
                                          onChange={(val) => setEditMemoForm({...editMemoForm, decisionType: val})}
                                          triggerClassName="p-2.5 text-xs font-bold bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                                          options={[
                                            { value: 'BUY_STRATEGY', label: 'BUY_STRATEGY (战略看多/底仓)' },
                                            { value: 'WATCH_GRID', label: 'WATCH_GRID (网格震荡/波段)' },
                                            { value: 'HOLD_STRATEGY', label: 'HOLD_STRATEGY (持有观望)' },
                                            { value: 'BLACK_LIST', label: 'BLACK_LIST (黑名单/不碰)' },
                                            { value: 'GLOBAL_MACRO', label: 'GLOBAL_MACRO (宏观大盘定调)' },
                                          ]}
                                      />

                                      <textarea 
                                          value={editMemoForm.coreLogic}
                                          onChange={(e) => setEditMemoForm({...editMemoForm, coreLogic: e.target.value})}
                                          className="w-full p-2.5 text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-[0.75rem] outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 min-h-[200px] custom-scrollbar"
                                      />

                                      <div className="flex justify-end space-x-2 pt-1">
                                          <button 
                                              onClick={() => setEditingMemoId(null)}
                                              className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-[0.625rem] transition-colors"
                                          >
                                              取消
                                          </button>
                                          <button
                                              onClick={() => handleSaveMemoEdit(memo.id)}
                                              className="flex items-center px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-[0.625rem] shadow-sm transition-colors active:scale-[0.97]"
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
                                              className="text-slate-500 hover:text-purple-500 bg-slate-100 hover:bg-purple-50 dark:text-slate-400 dark:bg-slate-700/80 dark:hover:bg-purple-900/30 p-2 rounded-[0.625rem] transition-colors shadow-sm active:scale-90"
                                          >
                                              <Edit size={16}/>
                                          </button>
                                          <button 
                                              onClick={(e) => { setConfirmTriggerRect(e.currentTarget.getBoundingClientRect()); handleDeleteMemo(memo.id); }} 
                                              className="text-slate-500 hover:text-red-500 bg-slate-100 hover:bg-red-50 dark:text-slate-400 dark:bg-slate-700/80 dark:hover:bg-red-900/30 p-2 rounded-[0.625rem] transition-colors shadow-sm active:scale-90"
                                          >
                                              <Trash2 size={16}/>
                                          </button>
                                      </div>

                                      {/* 为了防止文字与放大的常显按钮重叠，把 pr-16 扩大到 pr-20 */}
                                      <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1 pr-20">
                                          {memo.targetName} <span className="text-slate-400 font-mono text-xs font-normal">({memo.target})</span>
                                      </div>
                                      <div className="text-xs text-purple-600 dark:text-purple-400 font-bold mb-2 inline-block bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-[0.625rem]">
                                          定调方向: {memo.decisionType}
                                      </div>
                                      <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-[0.875rem] border border-purple-100 dark:border-purple-800/50">
                                          {renderMemoText(memo.coreLogic)}
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

          {/* 历史对话弹窗 */}
          {showConvList && (
            <div
              style={{ transition: `opacity ${0.2 * (settings.animationSpeed || 1) * (isConvListClosing ? 2.0 : 1)}s ease-out` }}
              className={`absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ${isConvListOpening || isConvListClosing ? "pointer-events-none" : ""} ${isConvListOpening ? 'opacity-0' : isConvListClosing ? 'opacity-0' : 'opacity-100'}`}
              onClick={() => { setIsConvListClosing(true); setTimeout(() => { setShowConvList(false); setIsConvListClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }}
            >
              <div
                style={{
                  transition: isConvListClosing
                    ? `transform ${0.75 * (settings.animationSpeed || 1) * 2.0}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.25 * (settings.animationSpeed || 1)}s ease-out`
                    : `transform ${0.75 * (settings.animationSpeed || 1)}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.75 * (settings.animationSpeed || 1)}s ease-out`,
                  ...(convListFlip && (isConvListOpening || isConvListClosing) ? { transform: `translate(${convListFlip.tx}px, ${convListFlip.ty}px) scale(${convListFlip.scale})`, opacity: 0 } : {})
                }}
                className="w-full max-w-md max-h-[80vh] bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl flex flex-col overflow-hidden border border-slate-200/60 dark:border-slate-700/40"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40 flex justify-between items-center bg-white dark:bg-slate-800">
                  <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">历史对话</h3>
                  <button onClick={() => { setIsConvListClosing(true); setTimeout(() => { setShowConvList(false); setIsConvListClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"><X size={16} /></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {Object.keys(conversations).length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-400">暂无历史对话</div>
                  ) : (
                    Object.entries(conversations)
                      // 🌟 核心修复：用真实时间戳大小做比对进行降序，避免空字符串在 localeCompare 中出现不可预测的错乱排序！
                      .sort(([,a], [,b]) => {
                          const timeA = a.updatedAt || a.createdAt;
                          const timeB = b.updatedAt || b.createdAt;
                          const tA = timeA ? new Date(timeA).getTime() : 0;
                          const tB = timeB ? new Date(timeB).getTime() : 0;
                          return tB - tA;
                      })
                      .map(([convId, meta]) => (
                        <div
                          key={convId}
                          className={`flex items-center border-b border-slate-100 dark:border-slate-700/30 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${convId === activeConvId ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        >
                          {/* 点击区域：切换对话（改为 div，避免 button 嵌套 button 导致内层按钮不可见） */}
                          <div
                            onClick={() => handleSwitchConversation(convId)}
                            className="flex-1 text-left px-5 py-4 min-w-0 cursor-pointer"
                          >
                            {editingConvId === convId ? (
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <input
                                  value={editTitleValue}
                                  onChange={e => setEditTitleValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveTitle(convId); } if (e.key === 'Escape') { e.preventDefault(); setEditingConvId(null); } }}
                                  className="flex-1 text-sm font-medium px-2 py-1 rounded-md border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                  autoFocus
                                  onFocus={e => e.target.select()}
                                />
                                <button onClick={(e) => { e.stopPropagation(); handleSaveTitle(convId); }} className="p-1 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 rounded shrink-0"><Check size={14} /></button>
                              </div>
                            ) : (
                              <span className={`font-medium text-sm truncate block ${convId === activeConvId ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>{meta.title || '新对话'}</span>
                            )}
                            <div className="text-[11px] text-slate-400 mt-1">{(meta.updatedAt || meta.createdAt) ? new Date(meta.updatedAt || meta.createdAt).toLocaleString('zh-CN') : ''}</div>
                          </div>
                          {/* 编辑标题按钮 */}
                          <Tooltip content="编辑标题">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleStartEditTitle(convId, meta.title); }}
                              className="shrink-0 p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-[0.625rem] transition-colors active:scale-90"
                            ><Edit size={16} /></button>
                          </Tooltip>
                          {/* 删除按钮 — default 对话不可删除 */}
                          {convId !== 'default' && (
                            <Tooltip content="删除对话">
                              <button
                                onClick={(e) => handleDeleteConversation(convId, e)}
                                className="shrink-0 p-2 mr-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-[0.625rem] transition-colors active:scale-90"
                              >
                                <Trash2 size={16} />
                              </button>
                            </Tooltip>
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

      {/* AI 参数设置面板 — 毛玻璃效果，fixed 定位在齿轮按钮上方 */}
      {showAiParams && isOpen && (
        <div
          className="fixed z-[70] w-72 bg-white/30 dark:bg-slate-900/30 backdrop-blur-xl rounded-modal border border-slate-200/60 dark:border-slate-700/40 shadow-apple-2xl p-4 animate-spring-up max-h-[70vh] overflow-y-auto custom-scrollbar"
          style={{
            left: aiParamsTriggerRect
              ? Math.min(Math.max(aiParamsTriggerRect.left + aiParamsTriggerRect.width / 2 - 144, 8), window.innerWidth - 296)
              : '50%',
            bottom: aiParamsTriggerRect
              ? window.innerHeight - aiParamsTriggerRect.top + 8
              : '50%',
            transform: aiParamsTriggerRect ? 'none' : 'translate(-50%, 50%)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <Sparkles size={14} className="text-slate-500 mr-1.5" />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">AI 参数设置</span>
            </div>
            <button onClick={() => setShowAiParams(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded-[0.625rem] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <X size={14} />
            </button>
          </div>

          {(settings.aiProvider === 'deepseek' || settings.aiProvider === 'siliconflow') && (
            <div className="mb-3 pb-3 border-b border-slate-100 dark:border-slate-700/50">
              <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 block mb-2">推理深度</span>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'disabled', label: '⚡ 快速', desc: '禁用推理' },
                  { id: 'high', label: '🔍 深度', desc: '平衡推理' },
                  { id: 'max', label: '🧠 极致', desc: '最强推理' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSaveSettings({ reasoningEffort: opt.id })}
                    className={`p-2 border rounded-[0.625rem] flex flex-col items-center transition-all duration-200 active:scale-[0.97] text-[10px] leading-tight ${
                      (settings.reasoningEffort || 'max') === opt.id
                        ? 'bg-purple-100 border-purple-400 text-purple-700 dark:bg-purple-900/40 dark:border-purple-500 dark:text-purple-300 shadow-sm'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span className="font-bold text-[11px]">{opt.label}</span>
                    <span className="text-[9px] opacity-70 mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3 pb-3 border-b border-purple-100 dark:border-purple-800/50">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">Temperature</span>
                <span className="text-[11px] font-mono font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-[0.625rem]">{(settings.temperature ?? 0.1).toFixed(2)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={settings.temperature ?? 0.1}
                onChange={e => onSaveSettings({ temperature: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-purple-200 dark:bg-purple-700 rounded-full appearance-none cursor-pointer accent-purple-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-600 [&::-webkit-slider-thumb]:shadow" />
              <p className="text-[9px] text-purple-500 dark:text-purple-400 mt-0.5">越低越严谨确定，越高越有创造性</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">Top P</span>
                <span className="text-[11px] font-mono font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-[0.625rem]">{(settings.topP ?? 0.85).toFixed(2)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={settings.topP ?? 0.85}
                onChange={e => onSaveSettings({ topP: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-purple-200 dark:bg-purple-700 rounded-full appearance-none cursor-pointer accent-purple-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-600 [&::-webkit-slider-thumb]:shadow" />
              <p className="text-[9px] text-purple-500 dark:text-purple-400 mt-0.5">控制词汇多样性，配合 Temperature 使用</p>
            </div>
          </div>

          <div className="space-y-3 pt-3">
            <div>
              <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block mb-1">最大输出 Token</label>
              <AppleSelect value={String(settings.maxOutputTokens || 8192)} onChange={(val) => onSaveSettings({ maxOutputTokens: parseInt(val) })}
                triggerClassName="px-2.5 py-2 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                options={[
                  { value: '2048', label: '2,048' },
                  { value: '4096', label: '4,096' },
                  { value: '8192', label: '8,192 (默认)' },
                  { value: '16384', label: '16,384' },
                ]}
              />
              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">限制 AI 单次回复最大输出，防止过量消耗</p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block mb-1">上下文窗口</label>
              <AppleSelect value={String(settings.maxHistoryMessages || 20)} onChange={(val) => onSaveSettings({ maxHistoryMessages: parseInt(val) })}
                triggerClassName="px-2.5 py-2 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                options={[
                  { value: '5', label: '5 条' },
                  { value: '10', label: '10 条' },
                  { value: '20', label: '20 条 (默认)' },
                  { value: '30', label: '30 条' },
                ]}
              />
              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">更大的窗口让 AI 记住更多，但消耗更多 Token</p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block mb-1">工具调用最大轮次</label>
              <AppleSelect value={String(settings.maxToolLoops || 12)} onChange={(val) => onSaveSettings({ maxToolLoops: parseInt(val) })}
                triggerClassName="px-2.5 py-2 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[0.75rem] text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                options={[
                  { value: '4', label: '4 轮' },
                  { value: '8', label: '8 轮' },
                  { value: '12', label: '12 轮 (默认)' },
                  { value: '20', label: '20 轮' },
                ]}
              />
              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">更多轮次 = 更深研究，更高 API 调用费用</p>
            </div>
          </div>
        </div>
      )}
      {/* 打分历史查看面板（手动拉取，按需展示） — Apple FLIP 动画 */}
      {scoringHistory !== null && (
        <div
          style={{ transition: `opacity ${0.2 * (settings.animationSpeed || 1) * (isScoringClosing ? 2.0 : 1)}s ease-out` }}
          className={`fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ${isScoringOpening || isScoringClosing ? "pointer-events-none" : ""} ${isScoringOpening ? 'opacity-0' : isScoringClosing ? 'opacity-0' : 'opacity-100'}`}
          onClick={() => { setIsScoringClosing(true); setTimeout(() => { setScoringHistory(null); setIsScoringClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }}
        >
          <div
            style={{
              transition: isScoringClosing
                ? `transform ${0.75 * (settings.animationSpeed || 1) * 2.0}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.25 * (settings.animationSpeed || 1)}s ease-out`
                : `transform ${0.75 * (settings.animationSpeed || 1)}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.75 * (settings.animationSpeed || 1)}s ease-out`,
              ...(scoringFlip && (isScoringOpening || isScoringClosing) ? { transform: `translate(${scoringFlip.tx}px, ${scoringFlip.ty}px) scale(${scoringFlip.scale})`, opacity: 0 } : {})
            }}
            className="w-full max-w-lg max-h-[80vh] bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl flex flex-col overflow-hidden border border-slate-200/60 dark:border-slate-700/40"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40 flex justify-between items-center bg-white dark:bg-slate-800 shrink-0">
              <h3 className="font-bold flex items-center text-slate-800 dark:text-slate-200 text-sm">
                <Activity className="mr-2 text-indigo-500" size={18} />
                量化打分历史
                {isScoringRefreshing && <span className="ml-2 text-[10px] font-normal text-indigo-400 flex items-center gap-1"><RefreshCw size={10} className="animate-spin" />刷新中</span>}
              </h3>
              <button onClick={() => { setIsScoringClosing(true); setTimeout(() => { setScoringHistory(null); setIsScoringClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto custom-scrollbar space-y-3">
              {isScoringLoading ? (
                <div className="text-center text-slate-400 py-12 text-sm min-h-[200px] flex flex-col items-center justify-center"><RefreshCw size={20} className="animate-spin mx-auto mb-2 text-indigo-500" />加载中...</div>
              ) : scoringHistory.length === 0 ? (
                <div className="text-center text-slate-400 py-8 text-sm">暂无打分记录</div>
              ) : (
                scoringHistory.map((s, i) => (
                  <div key={s.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-[0.875rem] p-3.5 border border-slate-100 dark:border-slate-700/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{s.date}{s.createdAt ? ` · ${new Date(s.createdAt).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}` : ""}</span>
                      <div className="flex items-center gap-1.5">
                        {s.equity && (
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: s.equity.final >= 50 ? 'rgba(52,199,89,0.15)' : s.equity.final >= 35 ? 'rgba(0,122,255,0.15)' : s.equity.final >= 20 ? 'rgba(255,149,0,0.15)' : 'rgba(255,59,48,0.15)',
                              color: s.equity.final >= 50 ? '#34C759' : s.equity.final >= 35 ? '#007AFF' : s.equity.final >= 20 ? '#FF9500' : '#FF3B30'
                            }}>
                            权益{s.equity.final}分
                          </span>
                        )}
                        {s.bond && (
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: s.bond.final >= 50 ? 'rgba(52,199,89,0.15)' : s.bond.final >= 35 ? 'rgba(0,122,255,0.15)' : s.bond.final >= 20 ? 'rgba(255,149,0,0.15)' : 'rgba(255,59,48,0.15)',
                              color: s.bond.final >= 50 ? '#34C759' : s.bond.final >= 35 ? '#007AFF' : s.bond.final >= 20 ? '#FF9500' : '#FF3B30'
                            }}>
                            固收{s.bond.final}分
                          </span>
                        )}
                      </div>
                    </div>
                    {s.equity && (
                      <>
                        <div className="text-[10px] text-slate-400 mb-1 font-medium tracking-wide">📈 权益打分</div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                          <span>F1a 上证赔率: <b className="text-slate-700 dark:text-slate-300">{s.equity.F1a != null ? s.equity.F1a : s.equity.F1 != null ? Math.round(s.equity.F1 * 20/35) : '?'}</b></span>
                          <span>F1b 双创校验: <b className="text-slate-700 dark:text-slate-300">{s.equity.F1b != null ? s.equity.F1b : s.equity.F1 != null ? Math.round(s.equity.F1 * 15/35) : '?'}</b></span>
                          <span>F2 微观反转: <b className="text-slate-700 dark:text-slate-300">{s.equity.F2}</b></span>
                          <span>F3 量能验证: <b className="text-slate-700 dark:text-slate-300">{s.equity.F3}</b></span>
                          <span>F4 跨资产: <b className="text-slate-700 dark:text-slate-300">{s.equity.F4}</b></span>
                          <span>因子总分: <b className="text-slate-700 dark:text-slate-300">{s.equity.totalRaw}</b></span>
                          <span>动量修正: <b className={s.equity.momentum > 0 ? 'text-green-500' : s.equity.momentum < 0 ? 'text-red-500' : 'text-slate-500'}>{s.equity.momentum >= 0 ? '+' : ''}{s.equity.momentum ?? 0}</b></span>
                        </div>
                        {(s.equity.turnoverYi || s.equity.f3Flags) && (
                          <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                            {s.equity.turnoverYi && <span>📊 成交{s.equity.turnoverYi}亿 ↑{s.equity.upCount ?? '?'}/↓{s.equity.downCount ?? '?'}</span>}
                            {s.equity.volumeRatio && <span className="ml-2">量比{s.equity.volumeRatio.toFixed(1)}</span>}
                            {s.equity.f3Flags && <span className="ml-2 text-amber-500">🏷 {s.equity.f3Flags}</span>}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                          {s.northbound?.totalNet != null ? (
                            <span>🌏 北向资金: 净{s.northbound.totalNet >= 0 ? '流入' : '流出'}{Math.abs(s.northbound.totalNet).toFixed(0)}亿（沪{s.northbound.shNet != null ? (s.northbound.shNet >= 0 ? '+' : '') + s.northbound.shNet.toFixed(0) : '?'}亿/深{s.northbound.szNet != null ? (s.northbound.szNet >= 0 ? '+' : '') + s.northbound.szNet.toFixed(0) : '?'}亿）</span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">🌏 北向资金: --</span>
                          )}
                        </div>
                      </>
                    )}
                    {s.bond && (
                      <>
                        <div className="text-[10px] text-slate-400 mb-1 font-medium tracking-wide">📉 固收打分</div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                          <span>F1 利率水位: <b className="text-slate-700 dark:text-slate-300">{s.bond.F1}</b></span>
                          <span>F2 股债跷跷板: <b className="text-slate-700 dark:text-slate-300">{s.bond.F2}</b></span>
                          <span>因子总分: <b className="text-slate-700 dark:text-slate-300">{s.bond.totalRaw}</b></span>
                          <span>动量修正: <b className={s.bond.momentum > 0 ? 'text-green-500' : s.bond.momentum < 0 ? 'text-red-500' : 'text-slate-500'}>{s.bond.momentum >= 0 ? '+' : ''}{s.bond.momentum ?? 0}</b></span>
                        </div>
                      </>
                    )}
                    {s.verdict && (
                      <div className="flex items-center gap-2 text-[11px] flex-wrap">
                        <span className="text-slate-400">CIO判定:</span>
                        <span className="font-medium" style={{ color: { BUY_STRATEGY: '#34C759', HOLD_STRATEGY: '#007AFF', WATCH_GRID: '#FF9500', BLACK_LIST: '#FF3B30' }[s.verdict.equityAction] || '#6b7280' }}>
                          权益:{{ BUY_STRATEGY: '买入/加仓', HOLD_STRATEGY: '持有/观望', WATCH_GRID: '战术网格', BLACK_LIST: '回避/减仓' }[s.verdict.equityAction] || '未判定'}
                        </span>
                        {s.verdict.bondAction && (
                          <span className="font-medium" style={{ color: { BUY_STRATEGY: '#34C759', HOLD_STRATEGY: '#007AFF', WATCH_GRID: '#FF9500', BLACK_LIST: '#FF3B30' }[s.verdict.bondAction] || '#6b7280' }}>
                            固收:{{ BUY_STRATEGY: '买入/加仓', HOLD_STRATEGY: '持有/观望', WATCH_GRID: '战术网格', BLACK_LIST: '回避/减仓' }[s.verdict.bondAction] || '未判定'}
                          </span>
                        )}
                        {(() => {
                          // 🔒 滞回只在得分跨越zone边界但±5去抖拦住时才有效
                          // bond zone: <35WATCH / 35-55HOLD / 55-75BUY / >75BUY+
                          // equity zone: 同理
                          // 得分稳定在zone内部(距离边界≥10分)时不可能有滞回
                          const eqScore = s.equity?.final ?? 100;
                          const bdScore = s.bond?.final ?? 100;
                          const validEq = s.verdict.equityHysteresis === true && eqScore >= 25 && eqScore <= 50;
                          const validBd = s.verdict.bondHysteresis === true && bdScore >= 25 && bdScore <= 50;
                          const hasOld = s.verdict.hysteresisActive && s.verdict.equityHysteresis === undefined;
                          if (!validEq && !validBd && !hasOld) return null;
                          return (
                            <span className="text-amber-500 text-[10px]">
                              🛡️ 滞回锁定:{validEq ? '权益' : ''}{validEq && validBd ? '/' : ''}{validBd ? '固收' : ''}{hasOld ? '(旧数据,未区分)' : ''}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    {(s.totalValue || s.totalProfit != null) && (
                      <div className="text-[10px] text-slate-400 mt-1 leading-relaxed border-t border-slate-100 dark:border-slate-700/30 pt-1.5">
                        💰 {s.totalValue && <span>市值{(s.totalValue/10000).toFixed(1)}万</span>}
                        {s.totalProfit != null && <span className="ml-2">累计盈亏 <b className={s.totalProfit >= 0 ? 'text-red-500' : 'text-green-500'}>{s.totalProfit >= 0 ? '+' : ''}{Math.round(s.totalProfit).toLocaleString()}</b></span>}
                        {s.overallXirr != null && <span className="ml-2">XIRR <b className={s.overallXirr >= 0 ? 'text-red-500' : 'text-green-500'}>{(s.overallXirr*100).toFixed(1)}%</b></span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 图片放大查看器 */}
      {zoomedImage && (
        <ImageModal
          src={zoomedImage.src}
          alt={zoomedImage.alt}
          onClose={() => setZoomedImage(null)}
        />
      )}

      {/* 自定义确认弹窗 */}
      {confirmAction && (
        <AnimatedModal onClose={() => setConfirmAction(null)} triggerRect={confirmTriggerRect} speed={settings.animationSpeed || 1.0}>
          {(close) => (
            <div className="bg-white dark:bg-slate-900 rounded-[0.875rem] shadow-apple-2xl p-5 mx-4 max-w-sm w-full border border-slate-200/60 dark:border-slate-700/40" onClick={e => e.stopPropagation()}>
              <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">{confirmAction.message}</p>
              <div className="flex justify-end space-x-2">
                <button onClick={close} className="px-4 py-2 rounded-[0.625rem] text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">取消</button>
                <button onClick={() => { confirmAction.onConfirm(); close(); }} className="px-4 py-2 rounded-[0.625rem] text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 active:scale-[0.97] transition-all">确认</button>
            </div>
          </div>
          )}
          </AnimatedModal>
        )}

    </>
  );
};

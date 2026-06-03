// AI 投资对话组件：资产 Copilot 聊天面板，支持联网搜索、大盘雷达、文件上传解析、AI 参数调节与战略记忆库
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MessageSquare, X, Send, RefreshCw, Trash2, Bot, User, Sparkles, Globe, Target, Brain, Activity, Paperclip, Edit, Check, SlidersHorizontal, Plus, ChevronDown, Share2, MessageCircle } from 'lucide-react';
import { chatWithPortfolioAI } from '../../utils/ai';
import { extractDataFromImage } from '../../services/fileParser';
import { renderMarkdown, renderMarkdownForPrint } from '../../utils/renderMarkdown';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalAnimation } from '../../hooks/useModalAnimation';
import { ActionCard } from './ActionCard';
import { dispatchAction } from './actionHandlers';
import { ImageModal } from '../UI/ImageModal';
import { AppleSelect } from '../UI/AppleSelect';
import { Tooltip } from '../UI/Tooltip';
import { AnimatedModal } from '../UI/AnimatedModal';
import { doc, setDoc, getDoc, onSnapshot, collection, query, updateDoc, deleteDoc } from 'firebase/firestore';
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
    open();
  }, [open]);

  const handleClose = useCallback(() => {
    setShowButton(true);
    animClose();
  }, [animClose]);
  const focusRef = useFocusTrap(isOpen);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [enableMacroRadar, setEnableMacroRadar] = useState(false);
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [ocrEngine, setOcrEngine] = useState('gemini');
  const [showAiParams, setShowAiParams] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmTriggerRect, setConfirmTriggerRect] = useState(null);
  const [isMemoClosing, setIsMemoClosing] = useState(false);
  const [isMemoOpening, setIsMemoOpening] = useState(true);

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
      const inspectionPrompt = "【系统自动触发：记忆库例行深度巡检】当前是例行维护日。请提取当前备忘录中的所有基金/资产代码，主动调用工具获取它们的最新精确净值与涨跌幅。然后，请使用 update_decision_memo 逐一覆写并更新那些包含‘过时时效性数字’（如：近1月收益、当前距离击球区的百分比、最新价格等）的记忆卡片。注意：除非基本面逻辑破裂，否则请保留原有的【战略定调】和【击球区阈值】。全部更新完毕后，请输出一份《记忆库洗盘与资产巡检报告》。";
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
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId), { title: newTitle }).catch(() => {});
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
            lastMessage: d.title || ''
          };
        }
      });
      // 确保 default 始终存在
      if (!list.default) {
        list.default = { title: '默认对话', createdAt: '', lastMessage: '' };
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
    const msgRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', activeConvId);
    const unsub = onSnapshot(msgRef, (snap) => {
      if (snap.exists() && snap.data().messages?.length > 0) {
        setMessages(snap.data().messages);
      } else {
        // 🌟 核心修复：防止串线！如果切换过去的对话在云端没数据，必须把本地的状态重置为空对话的欢迎语，否则会看到前一个对话的内容
        setMessages([{
            role: 'assistant',
            content: activeConvId === 'default'
                ? '您好！我是您的私人基金copilot。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？'
                : '新对话已开启。我已加载您的最新持仓数据，请问有什么可以帮您？',
            timestamp: new Date().toISOString()
        }]);
      }
    }, (err) => {
      console.error(`❌ 加载对话 [${activeConvId}] 失败:`, err);
      // 加载失败时保留当前本地消息，避免空白
    });

    // 🌟 一次性迁移：旧版 chat/history → chat_convs/default，完成后删除旧文档防止重复覆盖
    if (activeConvId === 'default') {
      const legacyRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat', 'history');
      getDoc(legacyRef).then(legacySnap => {
        if (legacySnap.exists() && legacySnap.data().messages?.length > 0) {
          const legacyMsgs = legacySnap.data().messages;
          // 🌟 修复：用 onSnapshot 已加载的最新数据做比对，而非闭包中的 prev（避免竞态）
          // 直接检查 chat_convs/default 是否已有 >= 旧数据的消息数，有则跳过迁移
          getDoc(msgRef).then(currentSnap => {
            const currentLen = currentSnap.exists() ? (currentSnap.data().messages?.length || 0) : 0;
            if (legacyMsgs.length > currentLen) {
              // 旧数据更长 → 执行迁移
              const lastUserMsg = [...legacyMsgs].reverse().find(m => m.role === 'user');
              const title = lastUserMsg ? lastUserMsg.content.substring(0, 30) : '默认对话';
              setDoc(msgRef, { messages: legacyMsgs, title, createdAt: new Date().toISOString() }, { merge: true }).then(() => {
                console.log('✅ 旧版 chat/history 已迁移到 chat_convs/default');
                // 🌟 迁移成功后立即删除旧文档，防止后续刷新时重复覆盖
                deleteDoc(legacyRef).catch(() => {});
              }).catch(() => {});
            } else {
              // 当前数据已更新 → 旧文档已无用，直接清理
              console.log('🧹 chat_convs/default 数据已更新，清理旧版 chat/history');
              deleteDoc(legacyRef).catch(() => {});
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    return () => { unsub(); };
  }, [user, activeConvId]);

  // 保存消息 + 同步更新 title 到消息文档自身
  const saveMessages = useCallback(async (msgs) => {
    if (!user || !db) return;
    const msgRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', activeConvId);
    const existingCreatedAt = conversations[activeConvId]?.createdAt;
    const payload = { messages: msgs };
    // title 仅在新建对话时写入，已存在的对话保留手动编辑的标题
    if (!existingCreatedAt) {
      const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
      payload.title = lastUserMsg
        ? lastUserMsg.content.substring(0, 30) + (lastUserMsg.content.length > 30 ? '...' : '')
        : (msgs.length > 1 ? '新对话' : '空对话');
      payload.createdAt = new Date().toISOString();
    } else {
      payload.createdAt = existingCreatedAt;
    }
    setDoc(msgRef, payload, { merge: true }).catch(err => console.error('❌ 保存对话失败，请检查 Firestore 规则:', err));
  }, [user, db, activeConvId, conversations]);

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

    // 🌟 保存用户消息到发起请求的对话（直接用 requestConvId，不用闭包中的 activeConvId）
    if (user && db) {
      const reqMsgRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', requestConvId);
      const existingCreatedAt = conversations[requestConvId]?.createdAt;
      const payload = { messages: newMessages };
      // title 仅在新建对话时写入；已存在的对话保留用户手动编辑的标题
      if (!existingCreatedAt) {
        const lastUserMsg = [...newMessages].reverse().find(m => m.role === 'user');
        payload.title = lastUserMsg
          ? lastUserMsg.content.substring(0, 30) + (lastUserMsg.content.length > 30 ? '...' : '')
          : '新对话';
        payload.createdAt = new Date().toISOString();
      } else {
        payload.createdAt = existingCreatedAt;
      }
      setDoc(reqMsgRef, payload, { merge: true }).catch(err => console.error('❌ 保存用户消息失败:', err));
    }

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

            if (user && db) {
                const reqMsgRef2 = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', requestConvId);
                setDoc(reqMsgRef2, { messages: finalMessages }, { merge: true }).catch(() => {});
            }
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

      // 🌟 核心拦截：如果开启则下发授权口令，如果关闭则下发系统禁令，防止模型幻觉
      const activeMarketData = enableMacroRadar
          ? "FETCH_NOW"
          : "【系统指令：用户已手动关闭大盘雷达，本次对话进入纯净模式。严禁读取、臆测或分析任何 A股、债市的大盘宏观走势！请彻底抛弃大盘数据，完全基于用户的具体基金持仓和提问作答。】";
      console.log('%c[大盘雷达] enableMacroRadar=' + enableMacroRadar + ' | activeMarketData=' + (activeMarketData === 'FETCH_NOW' ? 'FETCH_NOW' : 'PURE_MODE'), 'color: #f59e0b; font-weight: bold;');
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, activeMarketData, useWebSearch, todos, memos, setAiStatus);
      setAiStatus(null);

      // 🌟 核心防串线：AI 回复到达时，检查用户是否已切到其他对话
      if (activeConvIdRef.current !== requestConvId) {
        // 用户已切换对话！将 AI 回复静默写入原始对话的 Firestore，不更新当前 UI
        console.log(`⏭️ AI 回复属于对话 [${requestConvId}]，但用户已切到 [${activeConvIdRef.current}]，静默归档`);
        try {
          let replyMessages;
          if (typeof reply === 'object' && reply !== null && reply.type === 'ACTION_REQUIRED') {
            replyMessages = [...newMessages, { role: 'assistant', content: reply.text || '已为您生成操作卡片', isAction: true, actions: (reply.payload || []).map((act, idx) => ({ ...act, cardId: `act_${Date.now()}_${idx}`, status: 'pending' })), timestamp: new Date().toISOString() }];
          } else {
            replyMessages = [...newMessages, { role: 'assistant', content: typeof reply === 'string' ? reply : String(reply || ''), timestamp: new Date().toISOString() }];
          }
          const origRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', requestConvId);
          const existingCreatedAt2 = conversations[requestConvId]?.createdAt;
          const archivePayload = { messages: replyMessages };
          if (!existingCreatedAt2) {
            const lastUserMsg2 = [...replyMessages].reverse().find(m => m.role === 'user');
            archivePayload.title = lastUserMsg2 ? lastUserMsg2.content.substring(0, 30) + (lastUserMsg2.content.length > 30 ? '...' : '') : '新对话';
            archivePayload.createdAt = new Date().toISOString();
          } else {
            archivePayload.createdAt = existingCreatedAt2;
          }
          setDoc(origRef, archivePayload, { merge: true }).catch(err => console.error('❌ 归档AI回复失败:', err));
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
          const actionsWithStatus = (reply.payload || []).map((act, idx) => ({
              ...act,
              cardId: `act_${Date.now()}_${idx}`,
              status: 'pending'
          }));
          finalMessages = [...newMessages, {
              role: 'assistant',
              content: reply.text || `已为您生成以下操作卡片，请逐一核对：`,
              isAction: true,
              actions: actionsWithStatus,
              timestamp: new Date().toISOString()
          }];
      } else {
          finalMessages = [...newMessages, { role: 'assistant', content: typeof reply === 'string' ? reply : String(reply || ''), timestamp: new Date().toISOString() }];
      }
      setMessages(finalMessages);

      // 写入 Firestore（用 requestConvId 直写，不依赖 saveMessages 闭包中的 activeConvId）
      if (user && db) {
        const finalRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', requestConvId);
        const existingCreatedAt3 = conversations[requestConvId]?.createdAt;
        const finalPayload = { messages: finalMessages };
        // title 仅在新建对话时写入；已存在的对话保留用户手动编辑的标题
        if (!existingCreatedAt3) {
          const lastUserFinal = [...finalMessages].reverse().find(m => m.role === 'user');
          finalPayload.title = lastUserFinal ? lastUserFinal.content.substring(0, 30) + (lastUserFinal.content.length > 30 ? '...' : '') : '新对话';
          finalPayload.createdAt = new Date().toISOString();
        } else {
          finalPayload.createdAt = existingCreatedAt3;
        }
        setDoc(finalRef, finalPayload, { merge: true }).catch(err => console.error('❌ 保存AI回复失败:', err));
      }
    } catch (e) {
      console.error(`❌ AI 对话异常 [${requestConvId}]:`, e);
      // 🌟 始终在当前对话显示错误（仅当用户未切走时）
      if (activeConvIdRef.current === requestConvId) {
        const errorMessages = [...newMessages, { role: 'assistant', content: `❌ 抱歉，连接大脑失败：${e.message}`, timestamp: new Date().toISOString() }];
        setMessages(errorMessages);
        if (user && db) {
          const errRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', requestConvId);
          setDoc(errRef, { messages: errorMessages }, { merge: true }).catch(() => {});
        }
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
    const confirmConvId = activeConvId;
    setConvLoading(confirmConvId, true);
    try {
      await dispatchAction(action, formData, {
        user, settings,
        setMessages, setConvLoading, activeConvId: confirmConvId,
        onAddTodo, onUpdateTodo, onDeleteTodo,
        enableMacroRadar, useWebSearch,
        portfolioStats, todos, memos, messages,
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
  }, [user, settings, onAddTodo, onUpdateTodo, onDeleteTodo, enableMacroRadar, useWebSearch, portfolioStats, todos, memos, messages, activeConvId, setConvLoading]);

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

  // 【核心性能修复】使用 useMemo 阻断打字时触发的无效历史消息渲染
  const renderedMessages = useMemo(() => {
    return messages.map((msg, idx) => (
      <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group`}>
        <div className={`flex max-w-[90%] sm:max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm ring-2 ring-white dark:ring-slate-900 ${msg.role === 'user' ? 'bg-blue-500 text-white ml-2 sm:ml-3' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 mr-2 sm:mr-3'}`}>
            {msg.role === 'user' ? <User size={14} /> : <Bot size={15} />}
          </div>
          <div className={`px-4 py-3 text-[15px] leading-relaxed ${msg.role === 'user' ? 'bg-blue-500 text-white rounded-[1.25rem] shadow-apple-sm' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-[1.25rem] shadow-apple-sm'}`}>
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
        {/* 消息时间戳 — 默认隐藏，鼠标悬浮显示 */}
        <div className={`text-[10px] text-slate-400 dark:text-slate-500 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none ${msg.role === 'user' ? 'text-right mr-1' : 'text-left ml-1'}`}>
          {formatMessageTime(msg.timestamp)}
        </div>
      </div>
    ));
}, [messages, handleCancelAction, handleConfirmAction, handleShareAsPDF, todos]);

  return (
    <>
      {/* 右下角悬浮入口按钮 — Apple风格 */}
      <button
        onClick={handleOpen}
        className={`fixed bottom-6 right-6 p-4 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-apple-xl transition-all duration-300 ease-spring hover:scale-110 active:scale-95 z-40 ring-4 ring-white/80 dark:ring-slate-900/80 ${showButton ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`}
      >
        <MessageSquare size={24} />
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm" />
      </button>

      {/* 遮罩层 + 面板 — FLIP动画 */}
      <div style={overlayStyle} onClick={handleClose}>
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

              {/* AI 参数弹出面板 */}
              {showAiParams && (
                <div className="absolute bottom-full left-2 mb-3 w-72 bg-white dark:bg-slate-900 rounded-modal border border-slate-200/60 dark:border-slate-700/40 shadow-apple-2xl p-4 animate-spring-up z-50 max-h-[70vh] overflow-y-auto custom-scrollbar">
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
                        <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">Top-P</span>
                        <span className="text-[11px] font-mono font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-[0.625rem]">{(settings.topP ?? 0.1).toFixed(2)}</span>
                      </div>
                      <input type="range" min="0" max="1" step="0.05" value={settings.topP ?? 0.1}
                        onChange={e => onSaveSettings({ topP: parseFloat(e.target.value) })}
                        className="w-full h-1.5 bg-purple-200 dark:bg-purple-700 rounded-full appearance-none cursor-pointer accent-purple-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-600 [&::-webkit-slider-thumb]:shadow" />
                      <p className="text-[9px] text-purple-500 dark:text-purple-400 mt-0.5">核采样阈值，控制输出多样性</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 mt-3">
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
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block mb-1">聊天历史窗口</label>
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
                    <button onClick={() => setShowAiParams(!showAiParams)} className={`p-2 rounded-[0.625rem] transition-colors ${showAiParams ? 'text-purple-500 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 dark:text-slate-500'}`}>
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
              style={{ transition: `opacity ${0.2 * (settings.animationSpeed || 1) * (isMemoClosing ? 2.0 : 1)}s ease` }}
              className={`absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ${isMemoOpening ? 'opacity-0' : isMemoClosing ? 'opacity-0' : 'opacity-100'}`}
              onClick={() => { setIsMemoClosing(true); setTimeout(() => { setIsMemoModalOpen(false); setIsMemoClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }}
            >
              <div
                style={{
                  transition: `transform ${0.75 * (settings.animationSpeed || 1) * (isMemoClosing ? 2.0 : 1)}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.3 * (settings.animationSpeed || 1) * (isMemoClosing ? 2.0 : 1)}s ease`,
                  ...(memoFlip && (isMemoOpening || isMemoClosing) ? { transform: `translate(${memoFlip.tx}px, ${memoFlip.ty}px) scale(${memoFlip.scale})`, opacity: 0 } : {})
                }}
                className={`w-full max-w-lg bg-slate-50 dark:bg-slate-900 rounded-[1.25rem] shadow-apple-2xl flex flex-col overflow-hidden border border-slate-200/60 dark:border-slate-700/40 ${isMemoOpening || isMemoClosing ? '' : 'scale-100 opacity-100'}`}
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
              style={{ transition: `opacity ${0.2 * (settings.animationSpeed || 1) * (isConvListClosing ? 2.0 : 1)}s ease` }}
              className={`absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm ${isConvListOpening ? 'opacity-0' : isConvListClosing ? 'opacity-0' : 'opacity-100'}`}
              onClick={() => { setIsConvListClosing(true); setTimeout(() => { setShowConvList(false); setIsConvListClosing(false); }, Math.round(780 * (settings.animationSpeed || 1) * 2.0)); }}
            >
              <div
                style={{
                  transition: `transform ${0.75 * (settings.animationSpeed || 1) * (isConvListClosing ? 2.0 : 1)}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${0.3 * (settings.animationSpeed || 1) * (isConvListClosing ? 2.0 : 1)}s ease`,
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
                          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
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
                            <div className="text-[11px] text-slate-400 mt-1">{meta.createdAt ? new Date(meta.createdAt).toLocaleString('zh-CN') : ''}</div>
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
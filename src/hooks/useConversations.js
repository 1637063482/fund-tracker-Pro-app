// Hook: Conversation management extracted from PortfolioChat.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { conversationsDao } from '../services/firestoreDao';
import { doc, updateDoc, setDoc, onSnapshot, query, collection, deleteDoc } from 'firebase/firestore';
import { db, appId } from '../config/firebase';

export function useConversations(user, settings) {
  const [conversations, setConversations] = useState({});
  const [activeConvId, setActiveConvId] = useState('default');
  const [loadingConvs, setLoadingConvs] = useState({});
  const [showConvList, setShowConvList] = useState(false);
  const [convListTriggerRect, setConvListTriggerRect] = useState(null);
  const [isConvListOpening, setIsConvListOpening] = useState(true);
  const [isConvListClosing, setIsConvListClosing] = useState(false);
  const [editingConvId, setEditingConvId] = useState(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [showButton, setShowButton] = useState(true);

  const convListFlip = convListTriggerRect ? {
    tx: convListTriggerRect.left + convListTriggerRect.width / 2 - window.innerWidth / 2,
    ty: convListTriggerRect.top + convListTriggerRect.height / 2 - window.innerHeight / 2,
    scale: Math.max(convListTriggerRect.width / 600, 0.12)
  } : null;

  // Load conversations list
  useEffect(() => {
    if (!user || !db) return;
    const convsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chat_convs');
    const unsub = onSnapshot(query(convsRef), (snapshot) => {
      const list = {};
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        if (d.messages?.length > 0) {
          const lastUserMsg = [...d.messages].reverse().find(m => m.role === 'user');
          const convTitle = docSnap.id === 'default'
            ? '默认对话'
            : (d.title || (lastUserMsg ? lastUserMsg.content.substring(0, 30) : '新对话'));
          list[docSnap.id] = {
            title: convTitle,
            createdAt: d.createdAt || '',
            lastMessage: d.title || ''
          };
        }
      });
      if (!list.default) {
        list.default = { title: '默认对话', createdAt: '', lastMessage: '' };
      }
      setConversations(list);
    }, (err) => {
      console.error('加载对话列表失败:', err);
      setConversations(prev => {
        if (!prev.default) return { ...prev, default: { title: '默认对话', createdAt: '', lastMessage: '' } };
        return prev;
      });
    });
    return () => unsub();
  }, [user]);

  const isLoading = !!loadingConvs[activeConvId];

  const setConvLoading = useCallback((convId, loading) => {
    setLoadingConvs(prev => {
      if (loading) return { ...prev, [convId]: true };
      const next = { ...prev };
      delete next[convId];
      return next;
    });
  }, []);

  const handleStartEditTitle = useCallback((convId, currentTitle) => {
    setEditingConvId(convId);
    setEditTitleValue(currentTitle || '');
  }, []);

  const handleSaveTitle = useCallback(async (convId) => {
    const newTitle = editTitleValue.trim();
    if (newTitle && user && db) {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId), { title: newTitle })
        .catch(err => console.warn('更新对话标题失败:', err));
    }
    setEditingConvId(null);
  }, [editTitleValue, user]);

  const handleNewConversation = useCallback(() => {
    const newId = 'conv_' + Date.now();
    const existingTitles = Object.keys(conversations);
    let idx = 1;
    let title = '新对话';
    while (existingTitles.find(k => conversations[k]?.title === title)) {
      idx++;
      title = '新对话';
    }
    setConversations(prev => ({ ...prev, [newId]: { title, createdAt: new Date().toISOString(), lastMessage: '' } }));
    setActiveConvId(newId);
    setShowConvList(false);
    try {
      setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', newId), {
        messages: [], title, createdAt: new Date().toISOString()
      });
    } catch (e) { console.warn('创建对话文档失败:', e); }
  }, [conversations, user]);

  const handleSwitchConversation = useCallback((convId) => {
    setActiveConvId(convId);
    setShowConvList(false);
  }, []);

  const handleDeleteConversation = useCallback(async (convId) => {
    if (!user || !db) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId));
      if (convId === activeConvId) {
        setActiveConvId('default');
      }
    } catch (err) {
      console.error('删除对话失败:', err);
    }
  }, [user, activeConvId]);

  const persistConversation = useCallback((convId, msgs) => {
    if (!user || !db) return Promise.resolve();
    const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId);
    const existing = conversations[convId]?.createdAt;
    const payload = { messages: msgs };
    if (!existing) {
      const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
      payload.title = lastUserMsg ? lastUserMsg.content.substring(0, 30) + (lastUserMsg.content.length > 30 ? '...' : '') : '新对话';
      payload.createdAt = new Date().toISOString();
    } else {
      payload.createdAt = existing;
    }
    return setDoc(ref, payload, { merge: true });
  }, [user, conversations]);

  return {
    conversations, setConversations,
    activeConvId, setActiveConvId,
    loadingConvs, setConvLoading, isLoading,
    showConvList, setShowConvList,
    convListTriggerRect, setConvListTriggerRect,
    isConvListOpening, setIsConvListOpening,
    isConvListClosing, setIsConvListClosing,
    editingConvId, setEditingConvId,
    editTitleValue, setEditTitleValue,
    handleStartEditTitle, handleSaveTitle,
    handleNewConversation, handleSwitchConversation, handleDeleteConversation,
    persistConversation, showButton, setShowButton,
    convListFlip
  };
}


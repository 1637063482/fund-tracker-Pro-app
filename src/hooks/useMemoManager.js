// Hook: Memo and scoring management extracted from PortfolioChat.jsx
import { useState, useEffect, useCallback } from 'react';
import { memosDao, scoringDao } from '../services/firestoreDao';
import { db } from '../config/firebase';

export function useMemoManager(user, settings) {
  const [memos, setMemos] = useState([]);
  const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
  const [memoTriggerRect, setMemoTriggerRect] = useState(null);
  const [isMemoClosing, setIsMemoClosing] = useState(false);
  const [isMemoOpening, setIsMemoOpening] = useState(true);
  const [editingMemoId, setEditingMemoId] = useState(null);
  const [editMemoForm, setEditMemoForm] = useState({ decisionType: '', coreLogic: '' });
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmTriggerRect, setConfirmTriggerRect] = useState(null);
  const [showInspectionBanner, setShowInspectionBanner] = useState(false);

  // Scoring state
  const [scoringHistory, setScoringHistory] = useState(null);
  const [showScoringPanel, setShowScoringPanel] = useState(false);
  const [isScoringClosing, setIsScoringClosing] = useState(false);
  const [isScoringOpening, setIsScoringOpening] = useState(true);
  const [scoringTriggerRect, setScoringTriggerRect] = useState(null);
  const [isScoringLoading, setIsScoringLoading] = useState(false);

  const memoFlip = memoTriggerRect ? {
    tx: memoTriggerRect.left + memoTriggerRect.width / 2 - window.innerWidth / 2,
    ty: memoTriggerRect.top + memoTriggerRect.height / 2 - window.innerHeight / 2,
    scale: Math.max(memoTriggerRect.width / 600, 0.12)
  } : null;

  const scoringFlip = scoringTriggerRect ? {
    tx: scoringTriggerRect.left + scoringTriggerRect.width / 2 - window.innerWidth / 2,
    ty: scoringTriggerRect.top + scoringTriggerRect.height / 2 - window.innerHeight / 2,
    scale: Math.max(scoringTriggerRect.width / 600, 0.12)
  } : null;

  // Load memos via DAO
  useEffect(() => {
    if (!user || !db) return;
    const unsub = memosDao.getAll(user.uid, (data) => {
      setMemos(data);
    });
    return () => unsub();
  }, [user]);

  // Load scoring history via DAO (on-demand, not realtime)
  const fetchScoringHistory = useCallback(async () => {
    if (!user || !db) return;
    setIsScoringLoading(true);
    try {
      const data = await scoringDao.getRecent(user.uid, 30);
      setScoringHistory(data);
    } catch (err) {
      console.error('拉取打分快照失败:', err);
      setScoringHistory([]);
    } finally {
      setIsScoringLoading(false);
    }
  }, [user]);

  const handleDeleteMemo = useCallback(async (memoId) => {
    setConfirmAction({
      message: '确定要抹除 AI 的这条策略记忆吗？',
      onConfirm: async () => {
        try {
          await memosDao.delete(user.uid, memoId);
        } catch (error) {}
      }
    });
  }, [user]);

  const handleDeleteScoringSnapshot = useCallback(async (snapId) => {
    setConfirmAction({
      message: '确定要删除这条打分历史记录吗？此操作无法恢复。',
      onConfirm: async () => {
        try {
          await scoringDao.delete(user.uid, snapId);
          setScoringHistory(prev => prev ? prev.filter(s => s.id !== snapId) : null);
        } catch (error) {}
      }
    });
  }, [user]);

  const handleSaveMemoEdit = useCallback(async (memoId) => {
    if (!editMemoForm.coreLogic.trim()) return;
    try {
      await memosDao.save(user.uid, memoId, {
        decisionType: editMemoForm.decisionType,
        coreLogic: editMemoForm.coreLogic.trim(),
        updatedAt: new Date().toISOString()
      });
      setEditingMemoId(null);
    } catch (error) {
      alert('保存修改失败: ' + error.message);
    }
  }, [editMemoForm, user]);

  // Inspection banner — Friday check
  useEffect(() => {
    const today = new Date();
    const isFriday = today.getDay() === 5;
    const todayStr = today.toISOString().split('T')[0];
    const lastInspection = settings?.lastInspectionDate;
    if (isFriday && lastInspection !== todayStr) {
      setShowInspectionBanner(true);
    } else {
      setShowInspectionBanner(false);
    }
  }, [settings?.lastInspectionDate]);

  return {
    memos, setMemos,
    isMemoModalOpen, setIsMemoModalOpen,
    memoTriggerRect, setMemoTriggerRect,
    isMemoClosing, setIsMemoClosing,
    isMemoOpening, setIsMemoOpening,
    editingMemoId, setEditingMemoId,
    editMemoForm, setEditMemoForm,
    confirmAction, setConfirmAction,
    confirmTriggerRect, setConfirmTriggerRect,
    handleDeleteMemo, handleDeleteScoringSnapshot, handleSaveMemoEdit,
    showInspectionBanner, setShowInspectionBanner,
    scoringHistory, setScoringHistory,
    showScoringPanel, setShowScoringPanel,
    isScoringClosing, setIsScoringClosing,
    isScoringOpening, setIsScoringOpening,
    scoringTriggerRect, setScoringTriggerRect,
    isScoringLoading, setIsScoringLoading,
    fetchScoringHistory,
    memoFlip, scoringFlip
  };
}

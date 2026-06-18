// Hook: Firestore funds management
import { useState, useEffect } from 'react';
import { fundsDao } from '../services/firestoreDao';
import { db } from '../config/firebase';
import { evaluateExpression } from '../utils/helpers';

export function useFirestoreFunds(user) {
  const [funds, setFunds] = useState([]);
  const [fundNavs, setFundNavs] = useState({});
  const [fetchingNavCodes, setFetchingNavCodes] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    if (!user || !db) return;
    const unsub = fundsDao.getAll(user.uid, (data) => {
      setFunds(data);
    });
    return () => unsub();
  }, [user]);

  const handleSaveFund = async (fund) => {
    if (!user || !db) return;
    const fundId = fund.id || Date.now().toString();
    const preArchiveValue = fund.mode === 'auto'
      ? (Number(fund.shares) || 0) * (fundNavs[fund.fundCode]?.nav || fund.lastNav || 0)
      : (evaluateExpression(fund.currentValueRaw) || 0);
    let finalCurrentValue = fund.isArchived ? 0 : preArchiveValue;
    const payload = {
      name: fund.name || '未命名基金',
      transactions: fund.transactions || [],
      currentValueRaw: fund.currentValueRaw || '0',
      currentValue: finalCurrentValue,
      exitValue: fund.isArchived ? (fund.exitValue || preArchiveValue) : (fund.exitValue || 0),
      mode: fund.mode === 'auto' ? 'auto' : 'manual',
      fundCode: fund.fundCode || '',
      shares: fund.shares ? Number(fund.shares) : 0,
      isArchived: !!fund.isArchived,
      lastNav: fundNavs[fund.fundCode]?.nav || fund.lastNav || 0,
      lastNavDate: fundNavs[fund.fundCode]?.date || fund.lastNavDate || '',
      redemptionFees: fund.redemptionFees || {},
      assetAllocation: fund.assetAllocation || { stock: '', bond: '', cash: '', fund: '', other: '' },
      updatedAt: new Date().toISOString()
    };
    try { await fundsDao.save(user.uid, fundId, payload); }
    catch (err) { console.error('保存失败', err); }
  };

  const handleDeleteFund = async (id) => {
    if (!user || !db) return;
    setDeleteConfirm({ id });
  };

  const confirmDeleteFund = async () => {
    if (!deleteConfirm || !user || !db) return;
    await fundsDao.delete(user.uid, deleteConfirm.id);
    setDeleteConfirm(null);
  };

  return { funds, fundNavs, setFundNavs, fetchingNavCodes, setFetchingNavCodes, handleSaveFund, handleDeleteFund, deleteConfirm, setDeleteConfirm, confirmDeleteFund };
}
